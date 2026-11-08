/**
 * Fixed vocabularies shared by the Postgres enums, the zod schemas, and domain
 * code. Each list already covers the states later flows reach, because adding
 * a value to a Postgres enum takes a migration.
 */

export const USER_ROLES = ["buyer", "seller", "platform"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LEAVING_REASONS = [
  "graduating",
  "lease_end",
  "transfer",
  "leave_of_absence",
  "exchange",
] as const;
export type LeavingReason = (typeof LEAVING_REASONS)[number];

/** Where a seller receives payouts. Venmo needs a handle on the user. */
export const PAYOUT_WALLETS = ["paypal", "venmo"] as const;
export type PayoutWallet = (typeof PAYOUT_WALLETS)[number];

export const ROOM_TYPES = ["single", "double", "apartment_bedroom"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** Matches the procedural furniture types in the 3D room. */
export const LISTING_CATEGORIES = [
  "bed_accessory",
  "desk",
  "chair",
  "shelf",
  "lamp",
  "rug",
  "mini_fridge",
  "storage",
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

/**
 * How an item occupies the room. The fit check measures each placement in its own way.
 * `floor` takes floor area, `underlay` lies under other items (rugs),
 * `surface` stands on furniture, `bed` goes on or under the bed, and `wall`
 * hangs on a wall or door.
 */
export const PLACEMENTS = ["floor", "underlay", "surface", "bed", "wall"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const LISTING_STATUSES = ["draft", "active", "reserved", "sold", "withdrawn"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const HANDOFF_MODES = ["direct", "storage_hold", "same_room"] as const;
export type HandoffMode = (typeof HANDOFF_MODES)[number];

export const PAYMENT_MODES = ["authorize_then_capture", "capture_at_checkout"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PLAN_STATUSES = [
  "draft",
  "planning",
  "ready",
  "checked_out",
  "completed",
  "abandoned",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const NEGOTIATION_STATUSES = [
  "open",
  "agreed",
  "declined",
  "round_limit_reached",
  "canceled",
] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];

/**
 * `capture_pending`, `capture_declined`, and `reversed` mirror the
 * PAYMENT.CAPTURE.PENDING, DECLINED, and REVERSED webhooks for orders that
 * capture at checkout.
 */
export const ORDER_STATUSES = [
  "pending_approval",
  "approved",
  "authorized",
  "capture_pending",
  "captured",
  "capture_declined",
  "settled",
  "canceled",
  "voided",
  "reversed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * `held` is an item captured at checkout and held by the platform. `captured`
 * keeps the full amount, `adjusted` keeps a reduced amount, and `released`
 * returns everything to the buyer through a void or a refund.
 */
export const ORDER_ITEM_STATUSES = [
  "pending",
  "authorized",
  "held",
  "capture_pending",
  "captured",
  "adjusted",
  "released",
  "capture_declined",
  "reversed",
] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export const HANDOFF_STATUSES = [
  "scheduled",
  "in_storage",
  "verifying",
  "verified",
  "completed",
  "canceled",
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_DECISIONS = ["accepted", "adjusted", "rejected", "missing"] as const;
export type HandoffDecision = (typeof HANDOFF_DECISIONS)[number];

/** Mirrors the PayPal payout `batch_status`, with `created` before the batch is sent. */
export const PAYOUT_STATUSES = ["created", "pending", "processing", "success", "denied", "canceled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * Covers the PayPal payout item `transaction_status` values and the
 * PAYMENT.PAYOUTS-ITEM webhook events. `succeeded` is SUCCESS and `held` is
 * ONHOLD. CANCELED arrives only as a webhook.
 */
export const PAYOUT_ITEM_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "blocked",
  "canceled",
  "held",
  "refunded",
  "returned",
  "unclaimed",
  "reversed",
] as const;
export type PayoutItemStatus = (typeof PAYOUT_ITEM_STATUSES)[number];

/** Mirrors the PayPal dispute `status`. */
export const DISPUTE_STATUSES = [
  "open",
  "waiting_for_buyer_response",
  "waiting_for_seller_response",
  "under_review",
  "resolved",
  "other",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** The platform appears in the activity panel when it runs settlement and payouts. */
export const AGENT_NAMES = ["buyer", "seller", "verifier", "platform"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
