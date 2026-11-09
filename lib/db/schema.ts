import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { EvidenceBundle } from "../domain/dispute";
import type { AgentEventDetail } from "../domain/agent-events";
import {
  AGENT_NAMES,
  AGENT_RUN_KINDS,
  AGENT_RUN_STATUSES,
  CLAUDE_MODES,
  DISPUTE_STATUSES,
  HANDOFF_DECISIONS,
  HANDOFF_MODES,
  HANDOFF_STATUSES,
  LEAVING_REASONS,
  LISTING_CATEGORIES,
  LISTING_DRAFT_STATUSES,
  LISTING_STATUSES,
  NEGOTIATION_STATUSES,
  ORDER_ITEM_STATUSES,
  ORDER_STATUSES,
  PAYMENT_MODES,
  PAYOUT_ITEM_STATUSES,
  PAYOUT_RECIPIENT_TYPES,
  PAYOUT_STATUSES,
  PAYOUT_WALLETS,
  PLACEMENTS,
  PLAN_STATUSES,
  ROOM_TYPES,
  USER_ROLES,
} from "../domain/enums";
import type { HandoffPhoto } from "../domain/handoff";
import type { HallConstraint } from "../domain/hall-rules";
import type { ConditionReport, ListingColor, ListingPhoto, ListingSpecs, RetailReference } from "../domain/listing";
import type { OffersLog } from "../domain/negotiation";
import { EMPTY_LAYOUT, type PlanLayout } from "../domain/layout";
import type { RoomGeometry } from "../domain/room";
import type { Channel3Candidate, Channel3Lookup, DraftDetails } from "../domain/sell";
import type { VerificationReport } from "../domain/verdict";

// drizzle-kit does not read tsconfig paths, so this file uses relative imports.

export const userRole = pgEnum("user_role", USER_ROLES);
export const leavingReason = pgEnum("leaving_reason", LEAVING_REASONS);
export const payoutWallet = pgEnum("payout_wallet", PAYOUT_WALLETS);
export const roomType = pgEnum("room_type", ROOM_TYPES);
export const listingCategory = pgEnum("listing_category", LISTING_CATEGORIES);
export const placement = pgEnum("placement", PLACEMENTS);
export const listingStatus = pgEnum("listing_status", LISTING_STATUSES);
export const handoffMode = pgEnum("handoff_mode", HANDOFF_MODES);
export const paymentMode = pgEnum("payment_mode", PAYMENT_MODES);
export const planStatus = pgEnum("plan_status", PLAN_STATUSES);
export const negotiationStatus = pgEnum("negotiation_status", NEGOTIATION_STATUSES);
export const orderStatus = pgEnum("order_status", ORDER_STATUSES);
export const orderItemStatus = pgEnum("order_item_status", ORDER_ITEM_STATUSES);
export const handoffStatus = pgEnum("handoff_status", HANDOFF_STATUSES);
export const handoffDecision = pgEnum("handoff_decision", HANDOFF_DECISIONS);
export const payoutStatus = pgEnum("payout_status", PAYOUT_STATUSES);
export const payoutItemStatus = pgEnum("payout_item_status", PAYOUT_ITEM_STATUSES);
export const disputeStatus = pgEnum("dispute_status", DISPUTE_STATUSES);
export const agentName = pgEnum("agent_name", AGENT_NAMES);
export const agentRunKind = pgEnum("agent_run_kind", AGENT_RUN_KINDS);
export const agentRunStatus = pgEnum("agent_run_status", AGENT_RUN_STATUSES);
export const claudeMode = pgEnum("claude_mode", CLAUDE_MODES);
export const listingDraftStatus = pgEnum("listing_draft_status", LISTING_DRAFT_STATUSES);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const at = (name: string) => timestamp(name, { withTimezone: true });

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Counts PayPal attempts on a record. It feeds the PayPal-Request-Id key. */
const attempt = () => integer("attempt").notNull().default(1);

export const halls = pgTable(
  "halls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campus: text("campus").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("halls_campus_slug_key").on(t.campus, t.slug)],
);

