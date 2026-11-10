import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { startOfUtcDay } from "@/lib/agents/limits";
import { TERMINAL_ORDER_STATUSES, type ClaudeMode, type ListingDraftStatus } from "@/lib/domain/enums";
import type { Channel3Candidate, Channel3Lookup, DraftDetails } from "@/lib/domain/sell";
import type { ImageType } from "@/lib/images";
import type { Database } from "./client";
import type { Transaction } from "./plans";
import { channel3Lookups, listingDrafts, listingPhotos, listings, negotiations, orderItems, orders, plans, sellerAgentCalls } from "./schema";

type Executor = Database | Transaction;

/** Where a stored listing photo is served. Listing photos are public, like the seed photos. */
export const LISTING_PHOTO_PATH = "/api/listings/photos/";

export async function insertListingPhoto(
  db: Executor,
  input: { sellerId: string; sessionId: string; contentType: ImageType; bytes: Buffer; sha256: string; widthPx: number; heightPx: number },
): Promise<string> {
  const [row] = await db
    .insert(listingPhotos)
    .values({ ...input, byteSize: input.bytes.length })
    .returning({ id: listingPhotos.id });
  return row.id;
}

export async function loadListingPhoto(db: Executor, photoId: string): Promise<{ contentType: string; bytes: Buffer; sha256: string; widthPx: number; heightPx: number } | null> {
  const [row] = await db
    .select({ contentType: listingPhotos.contentType, bytes: listingPhotos.bytes, sha256: listingPhotos.sha256, widthPx: listingPhotos.widthPx, heightPx: listingPhotos.heightPx })
    .from(listingPhotos)
    .where(eq(listingPhotos.id, photoId));
  return row ?? null;
}

export async function loadChannel3Lookup(db: Executor, imageSha256: string): Promise<{ candidates: Channel3Candidate[]; productCount: number } | null> {
  const [row] = await db.select({ candidates: channel3Lookups.candidates, productCount: channel3Lookups.productCount }).from(channel3Lookups).where(eq(channel3Lookups.imageSha256, imageSha256));
  return row ?? null;
}

export async function storeChannel3Lookup(
  db: Executor,
  input: { imageSha256: string; sessionId: string; candidates: Channel3Candidate[]; productCount: number; credits: number; latencyMs: number },
): Promise<void> {
  await db.insert(channel3Lookups).values(input).onConflictDoNothing({ target: channel3Lookups.imageSha256 });
}

/** Live Channel3 searches since midnight UTC, for one session and for the whole demo. */
export async function channel3SearchesToday(db: Executor, sessionId: string, now: Date): Promise<{ sessionToday: number; allToday: number }> {
  const since = startOfUtcDay(now);
  const [row] = await db
    .select({
      allToday: sql<number>`count(*)::int`,
      sessionToday: sql<number>`(count(*) filter (where ${channel3Lookups.sessionId} = ${sessionId}))::int`,
    })
    .from(channel3Lookups)
    .where(and(gte(channel3Lookups.createdAt, since), sql`${channel3Lookups.credits} > 0`));
  return { sessionToday: row?.sessionToday ?? 0, allToday: row?.allToday ?? 0 };
}

const draftColumns = {
  id: listingDrafts.id,
  sellerId: listingDrafts.sellerId,
  sessionId: listingDrafts.sessionId,
  sampleSrc: listingDrafts.sampleSrc,
  photoId: listingDrafts.photoId,
  photoSha256: listingDrafts.photoSha256,
  status: listingDrafts.status,
  channel3: listingDrafts.channel3,
  details: listingDrafts.details,
  error: listingDrafts.error,
  claudeMode: listingDrafts.claudeMode,
  claudeCalls: listingDrafts.claudeCalls,
  inputTokens: listingDrafts.inputTokens,
  outputTokens: listingDrafts.outputTokens,
  describeMs: listingDrafts.describeMs,
  listingId: listingDrafts.listingId,
  createdAt: listingDrafts.createdAt,
};

export interface DraftRow {
  id: string;
  sellerId: string;
  sessionId: string;
  sampleSrc: string | null;
  photoId: string | null;
  photoSha256: string;
  status: ListingDraftStatus;
  channel3: Channel3Lookup;
  details: DraftDetails | null;
  error: string | null;
  claudeMode: ClaudeMode | null;
  claudeCalls: number;
  inputTokens: number;
  outputTokens: number;
  describeMs: number | null;
  listingId: string | null;
  createdAt: Date;
}

