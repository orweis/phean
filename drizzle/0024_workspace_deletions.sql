CREATE TABLE "workspace_deletions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_deletions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"deleted_by_user_id" text NOT NULL,
	"deleted_by_email" text NOT NULL,
	"deleted_by_name" text NOT NULL,
	"counts" jsonb NOT NULL,
	"blobs_cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "workspace_deletions_at_idx" ON "workspace_deletions" USING btree ("at" DESC NULLS LAST);