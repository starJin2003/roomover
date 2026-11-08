import { eq, notInArray, sql } from "drizzle-orm";
import type { PgColumn, PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db/client";
import { hallRules, halls, listings, orderItems, orders, roomPresets, users } from "@/lib/db/schema";
import { TERMINAL_ORDER_STATUSES } from "@/lib/domain/enums";
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

export interface SeedResult {
  tables: Map<string, UpsertCounts>;
  /** Seed listings left as they were because an open order references them. */
  heldListingIds: string[];
}

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
 * Listings referenced by an order that has not reached a terminal state. The
 * share lock blocks order writes until the seed commits, so checkout cannot
 * attach a listing to a new order between this read and the listing upsert.
 */
async function lockHeldListings(tx: Transaction): Promise<Set<string>> {
  await tx.execute(sql`lock table ${orders}, ${orderItems} in share mode`);
  const rows = await tx
    .selectDistinct({ listingId: orderItems.listingId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(notInArray(orders.status, [...TERMINAL_ORDER_STATUSES]));
  return new Set(rows.map((row) => row.listingId));
}

/**
 * Writes the demo campus in one transaction, parents before children. Rows
 * are keyed by deterministic IDs, so a second run on the same campus day
 * inserts and updates nothing, and a run on a later day moves only the
 * listing windows. Listings an open order holds keep their status and
 * windows. The seed never deletes a row.
 */
export async function seedDatabase(db: Database, seedDay: CampusDay): Promise<SeedResult> {
  const data = buildSeed(seedDay);
  return db.transaction(async (tx) => {
    const held = await lockHeldListings(tx);
    const tables = new Map<string, UpsertCounts>();
    tables.set("halls", await upsert(tx, halls, halls.id, data.halls));
    tables.set("room_presets", await upsert(tx, roomPresets, roomPresets.id, data.roomPresets));
    tables.set("hall_rules", await upsert(tx, hallRules, hallRules.id, data.hallRules));
    tables.set("users", await upsert(tx, users, users.id, data.users));
    const free = data.listings.filter((listing) => !held.has(listing.id));
    tables.set("listings", await upsert(tx, listings, listings.id, free));
    const heldListingIds = data.listings.filter((listing) => held.has(listing.id)).map((listing) => listing.id);
    return { tables, heldListingIds };
  });
}
