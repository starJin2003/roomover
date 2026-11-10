CREATE TYPE "public"."dispute_message_state" AS ENUM('sending', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "message_state" "dispute_message_state";--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "message_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "message_error" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_message_check" CHECK ("disputes"."message_state" is distinct from 'sent' or ("disputes"."message" is not null and "disputes"."message_sent_at" is not null));