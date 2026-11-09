import { z } from "zod";

export const PAYPAL_ID_KINDS = ["order", "authorization", "capture", "refund", "reauthorization", "payout_batch", "payout_item"] as const;
export type PayPalIdKind = (typeof PAYPAL_ID_KINDS)[number];

/**
 * Structured facts behind an activity line, kept for the full log and the
 * Under the hood view. Each field applies only to some tools.
 */
export const agentEventDetailSchema = z.strictObject({
  listingId: z.uuid().optional(),
  itemKey: z.string().min(1).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  /** What the plan costs after this step. */
  totalCents: z.number().int().nonnegative().optional(),
  /** The agent's own words from the tool call, such as why it chose an item. */
  note: z.string().max(400).optional(),
  problems: z.array(z.string().min(1)).max(12).optional(),
  /** How many results a search returned. */
  count: z.number().int().nonnegative().optional(),
  /** What the PayPal ID on the line names. */
  paypalIdKind: z.enum(PAYPAL_ID_KINDS).optional(),
  orderItemId: z.uuid().optional(),
  /** Claude calls a verifier step spent, counted against the daily allowance. Replayed comparisons spend none. */
  claudeCalls: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

export type AgentEventDetail = z.infer<typeof agentEventDetailSchema>;
