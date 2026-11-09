ALTER TYPE "public"."order_status" ADD VALUE 'settling';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'releasing';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'refunded';--> statement-breakpoint
CREATE TABLE "handoff_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handoff_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_photos_type_check" CHECK ("handoff_photos"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "handoff_photos_size_check" CHECK ("handoff_photos"."byte_size" > 0 and "handoff_photos"."byte_size" <= 5242880)
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "verifier_error" text;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "pay_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paypal_reauthorization_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "settlement_error" text;--> statement-breakpoint
ALTER TABLE "payout_items" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoff_photos" ADD CONSTRAINT "handoff_photos_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."handoffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoff_photos_handoff_idx" ON "handoff_photos" USING btree ("handoff_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paypal_reauthorization_id_unique" UNIQUE("paypal_reauthorization_id");--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_pay_check" CHECK (("handoffs"."decision" is null) = ("handoffs"."pay_cents" is null) and ("handoffs"."pay_cents" is null or "handoffs"."pay_cents" >= 0));