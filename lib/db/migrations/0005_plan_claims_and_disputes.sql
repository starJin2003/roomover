CREATE TYPE "public"."dispute_evidence_state" AS ENUM('not_due', 'due', 'sending', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "disputed_capture_id" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "seller_response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "paypal_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "evidence_state" "dispute_evidence_state" DEFAULT 'not_due' NOT NULL;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "evidence_stage" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "evidence_error" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "mcp_session_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "plans" SET "mcp_session_id" = "session_id" WHERE "session_id" LIKE 'mcp-%';--> statement-breakpoint
CREATE INDEX "plans_mcp_session_created_idx" ON "plans" USING btree ("mcp_session_id","created_at");--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_evidence_check" CHECK (("disputes"."evidence_state" = 'sent') = ("disputes"."evidence_submitted_at" is not null and "disputes"."evidence_stage" is not null));--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_claim_check" CHECK ("plans"."claimed_at" is null or "plans"."mcp_session_id" is not null);