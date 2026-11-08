import type { Pool } from "pg";
import { readConfig } from "@/lib/config";
import { createDatabase, createPool, type Database } from "@/lib/db/client";

/**
 * Runs a database script with its own small pool and closes the pool after.
 * Failures print the error message only. Connection strings are redacted in
 * case a driver message ever repeats one.
 */
export function runScript(name: string, task: (db: Database) => Promise<void>): void {
  void (async () => {
    let pool: Pool | undefined;
    try {
      const { DATABASE_URL } = readConfig(["DATABASE_URL"]);
      pool = createPool(DATABASE_URL, 2);
      await task(createDatabase(pool));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown failure";
      console.error(`${name} failed. ${message.replace(/postgres(?:ql)?:\/\/\S+/g, "<database url>")}`);
      process.exitCode = 1;
    } finally {
      await pool?.end();
    }
  })();
}
