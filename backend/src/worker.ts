import { resolve } from "node:path";
import { createDatabase } from "./db";
import { startEmailWorker } from "./notifications";
import { cleanupExpiredDeletedAccounts } from "./maintenance";

const database = createDatabase({
  path: process.env.DATABASE_PATH
    ? resolve(process.cwd(), process.env.DATABASE_PATH)
    : undefined,
  seedDemoUsers: false,
  migrate: false,
});
const stop = startEmailWorker(database);
const cleanupTimer = setInterval(
  () => {
    try {
      const count = cleanupExpiredDeletedAccounts(database);
      if (count)
        console.info(
          `Anonymized ${count} accounts past the 30-day deletion window`,
        );
    } catch (error) {
      console.error(
        "Account cleanup failed:",
        error instanceof Error ? error.name : "unknown",
      );
    }
  },
  6 * 60 * 60_000,
);
void cleanupExpiredDeletedAccounts(database);

const shutdown = (): void => {
  stop();
  clearInterval(cleanupTimer);
  database.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
