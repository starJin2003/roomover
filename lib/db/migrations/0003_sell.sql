CREATE TYPE "public"."listing_draft_status" AS ENUM('matched', 'ready', 'failed', 'listed');--> statement-breakpoint
CREATE TABLE "channel3_lookups" (
	"image_sha256" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"candidates" jsonb NOT NULL,
	"product_count" integer NOT NULL,
	"credits" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel3_lookups_credits_check" CHECK ("channel3_lookups"."credits" >= 0 and "channel3_lookups"."product_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "listing_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"client_hash" text NOT NULL,
	"sample_src" text,
	"photo_id" uuid,
	"photo_sha256" text NOT NULL,
	"status" "listing_draft_status" DEFAULT 'matched' NOT NULL,
	"channel3" jsonb NOT NULL,
	"details" jsonb,
	"error" text,
	"claude_mode" "claude_mode",
	"claude_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"describe_ms" integer,
	"listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_drafts_photo_check" CHECK (("listing_drafts"."sample_src" is null) <> ("listing_drafts"."photo_id" is null)),
	CONSTRAINT "listing_drafts_details_check" CHECK ("listing_drafts"."status" not in ('ready', 'listed') or "listing_drafts"."details" is not null),
	CONSTRAINT "listing_drafts_usage_check" CHECK ("listing_drafts"."claude_calls" >= 0 and "listing_drafts"."input_tokens" >= 0 and "listing_drafts"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "listing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_photos_type_check" CHECK ("listing_photos"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "listing_photos_size_check" CHECK ("listing_photos"."byte_size" > 0 and "listing_photos"."byte_size" <= 5242880 and "listing_photos"."width_px" > 0 and "listing_photos"."height_px" > 0)
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "payout_items" ADD COLUMN "recipient_type" text DEFAULT 'EMAIL' NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_photo_id_listing_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."listing_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_drafts" ADD CONSTRAINT "listing_drafts_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel3_lookups_session_created_idx" ON "channel3_lookups" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "channel3_lookups_created_idx" ON "channel3_lookups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "listing_drafts_seller_created_idx" ON "listing_drafts" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_drafts_session_created_idx" ON "listing_drafts" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_drafts_client_created_idx" ON "listing_drafts" USING btree ("client_hash","created_at");--> statement-breakpoint
CREATE INDEX "listing_photos_seller_created_idx" ON "listing_photos" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "listings_session_created_idx" ON "listings" USING btree ("session_id","created_at");--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_recipient_type_check" CHECK ("payout_items"."recipient_type" in ('PAYPAL_ID', 'EMAIL', 'USER_HANDLE'));