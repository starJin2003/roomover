import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { disputeUpdateStep, evidenceStateOnReport, type DisputeUpdateStep, type EvidenceBundle } from "@/lib/domain/dispute";
import type { DisputeEvidenceState, DisputeStatus } from "@/lib/domain/enums";
import type { Database } from "./client";
import type { Transaction } from "./plans";
import { disputes, orderItems, orders } from "./schema";

type Executor = Database | Transaction;

export interface DisputeRow {
  id: string;
  paypalDisputeId: string;
  orderId: string | null;
  orderItemId: string | null;
  disputedCaptureId: string | null;
  status: DisputeStatus;
  stage: string | null;
  reason: string | null;
  amountCents: number | null;
  outcome: string | null;
  refundedCents: number | null;
  sellerResponseDueAt: Date | null;
  paypalUpdatedAt: Date | null;
  evidenceState: DisputeEvidenceState;
  evidence: EvidenceBundle | null;
  evidenceStage: string | null;
  evidenceSubmittedAt: Date | null;
  evidenceError: string | null;
  createdAt: Date;
}

const columns = {
  id: disputes.id,
  paypalDisputeId: disputes.paypalDisputeId,
  orderId: disputes.orderId,
  orderItemId: disputes.orderItemId,
  disputedCaptureId: disputes.disputedCaptureId,
  status: disputes.status,
  stage: disputes.stage,
  reason: disputes.reason,
  amountCents: disputes.amountCents,
  outcome: disputes.outcome,
  refundedCents: disputes.refundedCents,
  sellerResponseDueAt: disputes.sellerResponseDueAt,
  paypalUpdatedAt: disputes.paypalUpdatedAt,
  evidenceState: disputes.evidenceState,
  evidence: disputes.evidence,
  evidenceStage: disputes.evidenceStage,
  evidenceSubmittedAt: disputes.evidenceSubmittedAt,
  evidenceError: disputes.evidenceError,
  createdAt: disputes.createdAt,
};

/**
 * The order a disputed PayPal transaction belongs to, and the item. The
 * buyer picks items from the whole order on PayPal's site, and PayPal echoes
 * each one's sku, which is its listing ID, so that names the item. Without
 * one, the item is the one the disputed capture paid for, or none for a
 * capture that paid for the whole order.
 */
export async function disputedRecords(db: Executor, captureIds: readonly string[], listingIds: readonly string[] = []): Promise<{ orderId: string; planId: string; orderItemId: string | null; captureId: string } | null> {
  if (captureIds.length === 0) return null;
  const [item] = await db
    .select({ orderId: orderItems.orderId, planId: orders.planId, orderItemId: orderItems.id, captureId: orderItems.paypalCaptureId })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(inArray(orderItems.paypalCaptureId, [...captureIds]))
    .limit(1);
  const [order] =
    item !== undefined && item.captureId !== null
      ? [{ orderId: item.orderId, planId: item.planId, captureId: item.captureId }]
      : await db.select({ orderId: orders.id, planId: orders.planId, captureId: orders.paypalCaptureId }).from(orders).where(inArray(orders.paypalCaptureId, [...captureIds])).limit(1);
  if (order === undefined || order.captureId === null) return null;
  const named =
    listingIds.length === 0
      ? undefined
      : (await db.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, order.orderId), inArray(orderItems.listingId, [...listingIds]))).limit(1))[0];
  return { orderId: order.orderId, planId: order.planId, captureId: order.captureId, orderItemId: named?.id ?? (item?.captureId === order.captureId ? item.orderItemId : null) };
}

export async function loadDispute(db: Executor, paypalDisputeId: string): Promise<DisputeRow | null> {
  const [row] = await db.select(columns).from(disputes).where(eq(disputes.paypalDisputeId, paypalDisputeId));
  return row ?? null;
}

