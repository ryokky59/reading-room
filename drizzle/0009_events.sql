CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"env" text NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"device" text NOT NULL,
	"layout" text NOT NULL,
	"vw" integer NOT NULL,
	"vh" integer NOT NULL,
	"standalone" boolean NOT NULL,
	"screen" text NOT NULL,
	"article_id" integer,
	"source" text,
	"view_id" text,
	"dwell_ms" integer,
	"active_ms" integer,
	"scroll_pct" integer,
	"props" jsonb
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_article_idx" ON "events" USING btree ("article_id");