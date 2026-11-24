-- Idempotent: an early preview of this change ran an equivalent migration (then numbered 0021) against a shared database,
-- so every statement tolerates the tables, indexes and constraints already being there.
CREATE TABLE IF NOT EXISTS "backoffice_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backoffice_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_user_id" text NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"tenant_id" text,
	"subject_user_id" text,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_calls_daily" (
	"day" date NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"tool" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tool_calls_daily_pk" PRIMARY KEY("day","tenant_id","agent_id","tool")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_daily" (
	"day" date NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"events" integer NOT NULL,
	CONSTRAINT "usage_daily_pk" PRIMARY KEY("day","tenant_id","actor_type","actor_id","action")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_rollup_state" (
	"id" text PRIMARY KEY DEFAULT 'usage' NOT NULL,
	"through_day" date,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_calls_daily" ADD CONSTRAINT "tool_calls_daily_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backoffice_audit_at_idx" ON "backoffice_audit" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backoffice_audit_grant_idx" ON "backoffice_audit" USING btree ("admin_user_id","tenant_id","action","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_calls_daily_day_idx" ON "tool_calls_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_daily_action_idx" ON "usage_daily" USING btree ("action","day");