export async function disputesForOrder(db: Executor, orderId: string): Promise<DisputeRow[]> {
  return db.select(columns).from(disputes).where(eq(disputes.orderId, orderId)).orderBy(asc(disputes.createdAt));
}

export interface DisputeUpdate {
  paypalDisputeId: string;
  status: DisputeStatus;
  stage: string | null;
  reason: string | null;
  amountCents: number | null;
  outcome: string | null;
  refundedCents: number | null;
  sellerResponseDueAt: Date | null;
  updatedAt: Date | null;
  records: { orderId: string; orderItemId: string | null; captureId: string } | null;
  /** Whether PayPal now waits for Roomover's evidence, which the state reads as due. */
  evidenceDue: boolean;
}

/**
 * Lands one report of a dispute under a row lock, so a redelivered or older
 * report changes nothing and a resolved dispute stays resolved. A dispute
 * that waits for evidence again after a submission is due again.
 */
export async function recordDisputeUpdate(tx: Executor, update: DisputeUpdate): Promise<{ step: DisputeUpdateStep; row: DisputeRow }> {
  const [current] = await tx.select(columns).from(disputes).where(eq(disputes.paypalDisputeId, update.paypalDisputeId)).for("update");
  const step = disputeUpdateStep(current ?? null, { status: update.status, updatedAt: update.updatedAt });
  const fields = {
    status: update.status,
    stage: update.stage,
    reason: update.reason,
    amountCents: update.amountCents,
    outcome: update.outcome,
    refundedCents: update.refundedCents,
    sellerResponseDueAt: update.sellerResponseDueAt,
    paypalUpdatedAt: update.updatedAt,
  };
  if (step === "insert") {
    const [row] = await tx
      .insert(disputes)
      .values({
        paypalDisputeId: update.paypalDisputeId,
        orderId: update.records?.orderId ?? null,
        orderItemId: update.records?.orderItemId ?? null,
        disputedCaptureId: update.records?.captureId ?? null,
        evidenceState: evidenceStateOnReport(null, update),
        ...fields,
      })
      .returning(columns);
    return { step, row };
  }
  if (current === undefined || step === "stale" || step === "same") return { step, row: current as DisputeRow };
  const evidenceState = evidenceStateOnReport({ state: current.evidenceState, stage: current.evidenceStage }, update);
  const [row] = await tx
    .update(disputes)
    .set({
      ...fields,
      ...(current.orderId === null && update.records !== null ? { orderId: update.records.orderId, orderItemId: update.records.orderItemId, disputedCaptureId: update.records.captureId } : {}),
      evidenceState,
    })
    .where(eq(disputes.id, current.id))
    .returning(columns);
  return { step, row };
}

/**
 * Takes the one submission for this stage. The Disputes API takes no
 * PayPal-Request-Id, so only the caller that moves the row to sending may
 * call provide-evidence.
 */
export async function claimEvidence(db: Executor, disputeId: string, stage: string | null): Promise<boolean> {
  const claimed = await db
    .update(disputes)
    .set({ evidenceState: "sending", evidenceError: null })
    .where(
      and(
        eq(disputes.id, disputeId),
        ne(disputes.evidenceState, "sending"),
        or(ne(disputes.evidenceState, "sent"), sql`${disputes.evidenceStage} is distinct from ${stage}`),
      ),
    )
    .returning({ id: disputes.id });
  return claimed.length === 1;
}

export async function finishEvidence(db: Executor, disputeId: string, outcome: { sent: true; bundle: EvidenceBundle; stage: string | null; at: Date } | { sent: false; error: string }): Promise<void> {
  await db
    .update(disputes)
    .set(
      outcome.sent
        ? { evidenceState: "sent", evidence: outcome.bundle, evidenceStage: outcome.stage ?? "UNKNOWN", evidenceSubmittedAt: outcome.at, evidenceError: null }
        : { evidenceState: "failed", evidenceError: outcome.error },
    )
    .where(and(eq(disputes.id, disputeId), eq(disputes.evidenceState, "sending")));
}
