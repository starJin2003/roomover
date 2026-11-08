import { z } from "zod";
import type { PayPalRestClient } from "@/lib/paypal/rest/client";
import { payoutMoney } from "@/lib/paypal/wire-money";

export interface PayoutItemInput {
  /** Roomover ID for this line, echoed back on the item and in webhooks. At most 63 characters. */
  readonly senderItemId: string;
  readonly amountCents: number;
  /** PAYPAL_ID is the payer ID from Log in with PayPal. USER_HANDLE is a Venmo handle. The sandbox rejects PHONE. */
  readonly recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE";
  readonly receiver: string;
  /** Venmo payouts are US and USD only. */
  readonly wallet: "PAYPAL" | "VENMO";
  /** Required by PayPal for Venmo items. */
  readonly note?: string;
}

const MAX_ITEMS = 15_000;
const MAX_SENDER_ITEM_ID = 63;

function assertItems(items: readonly PayoutItemInput[]): void {
  if (items.length === 0 || items.length > MAX_ITEMS) {
    throw new RangeError(`A payout batch needs 1 to ${MAX_ITEMS} items.`);
  }
  for (const item of items) {
    if (item.senderItemId.length === 0 || item.senderItemId.length > MAX_SENDER_ITEM_ID) {
      throw new RangeError(`sender_item_id must be 1 to ${MAX_SENDER_ITEM_ID} characters.`);
    }
    if (item.wallet === "VENMO" && (item.note === undefined || item.note.trim() === "")) {
      throw new RangeError(`Venmo payout ${item.senderItemId} needs a note.`);
    }
  }
}

export interface PayoutBatchInput {
  readonly emailSubject: string;
  readonly emailMessage?: string;
  readonly items: readonly PayoutItemInput[];
}

const linkSchema = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });
const amountSchema = z.object({ currency: z.string(), value: z.string() });

const batchHeaderSchema = z.object({
  payout_batch_id: z.string(),
  batch_status: z.string(),
  sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).optional(),
  amount: amountSchema.optional(),
  fees: amountSchema.optional(),
  time_created: z.string().optional(),
  time_completed: z.string().optional(),
});

const createdBatchSchema = z.object({
  batch_header: batchHeaderSchema,
  links: z.array(linkSchema).optional(),
});

const payoutItemSchema = z.object({
  payout_item_id: z.string(),
  transaction_id: z.string().optional(),
  transaction_status: z.string().optional(),
  payout_item: z.object({
    sender_item_id: z.string().optional(),
    amount: amountSchema,
    recipient_wallet: z.string().optional(),
  }),
  errors: z.object({ name: z.string().optional(), message: z.string().optional() }).optional(),
});

const batchSchema = z.object({
  batch_header: batchHeaderSchema,
  items: z.array(payoutItemSchema).default([]),
});

export type CreatedPayoutBatch = z.infer<typeof createdBatchSchema>;
export type PayoutBatch = z.infer<typeof batchSchema>;

/**
 * Pays sellers in one batch. The idempotency key is both the PayPal-Request-Id
 * and the sender_batch_id. PayPal keeps both for 30 days and pays a
 * sender_batch_id at most once, so a retried settlement cannot pay twice.
 */
export function createPayoutBatch(
  rest: PayPalRestClient,
  input: PayoutBatchInput,
  idempotencyKey: string,
): Promise<CreatedPayoutBatch> {
  assertItems(input.items);
  return rest.request({
    method: "POST",
    path: "/v1/payments/payouts",
    requestId: idempotencyKey,
    body: {
      kind: "json",
      value: {
        sender_batch_header: {
          sender_batch_id: idempotencyKey,
          email_subject: input.emailSubject,
          email_message: input.emailMessage,
        },
        items: input.items.map((item) => ({
          recipient_type: item.recipientType,
          receiver: item.receiver,
          amount: payoutMoney(item.amountCents),
          recipient_wallet: item.wallet,
          sender_item_id: item.senderItemId,
          note: item.note,
        })),
      },
    },
    schema: createdBatchSchema,
  });
}

export function getPayoutBatch(rest: PayPalRestClient, payoutBatchId: string): Promise<PayoutBatch> {
  return rest.request({
    method: "GET",
    path: `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`,
    query: { page_size: 1000, total_required: true },
    schema: batchSchema,
  });
}
