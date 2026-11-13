CREATE TYPE "public"."task_delegation" AS ENUM('handing_off', 'picking_up', 'returned');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "operator_user_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegation" "task_delegation";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegate_to_agent_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegate_to_user_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegation_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_delegate_to_user_id_user_id_fk" FOREIGN KEY ("delegate_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_delegate_to_agent_fk" FOREIGN KEY ("tenant_id","delegate_to_agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_operator_ck" CHECK (num_nonnulls("tasks"."claimed_by_agent_id", "tasks"."operator_user_id") <= 1);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_delegate_ck" CHECK (num_nonnulls("tasks"."delegate_to_agent_id", "tasks"."delegate_to_user_id") <= 1);