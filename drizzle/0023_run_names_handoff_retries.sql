-- Idempotent: branch previews share the production database and may run this before the release does,
-- so every statement tolerates the columns and index already being there.
ALTER TABLE "pipeline_run_stops" ADD COLUMN IF NOT EXISTS "handed_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD COLUMN IF NOT EXISTS "handoff_agent_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD COLUMN IF NOT EXISTS "handoff_resends" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD COLUMN IF NOT EXISTS "handoff_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD COLUMN IF NOT EXISTS "handoff_gave_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "name" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_run_stops_retry_idx" ON "pipeline_run_stops" USING btree ("handoff_retry_at") WHERE handoff_retry_at is not null and superseded_at is null;
