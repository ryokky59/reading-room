CREATE TABLE "folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "feed_id" integer;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_feed_idx" ON "articles" USING btree ("feed_id");--> statement-breakpoint
-- Data migration: the fixed Tech / Business categories become folders.
INSERT INTO "folders" ("name", "position") VALUES ('Tech', 0), ('Business', 1);--> statement-breakpoint
UPDATE "feeds" SET "folder_id" = "folders"."id" FROM "folders"
  WHERE "folders"."name" = CASE "feeds"."category" WHEN 'tech' THEN 'Tech' WHEN 'business' THEN 'Business' END;--> statement-breakpoint
-- Existing articles only know their feed by name; take the oldest feed of that name.
UPDATE "articles" SET "feed_id" = (SELECT min("feeds"."id") FROM "feeds" WHERE "feeds"."name" = "articles"."source")
  WHERE "feed_id" IS NULL;
