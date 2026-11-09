import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { ORDER_STATUSES, TERMINAL_ORDER_STATUSES } from "@/lib/domain/enums";
import { buildSeed, seedDatabase } from "@/scripts/seed";

const SEED_DAY = "2026-11-08";
const PROTECTED_TABLES = ["orders", "order_items", "payouts", "payout_items", "disputes", "webhook_events"];

interface Statement {
  text: string;
  params: unknown[];
}

/** A fake node-postgres client that records every statement and reports `heldIds` as held by open orders. */
function recordingDatabase(heldIds: string[]) {
  const statements: Statement[] = [];
  const client = {
    query(config: { text: string }, params: unknown[] = []) {
      statements.push({ text: config.text, params });
      const rows = config.text.startsWith("select distinct") ? heldIds.map((id) => [id]) : [];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
  };
  return { db: drizzle({ client: client as unknown as Pool, schema }), statements };
}

function listingInsert(statements: Statement[]): Statement {
  const insert = statements.find((statement) => statement.text.startsWith('insert into "listings"'));
  if (insert === undefined) throw new Error("No listings insert was issued.");
  return insert;
}

describe("terminal order statuses", () => {
  it("lists only settled, canceled, voided, reversed, and refunded", () => {
    expect([...TERMINAL_ORDER_STATUSES].sort()).toEqual(["canceled", "refunded", "reversed", "settled", "voided"]);
    for (const status of TERMINAL_ORDER_STATUSES) expect(ORDER_STATUSES).toContain(status);
  });

  it("keeps every order that can still capture, refund, retry, settle, or release open", () => {
    const open = ORDER_STATUSES.filter((status) => !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(status));
    expect(open).toEqual(["pending_approval", "approved", "authorized", "capture_pending", "captured", "capture_declined", "settling", "releasing"]);
  });
});

describe("seedDatabase guard", () => {
  const seedListings = buildSeed(SEED_DAY).listings;
  const held = seedListings[3]!.id;

  it("locks orders before reading held listings and leaves those listings out of the upsert", async () => {
    const { db, statements } = recordingDatabase([held]);
    const result = await seedDatabase(db, SEED_DAY);

    const texts = statements.map((statement) => statement.text);
    expect(texts[0]).toBe("begin");
    expect(texts[1]).toBe('lock table "orders", "order_items" in share mode');
    expect(texts[2]).toMatch(/^select distinct "order_items"\."listing_id" from "order_items" inner join "orders"/);
    expect(texts[2]).toContain('"orders"."status" not in');
    expect(statements[2]!.params).toEqual([...TERMINAL_ORDER_STATUSES]);
    expect(texts.at(-1)).toBe("commit");
    expect(texts.findIndex((text) => text.startsWith('insert into "listings"'))).toBeGreaterThan(2);

    const insert = listingInsert(statements);
    expect(insert.params).not.toContain(held);
    for (const listing of seedListings.filter((row) => row.id !== held)) expect(insert.params).toContain(listing.id);

    expect(result.heldListingIds).toEqual([held]);
    expect(result.tables.get("listings")).toEqual({ inserted: 0, updated: 0, unchanged: seedListings.length - 1 });
  });

  it("upserts every listing when no open order holds one", async () => {
    const { db, statements } = recordingDatabase([]);
    const result = await seedDatabase(db, SEED_DAY);

    const insert = listingInsert(statements);
    for (const listing of seedListings) expect(insert.params).toContain(listing.id);
    expect(result.heldListingIds).toEqual([]);
  });

  it("skips the listings upsert when open orders hold every listing", async () => {
    const { db, statements } = recordingDatabase(seedListings.map((listing) => listing.id));
    const result = await seedDatabase(db, SEED_DAY);

    expect(statements.some((statement) => statement.text.startsWith('insert into "listings"'))).toBe(false);
    expect(result.heldListingIds).toHaveLength(seedListings.length);
  });

  it("never deletes and never writes orders, payouts, disputes, or webhook events", async () => {
    const { db, statements } = recordingDatabase([held]);
    await seedDatabase(db, SEED_DAY);

    for (const { text } of statements) {
      expect(text).not.toMatch(/\b(delete|truncate|drop)\b/i);
      for (const table of PROTECTED_TABLES) {
        expect(text).not.toContain(`insert into "${table}"`);
        expect(text).not.toContain(`update "${table}"`);
      }
    }
    const written = statements
      .map(({ text }) => /^insert into "([a-z_]+)"/.exec(text)?.[1])
      .filter((table) => table !== undefined);
    expect(written).toEqual(["halls", "room_presets", "hall_rules", "users", "listings"]);
  });
});
