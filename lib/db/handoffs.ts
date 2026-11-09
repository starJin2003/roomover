import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { EventDraft } from "@/lib/agents/buyer/context";
import type { HandoffDecision, HandoffMode, HandoffStatus, ListingStatus, OrderItemStatus, OrderStatus, PaymentMode, PayoutItemStatus, PayoutRecipientType, PayoutStatus, PayoutWallet } from "@/lib/domain/enums";
import { handoffPhotosSchema, handoffWindow, type HandoffPhoto } from "@/lib/domain/handoff";
import { conditionReportSchema, listingPhotosSchema, type ConditionReport, type ListingPhoto } from "@/lib/domain/listing";
import { releasedStatus } from "@/lib/domain/order-state";
import type { PayoutRecipient, SellerAccount } from "@/lib/domain/payout-recipient";
import { payoutBatchStep, payoutItemStep } from "@/lib/domain/payout-state";
import type { SellerPayoutLine } from "@/lib/domain/settlement";
import { verificationReportSchema, type VerificationReport } from "@/lib/domain/verdict";
import type { ActivityEventView } from "@/lib/plan-view";
import type { Database } from "./client";
import { insertEvents, type Transaction } from "./plans";
import { agentEvents, handoffPhotos, handoffs, listings, orderItems, orders, payoutItems, payouts, plans, users } from "./schema";

type Executor = Database | Transaction;

export interface HandoffRecord {
  id: string;
  mode: HandoffMode;
  status: HandoffStatus;
  slotStartsAt: Date;
  slotEndsAt: Date;
  location: string;
  photos: HandoffPhoto[];
  report: VerificationReport | null;
  verifierError: string | null;
  decision: HandoffDecision | null;
  payCents: number | null;
  decidedAt: Date | null;
}

export interface HandoffItem {
  orderItemId: string;
  listingId: string;
  sellerId: string;
  sellerName: string;
  title: string;
  description: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  conditionReport: ConditionReport;
  photos: ListingPhoto[];
  listingStatus: ListingStatus;
  handoffMode: HandoffMode;
  moveOutStartsAt: Date;
  moveOutEndsAt: Date;
  moveInStartsAt: Date;
  moveInEndsAt: Date;
  amountCents: number;
  capturedAmountCents: number;
  refundedAmountCents: number;
  status: OrderItemStatus;
  paypalCaptureId: string | null;
  paypalRefundId: string | null;
  /** The handoff slot the agents agreed on, or null for the listing's whole handoff window. */
  slot: { startsAt: Date; endsAt: Date } | null;
  attempt: number;
  handoff: HandoffRecord | null;
}

export interface PayoutItemRecord {
  id: string;
  sellerId: string;
  sellerName: string;
  amountCents: number;
  wallet: PayoutWallet;
  recipientType: PayoutRecipientType;
  receiver: string;
  senderItemId: string;
  paypalPayoutItemId: string | null;
  status: PayoutItemStatus;
  statusChangedAt: Date | null;
}

export interface PayoutRecord {
  id: string;
  senderBatchId: string;
  paypalBatchId: string | null;
  status: PayoutStatus;
  totalCents: number;
  attempt: number;
  createdAt: Date;
  items: PayoutItemRecord[];
}

export interface HandoffOrder {
  id: string;
  planId: string;
  sessionId: string | null;
  paymentMode: PaymentMode;
  status: OrderStatus;
  totalCents: number;
  paypalOrderId: string | null;
  paypalAuthorizationId: string | null;
  paypalReauthorizationId: string | null;
  paypalCaptureId: string | null;
  approvedAt: Date | null;
  reauthorizedAt: Date | null;
  voidedAt: Date | null;
  settledAt: Date | null;
  releasedAt: Date | null;
  settlementError: string | null;
  attempt: number;
  items: HandoffItem[];
  payout: PayoutRecord | null;
}

