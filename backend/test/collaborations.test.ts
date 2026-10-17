import { expect, test } from "bun:test";
import { fixture } from "./fixtures";

test("collaborations support refusal, cancellation, private progress records and moderator cancellation of disputes", async () => {
  for (const outcome of ["decline", "cancel", "dispute-cancel"]) {
    const f = fixture();
    const requester = f.client();
    const provider = f.client();
    const moderator = f.client();
    await requester.signIn(`test.user.requester.${outcome}@suat-sz.edu.cn`);
    await provider.signIn(`test.user.provider.${outcome}@suat-sz.edu.cn`);
    const reviewer = await moderator.signIn("test.moderator.a@suat-sz.edu.cn");
    f.db
      .query("UPDATE users SET role = 'moderator' WHERE id = ?")
      .run(reviewer.id);
    const input = {
      title: "互助流程测试",
      category: "工程开发",
      description: "用于验证合作的拒绝取消及争议处理流程。",
      tags: ["测试"],
    };
    const request = await requester.request("/api/skills", "POST", {
      ...input,
      kind: "request",
    });
    const offer = await provider.request("/api/skills", "POST", {
      ...input,
      kind: "offer",
    });
    expect(request.status).toBe(201);
    expect(offer.status).toBe(201);
    const requestId = ((await request.json()) as { id: string }).id;
    const offerId = ((await offer.json()) as { id: string }).id;
    const proposal = await provider.request(
      `/api/skills/requests/${requestId}/collaborations`,
      "POST",
      { offerPostId: offerId, scope: "一起完成测试范围并进行复盘。" },
    );
    expect(proposal.status).toBe(201);
    const id = ((await proposal.json()) as { id: string }).id;
    expect(
      await (await requester.request("/api/me/collaborations")).json(),
    ).toMatchObject({ items: [{ id, isRequester: 1 }], total: 1 });
    expect(
      await (await provider.request("/api/me/collaborations")).json(),
    ).toMatchObject({ items: [{ id, isRequester: 0 }], total: 1 });
    expect(
      await (await moderator.request("/api/me/collaborations")).json(),
    ).toMatchObject({ items: [], total: 0 });
    expect(
      (
        await moderator.request(`/api/collaborations/${id}`, "PATCH", {
          action: "accept",
        })
      ).status,
    ).toBe(404);
    if (outcome === "dispute-cancel") {
      expect(
        (
          await requester.request(`/api/collaborations/${id}`, "PATCH", {
            action: "accept",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await provider.request(`/api/collaborations/${id}`, "PATCH", {
            action: "dispute",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await moderator.request(
            `/api/admin/collaborations/${id}/resolve`,
            "POST",
            { outcome: "cancel", reason: "双方同意终止本次互助" },
          )
        ).status,
      ).toBe(200);
    } else {
      expect(
        (
          await (outcome === "decline" ? requester : provider).request(
            `/api/collaborations/${id}`,
            "PATCH",
            { action: outcome },
          )
        ).status,
      ).toBe(200);
    }
    expect(
      f.db
        .query("SELECT status FROM skill_collaborations WHERE id = ?")
        .get(id),
    ).toEqual({ status: "cancelled" });
    expect(
      (
        await provider.request(`/api/collaborations/${id}/feedback`, "POST", {
          rating: 5,
          content: "未完成不可反馈",
        })
      ).status,
    ).toBe(409);
  }
});
