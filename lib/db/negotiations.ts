import { and, eq, inArray, sql } from "drizzle-orm";
import type { NegotiationRecord } from "@/lib/agents/buyer/context";
import type { TimeWindow } from "@/lib/domain/handoff";
import { offersLogSchema, type OffersLog } from "@/lib/domain/negotiation";
import type { NegotiationStatus } from "@/lib/domain/enums";
import type { Database } from "./client";
import type { Transaction } from "./plans";
import { negotiations } from "./schema";

type Executor = Database | Transaction;

export interface NegotiationRow {
  listingId: string;
  status: NegotiationStatus;
  offers: OffersLog;
  agreedPriceCents: number | null;
  agreedSlot: TimeWindow | null;
}

/** Writes each listing's negotiation for a plan, replacing what the plan held for that listing. */
export async function saveNegotiations(db: Executor, planId: string, records: readonly NegotiationRecord[]): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(negotiations)
    .values(
      records.map((record) => ({
        planId,
        listingId: record.listingId,
        status: record.status,
        offers: offersLogSchema.parse(record.offers),
        agreedPriceCents: record.agreedPriceCents,
        agreedSlotStartsAt: record.agreedSlot?.startsAt ?? null,
        agreedSlotEndsAt: record.agreedSlot?.endsAt ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [negotiations.planId, negotiations.listingId],
      set: {
        status: sql`excluded.status`,
        offers: sql`excluded.offers`,
        agreedPriceCents: sql`excluded.agreed_price_cents`,
        agreedSlotStartsAt: sql`excluded.agreed_slot_starts_at`,
        agreedSlotEndsAt: sql`excluded.agreed_slot_ends_at`,
        updatedAt: sql`now()`,
      },
    });
}

/** Every negotiation of a plan, so a later run and the panel see the same terms. */
export async function loadNegotiations(db: Executor, planId: string, listingIds?: readonly string[]): Promise<NegotiationRow[]> {
  const rows = await db
    .select({
      listingId: negotiations.listingId,
      status: negotiations.status,
      offers: negotiations.offers,
      agreedPriceCents: negotiations.agreedPriceCents,
      agreedSlotStartsAt: negotiations.agreedSlotStartsAt,
      agreedSlotEndsAt: negotiations.agreedSlotEndsAt,
    })
    .from(negotiations)
    .where(listingIds === undefined ? eq(negotiations.planId, planId) : and(eq(negotiations.planId, planId), inArray(negotiations.listingId, [...listingIds])));
  return rows.map((row) => ({
    listingId: row.listingId,
    status: row.status,
    offers: offersLogSchema.parse(row.offers),
    agreedPriceCents: row.agreedPriceCents,
    agreedSlot: row.agreedSlotStartsAt === null || row.agreedSlotEndsAt === null ? null : { startsAt: row.agreedSlotStartsAt, endsAt: row.agreedSlotEndsAt },
  }));
}

/** The agreed terms per listing for a plan, which checkout checks again before using. */
export async function agreedTerms(db: Executor, planId: string, listingIds: readonly string[]): Promise<Map<string, { priceCents: number; slot: TimeWindow }>> {
  if (listingIds.length === 0) return new Map();
  const rows = await loadNegotiations(db, planId, listingIds);
  return new Map(
    rows.flatMap((row) => (row.status === "agreed" && row.agreedPriceCents !== null && row.agreedSlot !== null ? [[row.listingId, { priceCents: row.agreedPriceCents, slot: row.agreedSlot }] as const] : [])),
  );
}