const orderColumns = {
  id: orders.id,
  planId: orders.planId,
  sessionId: plans.sessionId,
  paymentMode: orders.paymentMode,
  status: orders.status,
  totalCents: orders.totalCents,
  paypalOrderId: orders.paypalOrderId,
  paypalAuthorizationId: orders.paypalAuthorizationId,
  paypalReauthorizationId: orders.paypalReauthorizationId,
  paypalCaptureId: orders.paypalCaptureId,
  approvedAt: orders.approvedAt,
  reauthorizedAt: orders.reauthorizedAt,
  voidedAt: orders.voidedAt,
  settledAt: orders.settledAt,
  releasedAt: orders.releasedAt,
  settlementError: orders.settlementError,
  attempt: orders.attempt,
};

/** Orders the Handoff screen shows. Unpaid and canceled orders have nothing to hand off. */
const HANDOFF_ORDER_STATUSES: readonly OrderStatus[] = ["authorized", "capture_pending", "captured", "settling", "settled", "releasing", "voided", "refunded"];

async function itemsOf(db: Executor, orderId: string): Promise<HandoffItem[]> {
  const rows = await db
    .select({
      orderItemId: orderItems.id,
      listingId: orderItems.listingId,
      sellerId: orderItems.sellerId,
      sellerName: users.displayName,
      title: listings.title,
      description: listings.description,
      widthMm: listings.widthMm,
      depthMm: listings.depthMm,
      heightMm: listings.heightMm,
      conditionReport: listings.conditionReport,
      photos: listings.photos,
      listingStatus: listings.status,
      handoffMode: listings.handoffMode,
      moveOutStartsAt: listings.moveOutStartsAt,
      moveOutEndsAt: listings.moveOutEndsAt,
      moveInStartsAt: listings.moveInStartsAt,
      moveInEndsAt: listings.moveInEndsAt,
      amountCents: orderItems.amountCents,
      capturedAmountCents: orderItems.capturedAmountCents,
      refundedAmountCents: orderItems.refundedAmountCents,
      status: orderItems.status,
      paypalCaptureId: orderItems.paypalCaptureId,
      paypalRefundId: orderItems.paypalRefundId,
      itemSlotStartsAt: orderItems.slotStartsAt,
      itemSlotEndsAt: orderItems.slotEndsAt,
      attempt: orderItems.attempt,
      handoffId: handoffs.id,
      handoffMode2: handoffs.mode,
      handoffStatus: handoffs.status,
      slotStartsAt: handoffs.slotStartsAt,
      slotEndsAt: handoffs.slotEndsAt,
      location: handoffs.location,
      handoffPhotos: handoffs.photos,
      report: handoffs.verificationReport,
      verifierError: handoffs.verifierError,
      decision: handoffs.decision,
      payCents: handoffs.payCents,
      decidedAt: handoffs.decidedAt,
    })
    .from(orderItems)
    .innerJoin(listings, eq(orderItems.listingId, listings.id))
    .innerJoin(users, eq(orderItems.sellerId, users.id))
    .leftJoin(handoffs, eq(handoffs.orderItemId, orderItems.id))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.listingId));
  return rows.map((row) => ({
    orderItemId: row.orderItemId,
    listingId: row.listingId,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    title: row.title,
    description: row.description,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    heightMm: row.heightMm,
    conditionReport: conditionReportSchema.parse(row.conditionReport),
    photos: listingPhotosSchema.parse(row.photos),
    listingStatus: row.listingStatus,
    handoffMode: row.handoffMode,
    moveOutStartsAt: row.moveOutStartsAt,
    moveOutEndsAt: row.moveOutEndsAt,
    moveInStartsAt: row.moveInStartsAt,
    moveInEndsAt: row.moveInEndsAt,
    amountCents: row.amountCents,
    capturedAmountCents: row.capturedAmountCents,
    refundedAmountCents: row.refundedAmountCents,
    status: row.status,
    paypalCaptureId: row.paypalCaptureId,
    paypalRefundId: row.paypalRefundId,
    slot: row.itemSlotStartsAt === null || row.itemSlotEndsAt === null ? null : { startsAt: row.itemSlotStartsAt, endsAt: row.itemSlotEndsAt },
    attempt: row.attempt,
    handoff:
      row.handoffId === null
        ? null
        : {
            id: row.handoffId,
            mode: row.handoffMode2 as HandoffMode,
            status: row.handoffStatus as HandoffStatus,
            slotStartsAt: row.slotStartsAt as Date,
            slotEndsAt: row.slotEndsAt as Date,
            location: row.location as string,
            photos: handoffPhotosSchema.parse(row.handoffPhotos ?? []),
            report: row.report === null ? null : verificationReportSchema.parse(row.report),
            verifierError: row.verifierError,
            decision: row.decision,
            payCents: row.payCents,
            decidedAt: row.decidedAt,
          },
  }));
}

