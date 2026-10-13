import { Database } from "bun:sqlite";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = process.env.DATABASE_PATH
  ? resolve(process.cwd(), process.env.DATABASE_PATH)
  : resolve(import.meta.dir, "../data/shenxiaoli.sqlite");
const destinationArgument = process.argv[2];
if (!destinationArgument) {
  console.error("Usage: bun run src/backup.ts <destination.sqlite|->");
  process.exit(2);
}
const destination =
  destinationArgument === "-" ? "-" : resolve(destinationArgument);
if (destination !== "-") await mkdir(dirname(destination), { recursive: true });

const database = new Database(source, { readonly: true, strict: true });
let snapshot: Buffer;
try {
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("BEGIN DEFERRED");
  database.query("SELECT COUNT(*) AS count FROM sqlite_master").get();
  snapshot = database.serialize();
  database.exec("ROLLBACK");
} finally {
  database.close();
}

const check = Database.deserialize(snapshot, { readonly: true, strict: true });
try {
  const result = check.query("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  if (result.integrity_check !== "ok")
    throw new Error("SQLite backup integrity check failed");
} finally {
  check.close();
}
if (destination === "-") {
  process.stdout.write(snapshot);
  console.error("Consistent SQLite snapshot created and verified.");
} else {
  const output = await open(destination, "wx", 0o600);
  try {
    await output.writeFile(snapshot);
    await output.sync();
  } catch (error) {
    await output.close();
    await unlink(destination).catch(() => undefined);
    throw error;
  }
  await output.close();
  console.info(
    `Consistent SQLite snapshot created and verified: ${destination}`,
  );
}
