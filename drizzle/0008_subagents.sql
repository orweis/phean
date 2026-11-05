ALTER TABLE "agents" ADD COLUMN "parent_agent_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "purpose" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_fk" FOREIGN KEY ("tenant_id","parent_agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;