export const roomPresets = pgTable(
  "room_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hallId: uuid("hall_id")
      .notNull()
      .references(() => halls.id),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    roomType: roomType("room_type").notNull(),
    occupancy: integer("occupancy").notNull(),
    widthMm: integer("width_mm").notNull(),
    depthMm: integer("depth_mm").notNull(),
    ceilingHeightMm: integer("ceiling_height_mm").notNull(),
    geometry: jsonb("geometry").$type<RoomGeometry>().notNull(),
    /** Names the values that are estimates, for example `ceilingHeightMm` or `windows`. */
    estimatedFields: text("estimated_fields").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("room_presets_hall_idx").on(t.hallId),
    check("room_presets_occupancy_check", sql`${t.occupancy} between 1 and 4`),
    check(
      "room_presets_dimensions_check",
      sql`${t.widthMm} > 0 and ${t.depthMm} > 0 and ${t.ceilingHeightMm} > 0`,
    ),
  ],
);

export const hallRules = pgTable("hall_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  hallId: uuid("hall_id")
    .notNull()
    .unique()
    .references(() => halls.id),
  title: text("title").notNull(),
  ruleText: text("rule_text").notNull(),
  constraints: jsonb("constraints").$type<HallConstraint[]>().notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: userRole("role").notNull(),
    displayName: text("display_name").notNull(),
    campus: text("campus"),
    classYear: integer("class_year"),
    leavingReason: leavingReason("leaving_reason"),
    bio: text("bio"),
    /** Payer ID from Log in with PayPal. */
    paypalAccountId: text("paypal_account_id").unique(),
    /** Receiver for EMAIL payouts. Sandbox accounts in the demo. */
    paypalEmail: text("paypal_email").unique(),
    payoutWallet: payoutWallet("payout_wallet").notNull().default("paypal"),
    venmoHandle: text("venmo_handle"),
    /** The room a seller lives in now, or the room a buyer moves into next. */
    roomPresetId: uuid("room_preset_id").references(() => roomPresets.id),
    roomNumber: text("room_number"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("users_campus_role_idx").on(t.campus, t.role),
    check("users_campus_check", sql`${t.role} = 'platform' or ${t.campus} is not null`),
    check("users_venmo_handle_check", sql`${t.payoutWallet} <> 'venmo' or ${t.venmoHandle} is not null`),
    check("users_room_check", sql`${t.roomNumber} is null or ${t.roomPresetId} is not null`),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    campus: text("campus").notNull(),
    category: listingCategory("category").notNull(),
    placement: placement("placement").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    color: text("color").notNull(),
    /** Swatches read from the photo, which the 3D room paints the item with. */
    colors: jsonb("colors").$type<ListingColor[]>().notNull().default([]),
    material: text("material").notNull(),
    styleTags: text("style_tags").array().notNull().default(sql`'{}'::text[]`),
    widthMm: integer("width_mm").notNull(),
    depthMm: integer("depth_mm").notNull(),
    heightMm: integer("height_mm").notNull(),
    specs: jsonb("specs").$type<ListingSpecs>().notNull().default({}),
    photos: jsonb("photos").$type<ListingPhoto[]>().notNull(),
    conditionReport: jsonb("condition_report").$type<ConditionReport>().notNull(),
    retailReference: jsonb("retail_reference").$type<RetailReference>().notNull(),
    priceCents: integer("price_cents").notNull(),
    floorPriceCents: integer("floor_price_cents").notNull(),
    moveOutStartsAt: at("move_out_starts_at").notNull(),
    moveOutEndsAt: at("move_out_ends_at").notNull(),
    /** Arrival window of the incoming students this listing is offered to. */
    moveInStartsAt: at("move_in_starts_at").notNull(),
    moveInEndsAt: at("move_in_ends_at").notNull(),
    handoffMode: handoffMode("handoff_mode").notNull(),
    /** The room the item stays in. Required for same room handoffs. */
    roomPresetId: uuid("room_preset_id").references(() => roomPresets.id),
    roomNumber: text("room_number"),
    status: listingStatus("status").notNull().default("draft"),
    /** The demo session that listed it on Sell. Seed listings have none, and the cleanup removes the rest after a day. */
    sessionId: text("session_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listings_seller_idx").on(t.sellerId),
    index("listings_session_created_idx").on(t.sessionId, t.createdAt),
    index("listings_campus_status_category_price_idx").on(t.campus, t.status, t.category, t.priceCents),
    index("listings_campus_status_price_idx").on(t.campus, t.status, t.priceCents),
    index("listings_campus_status_move_out_idx").on(t.campus, t.status, t.moveOutStartsAt, t.moveOutEndsAt),
    check("listings_dimensions_check", sql`${t.widthMm} > 0 and ${t.depthMm} > 0 and ${t.heightMm} > 0`),
    check(
      "listings_price_check",
      sql`${t.priceCents} > 0 and ${t.floorPriceCents} >= 0 and ${t.floorPriceCents} <= ${t.priceCents}`,
    ),
    check(
      "listings_windows_check",
      sql`${t.moveOutEndsAt} > ${t.moveOutStartsAt} and ${t.moveInEndsAt} > ${t.moveInStartsAt}`,
    ),
    check(
      "listings_same_room_check",
      sql`${t.handoffMode} <> 'same_room' or (${t.roomPresetId} is not null and ${t.roomNumber} is not null)`,
    ),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id),
    roomPresetId: uuid("room_preset_id")
      .notNull()
      .references(() => roomPresets.id),
    roomNumber: text("room_number"),
    /** The signed demo session that created the plan. Each judge's browser sees only its own plans. */
    sessionId: text("session_id"),
    budgetCents: integer("budget_cents").notNull(),
    stylePrompt: text("style_prompt").notNull(),
    layout: jsonb("layout").$type<PlanLayout>().notNull().default(EMPTY_LAYOUT),
    moveInStartsAt: at("move_in_starts_at"),
    moveInEndsAt: at("move_in_ends_at"),
    status: planStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("plans_buyer_created_idx").on(t.buyerId, t.createdAt),
    index("plans_session_created_idx").on(t.sessionId, t.createdAt),
    check("plans_budget_check", sql`${t.budgetCents} > 0`),
    check(
      "plans_move_in_check",
      sql`(${t.moveInStartsAt} is null) = (${t.moveInEndsAt} is null) and (${t.moveInStartsAt} is null or ${t.moveInEndsAt} > ${t.moveInStartsAt})`,
    ),
  ],
);

