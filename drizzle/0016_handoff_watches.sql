-- Agents that already handed tasks off follow them as handoffs, so they hear how the work ends
-- (the `handed_off_by_you` delivery reason). Only agents that still exist, and only the task's latest
-- handoff per agent; an existing watch is upgraded, never duplicated.
INSERT INTO "watches" ("tenant_id", "agent_id", "entity_type", "entity_id", "reason", "created_at")
SELECT DISTINCT ON (e."tenant_id", e."actor_id", e."entity_id") e."tenant_id", e."actor_id", 'task', e."entity_id", 'handoff', e."created_at"
FROM "events" e
JOIN "agents" a ON a."tenant_id" = e."tenant_id" AND a."id" = e."actor_id"
WHERE e."action" = 'task.handed_off' AND e."actor_type" = 'agent' AND e."entity_type" = 'task'
ORDER BY e."tenant_id", e."actor_id", e."entity_id", e."created_at" DESC
ON CONFLICT ("agent_id", "entity_type", "entity_id") DO UPDATE SET "reason" = 'handoff';
