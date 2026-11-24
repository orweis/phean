CREATE TYPE "public"."pipeline_kind" AS ENUM('regular', 'adhoc', 'factory');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."pipeline_trigger_kind" AS ENUM('schedule', 'event', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."pipeline_proposal_state" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('running', 'waiting', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_trigger" AS ENUM('manual', 'agent', 'schedule', 'event', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stop_state" AS ENUM('active', 'waiting', 'done', 'failed', 'skipped', 'not_reached', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."agent_auth_kind" ADD VALUE 'system';--> statement-breakpoint
CREATE TABLE "pipeline_run_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"task_id" text,
	"state" "pipeline_stop_state" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"result" jsonb,
	"branch" text,
	"request_id" text,
	"recovering" boolean DEFAULT false NOT NULL,
	"votes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"version" integer NOT NULL,
	"number" integer NOT NULL,
	"trigger" "pipeline_run_trigger" NOT NULL,
	"triggered_by_type" text NOT NULL,
	"triggered_by_id" text,
	"triggered_by_name" text NOT NULL,
	"trigger_detail" text DEFAULT '' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"status" "pipeline_run_status" DEFAULT 'running' NOT NULL,
	"task_id" text,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_id" text,
	"end_name" text,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_runs_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "pipeline_runs_number_uq" UNIQUE("pipeline_id","number")
);
--> statement-breakpoint
CREATE TABLE "pipeline_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"kind" "pipeline_trigger_kind" NOT NULL,
	"cron" text,
	"time_zone" text,
	"tag" text,
	"source" text,
	"secret_hash" text,
	"checked_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_versions" (
	"tenant_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"proposal_state" "pipeline_proposal_state",
	"base_version" integer,
	"settings" jsonb,
	"decided_by_user_id" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_versions_pk" PRIMARY KEY("pipeline_id","number"),
	CONSTRAINT "pipeline_versions_tenant_uq" UNIQUE("tenant_id","pipeline_id","number")
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "pipeline_kind" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_user_id" text,
	"status" "pipeline_status" DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"factory_id" text,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD CONSTRAINT "pipeline_run_stops_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD CONSTRAINT "pipeline_run_stops_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."pipeline_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_stops" ADD CONSTRAINT "pipeline_run_stops_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_version_fk" FOREIGN KEY ("tenant_id","pipeline_id","version") REFERENCES "public"."pipeline_versions"("tenant_id","pipeline_id","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_triggers" ADD CONSTRAINT "pipeline_triggers_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_triggers" ADD CONSTRAINT "pipeline_triggers_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_pipeline_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."pipelines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_run_stops_current_uq" ON "pipeline_run_stops" USING btree ("run_id","stop_id") WHERE superseded_at is null;--> statement-breakpoint
CREATE INDEX "pipeline_run_stops_task_idx" ON "pipeline_run_stops" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "pipeline_run_stops_due_idx" ON "pipeline_run_stops" USING btree ("due_at") WHERE due_at is not null and superseded_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_runs_scheduled_uq" ON "pipeline_runs" USING btree ("pipeline_id","scheduled_for") WHERE scheduled_for is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_runs_task_uq" ON "pipeline_runs" USING btree ("tenant_id","task_id") WHERE task_id is not null;--> statement-breakpoint
CREATE INDEX "pipeline_runs_tenant_status_idx" ON "pipeline_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "pipeline_runs_pipeline_idx" ON "pipeline_runs" USING btree ("tenant_id","pipeline_id","number");--> statement-breakpoint
CREATE INDEX "pipeline_triggers_tenant_idx" ON "pipeline_triggers" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "pipeline_triggers_kind_idx" ON "pipeline_triggers" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "pipelines_tenant_status_idx" ON "pipelines" USING btree ("tenant_id","status");