/**
 * Seeds the Lakeshore University demo campus with listing windows counted
 * from today in campus time. Safe to run again, since every row has a fixed
 * ID and unchanged rows are skipped. A Render cron job runs it once a day.
 *
 *   pnpm db:seed
 */
import { countRows } from "@/lib/db/tables";
import { seedDatabase } from "../seed";
import { campusDay } from "../seed/campus";
import { printSeedReport } from "../seed/report";
import { runScript } from "./run";

runScript("db:seed", async (db) => {
  const seedDay = campusDay(new Date());
  console.log(`Seed day ${seedDay} (campus time)`);
  const seeded = await seedDatabase(db, seedDay);
  printSeedReport(seeded, await countRows(db));
});
