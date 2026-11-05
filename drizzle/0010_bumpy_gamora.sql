CREATE TYPE "public"."agent_access_level" AS ENUM('read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "public"."agent_auth_kind" AS ENUM('key', 'oauth');--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "token_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "token_prefix" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "auth_kind" "agent_auth_kind" DEFAULT 'key' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "access_level" "agent_access_level" DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_oauth_name_uq" ON "agents" USING btree ("tenant_id","created_by_user_id","name") WHERE "agents"."auth_kind" = 'oauth' and "agents"."revoked_at" is null;