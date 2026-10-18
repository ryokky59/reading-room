-- Safe while code that still writes category is running. Apply to production before merging #3;
-- running it again later (drizzle-kit migrate after the deploy) is a no-op.
ALTER TABLE "articles" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ALTER COLUMN "category" DROP NOT NULL;