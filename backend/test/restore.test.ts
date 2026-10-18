import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Database } from "bun:sqlite";
import { createDatabase, SCHEMA_VERSION } from "../src/db";

test("restoring a version 9 backup migrates the staged copy and preserves the source snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "shenxiaoli-restore-"));
  try {
    const backup = join(directory, "backup");
    const empty = join(directory, "empty");
    mkdirSync(backup);
    mkdirSync(empty);
    const sourcePath = join(backup, "database.sqlite");
    const source = createDatabase({ path: sourcePath, seedDemoUsers: true });
    source.exec(
      "DROP TABLE recovery_challenges; DROP TABLE recovery_emails; DROP TABLE recovery_email_cooldowns; DELETE FROM schema_migrations WHERE version >= 10;",
    );
    source.close();
    expect(
      spawnSync("tar", [
        "-czf",
        join(backup, "uploads.tar.gz"),
        "-C",
        empty,
        ".",
      ]).status,
    ).toBe(0);
    const destination = join(directory, "restored.sqlite");
    const result = spawnSync(
      process.execPath,
      ["run", "src/restore.ts", backup],
      {
        cwd: resolve(import.meta.dir, ".."),
        env: {
          ...process.env,
          DATABASE_PATH: destination,
          UPLOADS_PATH: join(directory, "uploads"),
        },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const restored = createDatabase({ path: destination, migrate: false });
    expect(
      restored
        .query("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toEqual({ version: SCHEMA_VERSION });
    expect(
      restored.query("SELECT COUNT(*) AS count FROM courses").get(),
    ).toMatchObject({ count: expect.any(Number) });
    restored.close();
    const original = new Database(sourcePath, { readonly: true });
    expect(
      original
        .query("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toEqual({ version: 9 });
    original.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
