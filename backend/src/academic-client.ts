import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { CookieJar } from "tough-cookie";

const JW = "https://jw.suat-sz.edu.cn";
const SSO = "https://sso.suat-sz.edu.cn";
const AUTH = "/cosmos/corona";
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const textValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

export class AcademicError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface AcademicConfig {
  passwordEnabled: boolean;
  smsEnabled: boolean;
  captchaStyle: string | null;
  smsInterval: number;
}
export interface Semester {
  id: string;
  name: string;
  current: boolean;
}
export interface AcademicCourse {
  sourceKey: string;
  courseCode: string;
  title: string;
  section: string;
  teachers: string[];
  credits: number | null;
  department: string;
  courseType: string;
}
export interface Captcha {
  kind: "image" | "slider" | "points";
  image: string;
  piece?: string;
  words?: string[];
}
export interface AcademicLogin {
  method: "password" | "sms";
  account: string;
  password?: string;
  mobileCode?: string;
  captcha?: string;
}
export interface AcademicClient {
  initialize(): Promise<AcademicConfig>;
  captcha(): Promise<Captcha>;
  verifyCaptcha(points: { x: number; y: number }[]): Promise<void>;
  sendSms(mobile: string): Promise<void>;
  login(
    input: AcademicLogin,
  ): Promise<{ state: "authenticated" | "second-factor" }>;
  sendFactor(): Promise<void>;
  verifyFactor(code: string): Promise<void>;
  semesters(): Promise<Semester[]>;
  courses(semester: Semester): Promise<AcademicCourse[]>;
  dispose(): void;
}

const md5 = (text: string) => createHash("md5").update(text).digest("hex");
export function encryptAcademicValue(value: string, key: string): string {
  if (![16, 24, 32].includes(Buffer.byteLength(key)))
    throw new AcademicError(
      "UPSTREAM_CHANGED",
      "学校验证参数发生变化，请稍后重试",
      502,
    );
  const cipher = createCipheriv(
    `aes-${Buffer.byteLength(key) * 8}-ecb`,
    Buffer.from(key),
    null,
  );
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString(
    "base64",
  );
}
const upstreamChanged = (stage = "unknown") => {
  console.warn(`[course-import] unexpected upstream response: ${stage}`);
  return new AcademicError(
    "UPSTREAM_CHANGED",
    "学校返回的数据格式发生变化，请稍后重试",
    502,
  );
};

