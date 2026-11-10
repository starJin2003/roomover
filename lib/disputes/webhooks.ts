import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/client";
import type { Transaction } from "@/lib/db/plans";
import { paypalDisputeSchema } from "@/lib/paypal/rest/disputes";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";
import { disputeReads, liveDisputeDeps } from "./deps";
import { disputeReport, reportIsComplete } from "./report";
import { landDisputeReport, readDispute, runDisputeAgent } from "./run";

/**
 * CUSTOMER.DISPUTE.CREATED, UPDATED, and RESOLVED. The event lands inside
 * the transaction that stored it, through the same ordered update as a
 * read, so a redelivered or older event changes nothing. An event that
 * lacks the status, reason, or disputed transaction is completed with a
 * toolkit read first.
 */
export async function onDisputeEvent(event: PayPalWebhookEvent, db: Database | Transaction): Promise<void> {
  const resource = paypalDisputeSchema.safeParse(event.resource);
  if (!resource.success) {
    console.warn("paypal webhook dispute without a dispute ID", { eventId: event.id, type: event.event_type });
    return;
  }
  const runId = randomUUID();
  const report = reportIsComplete(resource.data) ? disputeReport(resource.data) : await readDispute(db, disputeReads(), { runId, planId: null, orderId: null }, resource.data.dispute_id);
  const landed = await landDisputeReport(db, report, runId);
  console.info("paypal webhook dispute", { eventId: event.id, type: event.event_type, step: landed.step, ours: landed.row.orderId !== null });
}

/** After the event commits, the verifier agent reads the dispute and sends evidence when PayPal waits for it. */
export async function afterDisputeEvent(event: PayPalWebhookEvent): Promise<void> {
  const resource = paypalDisputeSchema.safeParse(event.resource);
  if (!resource.success) return;
  try {
    const outcome = await runDisputeAgent(liveDisputeDeps(), resource.data.dispute_id);
    console.info("dispute run", { disputeId: resource.data.dispute_id, outcome: outcome.kind });
  } catch (error) {
    console.error("dispute run failed", { disputeId: resource.data.dispute_id, error: error instanceof Error ? error.name : "unknown" });
  }
}
