import { sql } from "drizzle-orm";
import {
  check,
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
import {
  AGENT_NAMES,
  DISPUTE_STATUSES,
  HANDOFF_DECISIONS,
  HANDOFF_MODES,
  HANDOFF_STATUSES,
  LEAVING_REASONS,
  LISTING_CATEGORIES,
  LISTING_STATUSES,
  NEGOTIATION_STATUSES,
  ORDER_ITEM_STATUSES,
  ORDER_STATUSES,
  PAYMENT_MODES,
  PAYOUT_ITEM_STATUSES,
  PAYOUT_STATUSES,
  PAYOUT_WALLETS,
  PLACEMENTS,
  PLAN_STATUSES,
  ROOM_TYPES,
  USER_ROLES,
} from "../domain/enums";
import type { HandoffPhoto, VerificationReport } from "../domain/handoff";
import type { HallConstraint } from "../domain/hall-rules";
import type { ConditionReport, ListingPhoto, ListingSpecs, RetailReference } from "../domain/listing";
import type { OffersLog } from "../domain/negotiation";
import { EMPTY_LAYOUT, type PlanLayout } from "../domain/plan";
import type { RoomGeometry } from "../domain/room";

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

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const at = (name: string) => timestamp(name, { withTimezone: true });

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listings_seller_idx").on(t.sellerId),
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
    /** The single capture of an order that captures at checkout. */
    paypalCaptureId: text("paypal_capture_id").unique(),
    approvedAt: at("approved_at"),
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
    /** Email or Venmo handle at send time, kept so later profile edits do not rewrite history. */
    receiver: text("receiver").notNull(),
    senderItemId: text("sender_item_id").notNull().unique(),
    paypalPayoutItemId: text("paypal_payout_item_id").unique(),
    status: payoutItemStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("payout_items_payout_seller_key").on(t.payoutId, t.sellerId),
    index("payout_items_seller_idx").on(t.sellerId),
    check("payout_items_amount_check", sql`${t.amountCents} > 0`),
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
    attempt: attempt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("order_items_order_listing_key").on(t.orderId, t.listingId),
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
    decision: handoffDecision("decision"),
    decidedAt: at("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("handoffs_slot_idx").on(t.slotStartsAt),
    check("handoffs_slot_check", sql`${t.slotEndsAt} > ${t.slotStartsAt}`),
    check("handoffs_decision_check", sql`(${t.decision} is null) = (${t.decidedAt} is null)`),
  ],
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

export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    agent: agentName("agent").notNull(),
    tool: text("tool").notNull(),
    summary: text("summary").notNull(),
    paypalApi: text("paypal_api"),
    paypalId: text("paypal_id"),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_events_run_created_idx").on(t.runId, t.createdAt),
    index("agent_events_plan_created_idx").on(t.planId, t.createdAt),
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
