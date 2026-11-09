import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { startOfUtcDay } from "@/lib/agents/limits";
import type { Database } from "./client";
import { channel3Searches, retailReferences } from "./schema";

/**
 * Channel3 text searches, cached by query. The buyer agent's gap searches
 * and the savings lookups share the cache, so a query Channel3 answered once
 * costs no credit again. Retail references keep each used listing's new
 * price from those searches.
 */

export interface StoredSearch {
  response: unknown;
  productCount: number;
}

export async function loadChannel3Search(db: Database, queryKey: string): Promise<StoredSearch | null> {
  const [row] = await db.select({ response: channel3Searches.response, productCount: channel3Searches.productCount }).from(channel3Searches).where(eq(channel3Searches.queryKey, queryKey));
  return row ?? null;
}

export async function storeChannel3Search(
  db: Database,
  input: { queryKey: string; purpose: "gap" | "reference"; query: string; sessionId: string | null; response: unknown; productCount: number; latencyMs: number },
): Promise<void> {
  await db
    .insert(channel3Searches)
    .values({ ...input, response: input.response as Record<string, unknown>, credits: 1 })
    .onConflictDoNothing({ target: channel3Searches.queryKey });
}

/** Live gap searches today, for this session and across the demo, which share the Channel3 caps with Sell. */
export async function gapSearchesToday(db: Database, sessionId: string, now: Date): Promise<{ sessionToday: number; allToday: number }> {
  const since = startOfUtcDay(now);
  const [row] = await db
    .select({
      sessionToday: sql<number>`count(*) filter (where ${channel3Searches.sessionId} = ${sessionId})::int`,
      allToday: sql<number>`count(*)::int`,
    })
    .from(channel3Searches)
    .where(and(eq(channel3Searches.purpose, "gap"), gte(channel3Searches.createdAt, since)));
  return { sessionToday: row?.sessionToday ?? 0, allToday: row?.allToday ?? 0 };
}

export interface RetailReferenceRow {
  listingId: string;
  newPriceCents: number;
  productName: string;
  retailer: string;
  url: string;
  compared: number;
  queryKey: string;
}

export async function loadRetailReferences(db: Database, listingIds: readonly string[]): Promise<Map<string, RetailReferenceRow>> {
  if (listingIds.length === 0) return new Map();
  const rows = await db
    .select({
      listingId: retailReferences.listingId,
      newPriceCents: retailReferences.newPriceCents,
      productName: retailReferences.productName,
      retailer: retailReferences.retailer,
      url: retailReferences.url,
      compared: retailReferences.compared,
      queryKey: retailReferences.queryKey,
    })
    .from(retailReferences)
    .where(inArray(retailReferences.listingId, [...listingIds]));
  return new Map(rows.map((row) => [row.listingId, row]));
}

export async function storeRetailReference(db: Database, row: RetailReferenceRow): Promise<void> {
  await db
    .insert(retailReferences)
    .values(row)
    .onConflictDoUpdate({
      target: retailReferences.listingId,
      set: {
        newPriceCents: sql`excluded.new_price_cents`,
        productName: sql`excluded.product_name`,
        retailer: sql`excluded.retailer`,
        url: sql`excluded.url`,
        compared: sql`excluded.compared`,
        queryKey: sql`excluded.query_key`,
        checkedAt: sql`now()`,
      },
    });
}
