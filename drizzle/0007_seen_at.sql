ALTER TABLE "articles" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "articles_unread_idx" ON "articles" USING btree ("status","seen_at","fetched_at");