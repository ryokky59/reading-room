ALTER TABLE "articles" ADD COLUMN "digest_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "digest_error" text;