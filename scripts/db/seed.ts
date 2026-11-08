/**
 * Seeds the Lakeshore University demo campus. Safe to run again, since every
 * row has a fixed ID and unchanged rows are skipped.
 *
 *   pnpm db:seed
 */
import { countRows } from "@/lib/db/tables";
import { seedDatabase } from "../seed";
import { printSeedReport } from "../seed/report";
import { runScript } from "./run";

runScript("db:seed", async (db) => {
  const seeded = await seedDatabase(db);
  printSeedReport(seeded, await countRows(db));
});
