import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, SCHEMA_VERSION } from "../src/db";
import { fixture } from "./fixtures";
import {
  AcademicError,
  embeddedArray,
  normalizeAcademicCourses,
  SuatAcademicClient,
  type AcademicClient,
  type AcademicConfig,
  type AcademicCourse,
  type Captcha,
  type Semester,
} from "../src/academic-client";

const semester: Semester = { id: "100", name: "2026秋", current: true };
const course: AcademicCourse = {
  sourceKey: "100:lesson-1",
  courseCode: "SUAT101",
  title: "测试教务课程",
  section: "SUAT101-01",
  teachers: ["教师甲"],
  credits: 3,
  department: "测试学院",
  courseType: "专业课",
};
class FakeAcademic implements AcademicClient {
  config: AcademicConfig = {
    passwordEnabled: true,
    smsEnabled: true,
    captchaStyle: "calculate",
    smsInterval: 60,
  };
  data = [{ ...course }];
  disposed = false;
  factor = false;
  failure = false;
  smsFailure = false;
  semesterFailure = false;
  pending: Promise<void> | null = null;
  async initialize() {
    return this.config;
  }
  async captcha(): Promise<Captcha> {
    return { kind: "image", image: "data:image/png;base64,YWJj" };
  }
  async verifyCaptcha() {}
  async sendSms() {
    if (this.smsFailure)
      throw new AcademicError("ACADEMIC_AUTH_FAILED", "短信发送失败");
  }
  async login(): Promise<{ state: "authenticated" | "second-factor" }> {
    if (this.pending) await this.pending;
    if (this.failure)
      throw new AcademicError("ACADEMIC_AUTH_FAILED", "验证码错误或已过期");
    return { state: this.factor ? "second-factor" : "authenticated" };
  }
  async sendFactor() {}
  async verifyFactor(code: string) {
    if (code !== "123456")
      throw new AcademicError("ACADEMIC_AUTH_FAILED", "验证码错误");
  }
  async semesters() {
    if (this.semesterFailure)
      throw new AcademicError("UPSTREAM_CHANGED", "学校响应异常", 502);
    return [semester, { id: "99", name: "2026春", current: false }];
  }
  async courses() {
    return this.data;
  }
  dispose() {
    this.disposed = true;
  }
}
async function setup() {
  let clock = Date.now();
  const clients: FakeAcademic[] = [];
  const f = fixture(true, false, {
    academicClientFactory: () => {
      const client = new FakeAcademic();
      clients.push(client);
      return client;
    },
    academicNow: () => clock,
  });
  const owner = f.client(),
    other = f.client();
  await owner.signIn("importer@stu.suat-sz.edu.cn");
  await other.signIn("other@stu.suat-sz.edu.cn");
  const start = async () => {
    const response = await owner.request("/api/me/course-imports", "POST", {});
    expect(response.status).toBe(201);
    const session = (await response.json()) as { id: string };
    const path = `/api/me/course-imports/${session.id}`;
    return { path, fake: clients[clients.length - 1]! };
  };
  const login = async (path: string, method = "sms") => {
    const response = await owner.request(path + "/login", "POST", {
      method,
      account: method === "sms" ? "13800000000" : "test-account",
      mobileCode: "123456",
      password: "test-password",
      captcha: "4",
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { state: string };
  };
  const preview = async (path: string) => {
    const response = await owner.request(path + "/preview", "POST", {
      semesterId: semester.id,
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      previewId: string;
      items: { sourceKey: string; requiresChoice: boolean }[];
    };
  };
  return {
    ...f,
    owner,
    other,
    start,
    login,
    preview,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("personal academic imports", () => {
  test("requires a platform session and isolates temporary sessions", async () => {
    const f = await setup();
    expect(
      (await f.client().request("/api/me/course-imports", "POST")).status,
    ).toBe(401);
    const { path, fake } = await f.start();
    expect((await f.other.request(path)).status).toBe(410);
    expect((await f.other.request(path, "DELETE")).status).toBe(410);
    expect(
      (
        await f.owner.request(path + "/preview", "POST", {
          semesterId: semester.id,
        })
      ).status,
    ).toBe(409);
    expect((await f.owner.request(path, "DELETE")).status).toBe(200);
    expect(fake.disposed).toBe(true);
    expect((await f.owner.request(path)).status).toBe(410);
  });
  test("SMS and password login, semesters, catalogue fill, privacy, reviews and durable replay", async () => {
    const f = await setup();
    const { path, fake } = await f.start();
    expect(
      (await f.owner.request(path + "/sms", "POST", { mobile: "13800000000" }))
        .status,
    ).toBe(200);
    expect(
      (await f.owner.request(path + "/sms", "POST", { mobile: "13800000000" }))
        .status,
    ).toBe(429);
    expect((await f.login(path)).state).toBe("authenticated");
    const preview = await f.preview(path);
    expect(
      f.db.query("SELECT 1 FROM courses WHERE code='SUAT101'").get(),
    ).toBeNull();
    const body = { previewId: preview.previewId };
    const response = await f.owner.request(path + "/confirm", "POST", body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      courseCount: 1,
      newCourseCount: 1,
    });
    expect(fake.disposed).toBe(true);
    expect(
      await (await f.owner.request(path + "/confirm", "POST", body)).json(),
    ).toMatchObject({ duplicate: true });
    expect(
      (await f.other.request(path + "/confirm", "POST", body)).status,
    ).toBe(410);
    const mine = (await (await f.owner.request("/api/me/courses")).json()) as {
      items: { id: string; offeringId: string; teacherNames: string[] }[];
    };
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]!.teacherNames).toEqual(["教师甲"]);
    expect(
      await (await f.other.request("/api/me/courses")).json(),
    ).toMatchObject({ total: 0 });
    expect((await f.other.request("/api/courses/SUAT101")).status).toBe(200);
    const review = {
      rating: 8,
      difficulty: 3,
      workload: 2,
      content: "测试导入课程的评价与开课关联是否正确",
      term: "2026秋",
      offeringId: mine.items[0]!.offeringId,
    };
    expect(
      (
        await f.owner.request(
          `/api/courses/${mine.items[0]!.id}/reviews`,
          "POST",
          review,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await f.owner.request(
          `/api/courses/${mine.items[0]!.id}/reviews`,
          "POST",
          review,
        )
      ).status,
    ).toBe(409);
    const second = await f.start();
    await f.login(second.path, "password");
    const next = await f.preview(second.path);
    expect(
      await (
        await f.owner.request(second.path + "/confirm", "POST", {
          previewId: next.previewId,
        })
      ).json(),
    ).toMatchObject({ newCourseCount: 0 });
    expect(
      await (await f.owner.request("/api/me/courses")).json(),
    ).toMatchObject({ total: 1 });
    const stored =
      JSON.stringify(
        f.db.query("SELECT * FROM academic_import_batches").all(),
      ) + JSON.stringify(f.db.query("SELECT * FROM academic_sms_limits").all());
    expect(stored).not.toContain("13800000000");
    expect(stored).not.toContain("123456");
    expect(stored).not.toContain("test-password");
  });
  test("expiry, cancelled in-flight login and logout destroy upstream sessions", async () => {
    const f = await setup();
    let first = await f.start();
    f.advance(180001);
    expect((await f.owner.request(first.path)).status).toBe(410);
    expect(first.fake.disposed).toBe(true);
    first = await f.start();
    let release!: () => void;
    first.fake.pending = new Promise<void>((r) => {
      release = r;
    });
    const pending = f.owner.request(first.path + "/login", "POST", {
      method: "sms",
      account: "13800000000",
      mobileCode: "123456",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await f.owner.request(first.path, "DELETE")).status).toBe(200);
    release();
    expect((await pending).status).toBe(410);
    const last = await f.start();
    expect(
      (await f.owner.request("/api/auth/sign-out", "POST", {})).status,
    ).toBe(200);
    expect(last.fake.disposed).toBe(true);
  });
  test("SMS cooldown survives new sessions, shared phone limits, and failed sends", async () => {
    const f = await setup();
    let first = await f.start();
    first.fake.smsFailure = true;
    expect(
      (
        await f.owner.request(first.path + "/sms", "POST", {
          mobile: "13800000000",
        })
      ).status,
    ).toBe(400);
    first = await f.start();
    expect(
      (
        await f.owner.request(first.path + "/sms", "POST", {
          mobile: "13800000000",
        })
      ).status,
    ).toBe(429);
    const other = (await (
      await f.other.request("/api/me/course-imports", "POST", {})
    ).json()) as { id: string };
    expect(
      (
        await f.other.request(
          `/api/me/course-imports/${other.id}/sms`,
          "POST",
          { mobile: "13800000000" },
        )
      ).status,
    ).toBe(429);
    f.advance(60001);
    expect(
      (
        await f.owner.request(first.path + "/sms", "POST", {
          mobile: "13800000000",
        })
      ).status,
    ).toBe(200);
  });
  test("second factor must complete before reading or importing courses", async () => {
    const f = await setup(),
      { path, fake } = await f.start();
    fake.factor = true;
    expect((await f.login(path, "password")).state).toBe("second-factor");
    expect((await f.owner.request(path + "/semesters")).status).toBe(409);
    expect(
      (await f.owner.request(path + "/second-factor/send", "POST", {})).status,
    ).toBe(200);
    expect(
      (
        await f.owner.request(path + "/second-factor/verify", "POST", {
          code: "000000",
        })
      ).status,
    ).toBe(400);
    expect(
      await (
        await f.owner.request(path + "/second-factor/verify", "POST", {
          code: "123456",
        })
      ).json(),
    ).toMatchObject({ state: "authenticated", defaultSemesterId: "100" });
    fake.failure = true;
    expect(
      (
        await f.owner.request(path + "/login", "POST", {
          method: "sms",
          account: "13800000000",
          mobileCode: "123456",
        })
      ).status,
    ).toBe(409);
  });
  test("semester retrieval can be retried after successful authentication", async () => {
    const f = await setup();
    const { path, fake } = await f.start();
    fake.semesterFailure = true;
    const failed = await f.owner.request(path + "/login", "POST", {
      method: "sms",
      account: "13800000000",
      mobileCode: "123456",
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      error: { message: expect.stringContaining("登录成功") },
    });
    expect(await (await f.owner.request(path)).json()).toMatchObject({
      state: "authenticated",
      semesters: [],
    });
    fake.semesterFailure = false;
    const retry = await f.owner.request(path + "/semesters");
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      state: "authenticated",
      semesters: [semester, expect.anything()],
    });
  });

  test("invalid credentials, captcha coordinates and semester fail without catalogue writes", async () => {
    const f = await setup(),
      { path, fake } = await f.start();
    fake.failure = true;
    expect(
      (
        await f.owner.request(path + "/login", "POST", {
          method: "sms",
          account: "13800000000",
          mobileCode: "123456",
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.owner.request(path + "/sms", "POST", { mobile: "123" })).status,
    ).toBe(400);
    expect((await f.owner.request(path + "/captcha", "POST", {})).status).toBe(
      200,
    );
    expect(
      (
        await f.owner.request(path + "/captcha/verify", "POST", {
          points: [{ x: 500, y: 5 }],
        })
      ).status,
    ).toBe(400);
    fake.failure = false;
    await f.login(path);
    expect(
      (await f.owner.request(path + "/preview", "POST", { semesterId: "9999" }))
        .status,
    ).toBe(400);
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM academic_import_batches").get(),
    ).toEqual({ count: 0 });
  });
  test("name candidates require explicit choice; lessonCode is not a course code", async () => {
    const f = await setup(),
      { path, fake } = await f.start();
    fake.data = [{ ...course, courseCode: "", title: "同名课程" }];
    f.db
      .query(
        "INSERT INTO courses(id,code,title,created_at) VALUES('existing','EXIST101','同名课程',?)",
      )
      .run(new Date().toISOString());
    await f.login(path);
    const preview = await f.preview(path);
    expect(preview.items[0]!.requiresChoice).toBe(true);
    expect(
      (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
          matches: { [course.sourceKey]: "another-course" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
          matches: { [course.sourceKey]: "existing" },
        })
      ).status,
    ).toBe(200);
    expect(
      f.db.query("SELECT course_id FROM academic_course_sources").get(),
    ).toEqual({ course_id: "existing" });
    expect(
      f.db.query("SELECT code FROM courses WHERE id='existing'").get(),
    ).toEqual({ code: "EXIST101" });
  });
  test("missing code uses an internal identifier and known zero credits are preserved", async () => {
    const f = await setup(),
      { path, fake } = await f.start();
    fake.data = [{ ...course, courseCode: "", credits: null }];
    await f.login(path);
    const preview = await f.preview(path);
    expect(
      (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
        })
      ).status,
    ).toBe(200);
    expect(
      f.db
        .query("SELECT code_pending,credits_known FROM courses WHERE title=?")
        .get(course.title),
    ).toEqual({ code_pending: 1, credits_known: 0 });
    const next = await f.start();
    next.fake.data = [{ ...course, credits: 0 }];
    await f.login(next.path);
    const p = await f.preview(next.path);
    expect(
      (
        await f.owner.request(next.path + "/confirm", "POST", {
          previewId: p.previewId,
        })
      ).status,
    ).toBe(200);
    expect(
      f.db
        .query(
          "SELECT code,code_pending,credits_known,credits FROM courses WHERE title=?",
        )
        .get(course.title),
    ).toEqual({
      code: "SUAT101",
      code_pending: 0,
      credits_known: 1,
      credits: 0,
    });
    const last = await f.start();
    await f.login(last.path);
    const end = await f.preview(last.path);
    await f.owner.request(last.path + "/confirm", "POST", {
      previewId: end.previewId,
    });
    expect(
      f.db.query("SELECT credits FROM courses WHERE code='SUAT101'").get(),
    ).toEqual({ credits: 0 });
  });
  test("existing maintained fields and inactive courses are preserved; failures roll back", async () => {
    const f = await setup(),
      { path, fake } = await f.start();
    f.db
      .query(
        "INSERT INTO courses(id,code,title,department,credits,active,created_at) VALUES('maintained','SUAT101','维护名称','维护学院',4,0,?)",
      )
      .run(new Date().toISOString());
    fake.data = [
      {
        ...course,
        sourceKey: "100:new",
        courseCode: "NEW102",
        title: "先写入的课程",
      },
      { ...course },
    ];
    await f.login(path);
    const preview = await f.preview(path);
    expect(
      (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
        })
      ).status,
    ).toBe(409);
    expect(
      f.db.query("SELECT 1 FROM courses WHERE code='NEW102'").get(),
    ).toBeNull();
    expect(
      f.db.query("SELECT COUNT(*) AS count FROM user_courses").get(),
    ).toEqual({ count: 0 });
    f.db.query("UPDATE courses SET active=1 WHERE id='maintained'").run();
    expect(
      (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
        })
      ).status,
    ).toBe(200);
    expect(
      f.db
        .query(
          "SELECT title,department,credits FROM courses WHERE id='maintained'",
        )
        .get(),
    ).toEqual({ title: "维护名称", department: "维护学院", credits: 4 });
  });
  test("different terms and sections are incremental, suspension blocks a pending import", async () => {
    const f = await setup(),
      { path, fake } = await f.start();
    fake.data = [
      course,
      { ...course, sourceKey: "100:second", section: "SUAT101-02" },
    ];
    await f.login(path);
    const preview = await f.preview(path);
    expect(
      await (
        await f.owner.request(path + "/confirm", "POST", {
          previewId: preview.previewId,
        })
      ).json(),
    ).toMatchObject({ courseCount: 2, newCourseCount: 1 });
    const second = await f.start();
    second.fake.data = [{ ...course, sourceKey: "99:lesson-1" }];
    await f.login(second.path);
    const p = (await (
      await f.owner.request(second.path + "/preview", "POST", {
        semesterId: "99",
      })
    ).json()) as { previewId: string };
    expect(
      (
        await f.owner.request(second.path + "/confirm", "POST", {
          previewId: p.previewId,
        })
      ).status,
    ).toBe(200);
    expect(
      await (await f.owner.request("/api/me/courses?term=2026春")).json(),
    ).toMatchObject({ total: 1 });
    const third = await f.start();
    await f.login(third.path);
    const next = await f.preview(third.path);
    f.db
      .query(
        "UPDATE users SET account_status='suspended' WHERE email='importer@stu.suat-sz.edu.cn'",
      )
      .run();
    expect(
      (
        await f.owner.request(third.path + "/confirm", "POST", {
          previewId: next.previewId,
        })
      ).status,
    ).toBe(403);
  });
});

