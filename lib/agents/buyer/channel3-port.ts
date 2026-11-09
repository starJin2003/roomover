import { Channel3Error } from "@channel3/sdk";
import { decideChannel3Limit } from "@/lib/channel3/limits";
import { newProductsFrom, queryKey, SEARCH_LIMIT, searchRequest, type NewProductQuery } from "@/lib/channel3/search";
import type { Channel3Transport } from "@/lib/channel3/transport";
import type { Database } from "@/lib/db/client";
import { gapSearchesToday, loadChannel3Search, loadRetailReferences, storeChannel3Search, storeRetailReference, type RetailReferenceRow } from "@/lib/db/channel3-searches";
import type { ListingCategory } from "@/lib/domain/enums";
import { referencePriceCents } from "@/lib/domain/savings";
import { formatUsdShort } from "@/lib/format";
import type { EventDraft, NewProductPort, NewProductSearch } from "./context";

/**
 * Channel3 for one buyer run. A query answered before comes from Postgres
 * and costs nothing, a live gap search counts against the demo's Channel3
 * caps first, and a replayed fixture answers tests without any credit.
 */

/** A reference search asks for anything comparable at any sensible price. */
const REFERENCE_PRICE_CAP_CENTS = 200_000;

interface SearchOutcome {
  response: unknown;
  credits: number;
  cached: boolean;
  latencyMs: number;
}

async function cachedSearch(db: Database, transport: Channel3Transport, query: NewProductQuery, purpose: "gap" | "reference", sessionId: string | null, now: () => Date): Promise<SearchOutcome | { problem: string }> {
  const started = Date.now();
  const key = queryKey(query);
  if (transport.mode === "fixture") return { response: await transport.searchText(searchRequest(query), key), credits: 0, cached: false, latencyMs: Date.now() - started };
  const stored = await loadChannel3Search(db, key);
  if (stored !== null) return { response: stored.response, credits: 0, cached: true, latencyMs: Date.now() - started };
  if (purpose === "gap" && sessionId !== null) {
    const decision = decideChannel3Limit(await gapSearchesToday(db, sessionId, now()), now());
    if (!decision.allowed) return { problem: decision.message };
  }
  let response: unknown;
  try {
    response = await transport.searchText(searchRequest(query), key);
  } catch (error) {
    console.error("channel3 text search failed", { error: error instanceof Error ? error.name : "unknown", status: error instanceof Channel3Error ? error.statusCode : undefined });
    return { problem: "Channel3 did not answer just now." };
  }
  const latencyMs = Date.now() - started;
  const productCount = Array.isArray((response as { products?: unknown }).products) ? (response as { products: unknown[] }).products.length : 0;
  await storeChannel3Search(db, { queryKey: key, purpose, query: query.text, sessionId, response, productCount, latencyMs });
  return { response, credits: 1, cached: false, latencyMs };
}

export function newProductPort(deps: { db: Database; transport: Channel3Transport; sessionId: string; now: () => Date }): NewProductPort {
  return {
    async search(query): Promise<NewProductSearch> {
      const outcome = await cachedSearch(deps.db, deps.transport, query, "gap", deps.sessionId, deps.now);
      if ("problem" in outcome) return { ok: false, problem: outcome.problem };
      const { products, productCount } = newProductsFrom(outcome.response, query);
      return { ok: true, products, productCount, credits: outcome.credits, cached: outcome.cached, latencyMs: outcome.latencyMs, queryKey: queryKey(query) };
    },
  };
}

export interface ReferenceListing {
  id: string;
  title: string;
  category: ListingCategory;
  /** The generic product the listing compares to, such as "Balance arm desk lamp with metal dome shade". */
  retailProductName: string;
  /** A Channel3 product Sell already matched to this listing, which needs no search. */
  matched: { productName: string; newPriceCents: number; url: string | null; retailer: string | null } | null;
}

/**
 * Finds a Channel3 new price for each used listing that has none yet, all
 * at once. A listing Sell matched to a Channel3 product uses that product,
 * and any other searches its generic product name and takes the cheapest
 * comparable product, so the savings it shows are never inflated.
 */
export async function compareWithNew(deps: { db: Database; transport: Channel3Transport; now: () => Date }, listings: readonly ReferenceListing[]): Promise<{ events: EventDraft[]; credits: number }> {
  const known = await loadRetailReferences(deps.db, listings.map((listing) => listing.id));
  const missing = listings.filter((listing) => !known.has(listing.id));
  if (missing.length === 0) return { events: [], credits: 0 };
  const results = await Promise.all(
    missing.map(async (listing) => {
      if (listing.matched !== null && listing.matched.url !== null) {
        const row: RetailReferenceRow = { listingId: listing.id, newPriceCents: listing.matched.newPriceCents, productName: listing.matched.productName, retailer: listing.matched.retailer ?? "channel3", url: listing.matched.url, compared: 1, queryKey: "matched" };
        await storeRetailReference(deps.db, row);
        return { listing, row, credits: 0, cached: true };
      }
      const query: NewProductQuery = { text: listing.retailProductName, category: listing.category, maxPriceCents: REFERENCE_PRICE_CAP_CENTS };
      const outcome = await cachedSearch(deps.db, deps.transport, query, "reference", null, deps.now);
      if ("problem" in outcome) return { listing, row: null, credits: 0, cached: false };
      const { products } = newProductsFrom(outcome.response, query, SEARCH_LIMIT);
      const price = referencePriceCents(products.map((product) => product.priceCents));
      const cheapest = products.find((product) => product.priceCents === price);
      if (price === null || cheapest === undefined) return { listing, row: null, credits: outcome.credits, cached: outcome.cached };
      const row: RetailReferenceRow = { listingId: listing.id, newPriceCents: price, productName: cheapest.title, retailer: cheapest.retailer, url: cheapest.buyUrl, compared: products.length, queryKey: queryKey(query) };
      await storeRetailReference(deps.db, row);
      return { listing, row, credits: outcome.credits, cached: outcome.cached };
    }),
  );
  const found = results.filter((result) => result.row !== null);
  const credits = results.reduce((sum, result) => sum + result.credits, 0);
  const lines = found.map((result) => `${result.listing.title}: ${formatUsdShort((result.row as RetailReferenceRow).newPriceCents)} new, the cheapest of ${(result.row as RetailReferenceRow).compared} comparable products`);
  return {
    credits,
    events: [
      {
        tool: "compare_with_new",
        summary: `Checked new prices on Channel3 for ${missing.length} used ${missing.length === 1 ? "item" : "items"}, found ${found.length}. ${lines.join(". ")}${lines.length > 0 ? "." : ""}`,
        detail: {
          count: found.length,
          channel3: {
            query: missing.map((listing) => listing.retailProductName).join(" | ").slice(0, 400),
            filters: "comparable new products, cheapest price",
            credits,
            cached: results.every((result) => result.cached),
            productCount: found.length,
            products: found.map((result) => ({ title: (result.row as RetailReferenceRow).productName, priceCents: (result.row as RetailReferenceRow).newPriceCents, retailer: (result.row as RetailReferenceRow).retailer })),
            keys: found.flatMap((result) => ((result.row as RetailReferenceRow).queryKey === "matched" ? [] : [(result.row as RetailReferenceRow).queryKey])),
          },
        },
      },
    ],
  };
}
