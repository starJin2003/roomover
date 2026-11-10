ALTER TABLE "disputes" DROP CONSTRAINT "disputes_evidence_check";--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "refunded_cents" integer;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_refunded_check" CHECK ("disputes"."refunded_cents" is null or "disputes"."refunded_cents" >= 0);--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_evidence_check" CHECK ("disputes"."evidence_state" <> 'sent' or ("disputes"."evidence_submitted_at" is not null and "disputes"."evidence_stage" is not null));