async function payoutOf(db: Executor, orderId: string): Promise<PayoutRecord | null> {
  const [payout] = await db
    .select({
      id: payouts.id,
      senderBatchId: payouts.senderBatchId,
      paypalBatchId: payouts.paypalBatchId,
      status: payouts.status,
      totalCents: payouts.totalCents,
      attempt: payouts.attempt,
      createdAt: payouts.createdAt,
    })
    .from(payouts)
    .where(eq(payouts.orderId, orderId))
    .orderBy(desc(payouts.createdAt))
    .limit(1);
  if (payout === undefined) return null;
  const items = await db
    .select({
      id: payoutItems.id,
      sellerId: payoutItems.sellerId,
      sellerName: users.displayName,
      amountCents: payoutItems.amountCents,
      wallet: payoutItems.wallet,
      recipientType: payoutItems.recipientType,
      receiver: payoutItems.receiver,
      senderItemId: payoutItems.senderItemId,
      paypalPayoutItemId: payoutItems.paypalPayoutItemId,
      status: payoutItems.status,
      statusChangedAt: payoutItems.statusChangedAt,
    })
    .from(payoutItems)
    .innerJoin(users, eq(payoutItems.sellerId, users.id))
    .where(eq(payoutItems.payoutId, payout.id))
    .orderBy(asc(payoutItems.createdAt), asc(payoutItems.senderItemId));
  return { ...payout, items };
}

/** The plan's order as the Handoff screen and settlement read it, or null before a checkout holds money. */
export async function loadHandoffOrder(db: Executor, planId: string): Promise<HandoffOrder | null> {
  const [row] = await db
    .select(orderColumns)
    .from(orders)
    .innerJoin(plans, eq(orders.planId, plans.id))
    .where(and(eq(orders.planId, planId), inArray(orders.status, [...HANDOFF_ORDER_STATUSES])))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (row === undefined) return null;
  const [items, payout] = await Promise.all([itemsOf(db, row.id), payoutOf(db, row.id)]);
  return { ...row, items, payout };
}

export async function loadHandoffOrderById(db: Executor, orderId: string): Promise<HandoffOrder | null> {
  const [row] = await db.select(orderColumns).from(orders).innerJoin(plans, eq(orders.planId, plans.id)).where(eq(orders.id, orderId));
  if (row === undefined) return null;
  const [items, payout] = await Promise.all([itemsOf(db, row.id), payoutOf(db, row.id)]);
  return { ...row, items, payout };
}

/** The session's latest plan whose order reached handoff, for the bare /handoff address. */
export async function latestHandoffPlanId(db: Executor, sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ planId: orders.planId })
    .from(orders)
    .innerJoin(plans, eq(orders.planId, plans.id))
    .where(and(eq(plans.sessionId, sessionId), inArray(orders.status, [...HANDOFF_ORDER_STATUSES])))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return row?.planId ?? null;
}

/**
 * Gives every item of the order its handoff row, once. The slot is the one
 * the buyer and seller agents agreed on, or else the item's handoff window
 * from the listing, and a direct or same room handoff happens in the
 * buyer's room.
 */
export async function ensureHandoffs(db: Executor, order: HandoffOrder, roomLabel: string): Promise<boolean> {
  const missing = order.items.filter((item) => item.handoff === null);
  if (missing.length === 0) return false;
  await db
    .insert(handoffs)
    .values(
      missing.map((item) => {
        const window = item.slot ?? handoffWindow(item.handoffMode, item) ?? { startsAt: item.moveInStartsAt, endsAt: item.moveInEndsAt };
        return {
          orderItemId: item.orderItemId,
          mode: item.handoffMode,
          slotStartsAt: window.startsAt,
          slotEndsAt: window.endsAt,
          location: item.handoffMode === "storage_hold" ? "Lakeshore campus storage" : roomLabel,
        };
      }),
    )
    .onConflictDoNothing({ target: handoffs.orderItemId });
  return true;
}

