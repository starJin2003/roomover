import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client";

/** Drizzle records applied migrations in this schema and table. */
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");

/** Applies every migration the database has not seen, in one transaction. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
}
