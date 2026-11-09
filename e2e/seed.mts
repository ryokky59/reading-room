// Builds a fresh database for the E2E tests. No AI or network calls are needed:
// every article already has its digest, and one has a saved conversation.
import { mkdirSync, rmSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/lib/db/schema";

const dir = process.env.PGLITE_DIR;
if (!dir) throw new Error("PGLITE_DIR is required");
const stub = `http://localhost:${process.env.E2E_STUB_PORT}`;

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const db = drizzle(new PGlite(dir), { schema });
await migrate(db, { migrationsFolder: "drizzle" });

const now = Date.now();
const article = (n: number, a: Partial<typeof schema.articles.$inferInsert>) => ({
  url: `https://example.com/e2e/${n}`,
  title: `E2E article ${n}`,
  source: "E2E Source",
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
    article(4, {
      title: "ビジネスの記事",
      titleJa: "ビジネスの記事",
      // Long enough to wrap past two lines on a phone (e2e/app.spec.ts clamps it).
      summary: "長い要約の記事です。".repeat(12),
    }),
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
// They point at real sites; 「今すぐ取得」 must not reach the network, so they point at the local
// stub instead (see `feed` below).
await db.update(schema.feeds).set({ url: sql`${stub} || '/e2e/feeds/seeded-' || ${schema.feeds.id}` });
const allFolders = await db.select().from(schema.folders);
const tech = allFolders.find((f) => f.name === "Tech")!;
const [, toDelete] = await db
  .insert(schema.folders)
  .values([
    { name: "E2E 移動先", position: 2 },
    { name: "E2E 消すフォルダ", position: 3 },
  ])
  .returning();
// Running feeds, so the Board gives them a column. 「今すぐ取得」 finds them empty (e2e/stub.mts).
const feed = (slug: string, name: string, folderId: number) => ({
  name,
  url: `${stub}/e2e/feeds/${slug}`,
  folderId,
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

// Inbox filter rows (e2e/inbox.spec.ts). Articles 1-3 and 5 stay unfiled (未分類).
const business = allFolders.find((f) => f.name === "Business")!;
const [many, crowded, back, lastOne, readBack] = await db
  .insert(schema.folders)
  .values([
    { name: "E2E たくさん", position: 4 },
    { name: "E2E サイトの多いフォルダ", position: 5 },
    { name: "E2E 戻り先", position: 6 },
    { name: "E2E 読み終わり", position: 6 },
    { name: "E2E 読了の戻り先", position: 6 },
    // Long names so the folder chips overflow a phone screen.
    ...["A", "B", "C"].map((x, i) => ({ name: `E2E 横スクロール確認用のフォルダ ${x}`, position: 7 + i })),
  ])
  .returning();
const [flash, weekly, readOnly, bulk, backFeed, lastFeed, stayFeed, readBackFeed, ...crowdedFeeds] = await db
  .insert(schema.feeds)
  .values([
    feed("flash", "E2E ビジネス速報", business.id),
    feed("weekly", "E2E ビジネス週報", business.id),
    feed("read-only", "E2E 読了だけのサイト", business.id),
    feed("bulk", "E2E 量産サイト", many.id),
    feed("back", "E2E 戻り先サイト", back.id),
    feed("last-one", "E2E 最後の1本のサイト", lastOne.id),
    feed("stay", "E2E 残るサイト", lastOne.id),
    feed("read-back", "E2E 読了の戻り先サイト", readBack.id),
    ...[1, 2, 3, 4, 5, 6].map((i) => feed(`crowded-${i}`, `E2E 横に並ぶサイト ${i}`, crowded.id)),
  ])
  .returning();
const biz = inserted.find((a) => a.title === "ビジネスの記事")!;
await db.update(schema.articles).set({ source: flash.name, feedId: flash.id }).where(eq(schema.articles.id, biz.id));
// Older than the articles above so they stay out of the first page of すべて.
const old = (i: number) => new Date(now - 86_400_000 - i * 60_000);
const filterArticles = [
  article(7, { title: "速報の2本目", titleJa: "速報の2本目", source: flash.name, feedId: flash.id }),
  article(8, { title: "週報の記事", titleJa: "週報の記事", source: weekly.name, feedId: weekly.id }),
  article(9, {
    title: "読了だけのサイトの記事",
    titleJa: "読了だけのサイトの記事",
    source: readOnly.name,
    feedId: readOnly.id,
    status: "read",
    readAt: new Date(now),
  }),
  ...[1, 2].map((i) =>
    article(300 + i, { title: `戻り先の記事 ${i}`, titleJa: `戻り先の記事 ${i}`, source: backFeed.name, feedId: backFeed.id, fetchedAt: old(200 + i) }),
  ),
  article(310, { title: "最後の1本", titleJa: "最後の1本", source: lastFeed.name, feedId: lastFeed.id, fetchedAt: old(210) }),
  article(311, { title: "残るサイトの記事", titleJa: "残るサイトの記事", source: stayFeed.name, feedId: stayFeed.id, fetchedAt: old(211) }),
  ...[1, 2].map((i) =>
    article(320 + i, { title: `読了の戻り先 ${i}`, titleJa: `読了の戻り先 ${i}`, source: readBackFeed.name, feedId: readBackFeed.id, fetchedAt: old(220 + i) }),
  ),
  ...Array.from({ length: 35 }, (_, i) =>
    article(100 + i, { title: `量産記事 ${i + 1}`, titleJa: `量産記事 ${i + 1}`, source: bulk.name, feedId: bulk.id, fetchedAt: old(i) }),
  ),
  ...crowdedFeeds.map((f, i) =>
    article(200 + i, { title: `並ぶサイトの記事 ${i + 1}`, source: f.name, feedId: f.id, fetchedAt: old(100 + i) }),
  ),
];
await db.insert(schema.articles).values(filterArticles);

// PC pane rows (e2e/panes.spec.ts): one folder per test that reads or skips.
const paneFolders = await db
  .insert(schema.folders)
  .values(["E2E ペインで読む", "E2E キーボード", "E2E 直接開く"].map((name, i) => ({ name, position: 10 + i })))
  .returning();
const paneFeeds = await db
  .insert(schema.feeds)
  .values(paneFolders.map((f, i) => feed(`pane-${i}`, `${f.name}のサイト`, f.id)))
  .returning();
const paneArticles = paneFeeds.flatMap((f, i) =>
  [1, 2, 3].map((j) =>
    article(400 + i * 10 + j, {
      title: `${paneFolders[i].name} ${j}`,
      titleJa: `${paneFolders[i].name} ${j}`,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(300 + i * 10 + j),
    }),
  ),
);
await db.insert(schema.articles).values(paneArticles);

// Phone scroll rows (e2e/mobile-scroll.spec.ts): one folder per way back, each with enough
// cards to scroll the list and a body long enough to scroll the article.
const scrollFolders = await db
  .insert(schema.folders)
  // No "戻る" in these names: other tests find the back link by that name.
  .values(
    ["E2E スマホの矢印", "E2E スマホの履歴", "E2E スマホで読了", "E2E スマホでスキップ"].map((name, i) => ({
      name,
      position: 20 + i,
    })),
  )
  .returning();
const scrollFeeds = await db
  .insert(schema.feeds)
  .values(scrollFolders.map((f, i) => feed(`scroll-${i}`, `${f.name}のサイト`, f.id)))
  .returning();
const longBody = Array.from({ length: 60 }, (_, k) => `<p>長い本文の段落 ${k + 1} です。スクロールして読みます。</p>`).join("");
const scrollArticles = scrollFeeds.flatMap((f, i) =>
  Array.from({ length: 20 }, (_, j) =>
    article(500 + i * 100 + j, {
      title: `${scrollFolders[i].name} ${j + 1}`,
      titleJa: `${scrollFolders[i].name} ${j + 1}`,
      source: f.name,
      feedId: f.id,
      contentHtml: longBody,
      fetchedAt: old(400 + i * 100 + j),
    }),
  ),
);
await db.insert(schema.articles).values(scrollArticles);

// Pause rows (e2e/pause-feed.spec.ts): one feed per screen width, in its own folder.
const pauseFolders = await db
  .insert(schema.folders)
  .values(["E2E PC で止める", "E2E スマホで止める"].map((name, i) => ({ name, position: 30 + i })))
  .returning();
const pauseFeeds = await db
  .insert(schema.feeds)
  .values(pauseFolders.map((f, i) => feed(`pause-${i}`, `${f.name}サイト`, f.id)))
  .returning();
const pauseArticles = pauseFeeds.flatMap((f, i) =>
  [1, 2].map((j) =>
    article(1000 + i * 10 + j, {
      title: `${pauseFolders[i].name}記事 ${j}`,
      titleJa: `${pauseFolders[i].name}記事 ${j}`,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(1000 + i * 10 + j),
    }),
  ),
);
await db.insert(schema.articles).values(pauseArticles);

// Reading past the loaded cards (e2e/panes.spec.ts): more unread than one page of the list.
const [pastFolder] = await db.insert(schema.folders).values({ name: "E2E 読み進める", position: 40 }).returning();
const [pastFeed] = await db.insert(schema.feeds).values(feed("past", "E2E 読み進めるサイト", pastFolder.id)).returning();
const pastArticles = Array.from({ length: 32 }, (_, i) =>
  article(1100 + i, {
    title: `読み進める ${i + 1}`,
    titleJa: `読み進める ${i + 1}`,
    source: pastFeed.name,
    feedId: pastFeed.id,
    fetchedAt: old(1100 + i),
  }),
);
await db.insert(schema.articles).values(pastArticles);

// Articles fetched in one go (e2e/panes.spec.ts): the same fetchedAt, so only the id orders them.
// Inserted from 34 down to 1, so "同時刻 1" has the highest id and comes first.
const [sameFolder, beforeFolder, afterFolder] = await db
  .insert(schema.folders)
  .values(["E2E 同時刻", "E2E 切り替え前", "E2E 切り替え後"].map((name, i) => ({ name, position: 50 + i })))
  .returning();
const [sameFeed, beforeFeed, afterFeed] = await db
  .insert(schema.feeds)
  .values([
    feed("same-time", "E2E 同時刻のサイト", sameFolder.id),
    // Stopped: e2e/panes.spec.ts resumes it beside the list.
    { ...feed("before-switch", "E2E 切り替え前のサイト", beforeFolder.id), enabled: false },
    feed("after-switch", "E2E 切り替え後のサイト", afterFolder.id),
  ])
  .returning();
const sameTime = old(1200);
const sameTimeArticles = Array.from({ length: 34 }, (_, i) =>
  article(1200 + i, {
    title: `同時刻 ${34 - i}`,
    titleJa: `同時刻 ${34 - i}`,
    source: sameFeed.name,
    feedId: sameFeed.id,
    fetchedAt: sameTime,
  }),
);
await db.insert(schema.articles).values(sameTimeArticles);
// Switching the list beside an open article (e2e/panes.spec.ts).
const switchArticles = [
  ...[1, 2].map((j) =>
    article(1250 + j, { title: `切り替え前 ${j}`, titleJa: `切り替え前 ${j}`, source: beforeFeed.name, feedId: beforeFeed.id, fetchedAt: old(1250 + j) }),
  ),
  ...[1, 2, 3].map((j) =>
    article(1260 + j, { title: `切り替え後 ${j}`, titleJa: `切り替え後 ${j}`, source: afterFeed.name, feedId: afterFeed.id, fetchedAt: old(1260 + j) }),
  ),
];
await db.insert(schema.articles).values(switchArticles);

// Press feedback (e2e/press.spec.ts): articles that tests mark read, in their own folder.
const [pressFolder] = await db.insert(schema.folders).values({ name: "E2E 押した感", position: 60 }).returning();
const [pressFeed] = await db.insert(schema.feeds).values(feed("press", "E2E 押した感のサイト", pressFolder.id)).returning();
// 押した感 5 starts read, for 未読に戻す. "E2E 次が取れない" has one article, so reading it beside
// the list asks the server for the next one.
const [lonelyFolder] = await db.insert(schema.folders).values({ name: "E2E 次が取れない", position: 61 }).returning();
const [lonelyFeed] = await db.insert(schema.feeds).values(feed("lonely", "E2E 次が取れないサイト", lonelyFolder.id)).returning();
const pressArticles = [
  ...[1, 2, 3, 4, 5].map((j) =>
    article(1300 + j, {
      title: `押した感 ${j}`,
      titleJa: `押した感 ${j}`,
      source: pressFeed.name,
      feedId: pressFeed.id,
      fetchedAt: old(1300 + j),
      ...(j === 5 ? { status: "read" as const, readAt: new Date(now) } : {}),
    }),
  ),
  article(1310, { title: "次が取れない記事", titleJa: "次が取れない記事", source: lonelyFeed.name, feedId: lonelyFeed.id, fetchedAt: old(1310) }),
];
await db.insert(schema.articles).values(pressArticles);

// Cards leaving the list, and 「元に戻す」 (e2e/leave.spec.ts): one folder per test.
const leaveFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E 一覧でスキップ", "E2E スマホで読了して戻す", "E2E スマホでスキップして戻す", "E2E PC で読了して戻す", "E2E 動きを減らして抜ける", "E2E スキップに失敗", "E2E 読了して履歴を遡る", "E2E 直接開いて読了", "E2E 元に戻すに失敗", "E2E 続けてスキップ", "E2E 一覧待ちで読了", "E2E 一覧待ちでスキップ", "E2E 一覧待ちのキー", "E2E 一覧待ちで失敗", "E2E 一覧待ちの横向き", "E2E 一覧が届かない"].map(
      (name, i) => ({ name, position: 70 + i }),
    ),
  )
  .returning();
const leaveFeeds = await db
  .insert(schema.feeds)
  .values(leaveFolders.map((f, i) => feed(`leave-${i}`, `${f.name}のサイト`, f.id)))
  .returning();
const leaveArticles = leaveFeeds.flatMap((f, i) =>
  [1, 2, 3].map((j) =>
    article(1400 + i * 10 + j, {
      title: `${leaveFolders[i].name} ${j}`,
      titleJa: `${leaveFolders[i].name} ${j}`,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(1400 + i * 10 + j),
    }),
  ),
);
await db.insert(schema.articles).values(leaveArticles);

// 既読 (e2e/seen.spec.ts): one folder per test, with two sites. Each folder has 3 unread articles,
// one seen, one skipped and one read.
const seenFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E PC ですべて既読", "E2E スマホですべて既読", "E2E フォルダをすべて既読", "E2E すべて既読に失敗", "E2E 既読を見返す", "E2E スマホで見返す", "E2E 未読に戻すに失敗", "E2E 開いて戻る", "E2E スマホで開いて戻る", "E2E 読了を戻す", "E2E 開いた記事を戻す", "E2E 先読み"].map(
      (name, i) => ({ name, position: 90 + i }),
    ),
  )
  .returning();
const seenFeeds = await db
  .insert(schema.feeds)
  .values(
    seenFolders.flatMap((f, i) => [
      feed(`seen-${i}-a`, `${f.name} A`, f.id),
      feed(`seen-${i}-b`, `${f.name} B`, f.id),
    ]),
  )
  .returning();
const seenArticles = seenFolders.flatMap((f, i) => {
  const [a, b] = [seenFeeds[i * 2], seenFeeds[i * 2 + 1]];
  const row = (n: number, title: string, site: typeof a, extra = {}) =>
    article(1600 + i * 10 + n, {
      title,
      titleJa: title,
      source: site.name,
      feedId: site.id,
      fetchedAt: old(1600 + i * 10 + n),
      ...extra,
    });
  return [
    row(1, `${f.name} A1`, a),
    row(2, `${f.name} A2`, a),
    row(3, `${f.name} B1`, b),
    row(4, `${f.name} 既読`, b, { seenAt: new Date(now) }),
    row(5, `${f.name} スキップ`, b, { status: "skipped" as const }),
    row(6, `${f.name} 読了`, b, { status: "read" as const, readAt: new Date(now) }),
  ];
});
await db.insert(schema.articles).values(seenArticles);

// The Board (e2e/board.spec.ts): one folder per test that changes state.
const boardFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E ボード", "E2E ボードで開く", "E2E ボードで既読", "E2E ボードで失敗", "E2E ボードのスマホ", "E2E ボードから読了", "E2E ボードから戻す", "E2E 遅い一覧", "E2E 最後の未読", "E2E ファビコン", "E2E 五十本を越える", "E2E 止まりだけ"].map(
      (name, i) => ({ name, position: 110 + i }),
    ),
  )
  .returning();