export async function storeUploadedPhoto(db: Executor, input: { handoffId: string; sessionId: string; contentType: string; bytes: Buffer; sha256: string }): Promise<string> {
  const id = randomUUID();
  await db.insert(handoffPhotos).values({ id, handoffId: input.handoffId, sessionId: input.sessionId, contentType: input.contentType, byteSize: input.bytes.length, sha256: input.sha256, bytes: input.bytes });
  return id;
}

/** An uploaded photo, only for the session that took it. */
export async function loadUploadedPhoto(db: Executor, photoId: string, sessionId: string): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
  const [row] = await db
    .select({ contentType: handoffPhotos.contentType, bytes: handoffPhotos.bytes, sha256: handoffPhotos.sha256 })
    .from(handoffPhotos)
    .where(and(eq(handoffPhotos.id, photoId), eq(handoffPhotos.sessionId, sessionId)));
  return row ?? null;
}

/** Adds the newest photo of an item and clears the last comparison, while no decision is confirmed. */
export async function addHandoffPhoto(db: Executor, handoffId: string, photo: HandoffPhoto): Promise<boolean> {
  const rows = await db
    .update(handoffs)
    .set({ photos: sql`${handoffs.photos} || ${JSON.stringify([photo])}::jsonb`, status: "verifying", verificationReport: null, verifierError: null })
    .where(and(eq(handoffs.id, handoffId), isNull(handoffs.decision)))
    .returning({ id: handoffs.id });
  return rows.length > 0;
}

export async function markVerifying(db: Executor, handoffId: string): Promise<boolean> {
  const rows = await db
    .update(handoffs)
    .set({ status: "verifying", verificationReport: null, verifierError: null })
    .where(and(eq(handoffs.id, handoffId), isNull(handoffs.decision)))
    .returning({ id: handoffs.id });
  return rows.length > 0;
}

export async function recordVerdict(db: Executor, handoffId: string, report: VerificationReport): Promise<void> {
  await db
    .update(handoffs)
    .set({ status: "verified", verificationReport: verificationReportSchema.parse(report), verifierError: null })
    .where(and(eq(handoffs.id, handoffId), isNull(handoffs.decision)));
}

export async function recordVerifierError(db: Executor, handoffId: string, error: string): Promise<void> {
  await db.update(handoffs).set({ status: "scheduled", verifierError: error }).where(and(eq(handoffs.id, handoffId), isNull(handoffs.decision)));
}

/** Confirms one item's decision. A second confirmation of the same item changes nothing. */
export async function recordDecision(db: Executor, handoffId: string, decision: HandoffDecision, payCents: number, at: Date): Promise<boolean> {
  const rows = await db
    .update(handoffs)
    .set({ decision, payCents, decidedAt: at, status: "verified" })
    .where(and(eq(handoffs.id, handoffId), isNull(handoffs.decision)))
    .returning({ id: handoffs.id });
  return rows.length > 0;
}

/**
 * Starts settlement, or picks up one that stopped partway. The order row
 * lock and the status check let one settlement or release own the order.
 */
export async function claimSettlement(db: Database, orderId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for("update");
    if (row === undefined) return false;
    if (row.status === "settling") return true;
    if (row.status !== "authorized" && row.status !== "captured") return false;
    await tx.update(orders).set({ status: "settling", settlementError: null }).where(eq(orders.id, orderId));
    return true;
  });
}

export async function recordSettlementError(db: Executor, orderId: string, error: string | null): Promise<void> {
  await db.update(orders).set({ settlementError: error }).where(eq(orders.id, orderId));
}

export async function recordReauthorization(db: Executor, orderId: string, authorizationId: string, at: Date): Promise<void> {
  await db.update(orders).set({ paypalReauthorizationId: authorizationId, reauthorizedAt: at }).where(and(eq(orders.id, orderId), isNull(orders.reauthorizedAt)));
}

