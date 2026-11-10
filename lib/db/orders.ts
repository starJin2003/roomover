import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { EventDraft } from "@/lib/agents/buyer/context";
import type { CheckoutListing, CheckoutPlan } from "@/lib/domain/checkout";
import type { OrderItemStatus, OrderStatus, PaymentMode } from "@/lib/domain/enums";
import type { PlanClaim } from "@/lib/domain/mcp";
import { holdsMoney, ITEM_STATUS_AFTER, planApproval, type ApprovalStatus } from "@/lib/domain/order-state";
import { formatUsdShort } from "@/lib/format";
import type { ActivityEventView } from "@/lib/plan-view";
import type { TimeWindow } from "@/lib/domain/handoff";
import type { Database } from "./client";
import { agreedTerms } from "./negotiations";
import { claimPlan, insertEvents, type Transaction } from "./plans";
import { listings, orderItems, orders, plans, users } from "./schema";

export interface OrderRow {
  id: string;
  planId: string;
  buyerId: string;
  paymentMode: PaymentMode;
  status: OrderStatus;
  totalCents: number;
  paypalOrderId: string | null;
  paypalAuthorizationId: string | null;
  paypalCaptureId: string | null;
  authorizationExpiresAt: Date | null;
  approvedAt: Date | null;
  attempt: number;
  createdAt: Date;
}

export interface OrderLine {
  listingId: string;
  sellerId: string;
  amountCents: number;
  status: OrderItemStatus;
  /** The handoff slot the agents agreed on, or null for the listing's whole handoff window. */
  slot: TimeWindow | null;
}

export type OrderWithLines = OrderRow & { lines: OrderLine[] };

const orderColumns = {
  id: orders.id,
  planId: orders.planId,
  buyerId: orders.buyerId,
  paymentMode: orders.paymentMode,
  status: orders.status,
  totalCents: orders.totalCents,
  paypalOrderId: orders.paypalOrderId,
  paypalAuthorizationId: orders.paypalAuthorizationId,
  paypalCaptureId: orders.paypalCaptureId,
  authorizationExpiresAt: orders.authorizationExpiresAt,
  approvedAt: orders.approvedAt,
  attempt: orders.attempt,
  createdAt: orders.createdAt,
};

const lineColumns = {
  listingId: orderItems.listingId,
  sellerId: orderItems.sellerId,
  amountCents: orderItems.amountCents,
  status: orderItems.status,
  slotStartsAt: orderItems.slotStartsAt,
  slotEndsAt: orderItems.slotEndsAt,
};

type LineRow = { listingId: string; sellerId: string; amountCents: number; status: OrderItemStatus; slotStartsAt: Date | null; slotEndsAt: Date | null };

const toLine = ({ slotStartsAt, slotEndsAt, ...row }: LineRow): OrderLine => ({ ...row, slot: slotStartsAt === null || slotEndsAt === null ? null : { startsAt: slotStartsAt, endsAt: slotEndsAt } });

type Executor = Database | Transaction;

/** The listings a plan names, with the seller, price, floor, status, move windows, and the plan's agreed terms that checkout reads. */
export async function loadCheckoutListings(db: Executor, ids: readonly string[], planId: string): Promise<Map<string, CheckoutListing>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      sellerId: listings.sellerId,
      sellerName: users.displayName,
      priceCents: listings.priceCents,
      floorPriceCents: listings.floorPriceCents,
      handoffMode: listings.handoffMode,
      status: listings.status,
      moveOutStartsAt: listings.moveOutStartsAt,
      moveOutEndsAt: listings.moveOutEndsAt,
      moveInStartsAt: listings.moveInStartsAt,
      moveInEndsAt: listings.moveInEndsAt,
    })
    .from(listings)
    .innerJoin(users, eq(listings.sellerId, users.id))
    .where(inArray(listings.id, [...ids]));
  const agreements = await agreedTerms(db, planId, ids);
  return new Map(rows.map((row) => [row.id, { ...row, agreement: agreements.get(row.id) ?? null }]));
}

async function linesOf(db: Executor, orderId: string): Promise<OrderLine[]> {
  const rows = await db.select(lineColumns).from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt), asc(orderItems.listingId));
  return rows.map(toLine);
}

