import { describe, expect, test } from "bun:test";
import { fixture } from "./fixtures";

type Client = ReturnType<ReturnType<typeof fixture>["client"]>;
const listingInput = {
  title: "功能测试教材",
  category: "教材书籍",
  price: 5,
  condition: "九成新",
  location: "图书馆",
  description: "用于验证每个功能的合成测试商品。",
  images: [],
};
async function created(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
async function tree(c: Client) {
  return created(
    await c.request("/api/tree-hole", "POST", {
      content: "测试树洞内容应该保持匿名并且支持互动。",
      topic: "科研",
    }),
  );
}

describe("member feature and access matrix", () => {
  test("contacts support decline, cancel, self-contact protection and private conversations with idempotent messages and blocks", async () => {
    const f = fixture();
    const a = f.client();
    const b = f.client();
    const outsider = f.client();
    const owner = await a.signIn("test.user.owner@stu.suat-sz.edu.cn");
    const sender = await b.signIn("test.user.sender@suat-sz.edu.cn");
    const moderator = await outsider.signIn(
      "test.moderator.other@suat-sz.edu.cn",
    );
    f.db
      .query("UPDATE users SET role = 'moderator' WHERE id = ?")
      .run(moderator.id);
    const listingId = await created(
      await a.request("/api/market/listings", "POST", listingInput),
    );
    expect(
      (
        await a.request(`/api/market/listings/${listingId}/contact`, "POST", {
          message: "联系自己",
        })
      ).status,
    ).toBe(400);
    const request = () =>
      b.request(`/api/market/listings/${listingId}/contact`, "POST", {
        message: "想了解这本测试教材。",
      });
    const first = await created(await request());
    expect(
      (
        await b.request(`/api/me/contact-requests/${first}`, "PATCH", {
          status: "accepted",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await a.request(`/api/me/contact-requests/${first}`, "PATCH", {
          status: "declined",
        })
      ).status,
    ).toBe(200);
    const second = await created(await request());
    expect(
      (
        await b.request(`/api/me/contact-requests/${second}`, "PATCH", {
          status: "cancelled",
        })
      ).status,
    ).toBe(200);
    const third = await created(await request());
    const accepted = await a.request(
      `/api/me/contact-requests/${third}`,
      "PATCH",
      { status: "accepted" },
    );
    expect(accepted.status).toBe(200);
    const { conversationId } = (await accepted.json()) as {
      conversationId: string;
    };
    expect(await (await a.request("/api/conversations")).json()).toMatchObject({
      items: [{ id: conversationId }],
      total: 1,
    });
    expect(
      await (await outsider.request("/api/conversations")).json(),
    ).toMatchObject({ items: [], total: 0 });
    expect(
      (
        await a.request(`/api/me/contact-requests/${third}`, "PATCH", {
          status: "accepted",
        })
      ).status,
    ).toBe(404);
    expect(
      (await outsider.request(`/api/conversations/${conversationId}/messages`))
        .status,
    ).toBe(404);
    expect(
      (
        await outsider.request(
          `/api/conversations/${conversationId}/messages`,
          "POST",
          { clientId: "unauthorized-message", body: "越权消息" },
        )
      ).status,
    ).toBe(404);
    const path = `/api/conversations/${conversationId}/messages`;
    const message = {
      clientId: "deduplicated-message-1",
      body: "第一次消息正文",
    };
    const messageId = await created(await b.request(path, "POST", message));
    expect(await (await b.request(path, "POST", message)).json()).toMatchObject(
      { id: messageId, duplicate: true },
    );
    expect(
      (await a.request(`/api/conversations/${conversationId}/read`, "POST"))
        .status,
    ).toBe(200);
    expect(
      (await a.request(`/api/me/blocks/${sender.id}`, "POST")).status,
    ).toBe(200);
    expect(
      (
        await b.request(path, "POST", {
          clientId: "blocked-message-1",
          body: "不能投递",
        })
      ).status,
    ).toBe(403);
    expect(await (await a.request("/api/me/blocks")).json()).toMatchObject({
      items: [{ userId: sender.id }],
    });
    expect(
      (await a.request(`/api/me/blocks/${sender.id}`, "DELETE")).status,
    ).toBe(200);
    expect(
      (
        await b.request(path, "POST", {
          clientId: "unblocked-message-1",
          body: "可以继续交流",
        })
      ).status,
    ).toBe(201);
    const report = await a.request(
      `/api/messages/${messageId}/report`,
      "POST",
      { reason: "测试消息举报流程" },
    );
    expect(report.status).toBe(201);
    expect(
      (
        await outsider.request(`/api/messages/${messageId}/report`, "POST", {
          reason: "不允许越权举报",
        })
      ).status,
    ).toBe(404);
    expect((await outsider.request("/api/admin/queue")).status).toBe(200);
    expect(
      f.db
        .query(
          "SELECT COUNT(*) AS count FROM moderation_audit WHERE action = 'view-reported-message'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      f.db
        .query(
          "SELECT COUNT(*) AS count FROM moderation_evidence WHERE target_type = 'message'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(owner.id).not.toBe(sender.id);
  });

  test("anonymous reactions are booleans and comments, replies, favorites, edits and deletions remain owner-scoped", async () => {
    const f = fixture();
    const a = f.client();
    const b = f.client();
    await a.signIn("test.user.a@stu.suat-sz.edu.cn");
    await b.signIn("test.user.b@suat-sz.edu.cn");
    const id = await tree(a);
    expect((await b.request(`/api/tree-hole/${id}/feel`, "POST")).status).toBe(
      200,
    );
    const feed = (await (await b.request("/api/tree-hole")).json()) as {
      items: {
        id: string;
        reacted: boolean;
        author: string;
        userId?: string;
      }[];
    };
    expect(feed.items[0]).toMatchObject({
      id,
      reacted: true,
      author: "匿名狸友",
    });
    expect(feed.items[0]?.userId).toBeUndefined();
    const parent = await created(
      await a.request("/api/comments", "POST", {
        targetType: "tree-hole",
        targetId: id,
        content: "一级匿名评论",
      }),
    );
    const reply = await created(
      await b.request("/api/comments", "POST", {
        targetType: "tree-hole",
        targetId: id,
        parentId: parent,
        content: "友善回复内容",
      }),
    );
    expect(
      (
        await b.request(`/api/comments/${parent}`, "PATCH", {
          content: "越权修改",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await a.request(`/api/comments/${parent}`, "PATCH", {
          content: "作者编辑后的评论",
        })
      ).status,
    ).toBe(200);
    expect((await b.request(`/api/comments/${reply}`, "DELETE")).status).toBe(
      200,
    );
    expect(
      (await a.request(`/api/favorites/tree-hole/${id}`, "POST")).status,
    ).toBe(200);
    expect(
      (await a.request(`/api/favorites/tree-hole/${id}`, "POST")).status,
    ).toBe(200);
    expect(await (await b.request("/api/favorites")).json()).toMatchObject({
      items: [],
    });
    expect(
      (await a.request(`/api/favorites/tree-hole/${id}`, "DELETE")).status,
    ).toBe(200);
    expect(
      (
        await a.request(`/api/publications/tree-hole/${id}`, "PATCH", {
          content: "作者编辑后的树洞内容。",
          topic: "校园生活",
        })
      ).status,
    ).toBe(200);
    expect(
      (await b.request(`/api/publications/tree-hole/${id}`, "DELETE")).status,
    ).toBe(404);
    expect(
      (await a.request(`/api/publications/tree-hole/${id}`, "DELETE")).status,
    ).toBe(200);
    expect((await b.request(`/api/tree-hole/${id}/feel`, "POST")).status).toBe(
      404,
    );
  });

  test("profile, notification preferences and read state are private; feedback validates campus contact and sessions revoke", async () => {
    const f = fixture();
    const a = f.client();
    const b = f.client();
    const user = await a.signIn("test.user.profile@suat-sz.edu.cn");
    await b.signIn("test.user.other@suat-sz.edu.cn");
    expect(
      (await a.request("/api/me/profile", "PATCH", { displayName: "新昵称" }))
        .status,
    ).toBe(200);
    expect(
      (await a.request("/api/me/profile", "PATCH", { displayName: "x" }))
        .status,
    ).toBe(400);
    expect(
      (
        await a.request("/api/notifications/preferences", "PATCH", {
          socialEmailEnabled: false,
        })
      ).status,
    ).toBe(200);
    expect(
      await (await a.request("/api/notifications/preferences")).json(),
    ).toEqual({ socialEmailEnabled: false });
    f.db
      .query(
        "INSERT INTO notifications (id, user_id, kind, title, dedupe_key, created_at) VALUES ('private-notification', ?, 'message', '私有通知', 'private-notification', ?)",
      )
      .run(user.id, new Date().toISOString());
    expect(
      (await b.request("/api/notifications/private-notification", "PATCH"))
        .status,
    ).toBe(404);
    expect(await (await a.request("/api/notifications")).json()).toMatchObject({
      unread: 1,
    });
    expect(
      (await a.request("/api/notifications/private-notification", "PATCH"))
        .status,
    ).toBe(200);
    expect(
      (await a.request("/api/notifications/read-all", "POST")).status,
    ).toBe(200);
    expect(await (await a.request("/api/notifications")).json()).toMatchObject({
      unread: 0,
    });
    const guest = f.client();
    expect(
      (
        await guest.request("/api/feedback", "POST", {
          email: "test@vip.qq.com",
          subject: "测试反馈",
          message: "这是一条足够长的访客反馈内容。",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await guest.request("/api/feedback", "POST", {
          email: "test@suat-sz.edu.cn",
          subject: "测试反馈",
          message: "这是一条足够长的访客反馈内容。",
        })
      ).status,
    ).toBe(201);
    expect((await a.request("/api/me/sessions/revoke", "POST")).status).toBe(
      200,
    );
    expect(await (await a.request("/api/session")).json()).toMatchObject({
      authenticated: false,
    });
  });
});

describe("administrator and reviewer feature matrix", () => {
  test("CSV imports enforce roles, preview ownership, expiry, replay protection and atomic rollback", async () => {
    const f = fixture();
    const admin = f.client();
    const second = f.client();
    const moderator = f.client();
    const a = await admin.signIn("test.admin.a@suat-sz.edu.cn");
    const b = await second.signIn("test.admin.b@suat-sz.edu.cn");
    const m = await moderator.signIn("test.moderator.a@suat-sz.edu.cn");
    f.db
      .query("UPDATE users SET is_admin = 1 WHERE id IN (?, ?)")
      .run(a.id, b.id);
    f.db.query("UPDATE users SET role = 'moderator' WHERE id = ?").run(m.id);
    expect(
      (await moderator.request("/api/admin/courses/import-template")).status,
    ).toBe(403);
    expect(
      (await admin.request("/api/admin/courses/import-template")).status,
    ).toBe(200);
    const csv =
      "courseCode,courseTitle,department,credits,term,section,teacherCode,teacherName,teacherDepartment\nTEST101,事务测试课程,测试学院,3,2026秋,A,T001,测试教师,测试学院";
    const preview = await admin.request(
      "/api/admin/courses/import-preview",
      "POST",
      { filename: "test.csv", csv },
    );
    expect(preview.status).toBe(200);
    const { previewId } = (await preview.json()) as { previewId: string };
    expect(
      (
        await second.request("/api/admin/courses/import-confirm", "POST", {
          previewId,
        })
      ).status,
    ).toBe(404);
    f.db.exec(
      "CREATE TRIGGER simulate_import_failure BEFORE INSERT ON teachers BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
    );
    expect(
      (
        await admin.request("/api/admin/courses/import-confirm", "POST", {
          previewId,
        })
      ).status,
    ).toBe(500);
    expect(
      f.db
        .query("SELECT COUNT(*) AS count FROM courses WHERE code = 'TEST101'")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM course_import_batches").get(),
    ).toEqual({ count: 0 });
    f.db.exec("DROP TRIGGER simulate_import_failure");
    expect(
      (
        await admin.request("/api/admin/courses/import-confirm", "POST", {
          previewId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.request("/api/admin/courses/import-confirm", "POST", {
          previewId,
        })
      ).status,
    ).toBe(404);
    const expired = (await (
      await admin.request("/api/admin/courses/import-preview", "POST", {
        filename: "test.csv",
        csv,
      })
    ).json()) as { previewId: string };
    f.db
      .query("UPDATE course_import_previews SET expires_at = '2000-01-01'")
      .run();
    expect(
      (
        await admin.request(
          "/api/admin/courses/import-confirm",
          "POST",
          expired,
        )
      ).status,
    ).toBe(404);
    const teacher = f.db.query("SELECT id FROM teachers LIMIT 1").get() as {
      id: string;
    };
    expect(
      (
        await admin.request(`/api/admin/teachers/${teacher.id}`, "PATCH", {
          name: "新教师名",
          department: "新学院",
          bio: "教师简介",
          active: false,
        })
      ).status,
    ).toBe(200);
    expect((await admin.request(`/api/teachers/${teacher.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await admin.request(`/api/admin/teachers/${teacher.id}`, "PATCH", {
          name: "新教师名",
          active: true,
        })
      ).status,
    ).toBe(200);
  });

  test("disabling a course removes all discovery surfaces and rejects reading or writing its reviews", async () => {
    const f = fixture(true);
    const c = f.client();
    const user = await c.signIn("test.admin.catalog@suat-sz.edu.cn");
    f.db.query("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
    const result = (await (
      await c.request("/api/courses?pageSize=1")
    ).json()) as { items: { id: string; code: string }[] };
    const course = result.items[0]!;
    expect(
      (
        await c.request(`/api/admin/courses/${course.id}`, "PATCH", {
          active: false,
        })
      ).status,
    ).toBe(200);
    expect((await c.request(`/api/courses/${course.id}`)).status).toBe(404);
    for (const suffix of ["", "&type=course"]) {
      const search = (await (
        await c.request(`/api/search?q=${course.code}${suffix}`)
      ).json()) as { results: { id: string }[] };
      expect(search.results.some((item) => item.id === course.id)).toBe(false);
    }
    const home = (await (await c.request("/api/home")).json()) as {
      featuredCourses: { id: string }[];
    };
    expect(home.featuredCourses.some((item) => item.id === course.id)).toBe(
      false,
    );
    expect((await c.request(`/api/courses/${course.id}/reviews`)).status).toBe(
      404,
    );
    expect(
      (
        await c.request(`/api/courses/${course.id}/reviews`, "POST", {
          rating: 8,
          difficulty: 3,
          workload: 3,
          term: "2026 秋",
          content: "不应该允许为已停用的课程提交新评价。",
        })
      ).status,
    ).toBe(404);
  });

  test("all report actions are audited and account penalties have the expected effects", async () => {
    for (const action of ["dismiss", "hide", "remove", "warn", "mute", "ban"]) {
      const f = fixture();
      const owner = f.client();
      const reporter = f.client();
      const moderator = f.client();
      const user = await owner.signIn(`test.user.${action}@suat-sz.edu.cn`);
      await reporter.signIn("test.user.reporter@suat-sz.edu.cn");
      const reviewer = await moderator.signIn(
        "test.moderator.a@suat-sz.edu.cn",
      );
      f.db
        .query("UPDATE users SET role = 'moderator' WHERE id = ?")
        .run(reviewer.id);
      const id = await tree(owner);
      const reportId = await created(
        await reporter.request("/api/reports", "POST", {
          targetType: "tree-hole",
          targetId: id,
          reason: "验证举报处理的测试原因",
        }),
      );
      const handled = await moderator.request(
        `/api/admin/reports/${reportId}/action`,
        "POST",
        { action, reason: "管理员测试处置理由", durationDays: 1 },
      );
      expect(handled.status, action).toBe(200);
      expect(
        (
          await moderator.request(
            `/api/admin/reports/${reportId}/action`,
            "POST",
            { action, reason: "重复处置不应成功" },
          )
        ).status,
      ).toBe(404);
      expect(
        f.db
          .query(
            "SELECT COUNT(*) AS count FROM moderation_audit WHERE action = ?",
          )
          .get(action),
      ).toEqual({ count: 1 });
      const state = f.db
        .query("SELECT account_status FROM users WHERE id = ?")
        .get(user.id) as { account_status: string };
      expect(state.account_status).toBe(
        action === "mute"
          ? "suspended"
          : action === "ban"
            ? "banned"
            : "active",
      );
      if (["hide", "remove"].includes(action))
        expect(
          await (await reporter.request("/api/tree-hole")).json(),
        ).toMatchObject({ total: 0 });
      if (action === "mute")
        expect(
          (
            await owner.request("/api/tree-hole", "POST", {
              content: "禁言期间不可发布内容。",
            })
          ).status,
        ).toBe(403);
      if (action === "ban")
        expect(
          await (await owner.request("/api/session")).json(),
        ).toMatchObject({ authenticated: false });
    }
  });
});

test("each publication type can be listed, edited and deleted by its owner; market states and skill contacts work", async () => {
  const f = fixture(true);
  const owner = f.client();
  const other = f.client();
  await owner.signIn("test.user.publications@suat-sz.edu.cn");
  await other.signIn("test.user.other@suat-sz.edu.cn");
  const catalog = (await (
    await owner.request("/api/courses?pageSize=1")
  ).json()) as { items: { id: string; rating: number }[] };
  const course = catalog.items[0]!;
  const detail = (await (
    await owner.request(`/api/courses/${course.id}`)
  ).json()) as { rating: number };
  expect(detail.rating).toBe(course.rating);
  const reviewId = await created(
    await owner.request(`/api/courses/${course.id}/reviews`, "POST", {
      term: "2026 秋",
      rating: 8,
      difficulty: 3,
      workload: 3,
      content: "测试发布维护功能的完整课程评价内容。",
    }),
  );
  const listingId = await created(
    await owner.request("/api/market/listings", "POST", listingInput),
  );
  const skillData = {
    kind: "offer",
    title: "测试 Python 技能",
    category: "工程开发",
    description: "这是一条测试技能分享，用于验证发布维护功能。",
    tags: ["Python"],
    canOffer: "代码交流",
    wants: "复盘建议",
  };
  const skillId = await created(
    await owner.request("/api/skills", "POST", skillData),
  );
  const treeId = await tree(owner);
  const publications = (await (
    await owner.request("/api/me/publications")
  ).json()) as { items: { type: string }[]; total: number };
  expect(publications.total).toBe(4);
  expect(publications.items.map((item) => item.type).sort()).toEqual([
    "listing",
    "review",
    "skill",
    "tree-hole",
  ]);
  expect(
    (
      await owner.request(`/api/market/listings/${listingId}`, "PATCH", {
        status: "reserved",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await other.request(`/api/market/listings/${listingId}`, "PATCH", {
        status: "sold",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await other.request(`/api/skills/${skillId}/contact`, "POST", {
        message: "想了解技能分享的范围。",
      })
    ).status,
  ).toBe(201);
  expect(
    await (await owner.request("/api/me/collaborations")).json(),
  ).toMatchObject({ items: [], total: 0 });
  const changes: [string, string, Record<string, unknown>][] = [
    [
      "review",
      reviewId,
      {
        rating: 9,
        difficulty: 2,
        workload: 2,
        term: "2026 秋",
        content: "更新后的完整课程评价内容，供回归测试使用。",
        tags: [],
      },
    ],
    ["listing", listingId, { ...listingInput, title: "更新后的测试商品" }],
    ["skill", skillId, { ...skillData, title: "更新后的技能分享" }],
    ["tree-hole", treeId, { content: "更新后的树洞测试内容。", topic: "科研" }],
  ];
  for (const [type, id, data] of changes) {
    expect(
      (await owner.request(`/api/publications/${type}/${id}`, "PATCH", data))
        .status,
    ).toBe(200);
    expect(
      (await other.request(`/api/publications/${type}/${id}`, "PATCH", data))
        .status,
    ).toBe(404);
    expect(
      (await owner.request(`/api/publications/${type}/${id}`, "DELETE")).status,
    ).toBe(200);
  }
  expect(
    await (await owner.request("/api/me/publications")).json(),
  ).toMatchObject({ items: [], total: 0 });
});
