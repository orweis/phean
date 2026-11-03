ALTER TABLE "tasks" ADD COLUMN "input_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Open questions asked before requests had ids and kinds become plain questions.
UPDATE "tasks" SET "input_request" = jsonb_build_object('id', 'q_' || substr(md5(random()::text || "id"), 1, 12), 'kind', 'question', 'context', '', 'options', '[]'::jsonb, 'links', '[]'::jsonb) || "input_request" WHERE "input_request" IS NOT NULL AND NOT ("input_request" ? 'id');