// Only parse JSON embedded in the page. Never execute upstream JavaScript.
export function embeddedArray(html: string, name: string): unknown[] | null {
  const match = new RegExp(`(?:window\\.)?${name}\\s*=\\s*\\[`).exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      try {
        const value: unknown = JSON.parse(html.slice(start, i + 1));
        return Array.isArray(value) ? value : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function normalizeAcademicCourses(
  payload: unknown,
  semester: Semester,
): AcademicCourse[] {
  if (
    !isObject(payload) ||
    !Array.isArray(payload.studentTableVms) ||
    payload.studentTableVms.length !== 1
  )
    throw upstreamChanged();
  const vm: unknown = payload.studentTableVms[0];
  if (
    !isObject(vm) ||
    !Array.isArray(vm.activities) ||
    vm.activities.length > 10000
  )
    throw upstreamChanged();
  const grouped = new Map<string, AcademicCourse>();
  for (const raw of vm.activities) {
    if (!isObject(raw)) throw upstreamChanged();
    const title = textValue(raw.courseName || raw.lessonName);
    const section = textValue(raw.lessonCode);
    const teachers = Array.isArray(raw.teachers)
      ? [
          ...new Set(
            raw.teachers
              .map((t: unknown) =>
                isObject(t) ? textValue(t.nameZh || t.name) : textValue(t),
              )
              .filter(Boolean),
          ),
        ].sort()
      : [];
    const lessonId =
      textValue(raw.lessonId) ||
      section ||
      createHash("sha256")
        .update(JSON.stringify([title, teachers]))
        .digest("hex");
    if (
      !title ||
      title.length > 200 ||
      section.length > 100 ||
      teachers.some((t) => t.length > 100) ||
      teachers.length > 50 ||
      lessonId.length > 120
    )
      throw upstreamChanged();
    const courseCode = textValue(raw.courseCode);
    const credits =
      raw.credits === null || raw.credits === undefined || raw.credits === ""
        ? null
        : Number(raw.credits);
    if (
      courseCode.length > 80 ||
      (credits !== null &&
        (!Number.isFinite(credits) || credits < 0 || credits > 50))
    )
      throw upstreamChanged();
    const sourceKey = `${semester.id}:${lessonId}`;
    const previous = grouped.get(sourceKey);
    if (previous) {
      if (
        previous.title !== title ||
        previous.courseCode !== courseCode ||
        previous.section !== section ||
        previous.credits !== credits
      )
        throw upstreamChanged();
      previous.teachers = [
        ...new Set([...previous.teachers, ...teachers]),
      ].sort();
      continue;
    }
    grouped.set(sourceKey, {
      sourceKey,
      courseCode,
      title,
      section,
      teachers,
      credits,
      department: textValue(raw.departmentName).slice(0, 80),
      courseType: isObject(raw.courseType)
        ? textValue(raw.courseType.nameZh).slice(0, 40)
        : "",
    });
  }
  if (grouped.size > 200) throw upstreamChanged();
  return [...grouped.values()];
}

export class SuatAcademicClient implements AcademicClient {
  private jar = new CookieJar();
  private lifetime = new AbortController();
  private config: AcademicConfig | null = null;
  private loginType = 0;
  private appId = "";
  private callback = "";
  private tokens: Record<string, unknown> = {};
  private userId = "";
  private authorizationCode = "";
  private codeKey = "";
  private codeRename = "";
  private factorType = "sms";
  private captchaData: Record<string, unknown> | null = null;
  private captchaVerification = "";
  private semesterValues: Semester[] = [];
  private authenticated = false;

  constructor(private fetcher: typeof fetch = fetch) {}

  dispose(): void {
    this.lifetime.abort();
    this.jar = new CookieJar();
    this.tokens = {};
    this.userId = "";
    this.authorizationCode = "";
    this.callback = "";
    this.captchaData = null;
    this.captchaVerification = "";
    this.authenticated = false;
  }

  private async request(
    rawUrl: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ text: string; url: URL }> {
    let url = new URL(rawUrl),
      method = body === undefined ? "GET" : "POST";
    let data = body === undefined ? undefined : JSON.stringify(body);
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(15000),
    ]);
    try {
      for (let i = 0; i < 12; i++) {
        if (
          url.protocol !== "https:" ||
          ![JW, SSO].includes(url.origin) ||
          url.username ||
          url.password
        ) {
          console.warn(
            `[course-import] redirect protocol=${url.protocol} host=${url.hostname}`,
          );
          throw upstreamChanged("redirect destination");
        }
        const headers: Record<string, string> = {
          accept: "application/json, text/html;q=0.9",
          "user-agent": "Shenxiaoli-Course-Import/1.0",
          cookie: await this.jar.getCookieString(url.href),
          referer: url.origin + "/",
          ...extraHeaders,
        };
        if (method === "POST") {
          headers["content-type"] = "application/json";
          headers.origin = url.origin;
        }
        const response = await this.fetcher(url.href, {
          method,
          body: data,
          headers,
          redirect: "manual",
          signal,
        });
        for (const cookie of response.headers.getSetCookie())
          await this.jar.setCookie(cookie, url.href, { ignoreError: true });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw upstreamChanged("redirect without location");
          const destination = new URL(location, url);
          // The school sometimes redirects back to its own HTTP URL. Upgrade
          // navigational requests before sending cookies or authorization codes.
          if (
            destination.protocol === "http:" &&
            destination.hostname === new URL(JW).hostname &&
            !destination.port &&
            !destination.username &&
            !destination.password &&
            (method === "GET" || [301, 302, 303].includes(response.status))
          )
            destination.protocol = "https:";
          if (
            method === "POST" &&
            [307, 308].includes(response.status) &&
            destination.origin !== url.origin
          )
            throw upstreamChanged("cross-origin post redirect");
          url = destination;
          if ([301, 302, 303].includes(response.status)) {
            method = "GET";
            data = undefined;
            extraHeaders = undefined;
          }
          continue;
        }
        if (!response.ok) {
          console.warn(
            `[course-import] upstream HTTP status=${response.status} host=${url.hostname} stage=${url.pathname === AUTH + "/oauth2/v1/web_login" ? "login" : "other"}`,
          );
          await response.body?.cancel();
          throw new AcademicError(
            "UPSTREAM_UNAVAILABLE",
            response.status === 429
              ? "学校请求过于频繁，请稍后再试"
              : "暂时无法连接学校教务系统，请稍后重试",
            502,
          );
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 4_000_000) {
              await reader.cancel();
              throw upstreamChanged("response size");
            }
            chunks.push(value);
          }
        if (signal.aborted) throw new Error("aborted");
        return { text: Buffer.concat(chunks).toString("utf8"), url };
      }
      throw upstreamChanged("redirect limit");
    } catch (error) {
      if (error instanceof AcademicError) throw error;
      throw new AcademicError(
        "UPSTREAM_UNAVAILABLE",
        "教务连接已中断或超时，请重新登录后重试",
        502,
      );
    }
  }

  private async api(
    path: string,
    data?: Record<string, unknown>,
    timestamp = Date.now(),
  ): Promise<Record<string, unknown>> {
    const seq = randomBytes(12).toString("hex");
    const result = await this.request(
      SSO + AUTH + path,
      {
        ...(data === undefined ? {} : { data }),
        timestamp,
        seq,
        ...(this.userId ? { userId: this.userId } : {}),
      },
      {
        cosmos_sgn: md5(md5(String(timestamp)) + md5(seq)),
        ...(typeof this.tokens.cosmosAccessToken === "string"
          ? { cosmosAccessToken: this.tokens.cosmosAccessToken }
          : {}),
        ...(typeof this.tokens.cosmosRefreshToken === "string"
          ? { cosmosRefreshToken: this.tokens.cosmosRefreshToken }
          : {}),
      },
    );
    let value: unknown;
    try {
      value = JSON.parse(result.text);
    } catch {
      throw upstreamChanged("authentication response is not JSON");
    }
    if (!isObject(value))
      throw upstreamChanged("authentication response is not an object");
    if (value.code !== 1000) {
      const msg = textValue(value.msg);
      const message = /验证码/.test(msg)
        ? "验证码错误或已过期，请重新获取后重试"
        : /锁定|频繁/.test(msg)
          ? "学校账号或验证操作受限，请稍后再试"
          : /密码|账号/.test(msg)
            ? "学校账号或密码不正确，请检查后重试"
            : "学校未能完成本次验证，请稍后重试";
      throw new AcademicError("ACADEMIC_AUTH_FAILED", message);
    }
    return isObject(value.data) ? value.data : {};
  }

  async initialize(): Promise<AcademicConfig> {
    const result = await this.request(JW + "/oauth2/login");
    if (result.url.origin !== SSO) throw upstreamChanged();
    const params = new URLSearchParams(
      result.url.hash.split("?")[1] || result.url.search,
    );
    this.appId = params.get("app_id") || "";
    this.codeRename = params.get("cosmosCodeRename") || "";
    if (
      this.codeRename &&
      !/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(this.codeRename)
    )
      throw upstreamChanged();
    this.callback = params.get("redirect_url") || "";
    const callback = new URL(this.callback || JW);
    if (
      !this.appId ||
      callback.origin !== JW ||
      callback.pathname !== "/oauth2/login"
    )
      throw upstreamChanged();
    const value = await this.api("/oauth2/v1/login_page_config", {});
    this.loginType = Number(value.loginType ?? 0);
    this.config = {
      passwordEnabled: value.passwordLoginEnable === true,
      smsEnabled: value.mobileCodeEnable === true,
      captchaStyle: value.captchaEnable ? textValue(value.captchaStyle) : null,
      smsInterval: Math.max(
        60,
        Math.min(600, Number(value.mobileCodeSendIntervalSeconds) || 60),
      ),
    };
    return this.config;
  }

  async captcha(): Promise<Captcha> {
    this.captchaVerification = "";
    const value = await this.api("/auth/v1/get/captcha");
    const vo = value.ajCaptchaVo;
    this.captchaData = {
      id: value.id,
      ...(isObject(vo)
        ? {
            ajCaptchaVo: {
              token: vo.token,
              secretKey: vo.secretKey,
              wordList: vo.wordList,
            },
          }
        : {}),
    };
    const image = (v: unknown) => {
      const s = textValue(v);
      if (/^data:image\/(png|jpe?g);base64,[a-zA-Z0-9+/=\r\n]+$/.test(s))
        return s;
      if (s && /^[a-zA-Z0-9+/=\r\n]+$/.test(s))
        return `data:image/png;base64,${s}`;
      throw upstreamChanged();
    };
    if (!isObject(vo)) return { kind: "image", image: image(value.img) };
    return {
      kind: Array.isArray(vo.wordList) ? "points" : "slider",
      image: image(vo.originalImageBase64),
      ...(vo.jigsawImageBase64 ? { piece: image(vo.jigsawImageBase64) } : {}),
      ...(Array.isArray(vo.wordList)
        ? { words: vo.wordList.map(textValue).slice(0, 10) }
        : {}),
    };
  }

  async verifyCaptcha(points: { x: number; y: number }[]): Promise<void> {
    const vo = this.captchaData?.ajCaptchaVo;
    if (!isObject(vo))
      throw new AcademicError("CAPTCHA_REQUIRED", "请先获取人机验证图片");
    const input = Array.isArray(vo.wordList) ? points : points[0];
    if (
      !input ||
      (Array.isArray(vo.wordList) && points.length !== vo.wordList.length)
    )
      throw new AcademicError("INVALID_INPUT", "请完成图片中的人机验证");
    const pointText = JSON.stringify(input),
      token = textValue(vo.token),
      key = textValue(vo.secretKey);
    await this.api("/auth/v1/verify/captcha/aj", {
      captchaId: this.captchaData?.id,
      ajCaptchaVerifyParam: {
        pointJson: key ? encryptAcademicValue(pointText, key) : pointText,
        token,
      },
    });
    const verification = `${token}---${pointText}`;
    this.captchaVerification = key
      ? encryptAcademicValue(verification, key)
      : verification;
  }

  async sendSms(mobile: string): Promise<void> {
    if (!this.config?.smsEnabled)
      throw new AcademicError(
        "METHOD_DISABLED",
        "学校暂未开放手机号验证码登录",
      );
    await this.api("/oauth2/v1/send/mobile_code", { mobile });
  }

  async login(
    input: AcademicLogin,
  ): Promise<{ state: "authenticated" | "second-factor" }> {
    if (
      !this.config ||
      (input.method === "sms"
        ? !this.config.smsEnabled
        : !this.config.passwordEnabled)
    )
      throw new AcademicError("METHOD_DISABLED", "学校暂未开放此登录方式");
    const timestamp = Date.now();
    const data: Record<string, unknown> = {
      appId: this.appId,
      account: input.account,
    };
    if (input.method === "sms")
      Object.assign(data, { loginType: 2, mobileCode: input.mobileCode });
    else {
      Object.assign(data, {
        loginType: this.loginType,
        passwordType: 1,
        password: encryptAcademicValue(
          md5(input.password || ""),
          md5(input.account + timestamp),
        ),
      });
      if (this.config.captchaStyle) {
        if (this.captchaVerification)
          data.captchaVerification = this.captchaVerification;
        else if (input.captcha && this.captchaData?.id)
          Object.assign(data, {
            captchaId: this.captchaData.id,
            captcha: input.captcha,
          });
        else throw new AcademicError("CAPTCHA_REQUIRED", "请先完成人机验证");
      }
    }
    const value = await this.api("/oauth2/v1/web_login", data, timestamp);
    this.captchaData = null;
    this.captchaVerification = "";
    if (value.passwordExpired || value.isDefaultPassword)
      throw new AcademicError(
        "PASSWORD_CHANGE_REQUIRED",
        "学校要求修改密码，请前往学校统一认证网站完成后重新导入",
      );
    this.tokens = isObject(value.token) ? value.token : {};
    const user = isObject(value.user) ? value.user : {};
    this.userId = textValue(user.id);
    this.authorizationCode = textValue(
      value.authorizationCode || value.cosmosCode,
    );
    this.codeKey = value.authorizationCode
      ? "authorization_code"
      : this.codeRename || "cosmos_code";
    if (!this.authorizationCode) {
      throw new AcademicError(
        "UPSTREAM_CHANGED",
        "学校登录响应缺少授权信息，请重新获取验证码后重试",
        502,
      );
    }
    if (value.needTwoFactorAuthenticate) {
      if (value.authenticationType !== "sms" || !value.smsOpen || !this.userId)
        throw new AcademicError(
          "EXTRA_VERIFICATION_REQUIRED",
          "学校要求额外身份验证，请先在学校网站完成后重试",
        );
      this.factorType = "sms";
      this.config.smsInterval = Math.max(
        60,
        Math.min(600, Number(value.loginMobileCodeSendInterval) || 60),
      );
      return { state: "second-factor" };
    }
    await this.completeLogin();
    return { state: "authenticated" };
  }

  async sendFactor(): Promise<void> {
    await this.api("/oauth2/v1/verify/code/send", {
      type: this.factorType,
      userId: this.userId,
      verifyCodeBusinessType: "twoFactorAuthentication",
    });
  }
  async verifyFactor(code: string): Promise<void> {
    await this.api("/oauth2/v1/verify/code/check", {
      type: this.factorType,
      userId: this.userId,
      code,
      verifyCodeBusinessType: "twoFactorAuthentication",
    });
    // School's two-factor page exchanges the pending code as cosmos_code.
    this.codeKey = "cosmos_code";
    await this.completeLogin();
  }
  private async completeLogin(): Promise<void> {
    const url = new URL(this.callback);
    url.searchParams.set(this.codeKey, this.authorizationCode);
    if (this.codeKey !== "authorization_code")
      url.searchParams.set("use_new_code_name", "true");
    const result = await this.request(url.href);
    if (
      result.url.origin !== JW ||
      /\/login(?:\?|$)/.test(result.url.pathname) ||
      result.text.includes("统一身份认证平台")
    )
      throw new AcademicError(
        "ACADEMIC_SESSION_EXPIRED",
        "教务登录未完成，请重新登录",
        401,
      );
    this.authenticated = true;
    this.authorizationCode = "";
    this.tokens = {};
  }
  private async schoolJson(path: string): Promise<unknown> {
    const result = await this.request(JW + path);
    if (result.url.origin !== JW || /\/login$/.test(result.url.pathname))
      throw new AcademicError(
        "ACADEMIC_SESSION_EXPIRED",
        "学校登录已过期，请重新登录",
        401,
      );
    try {
      return JSON.parse(result.text) as unknown;
    } catch {
      throw upstreamChanged();
    }
  }
  async semesters(): Promise<Semester[]> {
    if (!this.authenticated)
      throw new AcademicError(
        "ACADEMIC_AUTH_REQUIRED",
        "请先完成教务登录",
        401,
      );
    const result = await this.request(JW + "/student/for-std/course-table");
    if (result.url.origin !== JW || /\/login$/.test(result.url.pathname))
      throw new AcademicError(
        "ACADEMIC_SESSION_EXPIRED",
        "学校登录已过期，请重新登录",
        401,
      );
    const values = embeddedArray(result.text, "semesters");
    const selected =
      /<select[^>]*id=["']allSemesters["'][^>]*>([\s\S]*?)<\/select>/i.exec(
        result.text,
      )?.[1] || "";
    const optionValues = [
      ...selected.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/gi),
    ].map((m) => ({
      id: /value=["']([^"']+)["']/.exec(m[1])?.[1],
      nameZh: m[2],
      selected: /\bselected\b/.test(m[1]),
    }));
    const currentId = textValue(optionValues.find((v) => v.selected)?.id);
    this.semesterValues = (values || optionValues)
      .filter(isObject)
      .map((v) => ({
        id: textValue(v.id),
        name: textValue(v.nameZh || v.name),
        current: textValue(v.id) === currentId,
      }));
    if (
      !this.semesterValues.length ||
      this.semesterValues.length > 100 ||
      this.semesterValues.some(
        (v) =>
          !/^\d{1,20}$/.test(v.id) || v.name.length < 3 || v.name.length > 40,
      )
    )
      throw upstreamChanged();
    if (!this.semesterValues.some((s) => s.current)) {
      const defaultId =
        /(?:defaultSemesterId|semesterId)\s*[:=]\s*["']?(\d+)/.exec(
          result.text,
        )?.[1];
      const target =
        this.semesterValues.find((v) => v.id === defaultId) ||
        this.semesterValues[this.semesterValues.length - 1];
      target.current = true;
    }
    return this.semesterValues;
  }
  async courses(semester: Semester): Promise<AcademicCourse[]> {
    if (
      !this.authenticated ||
      !this.semesterValues.some((s) => s.id === semester.id)
    )
      throw new AcademicError("INVALID_SEMESTER", "请选择学校提供的学期");
    const id = encodeURIComponent(semester.id);
    return normalizeAcademicCourses(
      await this.schoolJson(
        `/student/for-std/course-table/semester/${id}/print-data?semesterId=${id}&hasExperiment=true`,
      ),
      semester,
    );
  }
}
