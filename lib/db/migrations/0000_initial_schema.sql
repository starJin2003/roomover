CREATE TYPE "public"."agent_name" AS ENUM('buyer', 'seller', 'verifier', 'platform');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'waiting_for_buyer_response', 'waiting_for_seller_response', 'under_review', 'resolved', 'other');--> statement-breakpoint
CREATE TYPE "public"."handoff_decision" AS ENUM('accepted', 'adjusted', 'rejected', 'missing');--> statement-breakpoint
CREATE TYPE "public"."handoff_mode" AS ENUM('direct', 'storage_hold', 'same_room');--> statement-breakpoint
CREATE TYPE "public"."handoff_status" AS ENUM('scheduled', 'in_storage', 'verifying', 'verified', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."leaving_reason" AS ENUM('graduating', 'lease_end', 'transfer', 'leave_of_absence', 'exchange');--> statement-breakpoint
CREATE TYPE "public"."listing_category" AS ENUM('bed_accessory', 'desk', 'chair', 'shelf', 'lamp', 'rug', 'mini_fridge', 'storage');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'active', 'reserved', 'sold', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."negotiation_status" AS ENUM('open', 'agreed', 'declined', 'round_limit_reached', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."order_item_status" AS ENUM('pending', 'authorized', 'held', 'capture_pending', 'captured', 'adjusted', 'released', 'capture_declined', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_approval', 'approved', 'authorized', 'capture_pending', 'captured', 'capture_declined', 'settled', 'canceled', 'voided', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('authorize_then_capture', 'capture_at_checkout');--> statement-breakpoint
CREATE TYPE "public"."payout_item_status" AS ENUM('pending', 'succeeded', 'failed', 'blocked', 'canceled', 'held', 'refunded', 'returned', 'unclaimed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('created', 'pending', 'processing', 'success', 'denied', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payout_wallet" AS ENUM('paypal', 'venmo');--> statement-breakpoint
CREATE TYPE "public"."placement" AS ENUM('floor', 'underlay', 'surface', 'bed', 'wall');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'planning', 'ready', 'checked_out', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('single', 'double', 'apartment_bedroom');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('buyer', 'seller', 'platform');--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent" "agent_name" NOT NULL,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"paypal_api" text,
	"paypal_id" text,
	"plan_id" uuid,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_events_paypal_check" CHECK ("agent_events"."paypal_id" is null or "agent_events"."paypal_api" is not null)
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_dispute_id" text NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"status" "dispute_status" NOT NULL,
	"reason" text,
	"amount_cents" integer,
	"evidence" jsonb,
	"evidence_submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_paypal_dispute_id_unique" UNIQUE("paypal_dispute_id"),
	CONSTRAINT "disputes_amount_check" CHECK ("disputes"."amount_cents" is null or "disputes"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "hall_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"title" text NOT NULL,
	"rule_text" text NOT NULL,
	"constraints" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hall_rules_hall_id_unique" UNIQUE("hall_id")
);
--> statement-breakpoint
CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "halls_campus_slug_key" UNIQUE("campus","slug")
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"mode" "handoff_mode" NOT NULL,
	"status" "handoff_status" DEFAULT 'scheduled' NOT NULL,
	"slot_starts_at" timestamp with time zone NOT NULL,
	"slot_ends_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_report" jsonb,
	"decision" "handoff_decision",
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoffs_order_item_id_unique" UNIQUE("order_item_id"),
	CONSTRAINT "handoffs_slot_check" CHECK ("handoffs"."slot_ends_at" > "handoffs"."slot_starts_at"),
	CONSTRAINT "handoffs_decision_check" CHECK (("handoffs"."decision" is null) = ("handoffs"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"campus" text NOT NULL,
	"category" "listing_category" NOT NULL,
	"placement" "placement" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"color" text NOT NULL,
	"material" text NOT NULL,
	"style_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"width_mm" integer NOT NULL,
	"depth_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photos" jsonb NOT NULL,
	"condition_report" jsonb NOT NULL,
	"retail_reference" jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"floor_price_cents" integer NOT NULL,
	"move_out_starts_at" timestamp with time zone NOT NULL,
	"move_out_ends_at" timestamp with time zone NOT NULL,
	"move_in_starts_at" timestamp with time zone NOT NULL,
	"move_in_ends_at" timestamp with time zone NOT NULL,
	"handoff_mode" "handoff_mode" NOT NULL,
	"room_preset_id" uuid,
	"room_number" text,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_dimensions_check" CHECK ("listings"."width_mm" > 0 and "listings"."depth_mm" > 0 and "listings"."height_mm" > 0),
	CONSTRAINT "listings_price_check" CHECK ("listings"."price_cents" > 0 and "listings"."floor_price_cents" >= 0 and "listings"."floor_price_cents" <= "listings"."price_cents"),
	CONSTRAINT "listings_windows_check" CHECK ("listings"."move_out_ends_at" > "listings"."move_out_starts_at" and "listings"."move_in_ends_at" > "listings"."move_in_starts_at"),
	CONSTRAINT "listings_same_room_check" CHECK ("listings"."handoff_mode" <> 'same_room' or ("listings"."room_preset_id" is not null and "listings"."room_number" is not null))
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"status" "negotiation_status" DEFAULT 'open' NOT NULL,
	"offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agreed_price_cents" integer,
	"agreed_slot_starts_at" timestamp with time zone,
	"agreed_slot_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiations_plan_listing_key" UNIQUE("plan_id","listing_id"),
	CONSTRAINT "negotiations_agreement_check" CHECK ("negotiations"."status" <> 'agreed' or coalesce("negotiations"."agreed_price_cents" > 0 and "negotiations"."agreed_slot_ends_at" > "negotiations"."agreed_slot_starts_at", false))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"captured_amount_cents" integer DEFAULT 0 NOT NULL,
	"refunded_amount_cents" integer DEFAULT 0 NOT NULL,
	"status" "order_item_status" DEFAULT 'pending' NOT NULL,
	"paypal_capture_id" text,
	"paypal_refund_id" text,
	"payout_item_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_paypal_refund_id_unique" UNIQUE("paypal_refund_id"),
	CONSTRAINT "order_items_order_listing_key" UNIQUE("order_id","listing_id"),
	CONSTRAINT "order_items_amounts_check" CHECK ("order_items"."amount_cents" > 0 and "order_items"."refunded_amount_cents" >= 0 and "order_items"."refunded_amount_cents" <= "order_items"."captured_amount_cents" and "order_items"."captured_amount_cents" <= "order_items"."amount_cents"),
	CONSTRAINT "order_items_attempt_check" CHECK ("order_items"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"status" "order_status" DEFAULT 'pending_approval' NOT NULL,
	"total_cents" integer NOT NULL,
	"paypal_order_id" text,
	"paypal_authorization_id" text,
	"authorization_expires_at" timestamp with time zone,
	"reauthorized_at" timestamp with time zone,
	"paypal_capture_id" text,
	"approved_at" timestamp with time zone,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "orders_paypal_authorization_id_unique" UNIQUE("paypal_authorization_id"),
	CONSTRAINT "orders_paypal_capture_id_unique" UNIQUE("paypal_capture_id"),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_cents" > 0),
	CONSTRAINT "orders_attempt_check" CHECK ("orders"."attempt" >= 1),
	CONSTRAINT "orders_reauthorization_check" CHECK ("orders"."reauthorized_at" is null or ("orders"."payment_mode" = 'authorize_then_capture' and "orders"."paypal_authorization_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"wallet" "payout_wallet" NOT NULL,
	"receiver" text NOT NULL,
	"sender_item_id" text NOT NULL,
	"paypal_payout_item_id" text,
	"status" "payout_item_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_items_sender_item_id_unique" UNIQUE("sender_item_id"),
	CONSTRAINT "payout_items_paypal_payout_item_id_unique" UNIQUE("paypal_payout_item_id"),
	CONSTRAINT "payout_items_payout_seller_key" UNIQUE("payout_id","seller_id"),
	CONSTRAINT "payout_items_amount_check" CHECK ("payout_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sender_batch_id" text NOT NULL,
	"paypal_batch_id" text,
	"status" "payout_status" DEFAULT 'created' NOT NULL,
	"total_cents" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_sender_batch_id_unique" UNIQUE("sender_batch_id"),
	CONSTRAINT "payouts_paypal_batch_id_unique" UNIQUE("paypal_batch_id"),
	CONSTRAINT "payouts_total_check" CHECK ("payouts"."total_cents" > 0),
	CONSTRAINT "payouts_attempt_check" CHECK ("payouts"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"room_preset_id" uuid NOT NULL,
	"room_number" text,
	"budget_cents" integer NOT NULL,
	"style_prompt" text NOT NULL,
	"layout" jsonb DEFAULT '{"items":[]}'::jsonb NOT NULL,
	"move_in_starts_at" timestamp with time zone,
	"move_in_ends_at" timestamp with time zone,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_budget_check" CHECK ("plans"."budget_cents" > 0),
	CONSTRAINT "plans_move_in_check" CHECK (("plans"."move_in_starts_at" is null) = ("plans"."move_in_ends_at" is null) and ("plans"."move_in_starts_at" is null or "plans"."move_in_ends_at" > "plans"."move_in_starts_at"))
);
--> statement-breakpoint
CREATE TABLE "room_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hall_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"room_type" "room_type" NOT NULL,
	"occupancy" integer NOT NULL,
	"width_mm" integer NOT NULL,
	"depth_mm" integer NOT NULL,
	"ceiling_height_mm" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"estimated_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_presets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "room_presets_occupancy_check" CHECK ("room_presets"."occupancy" between 1 and 4),
	CONSTRAINT "room_presets_dimensions_check" CHECK ("room_presets"."width_mm" > 0 and "room_presets"."depth_mm" > 0 and "room_presets"."ceiling_height_mm" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" NOT NULL,
	"display_name" text NOT NULL,
	"campus" text,
	"class_year" integer,
	"leaving_reason" "leaving_reason",
	"bio" text,
	"paypal_account_id" text,
	"paypal_email" text,
	"payout_wallet" "payout_wallet" DEFAULT 'paypal' NOT NULL,
	"venmo_handle" text,
	"room_preset_id" uuid,
	"room_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_paypal_account_id_unique" UNIQUE("paypal_account_id"),
	CONSTRAINT "users_paypal_email_unique" UNIQUE("paypal_email"),
	CONSTRAINT "users_campus_check" CHECK ("users"."role" = 'platform' or "users"."campus" is not null),
	CONSTRAINT "users_venmo_handle_check" CHECK ("users"."payout_wallet" <> 'venmo' or "users"."venmo_handle" is not null),
	CONSTRAINT "users_room_check" CHECK ("users"."room_number" is null or "users"."room_preset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"event_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_rules" ADD CONSTRAINT "hall_rules_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_room_preset_id_room_presets_id_fk" FOREIGN KEY ("room_preset_id") REFERENCES "public"."room_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_payout_item_id_payout_items_id_fk" FOREIGN KEY ("payout_item_id") REFERENCES "public"."payout_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_room_preset_id_room_presets_id_fk" FOREIGN KEY ("room_preset_id") REFERENCES "public"."room_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_presets" ADD CONSTRAINT "room_presets_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_room_preset_id_room_presets_id_fk" FOREIGN KEY ("room_preset_id") REFERENCES "public"."room_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_run_created_idx" ON "agent_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_events_plan_created_idx" ON "agent_events" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_events_order_created_idx" ON "agent_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_order_idx" ON "disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "handoffs_slot_idx" ON "handoffs" USING btree ("slot_starts_at");--> statement-breakpoint
CREATE INDEX "listings_seller_idx" ON "listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "listings_campus_status_category_price_idx" ON "listings" USING btree ("campus","status","category","price_cents");--> statement-breakpoint
CREATE INDEX "listings_campus_status_price_idx" ON "listings" USING btree ("campus","status","price_cents");--> statement-breakpoint
CREATE INDEX "listings_campus_status_move_out_idx" ON "listings" USING btree ("campus","status","move_out_starts_at","move_out_ends_at");--> statement-breakpoint
CREATE INDEX "negotiations_listing_idx" ON "negotiations" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "order_items_listing_idx" ON "order_items" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "order_items_seller_idx" ON "order_items" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "order_items_payout_item_idx" ON "order_items" USING btree ("payout_item_id");--> statement-breakpoint
CREATE INDEX "orders_buyer_created_idx" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_plan_idx" ON "orders" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payout_items_seller_idx" ON "payout_items" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "payouts_order_idx" ON "payouts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "plans_buyer_created_idx" ON "plans" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "room_presets_hall_idx" ON "room_presets" USING btree ("hall_id");--> statement-breakpoint
CREATE INDEX "users_campus_role_idx" ON "users" USING btree ("campus","role");--> statement-breakpoint
CREATE INDEX "webhook_events_resource_created_idx" ON "webhook_events" USING btree ("resource_id","event_created_at");