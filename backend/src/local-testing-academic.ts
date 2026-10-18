import { AcademicError, type AcademicClient } from "./academic-client";

// Explicitly injected by the loopback-only browser test environment. Never used
// by the normal development or production client; no SMS or school requests.
export function localAcademicFixture(): AcademicClient {
  let authenticated = false;
  let disposed = false;
  const alive = () => {
    if (disposed)
      throw new AcademicError("IMPORT_EXPIRED", "测试会话已关闭", 410);
  };
  return {
    async initialize() {
      alive();
      return {
        passwordEnabled: true,
        smsEnabled: true,
        captchaStyle: "calculate",
        smsInterval: 60,
      };
    },
    async captcha() {
      alive();
      return {
        kind: "image",
        image:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      };
    },
    async verifyCaptcha() {
      alive();
    },
    async sendSms() {
      alive();
    },
    async login(input) {
      alive();
      if (input.method === "password") {
        if (
          input.password !== "academic-test-password" ||
          input.captcha !== "4"
        )
          throw new AcademicError(
            "ACADEMIC_AUTH_FAILED",
            "学校账号、密码或图片验证码不正确",
          );
        return { state: "second-factor" };
      }
      if (input.mobileCode !== "123456")
        throw new AcademicError("ACADEMIC_AUTH_FAILED", "验证码错误或已过期");
      authenticated = true;
      return { state: "authenticated" };
    },
    async sendFactor() {
      alive();
    },
    async verifyFactor(code) {
      alive();
      if (code !== "123456")
        throw new AcademicError("ACADEMIC_AUTH_FAILED", "验证码错误或已过期");
      authenticated = true;
    },
    async semesters() {
      alive();
      if (!authenticated)
        throw new AcademicError("ACADEMIC_AUTH_REQUIRED", "请先登录教务", 401);
      return [
        { id: "100", name: "2026秋", current: true },
        { id: "99", name: "2026春", current: false },
      ];
    },
    async courses(semester) {
      alive();
      if (!authenticated)
        throw new AcademicError("ACADEMIC_AUTH_REQUIRED", "请先登录教务", 401);
      return [
        {
          sourceKey: `${semester.id}:fixture-lesson`,
          courseCode: "TEST-ACADEMIC-001",
          title: "合成教务课程",
          section: "测试教学班01",
          teachers: ["合成教务教师"],
          credits: 3,
          department: "测试学院",
          courseType: "专业课",
        },
      ];
    },
    dispose() {
      disposed = true;
      authenticated = false;
    },
  };
}
