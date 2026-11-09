CREATE TYPE "public"."agent_run_kind" AS ENUM('plan', 'edit');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."claude_mode" AS ENUM('live', 'fixture');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" "agent_run_kind" NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"request" text,
	"session_id" text NOT NULL,
	"client_hash" text NOT NULL,
	"claude_mode" "claude_mode" NOT NULL,
	"claude_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_item_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_runs_request_check" CHECK ("agent_runs"."kind" <> 'edit' or "agent_runs"."request" is not null),
	CONSTRAINT "agent_runs_finished_check" CHECK (("agent_runs"."status" = 'running') = ("agent_runs"."finished_at" is null)),
	CONSTRAINT "agent_runs_usage_check" CHECK ("agent_runs"."claude_calls" >= 0 and "agent_runs"."input_tokens" >= 0 and "agent_runs"."output_tokens" >= 0 and "agent_runs"."cache_write_tokens" >= 0 and "agent_runs"."cache_read_tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "agent_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "sentence" text;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "detail" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "colors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_plan_started_idx" ON "agent_runs" USING btree ("plan_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_session_started_idx" ON "agent_runs" USING btree ("session_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_client_started_idx" ON "agent_runs" USING btree ("client_hash","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "agent_events_plan_seq_idx" ON "agent_events" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE INDEX "plans_session_created_idx" ON "plans" USING btree ("session_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_seq_unique" UNIQUE("seq");