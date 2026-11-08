/**
 * Applies pending migrations from lib/db/migrations.
 *
 *   pnpm db:migrate
 */
import { sql } from "drizzle-orm";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, runMigrations } from "@/lib/db/migrate";
import { runScript } from "./run";

runScript("db:migrate", async (db) => {
  await runMigrations(db);
  const applied = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  console.log(`Migrations applied: ${applied.rows[0]?.count ?? 0}`);
});
