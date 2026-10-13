import { resolve } from "node:path";
import { createDatabase } from "./db";

const database = createDatabase({
  path: process.env.DATABASE_PATH
    ? resolve(process.cwd(), process.env.DATABASE_PATH)
    : undefined,
  seedDemoUsers: false,
});
try {
  const row = database
    .query("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null };
  console.info(
    `Database migrations are current (version ${row.version ?? 0}).`,
  );
} finally {
  database.close();
}
