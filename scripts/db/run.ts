import type { Pool } from "pg";
import { ConfigError, readConfig, type ConfigKey } from "@/lib/config";
import { createDatabase, createPool, type Database } from "@/lib/db/client";

/**
 * Runs a database script with its own small pool and closes the pool after.
 * Every variable the script names is checked before anything runs, so a cron
 * job missing one fails at once with one line naming it. Failures print the
 * error message only. Connection strings are redacted in case a driver
 * message ever repeats one.
 */
export function runScript(name: string, task: (db: Database) => Promise<void>, options: { requires?: readonly ConfigKey[] } = {}): void {
  void (async () => {
    let pool: Pool | undefined;
    try {
      const { DATABASE_URL } = readConfig(["DATABASE_URL", ...(options.requires ?? [])]);
      pool = createPool(DATABASE_URL, 2);
      await task(createDatabase(pool));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown failure";
      const lead = error instanceof ConfigError ? `${name} cannot start.` : `${name} failed.`;
      console.error(`${lead} ${message.replace(/postgres(?:ql)?:\/\/\S+/g, "<database url>").replace(/\s*\n\s*/g, " ")}`);
      process.exitCode = 1;
    } finally {
      await pool?.end();
    }
  })();
}