test("normalizes activities by teaching group and rejects malformed responses", () => {
  const raw = {
    lessonId: 12,
    lessonCode: "CLASS-01",
    courseName: "测试课程",
    teachers: ["甲"],
    credits: 0,
  };
  const values = normalizeAcademicCourses(
    { studentTableVms: [{ activities: [raw, { ...raw, teachers: ["乙"] }] }] },
    semester,
  );
  expect(values).toHaveLength(1);
  expect(values[0]).toMatchObject({
    courseCode: "",
    section: "CLASS-01",
    credits: 0,
    teachers: ["乙", "甲"],
  });
  expect(() =>
    normalizeAcademicCourses({ studentTableVms: [] }, semester),
  ).toThrow();
  expect(() =>
    normalizeAcademicCourses(
      { studentTableVms: [{ activities: [{ ...raw, credits: "NaN" }] }] },
      semester,
    ),
  ).toThrow();
  expect(
    embeddedArray(
      'const semesters = [{"id":1,"nameZh":"2026秋]"}];',
      "semesters",
    ),
  ).toEqual([{ id: 1, nameZh: "2026秋]" }]);
  expect(embeddedArray("semesters = [alert(1)];", "semesters")).toBeNull();
});

function upstream(
  options: {
    factor?: boolean;
    slider?: boolean;
    failed?: boolean;
    changePassword?: boolean;
    external?: boolean;
    httpRedirect?: boolean;
  } = {},
) {
  const calls: {
    url: URL;
    body: Record<string, unknown> | null;
    headers: Headers;
  }[] = [];
  const fetcher = async (
    url: string | URL | Request,
    init?: Parameters<typeof fetch>[1],
  ) => {
    const target = new URL(String(url));
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : null;
    calls.push({ url: target, body, headers: new Headers(init?.headers) });
    const ok = (data: unknown) => Response.json({ code: 1000, data });
    if (
      target.hostname === "jw.suat-sz.edu.cn" &&
      target.pathname === "/oauth2/login" &&
      !target.search
    )
      return new Response(null, {
        status: 302,
        headers: {
          location: options.external
            ? "https://example.com/"
            : "https://sso.suat-sz.edu.cn/gravity-login/#/?app_id=123&redirect_url=https%3A%2F%2Fjw.suat-sz.edu.cn%2Foauth2%2Flogin",
          "set-cookie": "SESSION=academic; Path=/; Secure; HttpOnly",
        },
      });
    if (target.pathname === "/gravity-login/")
      return new Response("login", {
        headers: { "set-cookie": "SSO=private; Path=/; Secure; HttpOnly" },
      });
    if (target.pathname.endsWith("login_page_config"))
      return ok({
        passwordLoginEnable: true,
        mobileCodeEnable: true,
        captchaEnable: true,
        captchaStyle: options.slider ? "blockPuzzle" : "calculate",
        mobileCodeSendIntervalSeconds: 60,
      });
    if (target.pathname.endsWith("get/captcha"))
      return ok(
        options.slider
          ? {
              id: "cap",
              ajCaptchaVo: {
                originalImageBase64: "YWJj",
                jigsawImageBase64: "YWJj",
                token: "token",
                secretKey: "1234567890123456",
              },
            }
          : { id: "cap", img: "data:image/png;base64,YWJj" },
      );
    if (target.pathname.endsWith("web_login"))
      return options.failed
        ? Response.json({ code: 1013, msg: "验证码错误" })
        : ok({
            authorizationCode: "temporary-code",
            token: { cosmosAccessToken: "access-private" },
            user: { id: "school-user" },
            ...(options.factor
              ? {
                  needTwoFactorAuthenticate: true,
                  authenticationType: "sms",
                  smsOpen: true,
                }
              : {}),
            ...(options.changePassword ? { passwordExpired: true } : {}),
          });
    if (target.pathname === "/oauth2/login")
      return new Response(null, {
        status: 302,
        headers: {
          location: options.httpRedirect
            ? "http://jw.suat-sz.edu.cn/home"
            : "/home",
        },
      });
    if (target.pathname === "/home") return new Response("school-home");
    if (target.pathname === "/student/for-std/course-table")
      return new Response(
        'const semesters = [{"id":100,"nameZh":"2026秋"}];<select id="allSemesters"><option value="100" selected>2026秋</option></select>',
      );
    if (target.pathname.endsWith("print-data"))
      return Response.json({
        studentTableVms: [
          {
            activities: [
              {
                lessonId: 1,
                lessonCode: "CLASS-01",
                courseName: "课程一",
                teachers: ["教师甲"],
                credits: 3,
              },
            ],
          },
        ],
      });
    return ok({});
  };
  return { client: new SuatAcademicClient(fetcher as typeof fetch), calls };
}
test("school transport signs SMS requests, keeps host-scoped cookies and exchanges authorization", async () => {
  const { client, calls } = upstream();
  try {
    expect(await client.initialize()).toMatchObject({
      smsEnabled: true,
      passwordEnabled: true,
    });
    expect(await client.captcha()).toMatchObject({ kind: "image" });
    expect(
      calls.find((c) => c.url.pathname.endsWith("get/captcha"))!.body,
    ).not.toHaveProperty("data");
    await client.sendSms("13800000000");
    await client.login({
      method: "sms",
      account: "13800000000",
      mobileCode: "123456",
    });
    const call = calls.find((c) => c.url.pathname.endsWith("web_login"))!;
    expect(call.body!.data).toMatchObject({
      loginType: 2,
      appId: "123",
      account: "13800000000",
      mobileCode: "123456",
    });
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    expect(call.headers.get("cosmos_sgn")).toBe(
      md5(md5(String(call.body!.timestamp)) + md5(String(call.body!.seq))),
    );
    expect(call.headers.get("cookie")).toContain("SSO=private");
    expect(call.headers.get("cookie")).not.toContain("SESSION=academic");
    const semesters = await client.semesters();
    expect(semesters).toEqual([semester]);
    expect(await client.courses(semesters[0]!)).toHaveLength(1);
    const jw = calls.find((c) => c.url.pathname === "/home")!;
    expect(jw.headers.get("cookie")).toContain("SESSION=academic");
    expect(jw.headers.get("cookie")).not.toContain("SSO=private");
    expect(jw.headers.has("cosmosAccessToken")).toBe(false);
  } finally {
    client.dispose();
  }
});
test("school HTTP redirect is upgraded before sending cookies", async () => {
  const { client, calls } = upstream({ httpRedirect: true });
  try {
    await client.initialize();
    await client.login({
      method: "sms",
      account: "13800000000",
      mobileCode: "123456",
    });
    expect(await client.semesters()).toEqual([semester]);
    const home = calls.find((call) => call.url.pathname === "/home")!;
    expect(home.url.origin).toBe("https://jw.suat-sz.edu.cn");
    expect(home.headers.get("cookie")).toContain("SESSION=academic");
    expect(calls.every((call) => call.url.protocol === "https:")).toBe(true);
  } finally {
    client.dispose();
  }
});
test("password, puzzle verification and SMS second factor follow school protocol", async () => {
  const { client, calls } = upstream({ slider: true, factor: true });
  try {
    await client.initialize();
    await expect(
      client.login({
        method: "password",
        account: "student",
        password: "raw-school-password",
      }),
    ).rejects.toThrow("人机验证");
    expect(await client.captcha()).toMatchObject({ kind: "slider" });
    await client.verifyCaptcha([{ x: 80, y: 5 }]);
    expect(
      await client.login({
        method: "password",
        account: "student",
        password: "raw-school-password",
      }),
    ).toEqual({ state: "second-factor" });
    const call = calls.find((c) => c.url.pathname.endsWith("web_login"))!;
    expect(JSON.stringify(call.body)).not.toContain("raw-school-password");
    expect(call.body!.data).toHaveProperty("captchaVerification");
    expect(call.body!.data).not.toHaveProperty("time");
    await client.sendFactor();
    await client.verifyFactor("123456");
    expect(
      calls.find((c) => c.url.pathname.endsWith("verify/code/send"))!.body!
        .data,
    ).toMatchObject({
      type: "sms",
      userId: "school-user",
      verifyCodeBusinessType: "twoFactorAuthentication",
    });
    expect(
      calls.some(
        (c) => c.url.searchParams.get("cosmos_code") === "temporary-code",
      ),
    ).toBe(true);
  } finally {
    client.dispose();
  }
});
test("upstream failures, password change and disallowed redirects are explicit", async () => {
  for (const flags of [{ failed: true }, { changePassword: true }]) {
    const { client } = upstream(flags);
    try {
      await client.initialize();
      await expect(
        client.login({
          method: "sms",
          account: "13800000000",
          mobileCode: "123456",
        }),
      ).rejects.toThrow(flags.failed ? "验证码" : "修改密码");
    } finally {
      client.dispose();
    }
  }
  const { client, calls } = upstream({ external: true });
  try {
    await expect(client.initialize()).rejects.toThrow("格式发生变化");
    expect(calls).toHaveLength(1);
  } finally {
    client.dispose();
  }
  const aborted = new SuatAcademicClient((async () => {
    throw new DOMException("timeout", "TimeoutError");
  }) as unknown as typeof fetch);
  await expect(aborted.initialize()).rejects.toThrow("中断或超时");
  aborted.dispose();
});

