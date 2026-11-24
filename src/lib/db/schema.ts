import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export type ArticleStatus = "inbox" | "read" | "skipped";

// User-made groups of feeds, shown in `position` order.
export const folders = pgTable("folders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeds = pgTable("feeds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(), // the RSS/Atom URL
  // Null means the feed is unfiled (未分類).
  folderId: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
  // Max items taken per run, and how many days back an item may be.
  itemLimit: integer("item_limit").notNull().default(5),
  days: integer("days").notNull().default(3),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull().unique(),
    title: text("title").notNull(),
    // Filled by the AI digest after fetching; null until then.
    titleJa: text("title_ja"), // Japanese title (same as title for Japanese articles)
    summary: text("summary"), // short Japanese summary for the inbox
    lang: text("lang"), // "ja" or "other"
    // Tries so far and why the last one failed; at DIGEST_ATTEMPT_LIMIT it is not tried again.
    digestAttempts: integer("digest_attempts").notNull().default(0),
    digestError: text("digest_error"),
    // When the digest was last tried; the next try waits DIGEST_RETRY_INTERVAL_MS (src/lib/feeds.ts).
    digestTriedAt: timestamp("digest_tried_at", { withTimezone: true }),
    source: text("source").notNull(),
    // The feed the article came from; null for articles added by URL or whose feed was deleted.
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    // Sanitized HTML for display; null when extraction failed.
    contentHtml: text("content_html"),
    // Plain text handed to Claude.
    contentText: text("content_text"),
    // Detailed Japanese walkthrough of a non-Japanese body, as Markdown; made on first open.
    contentJa: text("content_ja"),
    excerpt: text("excerpt"),
    charCount: integer("char_count").notNull().default(0),
    status: text("status").$type<ArticleStatus>().notNull().default("inbox"),
    readAt: timestamp("read_at", { withTimezone: true }),
    // When the owner first looked at the article; null means unread (未読).
    seenAt: timestamp("seen_at", { withTimezone: true }),
    learning: text("learning"),
    memo: text("memo"),
  },
  (t) => [
    index("articles_status_idx").on(t.status, t.fetchedAt),
    index("articles_unread_idx").on(t.status, t.seenAt, t.fetchedAt),
    index("articles_feed_idx").on(t.feedId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_article_idx").on(t.articleId, t.id)],
);

export const reviews = pgTable("reviews", {
  month: text("month").primaryKey(), // YYYY-MM
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// What the owner does in the app, one row per event sent by track() in lib/track.ts. Columns a
// type does not use stay null. See 「行動ログ」 in README.md for the values.
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    env: text("env").notNull(), // VERCEL_ENV, or "development"
    sessionId: text("session_id").notNull(), // random per browser tab
    type: text("type").notNull(),
    device: text("device").notNull(), // "phone" | "pc"
    layout: text("layout").notNull(), // "single" | "split"
    vw: integer("vw").notNull(),
    vh: integer("vh").notNull(),
    standalone: boolean("standalone").notNull(), // started from the home screen
    screen: text("screen").notNull(),
    articleId: integer("article_id").references(() => articles.id, { onDelete: "set null" }),
    source: text("source"), // how an article was opened
    viewId: text("view_id"), // one opening of an article, shared by the events while it is open
    dwellMs: integer("dwell_ms"),
    activeMs: integer("active_ms"),
    scrollPct: integer("scroll_pct"),
    props: jsonb("props").$type<Record<string, unknown>>(),
  },
  (t) => [index("events_created_idx").on(t.createdAt), index("events_article_idx").on(t.articleId)],
);

// 「今朝の N 本」: the articles chosen for the top of the Board each morning (lib/picks.ts). `day` is
// the pick day (pickDay in lib/format.ts); one set a day, so a second run adds nothing.
export const picks = pgTable(
  "picks",
  {
    id: serial("id").primaryKey(),
    day: text("day").notNull(), // YYYY-MM-DD
    position: integer("position").notNull(), // 0-4
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(), // why this one today, in one line
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("picks_day_position_unique").on(t.day, t.position)],
);

export type Article = typeof articles.$inferSelect;
export type Feed = typeof feeds.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Message = typeof messages.$inferSelect;
