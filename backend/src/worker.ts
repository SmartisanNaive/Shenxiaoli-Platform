import { resolve } from "node:path";
import { createDatabase } from "./db";
import { startEmailWorker } from "./notifications";
import { cleanupExpiredDeletedAccounts } from "./maintenance";
import { localTestEmailSender } from "./local-testing";
const localTestMode = process.env.LOCAL_TEST_MODE === "true";
if (localTestMode && process.env.NODE_ENV === "production")
  throw new Error("Local test mode is forbidden in production");
if (
  localTestMode &&
  (!process.env.DATABASE_PATH ||
    !resolve(process.env.DATABASE_PATH).startsWith(
      `${resolve(import.meta.dir, "../../.local-test")}/`,
    ))
)
  throw new Error("Local test databases must be inside .local-test/");

const database = createDatabase({
  path: process.env.DATABASE_PATH
    ? resolve(process.cwd(), process.env.DATABASE_PATH)
    : undefined,
  seedDemoUsers: false,
  migrate: false,
});
const stop = startEmailWorker(
  database,
  localTestMode
    ? {
        sendEmail: localTestEmailSender(database),
        onTick: () => {
          database
            .query(
              "INSERT INTO test_runtime_state (key, value) VALUES ('worker-heartbeat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .run(new Date().toISOString());
        },
      }
    : {},
);
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
