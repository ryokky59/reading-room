-- Apply to production only after code that no longer reads or writes category is deployed.
ALTER TABLE "articles" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "feeds" DROP COLUMN "category";