/** The plan's current order with its lines. Canceled orders are history and never current. */
export async function currentOrder(db: Executor, planId: string): Promise<OrderWithLines | null> {
  const [row] = await db
    .select(orderColumns)
    .from(orders)
    .where(and(eq(orders.planId, planId), ne(orders.status, "canceled")))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return row === undefined ? null : { ...row, lines: await linesOf(db, row.id) };
}

export async function orderByPayPalId(db: Executor, paypalOrderId: string): Promise<OrderWithLines | null> {
  const [row] = await db.select(orderColumns).from(orders).where(eq(orders.paypalOrderId, paypalOrderId));
  return row === undefined ? null : { ...row, lines: await linesOf(db, row.id) };
}

/**
 * Writes a new order awaiting approval, with one line per listing at its
 * listed or agreed price and its agreed slot. Any older order still
 * awaiting approval on the plan is canceled in the same transaction, so a
 * plan has one order to approve.
 */
export async function insertPendingOrder(db: Database, input: { planId: string; buyerId: string; checkout: CheckoutPlan }): Promise<OrderWithLines> {
  return db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ status: "canceled" })
      .where(and(eq(orders.planId, input.planId), inArray(orders.status, ["pending_approval", "approved"])));
    const [order] = await tx
      .insert(orders)
      .values({ planId: input.planId, buyerId: input.buyerId, paymentMode: input.checkout.paymentMode, totalCents: input.checkout.totalCents })
      .returning(orderColumns);
    const lines = await tx
      .insert(orderItems)
      .values(
        input.checkout.lines.map((line) => ({
          orderId: order.id,
          listingId: line.listingId,
          sellerId: line.sellerId,
          amountCents: line.amountCents,
          slotStartsAt: line.slot?.startsAt ?? null,
          slotEndsAt: line.slot?.endsAt ?? null,
        })),
      )
      .returning(lineColumns);
    return { ...order, lines: lines.map(toLine) };
  });
}

export async function setPayPalOrderId(db: Executor, orderId: string, paypalOrderId: string): Promise<void> {
  await db.update(orders).set({ paypalOrderId }).where(eq(orders.id, orderId));
}

/** Retires an order PayPal will not complete, such as one that expired before approval. */
export async function cancelPendingOrder(db: Executor, orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({ status: "canceled" })
    .where(and(eq(orders.id, orderId), inArray(orders.status, ["pending_approval", "approved"])));
}

export interface ApprovalRecord {
  paypalOrderId: string;
  status: ApprovalStatus;
  authorizationId?: string;
  authorizationExpiresAt?: Date;
  captureId?: string;
  /** Which path saw the result first, for the log. */
  source: "api" | "webhook";
  at: Date;
}

/** A listing in the order was reserved by someone else between checkout and approval. */
export class ListingTaken extends Error {
  constructor(readonly listingIds: readonly string[]) {
    super("An item in this order is no longer available.");
    this.name = "ListingTaken";
  }
}

export type ApprovalResult = { order: OrderWithLines; step: "apply" | "duplicate" | "stale"; events: ActivityEventView[]; claimed?: boolean };

function approvalEvent(order: OrderRow, sellers: number, record: ApprovalRecord): EventDraft {
  const total = formatUsdShort(order.totalCents);
  const students = sellers === 1 ? "1 student" : `${sellers} students`;
  const id = record.authorizationId ?? record.captureId ?? record.paypalOrderId;
  const via = record.source === "api" ? "the approval call" : "a PayPal webhook";
  const words: Record<ApprovalStatus, { sentence: string; summary: string }> = {
    authorized: { sentence: `You approved the order. PayPal holds ${total} for ${students} until handoff.`, summary: `Authorized order ${record.paypalOrderId} for ${total}, seen first through ${via}.` },
    captured: { sentence: `You approved the order. PayPal captured ${total}, and Roomover holds it for ${students} until handoff.`, summary: `Captured order ${record.paypalOrderId} for ${total}, seen first through ${via}.` },
    capture_pending: { sentence: `PayPal is still processing your ${total} payment.`, summary: `Capture of order ${record.paypalOrderId} is pending, seen first through ${via}.` },
    capture_declined: { sentence: "PayPal declined the payment, so nothing was charged.", summary: `Capture of order ${record.paypalOrderId} was declined, seen first through ${via}.` },
  };
  const kind = record.authorizationId !== undefined ? "authorization" : record.captureId !== undefined ? "capture" : "order";
  return { tool: "checkout_approved", ...words[record.status], blocked: record.status === "capture_declined", detail: { totalCents: order.totalCents, paypalIdKind: kind }, paypal: { api: "Orders v2", id } };
}