/** What a captured or refunded item ends as, from what the student kept and paid. */
function settledItemStatus(amountCents: number, payCents: number): OrderItemStatus {
  if (payCents === 0) return "released";
  return payCents === amountCents ? "captured" : "adjusted";
}

export async function recordItemCapture(db: Executor, input: { orderItemId: string; captureId: string; amountCents: number; payCents: number; pending: boolean }): Promise<void> {
  await db
    .update(orderItems)
    .set({ paypalCaptureId: input.captureId, capturedAmountCents: input.payCents, status: input.pending ? "capture_pending" : settledItemStatus(input.amountCents, input.payCents) })
    .where(eq(orderItems.id, input.orderItemId));
}

export async function recordItemRefund(db: Executor, input: { orderItemId: string; refundId: string; amountCents: number; payCents: number }): Promise<void> {
  await db
    .update(orderItems)
    .set({ paypalRefundId: input.refundId, refundedAmountCents: input.amountCents - input.payCents, status: settledItemStatus(input.amountCents, input.payCents) })
    .where(eq(orderItems.id, input.orderItemId));
}

export async function recordVoided(db: Executor, orderId: string, at: Date): Promise<void> {
  await db.update(orders).set({ voidedAt: at }).where(and(eq(orders.id, orderId), isNull(orders.voidedAt)));
}

/**
 * Writes the payout and one payout item per seller, once per order. Each
 * item's ID is also its sender_item_id, so webhooks find it before Roomover
 * knows PayPal's item ID.
 */
export async function insertPayout(db: Database, input: { orderId: string; senderBatchId: string; lines: readonly (SellerPayoutLine & PayoutRecipient)[] }): Promise<void> {
  await db.transaction(async (tx) => {
    const [payout] = await tx
      .insert(payouts)
      .values({ orderId: input.orderId, senderBatchId: input.senderBatchId, totalCents: input.lines.reduce((sum, line) => sum + line.amountCents, 0) })
      .onConflictDoNothing({ target: payouts.senderBatchId })
      .returning({ id: payouts.id });
    if (payout === undefined) return;
    for (const line of input.lines) {
      const id = randomUUID();
      await tx.insert(payoutItems).values({ id, payoutId: payout.id, sellerId: line.sellerId, amountCents: line.amountCents, wallet: line.wallet, recipientType: line.recipientType, receiver: line.receiver, senderItemId: id });
      await tx.update(orderItems).set({ payoutItemId: id }).where(inArray(orderItems.id, line.orderItemIds));
    }
  });
}

export async function recordPayoutBatch(db: Executor, payoutId: string, paypalBatchId: string): Promise<void> {
  await db.update(payouts).set({ paypalBatchId }).where(and(eq(payouts.id, payoutId), isNull(payouts.paypalBatchId)));
}

/** The order and plan a payout belongs to, so a change can reach the screens following it. */
async function ownerOfPayout(db: Executor, payoutId: string): Promise<{ planId: string; orderId: string } | null> {
  const [row] = await db.select({ planId: orders.planId, orderId: orders.id }).from(payouts).innerJoin(orders, eq(payouts.orderId, orders.id)).where(eq(payouts.id, payoutId));
  return row ?? null;
}

async function lockPayout(db: Executor, payoutId: string): Promise<void> {
  await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.id, payoutId)).for("update");
}

/** Locks the order's newest payout, so the moment every seller is paid is noted once. */
export async function lockOrderPayout(db: Executor, orderId: string): Promise<void> {
  await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.orderId, orderId)).for("update");
}

/**
 * Puts the seeded listings an order sold back on sale, so the demo catalog
 * never drains while judges test. Listings made on Sell stay sold.
 */
export async function relistSeededListings(db: Executor, orderId: string): Promise<string[]> {
  const sold = db.select({ id: orderItems.listingId }).from(orderItems).where(eq(orderItems.orderId, orderId));
  const rows = await db
    .update(listings)
    .set({ status: "active" })
    .where(and(inArray(listings.id, sold), eq(listings.status, "sold"), isNull(listings.sessionId)))
    .returning({ id: listings.id });
  return rows.map((row) => row.id);
}

