import { onAuthorizationCreated, onCaptureCompleted } from "@/lib/checkout/webhooks";
import { afterDisputeEvent, onDisputeEvent } from "@/lib/disputes/webhooks";
import { onAuthorizationVoided, onPayoutBatchEvent, onPayoutItemEvent } from "@/lib/handoff/webhooks";
import type { Database } from "@/lib/db/client";
import type { Transaction } from "@/lib/db/plans";
import {
  isSubscribedEventType,
  webhookResourceId,
  type PayPalWebhookEvent,
  type PayPalWebhookEventType,
} from "@/lib/paypal/webhooks/events";

/** Runs inside the transaction that stored the event, so the state change and the event row commit together. */
type Handler = (event: PayPalWebhookEvent, db: Database | Transaction) => Promise<void>;

// The route has already stored the event and skipped duplicates. Checkout,
// handoff, payout, and dispute events move records through transitions that
// ignore stale events, and the rest are logged.
function logOnly(subject: string): Handler {
  return async (event) => {
    console.info("paypal webhook", {
      subject,
      eventId: event.id,
      type: event.event_type,
      resourceId: webhookResourceId(event) ?? undefined,
    });
  };
}

const capture = logOnly("capture");

const HANDLERS: Record<PayPalWebhookEventType, Handler> = {
  "PAYMENT.AUTHORIZATION.CREATED": onAuthorizationCreated,
  "PAYMENT.AUTHORIZATION.VOIDED": onAuthorizationVoided,
  "PAYMENT.CAPTURE.COMPLETED": onCaptureCompleted,
  "PAYMENT.CAPTURE.PENDING": capture,
  "PAYMENT.CAPTURE.DECLINED": capture,
  "PAYMENT.CAPTURE.REFUNDED": capture,
  "PAYMENT.CAPTURE.REVERSED": capture,
  "PAYMENT.PAYOUTSBATCH.SUCCESS": onPayoutBatchEvent,
  "PAYMENT.PAYOUTSBATCH.DENIED": onPayoutBatchEvent,
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.FAILED": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.CANCELED": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.HELD": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.RETURNED": onPayoutItemEvent,
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": onPayoutItemEvent,
  "CUSTOMER.DISPUTE.CREATED": onDisputeEvent,
  "CUSTOMER.DISPUTE.UPDATED": onDisputeEvent,
  "CUSTOMER.DISPUTE.RESOLVED": onDisputeEvent,
};

/** Work that waits until the event's transaction commits. A dispute event starts the verifier agent's dispute run. */
export function followUpWebhookEvent(event: PayPalWebhookEvent): Promise<void> | null {
  return event.event_type.startsWith("CUSTOMER.DISPUTE.") ? afterDisputeEvent(event) : null;
}

/** Returns false for an event type Roomover does not subscribe to. The route still acknowledges it so PayPal stops redelivering. */
export async function dispatchWebhookEvent(event: PayPalWebhookEvent, db: Database | Transaction): Promise<boolean> {
  if (!isSubscribedEventType(event.event_type)) {
    console.info("paypal webhook ignored", { eventId: event.id, type: event.event_type });
    return false;
  }
  await HANDLERS[event.event_type](event, db);
  return true;
}
