import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { publish } from "@/lib/agents/bus";
import type { Database } from "@/lib/db/client";
import { applyPayoutBatchStatus, applyPayoutItemStatus, confirmItemCapture, finishRelease, orderByAuthorization } from "@/lib/db/handoffs";
import type { Transaction } from "@/lib/db/plans";
import { orders } from "@/lib/db/schema";
import { batchStatusFromPayPal, PAYOUT_ITEM_EVENT_STATUS } from "@/lib/domain/payout-state";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

/**
 * Handoff events that arrive as webhooks. Each lands through the same
 * transitions as the API answer or the batch read, so a repeat changes
 * nothing and a report older than what Roomover holds is ignored.
 */

type Db = Database | Transaction;

const payoutItemSchema = z.object({
  payout_item_id: z.string().min(1),
  payout_batch_id: z.string().min(1).optional(),
  payout_item: z.object({ sender_item_id: z.string().min(1).optional() }).optional(),
});

const payoutBatchSchema = z.object({
  batch_header: z.object({
    payout_batch_id: z.string().min(1),
    batch_status: z.string().optional(),
    sender_batch_header: z.object({ sender_batch_id: z.string().min(1).optional() }).optional(),
  }),
});

const resourceIdSchema = z.object({ id: z.string().min(1) });

export async function onPayoutItemEvent(event: PayPalWebhookEvent, db: Db): Promise<void> {
  const resource = payoutItemSchema.safeParse(event.resource);
  const next = PAYOUT_ITEM_EVENT_STATUS[event.event_type as keyof typeof PAYOUT_ITEM_EVENT_STATUS];
  if (!resource.success || next === undefined) {
    console.warn("paypal webhook payout item without an ID", { eventId: event.id, type: event.event_type });
    return;
  }
  const change = await applyPayoutItemStatus(db, { paypalPayoutItemId: resource.data.payout_item_id, senderItemId: resource.data.payout_item?.sender_item_id }, next, new Date(event.create_time));
  console.info("paypal webhook payout item", { eventId: event.id, type: event.event_type, step: change?.step ?? "unknown_item" });
  if (change?.step === "apply") publish(change.planId, { type: "handoff" });
}

export async function onPayoutBatchEvent(event: PayPalWebhookEvent, db: Db): Promise<void> {
  const resource = payoutBatchSchema.safeParse(event.resource);
  if (!resource.success) {
    console.warn("paypal webhook payout batch without an ID", { eventId: event.id, type: event.event_type });
    return;
  }
  const header = resource.data.batch_header;
  const next = event.event_type === "PAYMENT.PAYOUTSBATCH.DENIED" ? "denied" : batchStatusFromPayPal(header.batch_status ?? "SUCCESS");
  const change = await applyPayoutBatchStatus(db, { paypalBatchId: header.payout_batch_id, senderBatchId: header.sender_batch_header?.sender_batch_id }, next);
  console.info("paypal webhook payout batch", { eventId: event.id, type: event.event_type, step: change?.step ?? "unknown_batch" });
  if (change?.step === "apply") publish(change.planId, { type: "handoff" });
}

/** An item capture PayPal first reported pending completes here. Checkout captures land through checkout's own handler. */
export async function onItemCaptureCompleted(event: PayPalWebhookEvent, db: Db): Promise<void> {
  const resource = resourceIdSchema.safeParse(event.resource);
  if (!resource.success) return;
  const planId = await confirmItemCapture(db, resource.data.id);
  console.info("paypal webhook item capture", { eventId: event.id, landed: planId !== null });
  if (planId !== null) publish(planId, { type: "handoff" });
}

/**
 * PayPal voids an authorization on its own when the validity period ends.
 * An order still waiting for its handoff is then released. Voids Roomover
 * sent itself find the order already settling, settled, or released.
 */
export async function onAuthorizationVoided(event: PayPalWebhookEvent, db: Db): Promise<void> {
  const resource = resourceIdSchema.safeParse(event.resource);
  if (!resource.success) return;
  const order = await orderByAuthorization(db, resource.data.id);
  if (order === null || order.status !== "authorized") {
    console.info("paypal webhook authorization voided", { eventId: event.id, orderStatus: order?.status ?? "unknown_order" });
    return;
  }
  await db.update(orders).set({ status: "releasing" }).where(and(eq(orders.id, order.id), eq(orders.status, "authorized")));
  await finishRelease(db, order.id, { at: new Date(event.create_time), planStatus: "ready" });
  console.info("paypal webhook authorization voided by PayPal", { eventId: event.id, orderId: order.id });
  publish(order.planId, { type: "handoff" });
}
