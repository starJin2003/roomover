import { defineConfig } from "drizzle-kit";

// Generation compares the schema with the stored snapshots and needs no database connection.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  strict: true,
  verbose: true,
});
