import { getTableColumns, getTableName, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * The ON CONFLICT clause of an idempotent seed upsert keyed by `id`. A row
 * whose seeded columns already match is left alone, so a second run changes
 * nothing, `updated_at` included. Columns the seed does not set keep their
 * stored values.
 */
export function conflictUpdate<TTable extends PgTable>(
  table: TTable,
  seededKeys: readonly string[],
): { set: PgUpdateSetSource<TTable>; setWhere: SQL } {
  const columns: Record<string, PgColumn> = getTableColumns(table);
  const tableName = sql.identifier(getTableName(table));
  const set: Record<string, SQL> = {};
  const changes: SQL[] = [];

  for (const key of seededKeys) {
    if (key === "id") continue;
    const column = columns[key];
    if (column === undefined) throw new Error(`${getTableName(table)} has no column ${key}.`);
    const name = sql.identifier(column.name);
    set[key] = sql`excluded.${name}`;
    changes.push(sql`${tableName}.${name} is distinct from excluded.${name}`);
  }

  const setWhere = or(...changes);
  if (setWhere === undefined) throw new Error(`Seed rows for ${getTableName(table)} set no columns.`);
  return { set: set as PgUpdateSetSource<TTable>, setWhere };
}

/**
 * Counts from the rows an upsert returned. Rows the conflict clause skipped
 * return nothing, and `xmax = 0` marks a fresh insert.
 */
export function upsertCounts(total: number, returned: readonly { inserted: boolean }[]): UpsertCounts {
  const inserted = returned.filter((row) => row.inserted).length;
  const updated = returned.length - inserted;
  return { inserted, updated, unchanged: total - returned.length };
}

export const insertedFlag = sql<boolean>`(xmax = 0)`;
