CREATE TABLE "channel3_searches" (
	"query_key" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"query" text NOT NULL,
	"session_id" text,
	"response" jsonb NOT NULL,
	"product_count" integer NOT NULL,
	"credits" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel3_searches_purpose_check" CHECK ("channel3_searches"."purpose" in ('gap', 'reference')),
	CONSTRAINT "channel3_searches_counts_check" CHECK ("channel3_searches"."credits" >= 0 and "channel3_searches"."product_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retail_references" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"new_price_cents" integer NOT NULL,
	"product_name" text NOT NULL,
	"retailer" text NOT NULL,
	"url" text NOT NULL,
	"compared" integer NOT NULL,
	"query_key" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retail_references_price_check" CHECK ("retail_references"."new_price_cents" > 0 and "retail_references"."compared" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "slot_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "slot_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retail_references" ADD CONSTRAINT "retail_references_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel3_searches_purpose_created_idx" ON "channel3_searches" USING btree ("purpose","created_at");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_slot_check" CHECK (("order_items"."slot_starts_at" is null) = ("order_items"."slot_ends_at" is null) and ("order_items"."slot_starts_at" is null or "order_items"."slot_ends_at" > "order_items"."slot_starts_at"));