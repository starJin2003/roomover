import { z } from "zod";
import { publish } from "@/lib/agents/bus";
import type { Database } from "@/lib/db/client";
import { ListingTaken, recordApproval, type ApprovalRecord } from "@/lib/db/orders";
import type { Transaction } from "@/lib/db/plans";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks/events";

/**
 * Checkout results that arrive as webhooks. They land through the same
 * recordApproval as the API answer, so whichever arrives second changes
 * nothing. An event for an order Roomover does not know, or one a later
 * task settles, is acknowledged and logged.
 */

const relatedIds = z.object({ related_ids: z.object({ order_id: z.string().min(1).optional(), authorization_id: z.string().min(1).optional() }).optional() }).optional();

const authorizationSchema = z.object({ id: z.string().min(1), expiration_time: z.string().optional(), supplementary_data: relatedIds });
const captureSchema = z.object({ id: z.string().min(1), status: z.string().optional(), supplementary_data: relatedIds });

async function land(event: PayPalWebhookEvent, record: ApprovalRecord, db: Database | Transaction): Promise<void> {
  try {
    const result = await recordApproval(db, record);
    if (result === null) {
      console.info("paypal webhook for an unknown order", { eventId: event.id, type: event.event_type });
      return;
    }
    for (const view of result.events) publish(result.order.planId, { type: "event", event: view });
    console.info("paypal webhook checkout", { eventId: event.id, type: event.event_type, orderId: result.order.id, step: result.step });
  } catch (error) {
    // The approval call holds the money and gives it back when an item sold elsewhere, so the webhook only notes it.
    if (!(error instanceof ListingTaken)) throw error;
    console.warn("paypal webhook found a listing taken", { eventId: event.id, listingIds: error.listingIds });
  }
}

export async function onAuthorizationCreated(event: PayPalWebhookEvent, db: Database | Transaction): Promise<void> {
  const resource = authorizationSchema.safeParse(event.resource);
  const orderId = resource.success ? resource.data.supplementary_data?.related_ids?.order_id : undefined;
  if (!resource.success || orderId === undefined) {
    console.warn("paypal webhook authorization without an order", { eventId: event.id });
    return;
  }
  const expires = resource.data.expiration_time === undefined ? undefined : new Date(resource.data.expiration_time);
  await land(event, { paypalOrderId: orderId, status: "authorized", authorizationId: resource.data.id, authorizationExpiresAt: expires, source: "webhook", at: new Date(event.create_time) }, db);
}

export async function onCaptureCompleted(event: PayPalWebhookEvent, db: Database | Transaction): Promise<void> {
  const resource = captureSchema.safeParse(event.resource);
  const related = resource.success ? resource.data.supplementary_data?.related_ids : undefined;
  if (!resource.success || related?.order_id === undefined) {
    console.warn("paypal webhook capture without an order", { eventId: event.id });
    return;
  }
  if (related.authorization_id !== undefined) {
    console.info("paypal webhook capture of an authorization, settled at handoff", { eventId: event.id });
    return;
  }
  await land(event, { paypalOrderId: related.order_id, status: "captured", captureId: resource.data.id, source: "webhook", at: new Date(event.create_time) }, db);
}
