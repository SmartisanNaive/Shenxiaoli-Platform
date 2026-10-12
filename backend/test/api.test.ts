import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";

const databases = [] as ReturnType<typeof createDatabase>[];

function setup() {
  const db = createDatabase({ path: ":memory:", seedDemoUsers: true });
  databases.push(db);
  const app = createApp({
    database: db,
    demoAuthEnabled: true,
    sessionSecret: "test-only-secret",
    allowedOrigins: ["http://localhost:5173"],
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
  test("health and product data endpoints return seeded development data", async () => {
    const { app } = setup();
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const home = await app.request("/api/home");
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

    const courses = await app.request("/api/courses");
    const courseData = (await courses.json()) as { items: { code: string }[] };
    expect(courseData.items.length).toBeGreaterThan(0);
    expect(courseData.items[0]?.code).toBeTruthy();

    const search = await app.request("/api/search?q=ICGA503");
    const searchData = (await search.json()) as {
      results: { type: string; identifier: string }[];
    };
    expect(searchData.results.some((item) => item.type === "course")).toBe(
      true,
    );

    const listings = await app.request("/api/market/listings");
    expect(
      ((await listings.json()) as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);

    const skills = await app.request("/api/skills");
    expect(
      ((await skills.json()) as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);
  });

  test("tree-hole writes require a session and remain private until moderation", async () => {
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
    expect(submission.status).toBe("pending");

    const publicFeed = await app.request("/api/tree-hole");
    const publicData = (await publicFeed.json()) as { items: { id: string }[] };
    expect(publicData.items.some((item) => item.id === submission.id)).toBe(
      false,
    );

    const moderatorCookie = await login(app, "moderator");
    const moderation = await app.request(
      `/api/admin/tree-hole/${submission.id}`,
      {
        method: "PATCH",
        headers: {
          cookie: moderatorCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(moderation.status).toBe(200);

    const refreshed = await app.request("/api/tree-hole");
    const refreshedData = (await refreshed.json()) as {
      items: { id: string; author: string; user_id?: string }[];
    };
    const visiblePost = refreshedData.items.find(
      (item) => item.id === submission.id,
    );
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
    const coursesResponse = await app.request("/api/courses");
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
    expect(review.status).toBe("pending");

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
    ).toBe(true);
    expect(skill.id).toBeTruthy();
  });

  test("demo sign-in is unavailable when disabled", async () => {
    const db = createDatabase({ path: ":memory:", seedDemoUsers: true });
    databases.push(db);
    const app = createApp({ database: db, demoAuthEnabled: false });
    const response = await app.request("/api/auth/demo", { method: "POST" });
    expect(response.status).toBe(404);
  });
});