export async function insertDraft(
  db: Executor,
  input: { sellerId: string; sessionId: string; clientHash: string; sampleSrc: string | null; photoId: string | null; photoSha256: string; channel3: Channel3Lookup },
): Promise<string> {
  const [row] = await db.insert(listingDrafts).values(input).returning({ id: listingDrafts.id });
  return row.id;
}

/** A seller's own draft. Another seller asking gets the same null as a draft that does not exist. */
export async function loadDraft(db: Executor, draftId: string, sellerId: string): Promise<DraftRow | null> {
  const [row] = await db.select(draftColumns).from(listingDrafts).where(and(eq(listingDrafts.id, draftId), eq(listingDrafts.sellerId, sellerId)));
  return row ?? null;
}

/** The seller's newest draft from this browser, which a reload of Sell shows again. */
export async function latestDraft(db: Executor, sellerId: string, sessionId: string, since: Date): Promise<DraftRow | null> {
  const [row] = await db
    .select(draftColumns)
    .from(listingDrafts)
    .where(and(eq(listingDrafts.sellerId, sellerId), eq(listingDrafts.sessionId, sessionId), gte(listingDrafts.createdAt, since)))
    .orderBy(desc(listingDrafts.createdAt))
    .limit(1);
  return row ?? null;
}

/** Sell photos this browser started since midnight UTC. */
export async function draftsToday(db: Executor, sessionId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingDrafts)
    .where(and(eq(listingDrafts.sessionId, sessionId), gte(listingDrafts.createdAt, startOfUtcDay(now))));
  return row?.count ?? 0;
}

/** Bytes of every stored Sell upload. */
export async function storedSellPhotoBytes(db: Executor): Promise<number> {
  const [row] = await db.select({ bytes: sql<string>`coalesce(sum(${listingPhotos.byteSize}), 0)` }).from(listingPhotos);
  return Number(row?.bytes ?? 0);
}

/** Seller agent calls a photo spent or holds in reserve across all its tries. */
export async function sellerCallsForDraft(db: Executor, draftId: string): Promise<number> {
  const [row] = await db.select({ calls: sql<number>`coalesce(sum(${sellerAgentCalls.calls}), 0)::int` }).from(sellerAgentCalls).where(eq(sellerAgentCalls.draftId, draftId));
  return row?.calls ?? 0;
}

/** Reserves a describe run's calls at the time it starts, under the run limit lock. */
export async function reserveSellerCalls(db: Executor, input: { draftId: string; sessionId: string; clientHash: string; calls: number; at: Date }): Promise<string> {
  const [row] = await db
    .insert(sellerAgentCalls)
    .values({ draftId: input.draftId, sessionId: input.sessionId, clientHash: input.clientHash, calls: input.calls, calledAt: input.at })
    .returning({ id: sellerAgentCalls.id });
  return row.id;
}

/** Replaces a reservation with the calls the run spent. */
export async function settleSellerCalls(db: Executor, reservationId: string, calls: number): Promise<void> {
  await db.update(sellerAgentCalls).set({ calls }).where(eq(sellerAgentCalls.id, reservationId));
}

export async function markDescribeStarted(db: Executor, draftId: string, mode: ClaudeMode): Promise<void> {
  await db.update(listingDrafts).set({ claudeMode: mode, error: null }).where(eq(listingDrafts.id, draftId));
}

export async function recordDescribe(
  db: Executor,
  draftId: string,
  outcome: ({ status: "ready"; details: DraftDetails } | { status: "failed"; error: string }) & { calls: number; inputTokens: number; outputTokens: number; describeMs: number },
): Promise<void> {
  await db
    .update(listingDrafts)
    .set({
      status: outcome.status,
      details: outcome.status === "ready" ? outcome.details : sql`${listingDrafts.details}`,
      error: outcome.status === "failed" ? outcome.error : null,
      claudeCalls: sql`${listingDrafts.claudeCalls} + ${outcome.calls}`,
      inputTokens: sql`${listingDrafts.inputTokens} + ${outcome.inputTokens}`,
      outputTokens: sql`${listingDrafts.outputTokens} + ${outcome.outputTokens}`,
      describeMs: outcome.describeMs,
    })
    .where(and(eq(listingDrafts.id, draftId), notInArray(listingDrafts.status, ["listed"])));
}

