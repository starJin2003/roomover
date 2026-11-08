import {
  isSubscribedEventType,
  type PayPalWebhookEvent,
  type PayPalWebhookEventType,
} from "@/lib/paypal/webhooks/events";

type Handler = (event: PayPalWebhookEvent) => Promise<void>;

// Each handler records the event and stops there. The database task turns
// them into state machine transitions that ignore duplicate and stale events.
function logOnly(subject: string): Handler {
  return async (event) => {
    const resourceId = typeof event.resource.id === "string" ? event.resource.id : undefined;
    console.info("paypal webhook", { subject, eventId: event.id, type: event.event_type, resourceId });
  };
}

const authorization = logOnly("authorization");
const capture = logOnly("capture");
const payoutBatch = logOnly("payout batch");
const payoutItem = logOnly("payout item");
const dispute = logOnly("dispute");

const HANDLERS: Record<PayPalWebhookEventType, Handler> = {
  "PAYMENT.AUTHORIZATION.CREATED": authorization,
  "PAYMENT.AUTHORIZATION.VOIDED": authorization,
  "PAYMENT.CAPTURE.COMPLETED": capture,
  "PAYMENT.CAPTURE.REFUNDED": capture,
  "PAYMENT.PAYOUTSBATCH.SUCCESS": payoutBatch,
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.FAILED": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.CANCELED": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.HELD": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.RETURNED": payoutItem,
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": payoutItem,
  "CUSTOMER.DISPUTE.CREATED": dispute,
  "CUSTOMER.DISPUTE.UPDATED": dispute,
};

/** Returns false for an event type Roomover does not subscribe to. The route still acknowledges it so PayPal stops redelivering. */
export async function dispatchWebhookEvent(event: PayPalWebhookEvent): Promise<boolean> {
  if (!isSubscribedEventType(event.event_type)) {
    console.info("paypal webhook ignored", { eventId: event.id, type: event.event_type });
    return false;
  }
  await HANDLERS[event.event_type](event);
  return true;
}
