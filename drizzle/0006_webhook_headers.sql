ALTER TABLE "webhooks" ADD COLUMN "headers_ciphertext" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "header_names" text[] DEFAULT '{}'::text[] NOT NULL;