export const negotiations = pgTable(
  "negotiations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    status: negotiationStatus("status").notNull().default("open"),
    offers: jsonb("offers").$type<OffersLog>().notNull().default([]),
    agreedPriceCents: integer("agreed_price_cents"),
    agreedSlotStartsAt: at("agreed_slot_starts_at"),
    agreedSlotEndsAt: at("agreed_slot_ends_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("negotiations_plan_listing_key").on(t.planId, t.listingId),
    index("negotiations_listing_idx").on(t.listingId),
    check(
      "negotiations_agreement_check",
      sql`${t.status} <> 'agreed' or coalesce(${t.agreedPriceCents} > 0 and ${t.agreedSlotEndsAt} > ${t.agreedSlotStartsAt}, false)`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id),
    paymentMode: paymentMode("payment_mode").notNull(),
    status: orderStatus("status").notNull().default("pending_approval"),
    totalCents: integer("total_cents").notNull(),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalAuthorizationId: text("paypal_authorization_id").unique(),
    authorizationExpiresAt: at("authorization_expires_at"),
    /** Set once. Roomover reauthorizes an authorization at most one time. */
    reauthorizedAt: at("reauthorized_at"),
    /** The authorization a reauthorization returned. Later captures run against it. */
    paypalReauthorizationId: text("paypal_reauthorization_id").unique(),
    /** The single capture of an order that captures at checkout. */
    paypalCaptureId: text("paypal_capture_id").unique(),
    approvedAt: at("approved_at"),
    /** Set when the remaining authorization was voided, by settlement or by a release. */
    voidedAt: at("voided_at"),
    settledAt: at("settled_at"),
    releasedAt: at("released_at"),
    /** What the student sees when settlement stopped partway, until a retry finishes it. */
    settlementError: text("settlement_error"),
    attempt: attempt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_buyer_created_idx").on(t.buyerId, t.createdAt),
    index("orders_plan_idx").on(t.planId),
    index("orders_status_idx").on(t.status),
    check("orders_total_check", sql`${t.totalCents} > 0`),
    check("orders_attempt_check", sql`${t.attempt} >= 1`),
    check(
      "orders_reauthorization_check",
      sql`${t.reauthorizedAt} is null or (${t.paymentMode} = 'authorize_then_capture' and ${t.paypalAuthorizationId} is not null)`,
    ),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    senderBatchId: text("sender_batch_id").notNull().unique(),
    paypalBatchId: text("paypal_batch_id").unique(),
    status: payoutStatus("status").notNull().default("created"),
    totalCents: integer("total_cents").notNull(),
    attempt: attempt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payouts_order_idx").on(t.orderId),
    check("payouts_total_check", sql`${t.totalCents} > 0`),
    check("payouts_attempt_check", sql`${t.attempt} >= 1`),
  ],
);

