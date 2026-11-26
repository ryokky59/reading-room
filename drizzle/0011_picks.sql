CREATE TABLE "picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"position" integer NOT NULL,
	"article_id" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picks_day_position_unique" UNIQUE("day","position")
);
--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;