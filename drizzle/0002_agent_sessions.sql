ALTER TABLE "tasks" ADD COLUMN "agent_sessions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "input_request" jsonb;