/** One payout item per seller in a batch. PAYMENT.PAYOUTS-ITEM webhooks update these rows. */
export const payoutItems = pgTable(
  "payout_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payoutId: uuid("payout_id")
      .notNull()
      .references(() => payouts.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    wallet: payoutWallet("wallet").notNull(),
    /** How PayPal reads the receiver: a payer ID from Log in with PayPal, an email, or a Venmo handle. */
    recipientType: text("recipient_type", { enum: PAYOUT_RECIPIENT_TYPES }).notNull().default("EMAIL"),
    /** Payer ID, email, or Venmo handle at send time, kept so later profile edits do not rewrite history. */
    receiver: text("receiver").notNull(),
    senderItemId: text("sender_item_id").notNull().unique(),
    paypalPayoutItemId: text("paypal_payout_item_id").unique(),
    status: payoutItemStatus("status").notNull().default("pending"),
    /** When the status last changed, which orders the sellers paid rows as they fill. */
    statusChangedAt: at("status_changed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("payout_items_payout_seller_key").on(t.payoutId, t.sellerId),
    index("payout_items_seller_idx").on(t.sellerId),
    check("payout_items_amount_check", sql`${t.amountCents} > 0`),
    check("payout_items_recipient_type_check", sql`${t.recipientType} in ('PAYPAL_ID', 'EMAIL', 'USER_HANDLE')`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    capturedAmountCents: integer("captured_amount_cents").notNull().default(0),
    refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
    status: orderItemStatus("status").notNull().default("pending"),
    paypalCaptureId: text("paypal_capture_id"),
    paypalRefundId: text("paypal_refund_id").unique(),
    payoutItemId: uuid("payout_item_id").references(() => payoutItems.id),
    /** The handoff slot the buyer and seller agents agreed on. Null keeps the listing's whole handoff window. */
    slotStartsAt: at("slot_starts_at"),
    slotEndsAt: at("slot_ends_at"),
    attempt: attempt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("order_items_order_listing_key").on(t.orderId, t.listingId),
    check("order_items_slot_check", sql`(${t.slotStartsAt} is null) = (${t.slotEndsAt} is null) and (${t.slotStartsAt} is null or ${t.slotEndsAt} > ${t.slotStartsAt})`),
    index("order_items_listing_idx").on(t.listingId),
    index("order_items_seller_idx").on(t.sellerId),
    index("order_items_payout_item_idx").on(t.payoutItemId),
    check(
      "order_items_amounts_check",
      sql`${t.amountCents} > 0 and ${t.refundedAmountCents} >= 0 and ${t.refundedAmountCents} <= ${t.capturedAmountCents} and ${t.capturedAmountCents} <= ${t.amountCents}`,
    ),
    check("order_items_attempt_check", sql`${t.attempt} >= 1`),
  ],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .unique()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    mode: handoffMode("mode").notNull(),
    status: handoffStatus("status").notNull().default("scheduled"),
    slotStartsAt: at("slot_starts_at").notNull(),
    slotEndsAt: at("slot_ends_at").notNull(),
    location: text("location").notNull(),
    photos: jsonb("photos").$type<HandoffPhoto[]>().notNull().default([]),
    verificationReport: jsonb("verification_report").$type<VerificationReport>(),
    /** Why the last comparison produced no verdict, shown until the next one. */
    verifierError: text("verifier_error"),
    decision: handoffDecision("decision"),
    /** What the student agreed to pay for the item, set with the decision. */
    payCents: integer("pay_cents"),
    decidedAt: at("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("handoffs_slot_idx").on(t.slotStartsAt),
    check("handoffs_slot_check", sql`${t.slotEndsAt} > ${t.slotStartsAt}`),
    check("handoffs_decision_check", sql`(${t.decision} is null) = (${t.decidedAt} is null)`),
    check("handoffs_pay_check", sql`(${t.decision} is null) = (${t.payCents} is null) and (${t.payCents} is null or ${t.payCents} >= 0)`),
  ],
);

/**
 * Photos students upload at handoff. Each belongs to one handoff and one
 * demo session, and only that session can read it back. Sample photos stay
 * files under the public folder and get no row.
 */
export const handoffPhotos = pgTable(
  "handoff_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handoffId: uuid("handoff_id")
      .notNull()
      .references(() => handoffs.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("handoff_photos_handoff_idx").on(t.handoffId),
    check("handoff_photos_type_check", sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check("handoff_photos_size_check", sql`${t.byteSize} > 0 and ${t.byteSize} <= 5242880`),
  ],
);

/**
 * Photos sellers take on Sell. Listing photos are public, like the seed
 * photos, so any session can read them once they are listed.
 */
export const listingPhotos = pgTable(
  "listing_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    widthPx: integer("width_px").notNull(),
    heightPx: integer("height_px").notNull(),
    sha256: text("sha256").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("listing_photos_seller_created_idx").on(t.sellerId, t.createdAt),
    check("listing_photos_type_check", sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check("listing_photos_size_check", sql`${t.byteSize} > 0 and ${t.byteSize} <= 5242880 and ${t.widthPx} > 0 and ${t.heightPx} > 0`),
  ],
);

/**
 * One photo on its way to a listing. Channel3 matches it first, then the
 * seller agent fills in the details and the price, and the seller lists it.
 * The draft keeps what each step returned, so a reload shows the same panel
 * and Under the hood.
 */
export const listingDrafts = pgTable(
  "listing_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id").notNull(),
    /** HMAC of the client address, so the shared run limits count Sell without storing the address. */
    clientHash: text("client_hash").notNull(),
    /** A committed sample photo path, or null for an uploaded photo. */
    sampleSrc: text("sample_src"),
    photoId: uuid("photo_id").references(() => listingPhotos.id, { onDelete: "cascade" }),
    photoSha256: text("photo_sha256").notNull(),
    status: listingDraftStatus("status").notNull().default("matched"),
    channel3: jsonb("channel3").$type<Channel3Lookup>().notNull(),
    details: jsonb("details").$type<DraftDetails>(),
    /** What the seller sees when the seller agent gave no usable answer. */
    error: text("error"),
    claudeMode: claudeMode("claude_mode"),
    claudeCalls: integer("claude_calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    describeMs: integer("describe_ms"),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listing_drafts_seller_created_idx").on(t.sellerId, t.createdAt),
    index("listing_drafts_session_created_idx").on(t.sessionId, t.createdAt),
    index("listing_drafts_client_created_idx").on(t.clientHash, t.createdAt),
    check("listing_drafts_photo_check", sql`(${t.sampleSrc} is null) <> (${t.photoId} is null)`),
    check("listing_drafts_details_check", sql`${t.status} not in ('ready', 'listed') or ${t.details} is not null`),
    check("listing_drafts_usage_check", sql`${t.claudeCalls} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0`),
  ],
);

/**
 * Channel3 image searches, one per photo, keyed by the photo's SHA-256. A
 * second draft of the same photo reads this row and spends no credit. Rows
 * also count each session's and each day's live calls for the Channel3 caps.
 */
export const channel3Lookups = pgTable(
  "channel3_lookups",
  {
    imageSha256: text("image_sha256").primaryKey(),
    sessionId: text("session_id").notNull(),
    candidates: jsonb("candidates").$type<Channel3Candidate[]>().notNull(),
    /** Products the search returned before Roomover kept the ones with a US price. */
    productCount: integer("product_count").notNull(),
    credits: integer("credits").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("channel3_lookups_session_created_idx").on(t.sessionId, t.createdAt),
    index("channel3_lookups_created_idx").on(t.createdAt),
    check("channel3_lookups_credits_check", sql`${t.credits} >= 0 and ${t.productCount} >= 0`),
  ],
);

/**
 * Channel3 text searches by query, for the buyer agent's gap searches and
 * the new prices behind savings. A query answered once is read from here
 * and costs no credit again, and gap rows count each session's live
 * searches for the Channel3 caps.
 */
export const channel3Searches = pgTable(
  "channel3_searches",
  {
    queryKey: text("query_key").primaryKey(),
    purpose: text("purpose").notNull(),
    query: text("query").notNull(),
    sessionId: text("session_id"),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    productCount: integer("product_count").notNull(),
    credits: integer("credits").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("channel3_searches_purpose_created_idx").on(t.purpose, t.createdAt),
    check("channel3_searches_purpose_check", sql`${t.purpose} in ('gap', 'reference')`),
    check("channel3_searches_counts_check", sql`${t.credits} >= 0 and ${t.productCount} >= 0`),
  ],
);

/** The new price each used listing is compared against for savings, from comparable Channel3 products. */
export const retailReferences = pgTable(
  "retail_references",
  {
    listingId: uuid("listing_id")
      .primaryKey()
      .references(() => listings.id, { onDelete: "cascade" }),
    newPriceCents: integer("new_price_cents").notNull(),
    productName: text("product_name").notNull(),
    retailer: text("retailer").notNull(),
    url: text("url").notNull(),
    /** How many comparable products the median came from. 1 for a product Sell matched. */
    compared: integer("compared").notNull(),
    queryKey: text("query_key").notNull(),
    checkedAt: at("checked_at").notNull().defaultNow(),
  },
  (t) => [check("retail_references_price_check", sql`${t.newPriceCents} > 0 and ${t.compared} > 0`)],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paypalDisputeId: text("paypal_dispute_id").notNull().unique(),
    orderId: uuid("order_id").references(() => orders.id),
    orderItemId: uuid("order_item_id").references(() => orderItems.id),
    status: disputeStatus("status").notNull(),
    reason: text("reason"),
    amountCents: integer("amount_cents"),
    evidence: jsonb("evidence").$type<EvidenceBundle>(),
    evidenceSubmittedAt: at("evidence_submitted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("disputes_order_idx").on(t.orderId),
    check("disputes_amount_check", sql`${t.amountCents} is null or ${t.amountCents} > 0`),
  ],
);

/**
 * One buyer agent run over a plan. It carries the run's outcome, its Claude
 * usage for the cost record, and the session and hashed address the rate
 * limits count.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    kind: agentRunKind("kind").notNull(),
    status: agentRunStatus("status").notNull().default("running"),
    /** The student's words for an edit run. */
    request: text("request"),
    sessionId: text("session_id").notNull(),
    /** HMAC of the client address, so limits work without storing the address. */
    clientHash: text("client_hash").notNull(),
    claudeMode: claudeMode("claude_mode").notNull(),
    claudeCalls: integer("claude_calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    /** What the student sees when the run fails. */
    error: text("error"),
    startedAt: at("started_at").notNull().defaultNow(),
    firstItemAt: at("first_item_at"),
    finishedAt: at("finished_at"),
  },
  (t) => [
    index("agent_runs_plan_started_idx").on(t.planId, t.startedAt),
    index("agent_runs_session_started_idx").on(t.sessionId, t.startedAt),
    index("agent_runs_client_started_idx").on(t.clientHash, t.startedAt),
    index("agent_runs_started_idx").on(t.startedAt),
    check("agent_runs_request_check", sql`${t.kind} <> 'edit' or ${t.request} is not null`),
    check("agent_runs_finished_check", sql`(${t.status} = 'running') = (${t.finishedAt} is null)`),
    check(
      "agent_runs_usage_check",
      sql`${t.claudeCalls} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.cacheWriteTokens} >= 0 and ${t.cacheReadTokens} >= 0`,
    ),
  ],
);