export type PayoutChange = { step: "apply" | "duplicate" | "stale"; planId: string; orderId: string } | null;

/** Lands a batch status from PayPal, through the transitions that ignore repeats and stale reports. */
export async function applyPayoutBatchStatus(db: Executor, match: { paypalBatchId?: string; senderBatchId?: string }, next: PayoutStatus): Promise<PayoutChange> {
  return db.transaction(async (tx) => {
    const conditions = [match.paypalBatchId === undefined ? undefined : eq(payouts.paypalBatchId, match.paypalBatchId), match.senderBatchId === undefined ? undefined : eq(payouts.senderBatchId, match.senderBatchId)].filter((condition) => condition !== undefined);
    if (conditions.length === 0) return null;
    const [row] = await tx.select({ id: payouts.id, status: payouts.status }).from(payouts).where(or(...conditions)).for("update");
    if (row === undefined) return null;
    const step = payoutBatchStep(row.status, next);
    if (step === "apply") await tx.update(payouts).set({ status: next, ...(match.paypalBatchId === undefined ? {} : { paypalBatchId: sql`coalesce(${payouts.paypalBatchId}, ${match.paypalBatchId})` }) }).where(eq(payouts.id, row.id));
    const owner = await ownerOfPayout(tx, row.id);
    return owner === null ? null : { step, ...owner };
  });
}

/**
 * Lands an item status from PayPal. The item is found by PayPal's ID or by
 * Roomover's sender_item_id, and PayPal's ID is kept the first time it is
 * seen. The batch row is locked before the item, so two items landing at
 * once take turns and the later one sees the earlier one's status.
 */
export async function applyPayoutItemStatus(db: Executor, match: { paypalPayoutItemId?: string; senderItemId?: string }, next: PayoutItemStatus, at: Date): Promise<PayoutChange> {
  return db.transaction(async (tx) => {
    const conditions = [match.paypalPayoutItemId === undefined ? undefined : eq(payoutItems.paypalPayoutItemId, match.paypalPayoutItemId), match.senderItemId === undefined ? undefined : eq(payoutItems.senderItemId, match.senderItemId)].filter((condition) => condition !== undefined);
    if (conditions.length === 0) return null;
    const [found] = await tx.select({ payoutId: payoutItems.payoutId }).from(payoutItems).where(or(...conditions));
    if (found === undefined) return null;
    await lockPayout(tx, found.payoutId);
    const [row] = await tx.select({ id: payoutItems.id, payoutId: payoutItems.payoutId, status: payoutItems.status, paypalPayoutItemId: payoutItems.paypalPayoutItemId }).from(payoutItems).where(or(...conditions)).for("update");
    if (row === undefined) return null;
    const step = payoutItemStep(row.status, next);
    const learnedId = row.paypalPayoutItemId === null && match.paypalPayoutItemId !== undefined ? { paypalPayoutItemId: match.paypalPayoutItemId } : {};
    if (step === "apply") await tx.update(payoutItems).set({ status: next, statusChangedAt: at, ...learnedId }).where(eq(payoutItems.id, row.id));
    else if ("paypalPayoutItemId" in learnedId) await tx.update(payoutItems).set(learnedId).where(eq(payoutItems.id, row.id));
    const owner = await ownerOfPayout(tx, row.payoutId);
    return owner === null ? null : { step, ...owner };
  });
}

/**
 * Closes settlement. Kept items are sold and released items go back on
 * sale. The order row is written before any listing, the lock order the
 * daily reseed uses.
 */
