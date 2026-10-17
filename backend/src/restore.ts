import { Database } from "bun:sqlite";
import { createDatabase } from "./db";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

const backupDirectory = process.argv[2];
if (!backupDirectory) {
  console.error(
    "Usage: bun run src/restore.ts <directory containing database.sqlite and uploads.tar.gz>",
  );
  process.exit(2);
}
const sourceDatabase = resolve(backupDirectory, "database.sqlite");
const uploadArchive = resolve(backupDirectory, "uploads.tar.gz");
const databasePath = process.env.DATABASE_PATH
  ? resolve(process.cwd(), process.env.DATABASE_PATH)
  : resolve(import.meta.dir, "../data/shenxiaoli.sqlite");
const uploadsPath = process.env.UPLOADS_PATH
  ? resolve(process.cwd(), process.env.UPLOADS_PATH)
  : resolve(import.meta.dir, "../uploads");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const tempDatabase = `${databasePath}.restore-${stamp}`;
const oldDatabase = `${databasePath}.pre-restore-${stamp}`;
const stagedUploads = resolve(uploadsPath, `.restore-stage-${stamp}`);
const oldUploads = resolve(uploadsPath, `.pre-restore-${stamp}`);

const check = new Database(sourceDatabase, { readonly: true, strict: true });
try {
  const integrity = check.query("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  const migration = check
    .query("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null };
  const foreignKeyErrors = check.query("PRAGMA foreign_key_check").all();
  if (
    integrity.integrity_check !== "ok" ||
    (migration.version ?? 0) < 9 ||
    foreignKeyErrors.length
  ) {
    throw new Error(
      "Backup database failed integrity, migration, or foreign-key validation.",
    );
  }
} finally {
  check.close();
}

const archiveList = spawnSync("tar", ["-tzf", uploadArchive], {
  encoding: "utf8",
});
const archiveDetails = spawnSync("tar", ["-tvzf", uploadArchive], {
  encoding: "utf8",
});
if (archiveList.status !== 0 || archiveDetails.status !== 0)
  throw new Error("Upload archive could not be inspected.");
const archiveEntries = archiveList.stdout.split("\n").filter(Boolean);
const detailedEntries = archiveDetails.stdout.split("\n").filter(Boolean);
if (
  archiveEntries.length !== detailedEntries.length ||
  detailedEntries.some(
    (entry) => !entry.startsWith("-") && !entry.startsWith("d"),
  )
) {
  throw new Error(
    "Upload archive contains links or unsupported filesystem entries.",
  );
}
for (const entry of archiveEntries) {
  const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized && !/^[a-f0-9-]+\.(png|jpg|webp)$/.test(normalized)) {
    throw new Error("Upload archive contains an unexpected path.");
  }
}

await mkdir(dirname(databasePath), { recursive: true });
await mkdir(uploadsPath, { recursive: true });
await mkdir(stagedUploads, { recursive: true });
await copyFile(sourceDatabase, tempDatabase);
await chmod(tempDatabase, 0o600);
const tempCheck = createDatabase({ path: tempDatabase, seedDemoUsers: false });
try {
  const integrity = tempCheck.query("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  if (integrity.integrity_check !== "ok")
    throw new Error("Copied database snapshot failed integrity check.");
  // The staged database must be self-contained before its main file is renamed.
  const checkpoint = tempCheck
    .query("PRAGMA wal_checkpoint(TRUNCATE)")
    .get() as { busy: number };
  if (checkpoint.busy) throw new Error("Staged database checkpoint is busy.");
} finally {
  tempCheck.close();
}
const extracted = spawnSync(
  "tar",
  ["-xzf", uploadArchive, "-C", stagedUploads],
  { encoding: "utf8" },
);
if (extracted.status !== 0)
  throw new Error("Upload archive extraction failed.");
for (const filename of await readdir(stagedUploads)) {
  const metadata = await stat(resolve(stagedUploads, filename));
  if (!metadata.isFile() || !/^[a-f0-9-]+\.(png|jpg|webp)$/.test(filename))
    throw new Error("Upload snapshot contains an invalid file.");
}

let movedOldUploads: string[] = [];
let installedNewUploads: string[] = [];
let oldDbMoved = false;
try {
  await mkdir(oldUploads, { recursive: true });
  for (const filename of await readdir(uploadsPath)) {
    if (
      filename.startsWith(".restore-stage-") ||
      filename.startsWith(".pre-restore-")
    )
      continue;
    await rename(resolve(uploadsPath, filename), resolve(oldUploads, filename));
    movedOldUploads.push(filename);
  }
  for (const filename of await readdir(stagedUploads)) {
    await rename(
      resolve(stagedUploads, filename),
      resolve(uploadsPath, filename),
    );
    installedNewUploads.push(filename);
  }
  try {
    await rename(databasePath, oldDatabase);
    oldDbMoved = true;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  await rename(tempDatabase, databasePath);
} catch (error) {
  for (const filename of installedNewUploads)
    await rename(
      resolve(uploadsPath, filename),
      resolve(stagedUploads, filename),
    ).catch(() => undefined);
  for (const filename of movedOldUploads)
    await rename(
      resolve(oldUploads, filename),
      resolve(uploadsPath, filename),
    ).catch(() => undefined);
  if (oldDbMoved)
    await rename(oldDatabase, databasePath).catch(() => undefined);
  await rm(tempDatabase, { force: true });
  throw error;
}
await rm(stagedUploads, { recursive: true, force: true });
console.info(
  "Database and uploads restored. Previous data was retained alongside the live files for rollback.",
);
console.info(`Previous database: ${oldDbMoved ? oldDatabase : "none"}`);
console.info(`Previous uploads: ${oldUploads}`);
