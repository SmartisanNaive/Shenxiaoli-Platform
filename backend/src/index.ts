import { resolve } from "node:path";
import { createApp } from "./app";
import { createDatabase } from "./db";

const production = process.env.NODE_ENV === "production";
const demoAuthEnabled = process.env.DEMO_AUTH_ENABLED
  ? process.env.DEMO_AUTH_ENABLED === "true"
  : !production;

if (production && !process.env.SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET must be configured before production startup",
  );
}
if (production && demoAuthEnabled) {
  throw new Error("Demo authentication must not be enabled in production");
}
if (production) {
  const requiredProductionSettings = [
    "RESEND_API_KEY",
    "RESEND_FROM",
    "DATABASE_PATH",
    "UPLOADS_PATH",
  ];
  const missing = requiredProductionSettings.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length)
    throw new Error(
      `Missing required production settings: ${missing.join(", ")}`,
    );
  if ((process.env.SESSION_SECRET?.length ?? 0) < 32)
    throw new Error(
      "SESSION_SECRET must contain at least 32 characters in production",
    );
}

const databasePath = process.env.DATABASE_PATH
  ? resolve(process.cwd(), process.env.DATABASE_PATH)
  : undefined;
const db = createDatabase({
  path: databasePath,
  seedDemoUsers: demoAuthEnabled,
  migrate: process.env.RUN_MIGRATIONS !== "false",
});
const app = createApp({
  database: db,
  demoAuthEnabled,
  production,
  sessionSecret: process.env.SESSION_SECRET,
});
const port = Number(process.env.PORT ?? 8787);

console.info(`深小狸 API listening on http://127.0.0.1:${port}`);
console.info(
  `Demo sign-in: ${demoAuthEnabled ? "enabled (development only)" : "disabled"}`,
);

export default {
  port,
  fetch: app.fetch,
};
