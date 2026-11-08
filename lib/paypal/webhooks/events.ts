import { z } from "zod";

/** The events Roomover subscribes to. The webhook is registered with exactly this list. */
export const PAYPAL_WEBHOOK_EVENT_TYPES = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
] as const;

export type PayPalWebhookEventType = (typeof PAYPAL_WEBHOOK_EVENT_TYPES)[number];

export function isSubscribedEventType(value: string): value is PayPalWebhookEventType {
  return (PAYPAL_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** The envelope shared by every event. Each handler parses its own resource. */
export const webhookEventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  create_time: z.string().min(1),
  resource_type: z.string().optional(),
  resource: z.record(z.string(), z.unknown()),
});

export type PayPalWebhookEvent = z.infer<typeof webhookEventSchema>;