test("version 10 migration preserves catalogue and adds personal course storage", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "shenxiaoli-academic-migration-"),
  );
  const path = join(directory, "old.sqlite");
  try {
    const old = createDatabase({ path, seedDemoUsers: true });
    const count = old.query("SELECT COUNT(*) AS count FROM courses").get();
    old.exec(`DROP TABLE user_courses; DROP TABLE academic_course_sources; DROP TABLE academic_import_batches; DROP TABLE academic_sms_limits;
      ALTER TABLE courses DROP COLUMN code_pending; ALTER TABLE courses DROP COLUMN credits_known;
      ALTER TABLE course_offerings DROP COLUMN imported_teachers_json; DELETE FROM schema_migrations WHERE version=11;`);
    old.close();
    const migrated = createDatabase({ path });
    try {
      expect(
        migrated
          .query("SELECT MAX(version) AS version FROM schema_migrations")
          .get(),
      ).toEqual({ version: SCHEMA_VERSION });
      expect(
        migrated.query("SELECT COUNT(*) AS count FROM courses").get(),
      ).toEqual(count);
      expect(
        migrated.query("SELECT COUNT(*) AS count FROM user_courses").get(),
      ).toEqual({ count: 0 });
      expect(migrated.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("account deletion removes personal enrolments and receipts but keeps shared courses", async () => {
  const f = await setup(),
    { path } = await f.start();
  await f.login(path);
  const preview = await f.preview(path);
  expect(
    (
      await f.owner.request(path + "/confirm", "POST", {
        previewId: preview.previewId,
      })
    ).status,
  ).toBe(200);
  const pending = await f.start();
  expect(
    (await f.owner.request("/api/me/account/deletion-code", "POST", {})).status,
  ).toBe(200);
  expect(
    (
      await f.owner.request("/api/me/account/delete", "POST", {
        otp: f.code("importer@stu.suat-sz.edu.cn"),
      })
    ).status,
  ).toBe(200);
  expect(pending.fake.disposed).toBe(true);
  expect(
    f.db.query("SELECT COUNT(*) AS count FROM user_courses").get(),
  ).toEqual({ count: 0 });
  expect(
    f.db.query("SELECT COUNT(*) AS count FROM academic_import_batches").get(),
  ).toEqual({ count: 0 });
  expect(
    f.db.query("SELECT 1 FROM courses WHERE code='SUAT101'").get(),
  ).not.toBeNull();
});
