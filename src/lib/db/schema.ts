import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
  // Legacy grouping; still written until the inbox moves to folders.
  category: text("category").notNull(),
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
    source: text("source").notNull(),
    // The feed the article came from; null for articles added by URL or whose feed was deleted.
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: "set null" }),
    category: text("category").notNull(),
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
    learning: text("learning"),
    memo: text("memo"),
  },
  (t) => [index("articles_status_idx").on(t.status, t.fetchedAt), index("articles_feed_idx").on(t.feedId)],
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

export type Article = typeof articles.$inferSelect;
export type Feed = typeof feeds.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Message = typeof messages.$inferSelect;
