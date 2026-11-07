CREATE TABLE "realtime_streams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"root_agent_id" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "realtime_streams" ADD CONSTRAINT "realtime_streams_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_streams_tenant_idx" ON "realtime_streams" USING btree ("tenant_id","root_agent_id","renewed_at");