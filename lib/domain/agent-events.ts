import { z } from "zod";
import { MCP_TOOL_NAMES } from "./mcp";

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
  /** The listings a search returned, best match first, so the log shows what the agent saw. */
  listingIds: z.array(z.uuid()).max(24).optional(),
  /** What the PayPal ID on the line names. */
  paypalIdKind: z.enum(PAYPAL_ID_KINDS).optional(),
  orderItemId: z.uuid().optional(),
  /** Claude calls a verifier step spent, counted against the daily allowance. Replayed comparisons spend none. */
  claudeCalls: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  /** How long the step waited on Claude or Channel3. */
  latencyMs: z.number().int().nonnegative().optional(),
  /** One offer, counter, or answer between the buyer agent and a seller agent. */
  negotiation: z
    .strictObject({
      round: z.number().int().positive(),
      from: z.enum(["buyer", "seller"]),
      action: z.enum(["offer", "counter", "accept", "decline"]),
      priceCents: z.number().int().positive().optional(),
      slot: z.string().min(1).optional(),
      message: z.string().min(1).max(400).optional(),
      heldByCode: z.string().min(1).optional(),
    })
    .optional(),
  /** A Channel3 search: what was asked, what it cost, and what came back. */
  channel3: z
    .strictObject({
      query: z.string().min(1).max(400),
      filters: z.string().min(1).max(200),
      credits: z.number().int().nonnegative(),
      cached: z.boolean(),
      productCount: z.number().int().nonnegative(),
      products: z.array(z.strictObject({ title: z.string().min(1), priceCents: z.number().int().positive(), retailer: z.string().min(1) })).max(24),
      /** The cache keys of the searches, which name their answers in a recording. */
      keys: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(24).optional(),
    })
    .optional(),
  /** A step an outside assistant asked for over MCP, with the client's own name for itself. */
  mcp: z.strictObject({ tool: z.enum(MCP_TOOL_NAMES), client: z.string().min(1).max(80) }).optional(),
  /** A new item placed from Channel3, which the student buys from the retailer. */
  newProduct: z.strictObject({ productId: z.string().min(1), retailer: z.string().min(1), buyUrl: z.url() }).optional(),
});

export type AgentEventDetail = z.infer<typeof agentEventDetailSchema>;
