import { resolve } from "node:path";
import { createDatabase } from "./db";
import { normalizeCampusEmail } from "./auth";

const [command, inputEmail] = process.argv.slice(2);
if (command !== "grant-admin" || !inputEmail) {
  console.error("Usage: bun run admin:grant -- <verified-campus-email>");
  process.exit(2);
}

const email = normalizeCampusEmail(inputEmail);
if (!email) {
  console.error(
    "Only @stu.suat-sz.edu.cn and @suat-sz.edu.cn accounts are supported.",
  );
  process.exit(2);
}

const databasePath = process.env.DATABASE_PATH
  ? resolve(process.cwd(), process.env.DATABASE_PATH)
  : undefined;
const database = createDatabase({
  path: databasePath,
  seedDemoUsers: false,
  migrate: false,
});
try {
  const account = database
    .query(
      "SELECT id, name, email FROM auth_users WHERE email = ? COLLATE NOCASE AND emailVerified = 1",
    )
    .get(email) as { id: string; name: string; email: string } | null;
  if (!account) {
    console.error("No verified account exists for that campus email.");
    process.exitCode = 1;
  } else {
    const now = new Date().toISOString();
    database
      .query(
        `INSERT INTO users (id, display_name, email, email_verified, department, role, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, 1, '', 'student', 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, email_verified = 1, is_admin = 1, updated_at = excluded.updated_at`,
      )
      .run(account.id, account.name, account.email, now, now);
    console.info(
      "Administrator access granted to the verified campus account.",
    );
  }
} finally {
  database.close();
}
