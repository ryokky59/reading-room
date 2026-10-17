// Builds a fresh database for the E2E tests. No AI or network calls are needed:
// every article already has its digest, and one has a saved conversation.
import { mkdirSync, rmSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/lib/db/schema";

const dir = process.env.PGLITE_DIR;
if (!dir) throw new Error("PGLITE_DIR is required");

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const db = drizzle(new PGlite(dir), { schema });
await migrate(db, { migrationsFolder: "drizzle" });

const now = Date.now();
const article = (n: number, a: Partial<typeof schema.articles.$inferInsert>) => ({
  url: `https://example.com/e2e/${n}`,
  title: `E2E article ${n}`,
  source: "E2E Source",
  category: "tech",
  lang: "ja",
  summary: `記事 ${n} の AI 要約です。`,
  contentHtml: `<p>記事 ${n} の本文です。</p>`,
  contentText: `記事 ${n} の本文です。`,
  charCount: 1200,
  // Newer articles come first in the inbox.
  fetchedAt: new Date(now - n * 60_000),
  ...a,
});

const inserted = await db
  .insert(schema.articles)
  .values([
    article(1, { title: "Agents in production", titleJa: "本番で動くエージェント", lang: "other" }),
    article(2, { title: "スキップされる記事", titleJa: "スキップされる記事" }),
    article(3, { title: "読了にする記事", titleJa: "読了にする記事" }),
    article(4, { title: "ビジネスの記事", titleJa: "ビジネスの記事", category: "business", source: "Biz Source" }),
    article(5, { title: "対話のある記事", titleJa: "対話のある記事" }),
  ])
  .returning({ id: schema.articles.id, title: schema.articles.title });

const talked = inserted.find((a) => a.title === "対話のある記事")!;
await db.insert(schema.messages).values([
  { articleId: talked.id, role: "user", content: "この記事の要点は？" },
  { articleId: talked.id, role: "assistant", content: "要点は E2E テストが通ることです。" },
]);

// The migration has already turned the seeded Tech / Business feeds into folders.
// These rows let the folder tests change state without touching each other.
const allFolders = await db.select().from(schema.folders);
const tech = allFolders.find((f) => f.name === "Tech")!;
const [, toDelete] = await db
  .insert(schema.folders)
  .values([
    { name: "E2E 移動先", position: 2 },
    { name: "E2E 消すフォルダ", position: 3 },
  ])
  .returning();
const feed = (slug: string, name: string, folderId: number) => ({
  name,
  url: `https://example.com/e2e/feeds/${slug}`,
  category: "tech",
  folderId,
  enabled: false, // never fetched
});
const seededFeeds = await db
  .insert(schema.feeds)
  .values([
    feed("move", "E2E 移動するフィード", tech.id),
    feed("move-mobile", "E2E スマホで移動するフィード", tech.id),
    feed("keep", "E2E 残るフィード", toDelete.id),
  ])
  .returning();
const kept = seededFeeds.find((f) => f.name === "E2E 残るフィード")!;
await db.insert(schema.articles).values(
  article(6, { title: "残るフィードの記事", titleJa: "残るフィードの記事", source: kept.name, feedId: kept.id }),
);

console.log(`seeded ${inserted.length + 1} articles into ${dir}`);
