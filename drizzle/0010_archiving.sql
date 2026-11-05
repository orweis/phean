ALTER TABLE "agents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived_at" timestamp with time zone;