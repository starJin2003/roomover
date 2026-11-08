import type { PgColumn, PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db/client";
import { hallRules, halls, listings, roomPresets, users } from "@/lib/db/schema";
import type { CampusDay } from "./campus";
import { seedHallRules, seedHalls, seedRoomPresets } from "./halls";
import { seedListings } from "./listings";
import { seedUsers } from "./people";
import { conflictUpdate, insertedFlag, upsertCounts, type UpsertCounts } from "./upsert";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Listing windows count from `seedDay`, so a second run on the same campus day writes identical rows. */
export function buildSeed(seedDay: CampusDay) {
  return {
    halls: seedHalls(),
    roomPresets: seedRoomPresets(),
    hallRules: seedHallRules(),
    users: seedUsers(),
    listings: seedListings(seedDay),
  };
}

export type SeedData = ReturnType<typeof buildSeed>;

async function upsert<TTable extends PgTable>(
  tx: Transaction,
  table: TTable,
  id: PgColumn,
  rows: PgInsertValue<TTable>[],
): Promise<UpsertCounts> {
  const [first] = rows;
  if (first === undefined) return { inserted: 0, updated: 0, unchanged: 0 };
  const returned = await tx
    .insert(table)
    .values(rows)
    .onConflictDoUpdate({ target: id, ...conflictUpdate(table, Object.keys(first)) })
    .returning({ inserted: insertedFlag });
  return upsertCounts(rows.length, returned);
}

/**
 * Writes the demo campus in one transaction, parents before children. Rows
 * are keyed by deterministic IDs, so a second run on the same campus day
 * inserts and updates nothing, and a run on a later day moves only the
 * listing windows.
 */
export async function seedDatabase(db: Database, seedDay: CampusDay): Promise<Map<string, UpsertCounts>> {
  const data = buildSeed(seedDay);
  return db.transaction(async (tx) => {
    const counts = new Map<string, UpsertCounts>();
    counts.set("halls", await upsert(tx, halls, halls.id, data.halls));
    counts.set("room_presets", await upsert(tx, roomPresets, roomPresets.id, data.roomPresets));
    counts.set("hall_rules", await upsert(tx, hallRules, hallRules.id, data.hallRules));
    counts.set("users", await upsert(tx, users, users.id, data.users));
    counts.set("listings", await upsert(tx, listings, listings.id, data.listings));
    return counts;
  });
}