export async function finishSettlement(db: Database, order: HandoffOrder, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).for("update");
    if (row?.status !== "settling") return;
    await tx.update(orders).set({ status: "settled", settledAt: at, settlementError: null }).where(eq(orders.id, order.id));
    const kept = order.items.filter((item) => (item.handoff?.payCents ?? 0) > 0).map((item) => item.orderItemId);
    const released = order.items.filter((item) => item.handoff?.payCents === 0);
    if (released.length > 0) {
      await tx
        .update(orderItems)
        .set({ status: "released" })
        .where(
          and(
            inArray(
              orderItems.id,
              released.map((item) => item.orderItemId),
            ),
            ne(orderItems.status, "released"),
          ),
        );
    }
    await tx.update(handoffs).set({ status: "completed" }).where(inArray(handoffs.orderItemId, order.items.map((item) => item.orderItemId)));
    const keptListings = order.items.filter((item) => kept.includes(item.orderItemId)).map((item) => item.listingId);
    if (keptListings.length > 0) await tx.update(listings).set({ status: "sold" }).where(and(inArray(listings.id, keptListings), eq(listings.status, "reserved")));
    if (released.length > 0) await tx.update(listings).set({ status: "active" }).where(and(inArray(listings.id, released.map((item) => item.listingId)), eq(listings.status, "reserved")));
    await tx.update(plans).set({ status: "completed" }).where(eq(plans.id, order.planId));
  });
}

/** Starts giving an unchecked order's money back. Only an order that still holds it, with no settlement under way, can be claimed. */
export async function claimRelease(db: Executor, orderId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for("update");
    if (row === undefined) return false;
    if (row.status === "releasing") return true;
    if (row.status !== "authorized" && row.status !== "captured") return false;
    await tx.update(orders).set({ status: "releasing" }).where(eq(orders.id, orderId));
    return true;
  });
}

/**
 * Closes a release. The order ends voided or refunded, every item is
 * released, open handoffs are canceled, and the reserved listings go back on
 * sale, in the reseed's lock order.
 */
export async function finishRelease(db: Executor, orderId: string, input: { at: Date; planStatus: "ready" | "abandoned" }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ status: orders.status, paymentMode: orders.paymentMode, planId: orders.planId }).from(orders).where(eq(orders.id, orderId)).for("update");
    if (row?.status !== "releasing") return;
    const status = releasedStatus(row.paymentMode);
    await tx
      .update(orders)
      .set({ status, releasedAt: input.at, ...(status === "voided" ? { voidedAt: input.at } : {}) })
      .where(eq(orders.id, orderId));
    const lines = await tx.select({ id: orderItems.id, listingId: orderItems.listingId }).from(orderItems).where(eq(orderItems.orderId, orderId));
    await tx
      .update(orderItems)
      .set({ status: "released", ...(status === "refunded" ? { refundedAmountCents: sql`${orderItems.capturedAmountCents}` } : {}) })
      .where(eq(orderItems.orderId, orderId));
    if (lines.length > 0) {
      await tx.update(handoffs).set({ status: "canceled" }).where(inArray(handoffs.orderItemId, lines.map((line) => line.id)));
      await tx.update(listings).set({ status: "active" }).where(and(inArray(listings.id, lines.map((line) => line.listingId)), eq(listings.status, "reserved")));
    }
    await tx.update(plans).set({ status: input.planStatus }).where(eq(plans.id, row.planId));
  });
}

/** Each seller's payout accounts, read at send time. The receiver chosen from them is kept on the payout item. */
export async function sellerAccounts(db: Executor, sellerIds: readonly string[]): Promise<Map<string, SellerAccount>> {
  if (sellerIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, paypalAccountId: users.paypalAccountId, paypalEmail: users.paypalEmail, payoutWallet: users.payoutWallet, venmoHandle: users.venmoHandle })
    .from(users)
    .where(inArray(users.id, [...sellerIds]));
  return new Map(rows.map(({ id, ...account }) => [id, account]));
}

/** An order holding money under an authorization, found by the authorization or its reauthorization. */
export async function orderByAuthorization(db: Executor, authorizationId: string): Promise<{ id: string; planId: string; status: OrderStatus } | null> {
  const [row] = await db
    .select({ id: orders.id, planId: orders.planId, status: orders.status })
    .from(orders)
    .where(or(eq(orders.paypalAuthorizationId, authorizationId), eq(orders.paypalReauthorizationId, authorizationId)));
  return row ?? null;
}