const [boardShow, boardOpen, boardSeen, boardFail, boardPhone, boardRead, boardBack, boardSlow, boardLast, boardIcons, boardOver, boardStopped] = boardFolders;
const boardFeeds = await db
  .insert(schema.feeds)
  .values([
    feed("board-many", "E2E 列 たくさん", boardShow.id),
    { ...feed("board-few", "E2E 列 少ない", boardShow.id), lastFetchedAt: new Date(now - 12 * 60_000) },
    feed("board-none", "E2E 列 未読なし", boardShow.id),
    // Other columns must not see these: the articles stay behind 止まっているフィード.
    { ...feed("board-paused", "E2E 列 止めた", boardShow.id), enabled: false },
    // On a closed port, so 「今すぐ取得」 keeps its error.
    { ...feed("board-error", "E2E 列 エラー", boardShow.id), url: "http://localhost:9/e2e/feeds/board-error", lastError: "fetch failed" },
    feed("board-open-a", "E2E 開く A", boardOpen.id),
    feed("board-open-b", "E2E 開く B", boardOpen.id),
    feed("board-seen-a", "E2E 既読 A", boardSeen.id),
    feed("board-seen-b", "E2E 既読 B", boardSeen.id),
    feed("board-fail", "E2E 失敗の列", boardFail.id),
    feed("board-phone", "E2E スマホの列", boardPhone.id),
    feed("board-read", "E2E 読了の列", boardRead.id),
    feed("board-back", "E2E 戻す列", boardBack.id),
    feed("board-slow-a", "E2E 遅い A", boardSlow.id),
    feed("board-slow-b", "E2E 遅い B", boardSlow.id),
    feed("board-last", "E2E 1 本の列", boardLast.id),
    feed("board-below", "E2E 下の列", boardLast.id),
    feed("board-icon-good", "E2E 画像あり", boardIcons.id),
    feed("board-icon-404", "E2E 画像 404", boardIcons.id),
    feed("board-icon-empty", "E2E 画像 空", boardIcons.id),
    feed("board-icon-hang", "E2E 画像 無応答", boardIcons.id),
    feed("board-over", "E2E 五十二本", boardOver.id),
    { ...feed("board-only-stopped", "E2E 止まりの列", boardStopped.id), enabled: false },
    // Beside 「URL から追加」 in 未分類: its 「すべて既読」 must leave this feed alone.
    { ...feed("board-unfiled", "E2E 未分類の列", boardShow.id), folderId: null },
  ])
  .returning();
