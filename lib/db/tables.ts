import { getTableName, is, sql } from "drizzle-orm";
import { PgTable, isPgEnum } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import * as schema from "./schema";

const schemaValues: unknown[] = Object.values(schema);

/** Every table name in the schema, sorted. */
export const TABLE_NAMES: readonly string[] = schemaValues
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableName(table))
  .sort();

/** Every enum type name in the schema, sorted. */
export const ENUM_NAMES: readonly string[] = schemaValues
  .filter(isPgEnum)
  .map((pgEnum) => pgEnum.enumName)
  .sort();

/** Row count per table in one query. Works on a database or inside a transaction. */
export async function countRows(db: Pick<Database, "execute">): Promise<Map<string, number>> {
  const selects = TABLE_NAMES.map(
    (name) => sql`select ${name}::text as table_name, count(*)::int as row_count from ${sql.identifier(name)}`,
  );
  const result = await db.execute<{ table_name: string; row_count: number }>(sql.join(selects, sql` union all `));
  return new Map(result.rows.map((row) => [row.table_name, row.row_count]));
}