/** A capture PayPal reported pending lands as captured once its completion webhook arrives. */
export async function confirmItemCapture(db: Executor, captureId: string): Promise<string | null> {
  const [row] = await db
    .update(orderItems)
    .set({ status: sql`case when ${orderItems.capturedAmountCents} = ${orderItems.amountCents} then 'captured'::order_item_status else 'adjusted'::order_item_status end` })
    .where(and(eq(orderItems.paypalCaptureId, captureId), eq(orderItems.status, "capture_pending")))
    .returning({ orderId: orderItems.orderId });
  if (row === undefined) return null;
  const [order] = await db.select({ planId: orders.planId }).from(orders).where(eq(orders.id, row.orderId));
  return order?.planId ?? null;
}

/** Cancels prepared orders created before the cutoff that nobody approved. They hold no money and reserve no listing. */
export async function cancelUnapprovedBefore(db: Executor, createdBefore: Date): Promise<string[]> {
  const rows = await db
    .update(orders)
    .set({ status: "canceled" })
    .where(and(inArray(orders.status, ["pending_approval", "approved"]), sql`${orders.createdAt} <= ${createdBefore}`))
    .returning({ id: orders.id });
  return rows.map((row) => row.id);
}

/**
 * Orders the demo release may give back: holding money, approved before the
 * cutoff, with their handoff photo count and the latest change to any of
 * their handoffs. A release a stopped run left partway comes along too.
 */
export async function releaseCandidates(db: Executor, approvedBefore: Date): Promise<{ id: string; status: OrderStatus; approvedAt: Date | null; photoCount: number; lastActivityAt: Date | null }[]> {
  const held = (
    await db
      .select({ id: orders.id, status: orders.status, approvedAt: orders.approvedAt })
      .from(orders)
      .where(inArray(orders.status, ["authorized", "captured", "releasing"]))
  ).filter((row) => row.status === "releasing" || (row.approvedAt !== null && row.approvedAt <= approvedBefore));
  if (held.length === 0) return [];
  // A join, so Drizzle names each column with its table. Inside a one table select it would not.
  const activity = await db
    .select({
      orderId: orderItems.orderId,
      photoCount: sql<number>`coalesce(sum(jsonb_array_length(${handoffs.photos})), 0)::int`,
      lastActivityAt: sql<string | Date | null>`max(${handoffs.updatedAt})`,
    })
    .from(handoffs)
    .innerJoin(orderItems, eq(handoffs.orderItemId, orderItems.id))
    .where(inArray(orderItems.orderId, held.map((row) => row.id)))
    .groupBy(orderItems.orderId);
  const byOrder = new Map(activity.map((row) => [row.orderId, row]));
  return held.map((row) => {
    const seen = byOrder.get(row.id);
    return { ...row, photoCount: seen?.photoCount ?? 0, lastActivityAt: seen?.lastActivityAt === null || seen?.lastActivityAt === undefined ? null : new Date(seen.lastActivityAt) };
  });
}

/** Writes handoff activity lines. Their run ID is the order's ID, like checkout's. */
export async function insertHandoffEvents(db: Executor, order: Pick<HandoffOrder, "id" | "planId">, agent: "verifier" | "platform", drafts: readonly EventDraft[]): Promise<ActivityEventView[]> {
  return insertEvents(db, { runId: order.id, planId: order.planId, orderId: order.id, agent, drafts });
}

/** Whether an order already has an activity line from this tool, so a retried step writes its line once. */
export async function hasOrderEvent(db: Executor, orderId: string, tool: string): Promise<boolean> {
  const [row] = await db.select({ seq: agentEvents.seq }).from(agentEvents).where(and(eq(agentEvents.orderId, orderId), eq(agentEvents.tool, tool))).limit(1);
  return row !== undefined;
}

/** Live comparisons a session ran in the last hour, for the demo limit. */
export async function comparisonsSince(db: Executor, sessionId: string, since: Date): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${agentEvents.createdAt})` })
    .from(agentEvents)
    .innerJoin(plans, eq(agentEvents.planId, plans.id))
    .where(and(eq(plans.sessionId, sessionId), eq(agentEvents.agent, "verifier"), sql`(${agentEvents.detail}->>'claudeCalls')::int > 0`, gte(agentEvents.createdAt, since)));
  return { count: row?.count ?? 0, oldest: row?.oldest === null || row?.oldest === undefined ? null : new Date(row.oldest) };
}