/**
 * Lands a checkout result, from the API answer or a webhook. The order row
 * is locked and updated before any listing, which keeps the lock order of
 * the daily reseed. The same result twice, or one the order has moved past,
 * changes nothing. Returns null when no order has the PayPal ID.
 */
export async function recordApproval(db: Executor, record: ApprovalRecord, claim?: PlanClaim): Promise<ApprovalResult | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select(orderColumns).from(orders).where(eq(orders.paypalOrderId, record.paypalOrderId)).for("update");
    if (row === undefined) return null;
    const lines = await linesOf(tx, row.id);
    const { step, reserveListings } = planApproval(row, record.status);
    if (step !== "apply") {
      const claimed = await claimIfHeld(tx, row, claim);
      return { order: { ...row, lines }, step, events: claimed.events, claimed: claimed.step === "claim" };
    }

    const captured = record.status === "captured";
    const [order] = await tx
      .update(orders)
      .set({
        status: record.status,
        paypalAuthorizationId: record.authorizationId ?? row.paypalAuthorizationId,
        authorizationExpiresAt: record.authorizationExpiresAt ?? row.authorizationExpiresAt,
        paypalCaptureId: record.captureId ?? row.paypalCaptureId,
        approvedAt: row.approvedAt ?? record.at,
      })
      .where(eq(orders.id, row.id))
      .returning(orderColumns);
    await tx
      .update(orderItems)
      .set({ status: ITEM_STATUS_AFTER[record.status], ...(captured ? { capturedAmountCents: sql`${orderItems.amountCents}` } : {}) })
      .where(eq(orderItems.orderId, row.id));

    if (reserveListings) {
      const ids = lines.map((line) => line.listingId);
      const reserved = await tx
        .update(listings)
        .set({ status: "reserved" })
        .where(and(inArray(listings.id, ids), eq(listings.status, "active")))
        .returning({ id: listings.id });
      if (reserved.length < ids.length) {
        const got = new Set(reserved.map((listing) => listing.id));
        throw new ListingTaken(ids.filter((id) => !got.has(id)));
      }
      await tx.update(plans).set({ status: "checked_out" }).where(eq(plans.id, row.planId));
    }

    const sellers = new Set(lines.map((line) => line.sellerId)).size;
    const events = await insertEvents(tx, { runId: row.id, planId: row.planId, orderId: row.id, agent: "platform", drafts: [approvalEvent(order, sellers, record)] });
    const claimed = await claimIfHeld(tx, order, claim);
    return { order: { ...order, lines: await linesOf(tx, row.id) }, step, events: [...events, ...claimed.events], claimed: claimed.step === "claim" };
  });
}

async function claimIfHeld(tx: Transaction, order: OrderRow, claim: PlanClaim | undefined) {
  if (claim === undefined || !holdsMoney(order.status)) return { step: "not_held" as const, events: [] };
  return claimPlan(tx, { planId: order.planId, orderId: order.id, paypalOrderId: order.paypalOrderId, claim });
}

/**
 * Claims the plan of an order a webhook already landed, under the same row
 * lock an approval takes, for a student whose return from PayPal arrives
 * after the webhook.
 */
export async function claimHeldPlan(db: Executor, orderId: string, claim: PlanClaim): Promise<{ claimed: boolean; events: ActivityEventView[] }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select(orderColumns).from(orders).where(eq(orders.id, orderId)).for("update");
    if (row === undefined) return { claimed: false, events: [] };
    const result = await claimIfHeld(tx, row, claim);
    return { claimed: result.step === "claim", events: result.events };
  });
}

/** Writes the activity lines of a checkout step outside an approval, such as preparing the order. */
export async function insertOrderEvents(db: Executor, order: Pick<OrderRow, "id" | "planId">, agent: "buyer" | "platform", drafts: readonly EventDraft[]): Promise<ActivityEventView[]> {
  return insertEvents(db, { runId: order.id, planId: order.planId, orderId: order.id, agent, drafts });
}