export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Orders events within a plan and serves as the server sent event ID. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    runId: uuid("run_id").notNull(),
    agent: agentName("agent").notNull(),
    tool: text("tool").notNull(),
    summary: text("summary").notNull(),
    /** The everyday sentence the activity panel shows, when the step deserves one. */
    sentence: text("sentence"),
    /** A hard constraint in code stopped this step. */
    blocked: boolean("blocked").notNull().default(false),
    detail: jsonb("detail").$type<AgentEventDetail>().notNull().default({}),
    paypalApi: text("paypal_api"),
    paypalId: text("paypal_id"),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_events_run_created_idx").on(t.runId, t.createdAt),
    index("agent_events_plan_created_idx").on(t.planId, t.createdAt),
    index("agent_events_plan_seq_idx").on(t.planId, t.seq),
    index("agent_events_order_created_idx").on(t.orderId, t.createdAt),
    check("agent_events_paypal_check", sql`${t.paypalId} is null or ${t.paypalApi} is not null`),
  ],
);

/** Every verified PayPal webhook, keyed by event ID so a redelivery is recognized. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paypalEventId: text("paypal_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    eventCreatedAt: at("event_created_at").notNull(),
    receivedAt: at("received_at").notNull().defaultNow(),
    processedAt: at("processed_at"),
  },
  (t) => [index("webhook_events_resource_created_idx").on(t.resourceId, t.eventCreatedAt)],
);
