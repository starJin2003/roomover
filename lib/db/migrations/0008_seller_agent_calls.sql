CREATE TABLE "seller_agent_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"client_hash" text NOT NULL,
	"calls" integer NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_agent_calls_calls_check" CHECK ("seller_agent_calls"."calls" >= 0 and "seller_agent_calls"."calls" <= 2)
);
--> statement-breakpoint
CREATE INDEX "seller_agent_calls_called_idx" ON "seller_agent_calls" USING btree ("called_at");--> statement-breakpoint
CREATE INDEX "seller_agent_calls_session_called_idx" ON "seller_agent_calls" USING btree ("session_id","called_at");--> statement-breakpoint
CREATE INDEX "seller_agent_calls_client_called_idx" ON "seller_agent_calls" USING btree ("client_hash","called_at");--> statement-breakpoint
CREATE INDEX "seller_agent_calls_draft_idx" ON "seller_agent_calls" USING btree ("draft_id");