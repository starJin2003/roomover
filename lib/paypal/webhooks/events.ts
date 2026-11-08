import { z } from "zod";

/** The events Roomover subscribes to. The webhook is registered with exactly this list. */
export const PAYPAL_WEBHOOK_EVENT_TYPES = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
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
  "CUSTOMER.DISPUTE.RESOLVED",
] as const;

export type PayPalWebhookEventType = (typeof PAYPAL_WEBHOOK_EVENT_TYPES)[number];

export function isSubscribedEventType(value: string): value is PayPalWebhookEventType {
  return (PAYPAL_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** The envelope shared by every event. Each handler parses its own resource. */
export const webhookEventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  create_time: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Expected a timestamp"),
  resource_type: z.string().optional(),
  resource: z.record(z.string(), z.unknown()),
});

export type PayPalWebhookEvent = z.infer<typeof webhookEventSchema>;

const resourceIdSchema = z.union([
  z.object({ id: z.string().min(1) }).transform((resource) => resource.id),
  z.object({ payout_item_id: z.string().min(1) }).transform((resource) => resource.payout_item_id),
  z.object({ batch_header: z.object({ payout_batch_id: z.string().min(1) }) }).transform(
    (resource) => resource.batch_header.payout_batch_id,
  ),
]);

/**
 * The PayPal ID of the resource an event is about. Captures, authorizations,
 * and disputes carry `id`, payout item events `payout_item_id`, and payout
 * batch events `batch_header.payout_batch_id`.
 */
export function webhookResourceId(event: PayPalWebhookEvent): string | null {
  const parsed = resourceIdSchema.safeParse(event.resource);
  return parsed.success ? parsed.data : null;
}
