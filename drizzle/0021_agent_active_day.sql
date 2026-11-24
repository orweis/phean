ALTER TABLE "agents" ADD COLUMN "last_active_day" date;--> statement-breakpoint
-- Agents already in use have had their first call: only agents approved from now on send agent_first_call.
UPDATE "agents" SET "last_active_day" = ("last_seen_at" AT TIME ZONE 'UTC')::date WHERE "last_seen_at" IS NOT NULL;
