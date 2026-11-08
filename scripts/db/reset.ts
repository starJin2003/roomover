/**
 * Drops every Roomover table, enum, and the migration journal, then migrates
 * and seeds from scratch. All data in those tables is lost, so the script
 * refuses to run without the confirmation flag.
 *
 *   pnpm db:reset --confirm-drop-all
 */
import { sql } from "drizzle-orm";
import { MIGRATIONS_SCHEMA, runMigrations } from "@/lib/db/migrate";
import { countRows, ENUM_NAMES, TABLE_NAMES } from "@/lib/db/tables";
import { seedDatabase } from "../seed";
import { campusDay } from "../seed/campus";
import { printSeedReport } from "../seed/report";
import { runScript } from "./run";

const CONFIRM_FLAG = "--confirm-drop-all";

const identifiers = (names: readonly string[]) =>
  sql.join(
    names.map((name) => sql.identifier(name)),
    sql`, `,
  );

if (process.argv.slice(2).includes(CONFIRM_FLAG)) {
  runScript("db:reset", async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`drop table if exists ${identifiers(TABLE_NAMES)} cascade`);
      await tx.execute(sql`drop type if exists ${identifiers(ENUM_NAMES)} cascade`);
      await tx.execute(sql`drop schema if exists ${sql.identifier(MIGRATIONS_SCHEMA)} cascade`);
    });
    console.log(`Dropped ${TABLE_NAMES.length} tables, ${ENUM_NAMES.length} enums, and the migration journal.`);
    await runMigrations(db);
    const seeded = await seedDatabase(db, campusDay(new Date()));
    printSeedReport(seeded, await countRows(db));
  });
} else {
  console.error(
    `db:reset drops all ${TABLE_NAMES.length} Roomover tables and their data. Nothing was changed. To proceed, run: pnpm db:reset ${CONFIRM_FLAG}`,
  );
  process.exitCode = 1;
}
