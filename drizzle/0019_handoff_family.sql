ALTER TABLE "tasks" ADD COLUMN "handed_off_by_agent_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handed_off_by_user_id" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "for_agents" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_handed_off_by_user_id_user_id_fk" FOREIGN KEY ("handed_off_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_handed_off_by_agent_fk" FOREIGN KEY ("tenant_id","handed_off_by_agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_hander_ck" CHECK (num_nonnulls("tasks"."handed_off_by_agent_id", "tasks"."handed_off_by_user_id") <= 1);--> statement-breakpoint
-- Open tasks remember who last handed them off, from the activity log, so work handed over before
-- this release can be handed back too. Only actors that still exist.
UPDATE "tasks" t SET
  "handed_off_by_agent_id" = CASE WHEN h."actor_type" = 'agent' THEN h."actor_id" END,
  "handed_off_by_user_id" = CASE WHEN h."actor_type" = 'user' THEN h."actor_id" END
FROM (
  SELECT DISTINCT ON (e."tenant_id", e."entity_id") e."tenant_id", e."entity_id", e."actor_type", e."actor_id"
  FROM "events" e
  WHERE e."action" = 'task.handed_off' AND e."entity_type" = 'task'
  ORDER BY e."tenant_id", e."entity_id", e."id" DESC
) h
WHERE t."tenant_id" = h."tenant_id" AND t."id" = h."entity_id"
  AND t."status" NOT IN ('done', 'dropped')
  AND (
    (h."actor_type" = 'agent' AND EXISTS (SELECT 1 FROM "agents" a WHERE a."tenant_id" = h."tenant_id" AND a."id" = h."actor_id"))
    OR (h."actor_type" = 'user' AND EXISTS (SELECT 1 FROM "user" u WHERE u."id" = h."actor_id"))
  );