/**
 * Lists a ready draft in one transaction. The draft row is locked first, so
 * a double press lists the item once, and the listing and the draft change
 * together.
 */
export async function listDraft(db: Database, draftId: string, sellerId: string, listing: typeof listings.$inferInsert): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [draft] = await tx.select({ status: listingDrafts.status, listingId: listingDrafts.listingId }).from(listingDrafts).where(and(eq(listingDrafts.id, draftId), eq(listingDrafts.sellerId, sellerId))).for("update");
    if (draft === undefined) return null;
    if (draft.status === "listed") return draft.listingId;
    if (draft.status !== "ready") return null;
    const [row] = await tx.insert(listings).values(listing).returning({ id: listings.id });
    await tx.update(listingDrafts).set({ status: "listed", listingId: row.id }).where(eq(listingDrafts.id, draftId));
    return row.id;
  });
}

export interface SellListingRow {
  id: string;
  createdAt: Date;
  inOpenOrder: boolean;
  referenced: boolean;
}

/** Listings made on Sell before the cutoff and not withdrawn yet, with what still names them. */
export async function sellListingsBefore(db: Executor, createdBefore: Date): Promise<SellListingRow[]> {
  const candidates = await db
    .select({ id: listings.id, createdAt: listings.createdAt })
    .from(listings)
    .where(and(isNotNull(listings.sessionId), lt(listings.createdAt, createdBefore), ne(listings.status, "withdrawn")));
  if (candidates.length === 0) return [];
  const ids = candidates.map((row) => row.id);
  const ordered = await db
    .select({ listingId: orderItems.listingId, status: orders.status })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(inArray(orderItems.listingId, ids));
  const negotiated = await db.select({ listingId: negotiations.listingId }).from(negotiations).where(inArray(negotiations.listingId, ids));
  const planned = await db
    .select({ layout: sql<string>`${plans.layout}::text` })
    .from(plans)
    .where(or(...ids.map((id) => sql`${plans.layout}::text like ${`%${id}%`}`)));
  const terminal: ReadonlySet<string> = new Set(TERMINAL_ORDER_STATUSES);
  return candidates.map((row) => ({
    ...row,
    inOpenOrder: ordered.some((line) => line.listingId === row.id && !terminal.has(line.status)),
    referenced: ordered.some((line) => line.listingId === row.id) || negotiated.some((line) => line.listingId === row.id) || planned.some((plan) => plan.layout.includes(row.id)),
  }));
}

/** Deletes unreferenced Sell listings and withdraws the rest, then deletes drafts and photos left with no listing. */
export async function removeSellListings(db: Database, input: { deleteIds: string[]; withdrawIds: string[]; draftsBefore: Date }): Promise<{ deleted: number; withdrawn: number; drafts: number; photos: number }> {
  return db.transaction(async (tx) => {
    const withdrawn = input.withdrawIds.length === 0 ? [] : await tx.update(listings).set({ status: "withdrawn" }).where(inArray(listings.id, input.withdrawIds)).returning({ id: listings.id });
    const deleted = input.deleteIds.length === 0 ? [] : await tx.delete(listings).where(inArray(listings.id, input.deleteIds)).returning({ id: listings.id });
    const drafts = await tx.delete(listingDrafts).where(and(lt(listingDrafts.createdAt, input.draftsBefore), isNull(listingDrafts.listingId))).returning({ id: listingDrafts.id });
    const photos = await tx
      .delete(listingPhotos)
      .where(
        and(
          lt(listingPhotos.createdAt, input.draftsBefore),
          sql`not exists (select 1 from ${listingDrafts} where ${listingDrafts.photoId} = ${listingPhotos.id})`,
          sql`not exists (select 1 from ${listings} where ${listings.photos}::text like '%' || ${listingPhotos.id}::text || '%')`,
        ),
      )
      .returning({ id: listingPhotos.id });
    return { deleted: deleted.length, withdrawn: withdrawn.length, drafts: drafts.length, photos: photos.length };
  });
}
