import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { cleanupExpiredDeletedAccounts } from "../src/maintenance";
import { normalizeCampusEmail } from "../src/auth";

const databases = [] as ReturnType<typeof createDatabase>[];

function setup(sendEmail?: Parameters<typeof createApp>[0]["sendEmail"]) {
  const db = createDatabase({ path: ":memory:", seedDemoUsers: true });
  databases.push(db);
  const app = createApp({
    database: db,
    demoAuthEnabled: true,
    sessionSecret: "test-only-secret",
    allowedOrigins: ["http://localhost:5173"],
    sendEmail,
  });
  return { app, db };
}

async function login(app: ReturnType<typeof createApp>, role = "student") {
  const response = await app.request("/api/auth/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected a demo session cookie");
  return cookie;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("Shenxiaoli API", () => {
  test("production login follows the request host behind an HTTP proxy without a configured public URL", async () => {
    const db = createDatabase({ path: ":memory:", seedDemoUsers: false });
    databases.push(db);
    const codes = new Map<string, string>();
    const app = createApp({
      database: db,
      production: true,
      sessionSecret: "production-test-secret-at-least-32-characters",
      allowedOrigins: [],
      sendEmail: async ({ to, text }) => {
        codes.set(to, /验证码是 (\d{6})/.exec(text)?.[1] ?? "");
      },
    });
    for (const [host, email, role] of [
      ["first.tunnel.example", "teacher@suat-sz.edu.cn", "student"],
      ["second.tunnel.example:9443", "student@suat-sz.edu.cn", "student"],
    ]) {
      const headers = {
        host: host!,
        origin: `https://${host}`,
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.21",
      };
      const request = (
        path: string,
        init: NonNullable<Parameters<typeof app.request>[1]> = {},
      ) =>
        app.request(`http://api:8787${path}`, {
          ...init,
          headers: { ...headers, ...init.headers },
        });
      const send = await request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        body: JSON.stringify({ email, type: "sign-in" }),
      });
      expect(send.status).toBe(200);
      expect(codes.get(email!)).toMatch(/^\d{6}$/);
      const signIn = await request("/api/auth/sign-in/email-otp", {
        method: "POST",
        body: JSON.stringify({
          email,
          otp: codes.get(email!),
          name: "穿透测试",
        }),
      });
      expect(signIn.status).toBe(200);
      const setCookie = signIn.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).not.toContain("Domain=");
      const cookie = setCookie.split(";")[0]!;
      const session = await request("/api/session", { headers: { cookie } });
      expect(await session.json()).toMatchObject({
        authenticated: true,
        user: { role, emailVerified: true },
      });
      expect(
        (
          await request("/api/auth/sign-out", {
            method: "POST",
            headers: {
              cookie,
              origin: "https://evil.example",
              "x-forwarded-host": "evil.example",
            },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request("/api/me/profile", {
            method: "PATCH",
            headers: { cookie },
            body: JSON.stringify({ displayName: "合法同源请求" }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request("/api/auth/sign-out", {
            method: "POST",
            headers: { cookie },
            body: "{}",
          })
        ).status,
      ).toBe(200);
      expect(
        await (await request("/api/session", { headers: { cookie } })).json(),
      ).toMatchObject({ authenticated: false });
    }
  });

  test("registration accepts exact campus domains and never promotes an external admin email", async () => {
    expect(normalizeCampusEmail(" STUDENT@STU.SUAT-SZ.EDU.CN ")).toBe(
      "student@stu.suat-sz.edu.cn",
    );
    expect(normalizeCampusEmail("teacher@suat-sz.edu.cn")).toBe(
      "teacher@suat-sz.edu.cn",
    );
    for (const email of [
      "person@vip.qq.com",
      "student@sub.stu.suat-sz.edu.cn",
      "student@stu.suat-sz.edu.cn.evil.test",
      "invalid",
      "a@@suat-sz.edu.cn",
    ]) {
      expect(normalizeCampusEmail(email)).toBeNull();
      const { app } = setup();
      const denied = await app.request(
        "/api/auth/email-otp/send-verification-otp",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        },
      );
      expect(denied.status).toBe(400);
    }
  });

  test("a verified campus account is a student until explicitly granted admin access", async () => {
    let sentText = "";
    const email = "admin.test@stu.suat-sz.edu.cn";
    const { app, db } = setup(async (message) => {
      sentText = message.text;
    });
    const headers = {
      origin: "http://localhost:5173",
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.20",
    };
    const send = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email, type: "sign-in" }),
      },
    );
    expect(send.status).toBe(200);
    const signIn = await app.request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        otp: /验证码是 (\d{6})/.exec(sentText)?.[1],
        name: "校园管理员",
      }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0];
    const request = (path: string) =>
      app.request(path, { headers: { ...headers, cookie } });
    expect(await (await request("/api/session")).json()).toMatchObject({
      authenticated: true,
      campusEmailVerified: true,
      user: { email, role: "student" },
    });
    expect((await request("/api/admin/courses/import-template")).status).toBe(
      403,
    );
    db.query("UPDATE users SET is_admin = 1 WHERE email = ?").run(email);
    expect((await request("/api/admin/courses/import-template")).status).toBe(
      200,
    );
    db.query("UPDATE users SET account_status = 'banned' WHERE email = ?").run(
      email,
    );
    expect((await request("/api/admin/courses/import-template")).status).toBe(
      403,
    );
    db.query("UPDATE users SET account_status = 'active' WHERE email = ?").run(
      email,
    );
    db.query("UPDATE auth_users SET emailVerified = 0 WHERE email = ?").run(
      email,
    );
    expect((await request("/api/admin/courses/import-template")).status).toBe(
      401,
    );
  });

  test("health and product data endpoints return seeded development data", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
    expect((await app.request("/api/ready")).status).toBe(200);

    const denied = await app.request("/api/home");
    expect(denied.status).toBe(401);
    const home = await app.request("/api/home", { headers: { cookie } });
    const homeData = (await home.json()) as {
      latestSkills: unknown[];
      latestListings: unknown[];
      latestTreePosts: unknown[];
      demoData: boolean;
    };
    expect(homeData.latestSkills.length).toBeGreaterThan(0);
    expect(homeData.latestListings.length).toBeGreaterThan(0);
    expect(homeData.latestTreePosts.length).toBeGreaterThan(0);
    expect(homeData.demoData).toBe(true);
    const demoSkillStats = await app.request("/api/skills/stats", {
      headers: { cookie },
    });
    expect(await demoSkillStats.json()).toMatchObject({
      successfulPairs: 0,
      completedCollaborations: 0,
      helpResolution: { numerator: 0, denominator: 0, rate: null },
    });

    const courses = await app.request("/api/courses", { headers: { cookie } });
    const courseData = (await courses.json()) as { items: { code: string }[] };
    expect(courseData.items.length).toBeGreaterThan(0);
    expect(courseData.items[0]?.code).toBeTruthy();

    const search = await app.request("/api/search?q=ICGA503", {
      headers: { cookie },
    });
    const searchData = (await search.json()) as {
      results: { type: string; identifier: string }[];
    };
    expect(searchData.results.some((item) => item.type === "course")).toBe(
      true,
    );
    const allSearch = await app.request(
      "/api/search?q=ICGA503&type=course&page=1&pageSize=1",
      { headers: { cookie } },
    );
    const allSearchData = (await allSearch.json()) as {
      results: { type: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(allSearchData).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(allSearchData.results[0]?.type).toBe("course");

    const listings = await app.request("/api/market/listings", {
      headers: { cookie },
    });
    expect(
      ((await listings.json()) as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);

    const skills = await app.request("/api/skills", { headers: { cookie } });
    expect(
      ((await skills.json()) as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);
  });

  test("tree-hole requires a session and publishes anonymously immediately", async () => {
    const { app } = setup();
    const unauthorized = await app.request("/api/tree-hole", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "A sufficiently long test post",
        topic: "科研",
      }),
    });
    expect(unauthorized.status).toBe(401);

    const studentCookie = await login(app);
    const submitted = await app.request("/api/tree-hole", {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json" },
      body: JSON.stringify({
        content: "A sufficiently long test post",
        topic: "科研",
      }),
    });
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as {
      id: string;
      status: string;
    };
    expect(submission.status).toBe("approved");

    const publicFeed = await app.request("/api/tree-hole", {
      headers: { cookie: studentCookie },
    });
    const publicData = (await publicFeed.json()) as { items: { id: string }[] };
    const visiblePost = (
      publicData.items as { id: string; author: string; user_id?: string }[]
    ).find((item) => item.id === submission.id);
    expect(visiblePost?.author).toBe("匿名狸友");
    expect(visiblePost).not.toHaveProperty("user_id");
  });

  test("moderation routes reject regular student sessions", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const response = await app.request("/api/admin/queue", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });

  test("course, market, skill and contact flows persist data", async () => {
    const { app } = setup();
    const studentCookie = await login(app);
    const anonymousCourses = await app.request("/api/courses");
    expect(anonymousCourses.status).toBe(401);
    const coursesResponse = await app.request("/api/courses", {
      headers: { cookie: studentCookie },
    });
    const courses = (await coursesResponse.json()) as {
      items: { id: string }[];
    };
    const courseId = courses.items[0]?.id;
    expect(courseId).toBeTruthy();

    const reviewResponse = await app.request(
      `/api/courses/${courseId}/reviews`,
      {
        method: "POST",
        headers: { cookie: studentCookie, "content-type": "application/json" },
        body: JSON.stringify({
          rating: 8,
          difficulty: 3,
          workload: 2.5,
          content: "A helpful, detailed course review for automated testing.",
          term: "2026 秋",
          tags: ["清晰"],
        }),
      },
    );
    expect(reviewResponse.status).toBe(201);
    const review = (await reviewResponse.json()) as {
      id: string;
      status: string;
    };
    expect(review.status).toBe("approved");
    const publicReviews = await app.request(
      `/api/courses/${courseId}/reviews`,
      { headers: { cookie: studentCookie } },
    );
    expect(
      ((await publicReviews.json()) as { items: { id: string }[] }).items.some(
        (item) => item.id === review.id,
      ),
    ).toBe(true);

    const listingResponse = await app.request("/api/market/listings", {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json" },
      body: JSON.stringify({
        title: "二手实验记录本",
        category: "教材书籍",
        price: 8,
        condition: "九成新",
        location: "图书馆",
        description: "测试用的商品说明，内页完整无缺损。",
        images: [],
      }),
    });
    expect(listingResponse.status).toBe(201);
    const listing = (await listingResponse.json()) as { id: string };

    const skillResponse = await app.request("/api/skills", {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "offer",
        title: "Python 入门互助",
        category: "数据与科研",
        description: "可以一起梳理 Python 基础语法和常用数据处理方法。",
        tags: ["Python"],
      }),
    });
    expect(skillResponse.status).toBe(201);
    const skill = (await skillResponse.json()) as { id: string };

    const moderatorCookie = await login(app, "moderator");
    const contactResponse = await app.request(
      `/api/market/listings/${listing.id}/contact`,
      {
        method: "POST",
        headers: {
          cookie: moderatorCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "想确认一下交易地点。" }),
      },
    );
    expect(contactResponse.status).toBe(201);
    const inbox = await app.request("/api/me/contact-requests", {
      headers: { cookie: studentCookie },
    });
    expect(
      ((await inbox.json()) as { items: { targetId: string }[] }).items.some(
        (item) => item.targetId === listing.id,
      ),
    ).toBe(true);

    const received = await app.request("/api/me/contact-requests", {
      headers: { cookie: studentCookie },
    });
    const requestItem = (
      (await received.json()) as { items: { id: string; status: string }[] }
    ).items.find((item) => item.status === "pending");
    expect(requestItem).toBeTruthy();
    const accepted = await app.request(
      `/api/me/contact-requests/${requestItem?.id}`,
      {
        method: "PATCH",
        headers: { cookie: studentCookie, "content-type": "application/json" },
        body: JSON.stringify({ status: "accepted" }),
      },
    );
    expect(accepted.status).toBe(200);
    const { conversationId } = (await accepted.json()) as {
      conversationId: string;
    };
    const sent = await app.request(
      `/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          cookie: moderatorCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientId: "test-message-0001",
          body: "你好，商品还在吗？",
        }),
      },
    );
    expect(sent.status).toBe(201);
    const messages = await app.request(
      `/api/conversations/${conversationId}/messages`,
      { headers: { cookie: studentCookie } },
    );
    expect(
      ((await messages.json()) as { items: { body: string }[] }).items[0]?.body,
    ).toBe("你好，商品还在吗？");
    for (let index = 0; index < 21; index += 1) {
      const message = await app.request(
        `/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            cookie: moderatorCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            clientId: `history-${String(index).padStart(4, "0")}`,
            body: `历史消息 ${index}`,
          }),
        },
      );
      expect(message.status).toBe(201);
    }
    const recent = await app.request(
      `/api/conversations/${conversationId}/messages?pageSize=20`,
      { headers: { cookie: studentCookie } },
    );
    const recentData = (await recent.json()) as {
      items: { id: string }[];
      hasMore: boolean;
      nextCursor: string;
    };
    expect(recentData.items).toHaveLength(20);
    expect(recentData.hasMore).toBe(true);
    const older = await app.request(
      `/api/conversations/${conversationId}/messages?pageSize=20&before=${recentData.nextCursor}`,
      { headers: { cookie: studentCookie } },
    );
    const olderData = (await older.json()) as {
      items: { id: string }[];
      hasMore: boolean;
    };
    expect(olderData.items).toHaveLength(2);
    expect(olderData.hasMore).toBe(false);
    expect(
      olderData.items.some((item) =>
        recentData.items.some((recentItem) => recentItem.id === item.id),
      ),
    ).toBe(false);

    const queue = await app.request("/api/admin/queue", {
      headers: { cookie: moderatorCookie },
    });
    const queueItems = (await queue.json()) as {
      items: { id: string; type: string }[];
    };
    expect(
      queueItems.items.some(
        (item) => item.id === review.id && item.type === "review",
      ),
    ).toBe(false);
    expect(skill.id).toBeTruthy();
  });

  test("skill recommendations, bilateral completion, feedback and disputes follow real states", async () => {
    const { app, db } = setup();
    const requester = await login(app);
    const provider = await login(app, "moderator");
    const createSkill = async (
      cookie: string,
      input: { kind: "offer" | "request"; title: string },
    ) =>
      app.request("/api/skills", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          category: "数据与科研",
          description: "一起梳理真实问题、练习方法并记录互助进度。",
          tags: ["Python", "统计"],
        }),
      });

    const request = await createSkill(requester, {
      kind: "request",
      title: "求助：统计分析入门",
    });
    const offer = await createSkill(provider, {
      kind: "offer",
      title: "分享：Python 与统计分析",
    });
    const requestId = ((await request.json()) as { id: string }).id;
    const offerId = ((await offer.json()) as { id: string }).id;
    const recommendations = await app.request(
      `/api/skills/recommendations?requestId=${requestId}`,
      { headers: { cookie: requester } },
    );
    const recommendationItems = (
      (await recommendations.json()) as {
        items: Array<{ id: string; reasons: string[] }>;
      }
    ).items;
    expect(recommendationItems[0]?.id).toBe(offerId);
    expect(recommendationItems[0]?.reasons).toEqual([
      "同一领域",
      "2 个标签相符",
    ]);

    const initialStats = await app.request("/api/skills/stats", {
      headers: { cookie: requester },
    });
    expect(await initialStats.json()).toMatchObject({
      successfulPairs: 0,
      completedCollaborations: 0,
      helpResolution: { numerator: 0, denominator: 1, rate: 0 },
    });

    const proposal = await app.request(
      `/api/skills/requests/${requestId}/collaborations`,
      {
        method: "POST",
        headers: { cookie: provider, "content-type": "application/json" },
        body: JSON.stringify({
          offerPostId: offerId,
          scope: "一起完成入门练习并复盘分析步骤。",
        }),
      },
    );
    expect(proposal.status).toBe(201);
    const collaborationId = ((await proposal.json()) as { id: string }).id;
    const accepted = await app.request(
      `/api/collaborations/${collaborationId}`,
      {
        method: "PATCH",
        headers: { cookie: requester, "content-type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      },
    );
    expect(accepted.status).toBe(200);
    const oneSided = await app.request(
      `/api/collaborations/${collaborationId}`,
      {
        method: "PATCH",
        headers: { cookie: requester, "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm-complete" }),
      },
    );
    expect(oneSided.status).toBe(200);
    const notYetComplete = await app.request("/api/skills/stats", {
      headers: { cookie: requester },
    });
    expect(await notYetComplete.json()).toMatchObject({
      successfulPairs: 1,
      completedCollaborations: 0,
      helpResolution: { numerator: 0, denominator: 1, rate: 0 },
    });

    const completed = await app.request(
      `/api/collaborations/${collaborationId}`,
      {
        method: "PATCH",
        headers: { cookie: provider, "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm-complete" }),
      },
    );
    expect(completed.status).toBe(200);
    const finalStats = await app.request("/api/skills/stats", {
      headers: { cookie: requester },
    });
    expect(await finalStats.json()).toMatchObject({
      successfulPairs: 1,
      completedCollaborations: 1,
      helpResolution: { numerator: 1, denominator: 1, rate: 100 },
    });
    const feedback = await app.request(
      `/api/collaborations/${collaborationId}/feedback`,
      {
        method: "POST",
        headers: { cookie: provider, "content-type": "application/json" },
        body: JSON.stringify({ rating: 5, content: "一起完成了目标。" }),
      },
    );
    expect(feedback.status).toBe(201);
    const duplicateFeedback = await app.request(
      `/api/collaborations/${collaborationId}/feedback`,
      {
        method: "POST",
        headers: { cookie: provider, "content-type": "application/json" },
        body: JSON.stringify({ rating: 4, content: "重复反馈不可覆盖。" }),
      },
    );
    expect(duplicateFeedback.status).toBe(409);

    const secondRequest = await createSkill(requester, {
      kind: "request",
      title: "求助：第二项数据分析练习",
    });
    const secondRequestId = ((await secondRequest.json()) as { id: string }).id;
    const secondProposal = await app.request(
      `/api/skills/requests/${secondRequestId}/collaborations`,
      {
        method: "POST",
        headers: { cookie: provider, "content-type": "application/json" },
        body: JSON.stringify({
          offerPostId: offerId,
          scope: "一起确认练习目标并进行复盘。",
        }),
      },
    );
    const disputedId = ((await secondProposal.json()) as { id: string }).id;
    await app.request(`/api/collaborations/${disputedId}`, {
      method: "PATCH",
      headers: { cookie: requester, "content-type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    const dispute = await app.request(`/api/collaborations/${disputedId}`, {
      method: "PATCH",
      headers: { cookie: provider, "content-type": "application/json" },
      body: JSON.stringify({ action: "dispute" }),
    });
    expect(dispute.status).toBe(200);
    const queue = await app.request("/api/admin/queue", {
      headers: { cookie: provider },
    });
    expect(
      (
        (await queue.json()) as { items: Array<{ id: string; type: string }> }
      ).items.some(
        (item) => item.id === disputedId && item.type === "collaboration",
      ),
    ).toBe(true);
    const resolvedDispute = await app.request(
      `/api/admin/collaborations/${disputedId}/resolve`,
      {
        method: "POST",
        headers: { cookie: provider, "content-type": "application/json" },
        body: JSON.stringify({
          outcome: "resume",
          reason: "双方沟通后继续合作，并重新确认完成情况。",
        }),
      },
    );
    expect(resolvedDispute.status).toBe(200);
    expect(
      db
        .query("SELECT status FROM skill_collaborations WHERE id = ?")
        .get(disputedId),
    ).toEqual({ status: "active" });
    expect(
      db
        .query(
          "SELECT action FROM moderation_audit WHERE target_id = ? AND target_type = 'skill-collaboration'",
        )
        .get(disputedId),
    ).toEqual({ action: "dispute-resume" });
  });

  test("campus email OTP creates a verified account and rejects unapproved domains", async () => {
    let sentText = "";
    const { app, db } = setup(async ({ text }) => {
      sentText = text;
    });
    const invalid = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "student@sub.stu.suat-sz.edu.cn",
          type: "sign-in",
        }),
      },
    );
    expect(invalid.status).toBe(400);
    const send = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: " New.User@STU.SUAT-SZ.EDU.CN ",
          type: "sign-in",
        }),
      },
    );
    expect(send.status).toBe(200);
    const otp = /验证码是 (\d{6})/.exec(sentText)?.[1];
    expect(otp).toBeTruthy();
    const signIn = await app.request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@stu.suat-sz.edu.cn",
        otp,
        name: "测试狸友",
      }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const session = await app.request("/api/session", {
      headers: { cookie: cookie! },
    });
    expect(await session.json()).toMatchObject({
      authenticated: true,
      campusEmailVerified: true,
    });
    const saved = db
      .query("SELECT email, email_verified FROM users WHERE email = ?")
      .get("new.user@stu.suat-sz.edu.cn") as {
      email: string;
      email_verified: number;
    } | null;
    expect(saved).toEqual({
      email: "new.user@stu.suat-sz.edu.cn",
      email_verified: 1,
    });
    const staffCodeRequest = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "Staff@SUAT-SZ.EDU.CN",
          type: "sign-in",
        }),
      },
    );
    expect(staffCodeRequest.status).toBe(200);
    const staffOtp = /验证码是 (\d{6})/.exec(sentText)?.[1];
    const staffLogin = await app.request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "staff@suat-sz.edu.cn",
        otp: staffOtp,
        name: "教职工邮箱测试",
      }),
    });
    expect(staffLogin.status).toBe(200);
  });

  test("report handling hides content and an independent reviewer can restore it on appeal", async () => {
    let sentText = "";
    const { app, db } = setup(async ({ text }) => {
      sentText = text;
    });
    const owner = await login(app);
    const originalModerator = await login(app, "moderator");
    const listingResponse = await app.request("/api/market/listings", {
      method: "POST",
      headers: { cookie: owner, "content-type": "application/json" },
      body: JSON.stringify({
        title: "待审核的旧教材",
        category: "教材书籍",
        price: 20,
        condition: "九成新",
        location: "图书馆",
        description: "用于验证举报、下架和申诉恢复闭环的测试商品。",
        images: [],
      }),
    });
    const listingId = ((await listingResponse.json()) as { id: string }).id;
    const report = await app.request("/api/reports", {
      method: "POST",
      headers: {
        cookie: originalModerator,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        targetType: "listing",
        targetId: listingId,
        reason: "商品描述需要核实真实性。",
      }),
    });
    expect(report.status).toBe(201);
    const reportId = ((await report.json()) as { id: string }).id;
    const handled = await app.request(`/api/admin/reports/${reportId}/action`, {
      method: "POST",
      headers: {
        cookie: originalModerator,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "hide",
        reason: "收到举报后暂时隐藏，等待复核。",
      }),
    });
    expect(handled.status).toBe(200);
    const hidden = await app.request("/api/market/listings", {
      headers: { cookie: owner },
    });
    expect(
      ((await hidden.json()) as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === listingId,
      ),
    ).toBe(false);
    const caseId = ((await handled.json()) as { caseId: string }).caseId;
    const submittedAppeal = await app.request("/api/me/appeals", {
      method: "POST",
      headers: { cookie: owner, "content-type": "application/json" },
      body: JSON.stringify({
        caseId,
        reason: "我补充了商品来源凭证，请求由其他审核员复核。",
      }),
    });
    expect(submittedAppeal.status).toBe(201);

    const sentCode = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "independent.reviewer@suat-sz.edu.cn",
          type: "sign-in",
        }),
      },
    );
    expect(sentCode.status).toBe(200);
    const otp = /验证码是 (\d{6})/.exec(sentText)?.[1];
    const reviewerLogin = await app.request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "independent.reviewer@suat-sz.edu.cn",
        otp,
        name: "独立复核员",
      }),
    });
    expect(reviewerLogin.status).toBe(200);
    const reviewerCookie = reviewerLogin.headers
      .get("set-cookie")
      ?.split(";")[0];
    expect(reviewerCookie).toBeTruthy();
    await app.request("/api/session", { headers: { cookie: reviewerCookie! } });
    const reviewerId = (
      db
        .query("SELECT id FROM auth_users WHERE email = ?")
        .get("independent.reviewer@suat-sz.edu.cn") as { id: string }
    ).id;
    db.query("UPDATE users SET role = 'moderator' WHERE id = ?").run(
      reviewerId,
    );

    const restored = await app.request(`/api/admin/appeals/${caseId}`, {
      method: "PATCH",
      headers: {
        cookie: reviewerCookie!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        outcome: "restore",
        reason: "复核通过，证明材料完整，恢复该商品。",
      }),
    });
    expect(restored.status).toBe(200);
    expect(
      db
        .query(
          "SELECT status, moderation_status FROM market_listings WHERE id = ?",
        )
        .get(listingId),
    ).toEqual({ status: "active", moderation_status: "visible" });
    expect(
      db
        .query(
          "SELECT status, appeal_reviewer_id FROM moderation_cases WHERE id = ?",
        )
        .get(caseId),
    ).toEqual({
      status: "reinstated",
      appeal_reviewer_id: reviewerId,
    });
    expect(
      db
        .query(
          "SELECT COUNT(*) AS count FROM notifications WHERE user_id = 'demo-student' AND kind IN ('moderation-action', 'appeal-result')",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(
      db
        .query(
          "SELECT COUNT(*) AS count FROM notifications WHERE user_id = 'demo-moderator' AND kind = 'report-result'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  test("account deletion revokes access immediately and clears identity after 30 days", async () => {
    let sentText = "";
    const { app, db } = setup(async ({ text }) => {
      sentText = text;
    });
    const email = "account.deletion@stu.suat-sz.edu.cn";
    const sendCode = async () =>
      app.request("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "x-forwarded-for": "203.0.113.45",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, type: "sign-in" }),
      });
    expect((await sendCode()).status).toBe(200);
    const signIn = await app.request("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "x-forwarded-for": "203.0.113.45",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        otp: /验证码是 (\d{6})/.exec(sentText)?.[1],
        name: "准备注销的狸友",
      }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    await app.request("/api/session", { headers: { cookie: cookie! } });
    const userId = (
      db.query("SELECT id FROM users WHERE email = ?").get(email) as {
        id: string;
      }
    ).id;
    const listing = await app.request("/api/market/listings", {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({
        title: "注销后隐藏的商品",
        category: "教材书籍",
        price: 5,
        condition: "九成新",
        location: "图书馆",
        description: "用来验证账号注销时会立即隐藏发布内容。",
        images: [],
      }),
    });
    const listingId = ((await listing.json()) as { id: string }).id;
    const deletionCode = await app.request("/api/me/account/deletion-code", {
      method: "POST",
      headers: { cookie: cookie! },
    });
    expect(deletionCode.status).toBe(200);
    const deletionOtp = /注销验证码是 (\d{6})/.exec(sentText)?.[1];
    const deleted = await app.request("/api/me/account/delete", {
      method: "POST",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ otp: deletionOtp }),
    });
    expect(deleted.status).toBe(200);
    const invalidatedSession = await app.request("/api/session", {
      headers: { cookie: cookie! },
    });
    expect(await invalidatedSession.json()).toMatchObject({
      authenticated: false,
    });
    expect(
      db
        .query("SELECT email, account_status FROM users WHERE id = ?")
        .get(userId),
    ).toEqual({ email, account_status: "deleting" });
    expect(
      db.query("SELECT 1 FROM auth_users WHERE id = ?").get(userId),
    ).toBeNull();
    const viewer = await login(app);
    const visibleListings = await app.request("/api/market/listings", {
      headers: { cookie: viewer },
    });
    expect(
      (
        (await visibleListings.json()) as { items: Array<{ id: string }> }
      ).items.some((item) => item.id === listingId),
    ).toBe(false);
    expect((await sendCode()).status).toBe(410);

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString();
    db.query("UPDATE users SET deleted_at = ? WHERE id = ?").run(
      oldDate,
      userId,
    );
    expect(cleanupExpiredDeletedAccounts(db)).toBe(1);
    expect(
      db
        .query(
          "SELECT email, email_verified, account_cleanup_completed_at FROM users WHERE id = ?",
        )
        .get(userId),
    ).toMatchObject({ email: null, email_verified: 0 });
    db.query("DELETE FROM auth_email_cooldowns").run();
    expect((await sendCode()).status).toBe(200);
  });

  test("comments, favorites and publication management are private and owner-scoped", async () => {
    const { app } = setup();
    const owner = await login(app);
    const other = await login(app, "moderator");
    const treeComment = await app.request("/api/comments", {
      method: "POST",
      headers: { cookie: owner, "content-type": "application/json" },
      body: JSON.stringify({
        targetType: "tree-hole",
        targetId: "tree-lab",
        content: "刚开始时慢下来很正常，我们一起加油。",
      }),
    });
    expect(treeComment.status).toBe(201);
    const query = "/api/comments?targetType=tree-hole&targetId=tree-lab";
    const comments = await app.request(query, { headers: { cookie: other } });
    const firstRead = (
      (await comments.json()) as { items: Array<Record<string, unknown>> }
    ).items[0];
    const secondRead = await app.request(query, { headers: { cookie: other } });
    const second = (
      (await secondRead.json()) as { items: Array<Record<string, unknown>> }
    ).items[0];
    expect(firstRead?.author).toBe(second?.author);
    expect(firstRead?.author).toStartWith("同帖同学 ");
    expect(firstRead).not.toHaveProperty("commentUserId");

    const publication = await app.request("/api/me/publications", {
      headers: { cookie: owner },
    });
    expect(publication.status).toBe(200);
    const listing = await app.request("/api/market/listings", {
      method: "POST",
      headers: { cookie: owner, "content-type": "application/json" },
      body: JSON.stringify({
        title: "可编辑商品",
        category: "教材书籍",
        price: 10,
        condition: "九成新",
        location: "图书馆",
        description: "这是一个用于验证所有权的测试商品。",
        images: [],
      }),
    });
    const listingId = ((await listing.json()) as { id: string }).id;
    const favorite = await app.request(`/api/favorites/listing/${listingId}`, {
      method: "POST",
      headers: { cookie: other },
    });
    expect(favorite.status).toBe(200);
    const forbidden = await app.request(
      `/api/publications/listing/${listingId}`,
      {
        method: "PATCH",
        headers: { cookie: other, "content-type": "application/json" },
        body: JSON.stringify({
          title: "篡改",
          category: "其他",
          price: 1,
          condition: "新",
          location: "校内",
          description: "不允许编辑别人的商品内容。",
        }),
      },
    );
    expect(forbidden.status).toBe(404);
  });

  test("admin CSV course import previews rows and links teacher reviews to offerings", async () => {
    const { app, db } = setup();
    const moderatorCookie = await login(app, "moderator");
    db.query("UPDATE users SET is_admin = 1 WHERE id = 'demo-moderator'").run();
    const studentCookie = await login(app);
    const headers = {
      cookie: moderatorCookie,
      "content-type": "application/json",
    };
    const invalid = await app.request("/api/admin/courses/import-preview", {
      method: "POST",
      headers,
      body: JSON.stringify({
        filename: "bad.csv",
        csv: "courseCode,courseTitle,department,credits,term,section,teacherCode,teacherName,teacherDepartment\nBAD101,课程,学院,x,2026秋,A,T1,老师,学院",
      }),
    });
    expect(invalid.status).toBe(422);
    expect(
      ((await invalid.json()) as { valid: boolean; errors: unknown[] }).errors
        .length,
    ).toBeGreaterThan(0);

    const csv = [
      "courseCode,courseTitle,department,credits,term,section,teacherCode,teacherName,teacherDepartment",
      "TEST100,测试课程,计算机学院,3,2026秋,A,TC001,李老师,计算机学院",
      "TEST100,测试课程,计算机学院,3,2026秋,A,TC002,王老师,计算机学院",
    ].join("\n");
    const preview = await app.request("/api/admin/courses/import-preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ filename: "courses.csv", csv }),
    });
    expect(preview.status).toBe(200);
    const previewData = (await preview.json()) as {
      valid: boolean;
      previewId: string;
      summary: {
        rows: number;
        courses: number;
        offerings: number;
        teachers: number;
      };
    };
    expect(previewData).toMatchObject({
      valid: true,
      summary: { rows: 2, courses: 1, offerings: 1, teachers: 2 },
    });
    const confirm = await app.request("/api/admin/courses/import-confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ previewId: previewData.previewId }),
    });
    expect(confirm.status).toBe(200);
    const course = await app.request("/api/courses/TEST100", {
      headers: { cookie: studentCookie },
    });
    const courseData = (await course.json()) as {
      id: string;
      offerings: { id: string; teachers: { id: string; name: string }[] }[];
    };
    expect(courseData.offerings).toHaveLength(1);
    expect(
      courseData.offerings[0]?.teachers.map((teacher) => teacher.name),
    ).toContain("李老师");
    expect(
      courseData.offerings[0]?.teachers.map((teacher) => teacher.name),
    ).toContain("王老师");

    const teachers = await app.request("/api/teachers?q=李老师", {
      headers: { cookie: studentCookie },
    });
    const teacherData = (await teachers.json()) as {
      items: { id: string; name: string }[];
    };
    expect(teacherData.items[0]?.name).toBe("李老师");
    const submitted = await app.request(
      `/api/courses/${courseData.id}/reviews`,
      {
        method: "POST",
        headers: { cookie: studentCookie, "content-type": "application/json" },
        body: JSON.stringify({
          offeringId: courseData.offerings[0]?.id,
          term: "ignored",
          rating: 9,
          difficulty: 2,
          workload: 2,
          content: "这是与本次真实开课记录关联的测试评价。",
          tags: [],
        }),
      },
    );
    expect(submitted.status).toBe(201);
    const filtered = await app.request(
      `/api/courses/TEST100/reviews?teacherId=${teacherData.items[0]?.id}`,
      { headers: { cookie: studentCookie } },
    );
    expect(((await filtered.json()) as { total: number }).total).toBe(1);
    const teacherPage = await app.request(
      `/api/teachers/${teacherData.items[0]?.id}`,
      { headers: { cookie: studentCookie } },
    );
    expect(
      ((await teacherPage.json()) as { offerings: unknown[] }).offerings,
    ).toHaveLength(1);
  });

  test("demo sign-in is unavailable when disabled", async () => {
    const db = createDatabase({ path: ":memory:", seedDemoUsers: true });
    databases.push(db);
    const app = createApp({ database: db, demoAuthEnabled: false });
    const response = await app.request("/api/auth/demo", { method: "POST" });
    expect(response.status).toBe(404);
  });

  test("version 8 database migration preserves existing skill records", () => {
    const directory = mkdtempSync(join(tmpdir(), "shenxiaoli-migration-"));
    const databasePath = join(directory, "community.sqlite");
    const existing = createDatabase({ path: databasePath });
    existing
      .query(
        `INSERT INTO skill_posts
         (id, kind, title, category, description, status, created_at)
         VALUES ('preserved-skill', 'request', '保留的求助', '学习', '已有业务数据', 'active', '2026-10-01T00:00:00.000Z')`,
      )
      .run();
    existing.close();

    const legacy = new Database(databasePath, { strict: true });
    legacy.exec("DELETE FROM schema_migrations WHERE version = 9");
    legacy.exec("ALTER TABLE skill_posts DROP COLUMN is_demo");
    legacy.close();

    const migrated = createDatabase({ path: databasePath });
    try {
      expect(
        migrated
          .query(
            "SELECT title, is_demo FROM skill_posts WHERE id = 'preserved-skill'",
          )
          .get(),
      ).toEqual({ title: "保留的求助", is_demo: 0 });
      expect(
        migrated
          .query("SELECT MAX(version) AS version FROM schema_migrations")
          .get(),
      ).toEqual({ version: 10 });
      expect(migrated.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      migrated.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
