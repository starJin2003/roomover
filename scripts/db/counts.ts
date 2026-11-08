/**
 * Prints the row count of every table inside a read only transaction.
 *
 *   pnpm db:counts
 */
import { countRows } from "@/lib/db/tables";
import { runScript } from "./run";

runScript("db:counts", async (db) => {
  const counts = await db.transaction((tx) => countRows(tx), { accessMode: "read only" });
  for (const [table, rows] of counts) {
    console.log(`${table.padEnd(16)}${rows}`);
  }
});
