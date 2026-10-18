import { afterEach, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createDatabase, SCHEMA_VERSION } from "../src/db";
import {
  initializeLocalTesting,
  localTestEmailSender,
  TEST_IDENTITIES,
} from "../src/local-testing";

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const database = () => {
  const db = createDatabase({ path: ":memory:" });
  databases.push(db);
  return db;
};

test("testing controls are absent by default, forbidden in production, and restricted to loopback hosts and origins", async () => {
  const db = database();
  const ordinary = createApp({ database: db });
  expect((await ordinary.request("/api/testing/status")).status).toBe(404);
  expect(() =>
    createApp({ database: db, production: true, localTestMode: true }),
  ).toThrow("production");
  expect(
    db
      .query("SELECT 1 FROM sqlite_master WHERE name = 'test_mail_inbox'")
      .get(),
  ).toBeNull();
  const app = createApp({ database: db, localTestMode: true });
  expect((await app.request("/api/testing/status")).status).toBe(200);
  expect(
    (await app.request("http://external.example/api/testing/status")).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/testing/inbox", {
        headers: { origin: "https://external.example" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/testing/inbox", {
        headers: { "sec-fetch-site": "cross-site" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/testing/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
  ).toBe(400);
});

test("synthetic messages stay local and real recipients use the normal sender; reset retains migrations and restores fixtures", async () => {
  const db = database();
  initializeLocalTesting(db);
  const forwarded: string[] = [];
  const send = localTestEmailSender(db, async (message) => {
    forwarded.push(message.to);
    return "provider-accepted";
  });
  const message = {
    to: TEST_IDENTITIES[0].email,
    subject: "验证码",
    text: "验证码是 123456",
    idempotencyKey: "test-local",
  };
  await send(message);
  await send(message);
  await send({
    ...message,
    to: "campus.owner@stu.suat-sz.edu.cn",
    idempotencyKey: "test-real-routing",
  });
  expect(forwarded).toEqual(["campus.owner@stu.suat-sz.edu.cn"]);
  expect(
    db.query("SELECT COUNT(*) AS count FROM test_mail_inbox").get(),
  ).toEqual({ count: 1 });
  const app = createApp({ database: db, localTestMode: true });
  const response = await app.request("/api/testing/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "RESET_LOCAL_TEST_DATABASE" }),
  });
  expect(response.status).toBe(200);
  expect(
    db.query("SELECT MAX(version) AS version FROM schema_migrations").get(),
  ).toEqual({ version: SCHEMA_VERSION });
  expect(
    db.query("SELECT COUNT(*) AS count FROM test_mail_inbox").get(),
  ).toEqual({ count: 0 });
  expect(db.query("SELECT COUNT(*) AS count FROM auth_users").get()).toEqual({
    count: TEST_IDENTITIES.length,
  });
});