const feedNamed = (name: string) => boardFeeds.find((f) => f.name === name)!;
let boardN = 2000;
const boardRows = (name: string, count: number, extra = {}) =>
  Array.from({ length: count }, (_, i) =>
    article(boardN++, {
      title: `${name} ${i + 1}`,
      titleJa: `${name} ${i + 1}`,
      source: name,
      feedId: feedNamed(name).id,
      fetchedAt: old(2000 + boardN),
      ...extra,
    }),
  );
const boardArticles = [
  ...boardRows("E2E 列 たくさん", 55),
  ...boardRows("E2E 列 少ない", 2, { lang: "other", title: "A short column", titleJa: null }).map((a, i) => ({
    ...a,
    title: `A short column ${i + 1}`,
    titleJa: `E2E 列 少ない ${i + 1}`,
  })),
  ...boardRows("E2E 列 未読なし", 1, { seenAt: new Date(now) }),
  ...boardRows("E2E 列 止めた", 1),
  ...boardRows("E2E 列 エラー", 1),
  ...boardRows("E2E 開く A", 3),
  ...boardRows("E2E 開く B", 2),
  ...boardRows("E2E 既読 A", 2),
  ...boardRows("E2E 既読 B", 2),
  ...boardRows("E2E 失敗の列", 2),
  ...boardRows("E2E スマホの列", 5),
  ...boardRows("E2E 読了の列", 2),
  ...boardRows("E2E 戻す列", 2),
  ...boardRows("E2E 未分類の列", 1),
  ...boardRows("E2E 遅い A", 52),
  ...boardRows("E2E 遅い B", 2),
  ...boardRows("E2E 1 本の列", 1),
  ...boardRows("E2E 下の列", 3),
  // What the favicon service answers depends on the host (e2e/stub.mts).
  ...[
    ["E2E 画像あり", "good.example"],
    ["E2E 画像 404", "notfound.example"],
    ["E2E 画像 空", "empty.example"],
    ["E2E 画像 無応答", "hang.example"],
  ].flatMap(([name, host]) => boardRows(name, 1).map((a) => ({ ...a, url: `https://${host}/e2e/${a.title}` }))),
  ...boardRows("E2E 五十二本", 52),
  ...boardRows("E2E 止まりの列", 1),
];
const boardInserted = await db.insert(schema.articles).values(boardArticles).returning();
const boardTalked = boardInserted.find((a) => a.titleJa === "E2E 列 少ない 2")!;
await db.insert(schema.messages).values({ articleId: boardTalked.id, role: "user", content: "列の対話です" });

console.log(
  `seeded ${inserted.length + 1 + filterArticles.length + paneArticles.length + scrollArticles.length + pauseArticles.length + pastArticles.length + sameTimeArticles.length + switchArticles.length + pressArticles.length + leaveArticles.length + seenArticles.length + boardArticles.length} articles into ${dir}`,
);
