// Builds a fresh database for the E2E tests. No AI or network calls are needed:
// every article already has its digest, and one has a saved conversation.
import { mkdirSync, rmSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/lib/db/schema";
import { DIGEST_ATTEMPT_LIMIT, pickDay } from "../src/lib/format";

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
    // e2e/digest.spec.ts: a reply cut off by the length limit. Read, so it stays off the Board.
    article(138, { title: "対話が切れる記事", titleJa: "対話が切れる記事", status: "read", readAt: new Date(now) }),
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
    feed("move-keys", "E2E キーで移動するフィード", tech.id),
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
// Articles the AI refused to summarize (e2e/digest.spec.ts).
const [refusedFolder] = await db.insert(schema.folders).values({ name: "E2E 要約できない", position: 65 }).returning();
const [refusedFeed] = await db.insert(schema.feeds).values(feed("refused", "E2E 要約できないサイト", refusedFolder.id)).returning();
// A first row on the Board with its digest still to come (e2e/board.spec.ts): in a folder of its
// own, as openFeed takes the refused folder's only column.
const [pendingFolder] = await db.insert(schema.folders).values({ name: "E2E 要約まだ", position: 66 }).returning();
const [pendingFeed] = await db.insert(schema.feeds).values(feed("pending", "E2E 要約まだのサイト", pendingFolder.id)).returning();
const biz = inserted.find((a) => a.title === "ビジネスの記事")!;
await db.update(schema.articles).set({ source: flash.name, feedId: flash.id }).where(eq(schema.articles.id, biz.id));
// Older than the articles above so they stay out of the first page of すべて.
const old = (i: number) => new Date(now - 86_400_000 - i * 60_000);
const filterArticles = [
  article(10, {
    title: "要約を断られた記事",
    lang: null,
    summary: null,
    excerpt: "要約を断られた記事の RSS の概要です。",
    digestAttempts: DIGEST_ATTEMPT_LIMIT,
    digestError: "refused",
    source: refusedFeed.name,
    feedId: refusedFeed.id,
    fetchedAt: old(90),
  }),
  // The same for the phone test: opening an article marks it seen, so each screen has its own.
  article(11, {
    title: "スマホで開く断られた記事",
    lang: null,
    summary: null,
    excerpt: "スマホで開く断られた記事の RSS の概要です。",
    digestAttempts: DIGEST_ATTEMPT_LIMIT,
    digestError: "refused",
    source: refusedFeed.name,
    feedId: refusedFeed.id,
    fetchedAt: old(91),
  }),
  // The Board's: newest of the column, so its first row whichever of the above was opened.
  article(12, {
    title: "ボードで断られた記事",
    lang: null,
    summary: null,
    excerpt: "ボードで断られた記事の RSS の概要です。",
    digestAttempts: DIGEST_ATTEMPT_LIMIT,
    digestError: "refused",
    source: refusedFeed.name,
    feedId: refusedFeed.id,
    fetchedAt: old(89),
  }),
  // One try short of giving up: still to come. Tried "later", so that no run of the suite (a
  // fetch digests what is missing, and the stub of digest.spec.ts fails) uses up the last try.
  article(13, {
    title: "ボードで要約まだの記事",
    lang: null,
    summary: null,
    excerpt: "ボードで要約まだの記事の RSS の概要です。",
    digestAttempts: DIGEST_ATTEMPT_LIMIT - 1,
    digestTriedAt: new Date(now + 7 * 86_400_000),
    source: pendingFeed.name,
    feedId: pendingFeed.id,
    fetchedAt: old(92),
  }),
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

// Cards leaving the list, and 「元に戻す」 (e2e/leave.spec.ts): one folder per test. At most 30
// folders: their ids (1400 + i * 10 + j) end before the 既読 block at 1700.
const leaveFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E 一覧でスキップ", "E2E スマホで読了して戻す", "E2E スマホでスキップして戻す", "E2E PC で読了して戻す", "E2E 動きを減らして抜ける", "E2E スキップに失敗", "E2E 読了して履歴を遡る", "E2E 直接開いて読了", "E2E 元に戻すに失敗", "E2E 続けてスキップ", "E2E 一覧待ちで読了", "E2E 一覧待ちでスキップ", "E2E 一覧待ちのキー", "E2E 一覧待ちで失敗", "E2E 一覧待ちの横向き", "E2E 一覧が届かない", "E2E 読了の保存中に戻る", "E2E スキップの保存中に戻る", "E2E 保存に失敗して戻る", "E2E 未読に戻すの保存中に戻る", "E2E 未読に戻すに失敗して戻る", "E2E スマホでオフラインのまま開き直す", "E2E スマホで戻るとすぐ一覧", "E2E 読了の保存中にカードを押す", "E2E スキップの保存中にカードを押す", "E2E 読了に失敗してカードを押す", "E2E 未読に戻すの保存中にカードを押す", "E2E 未読に戻すに失敗してカードを押す", "E2E 読了の保存中に k", "E2E 押したカードが遅れて届く"].map(
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

// 既読 (e2e/seen.spec.ts): one folder per test, with two sites. Ids start at 1700, after the
// leave folders' 1400 + i * 10 + j. Each folder has 3 unread articles,
// one seen, one skipped and one read.
const seenFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E PC ですべて既読", "E2E スマホですべて既読", "E2E フォルダをすべて既読", "E2E すべて既読に失敗", "E2E 既読を見返す", "E2E スマホで見返す", "E2E 未読に戻すに失敗", "E2E 開いて戻る", "E2E スマホで開いて戻る", "E2E 読了を戻す", "E2E 開いた記事を戻す", "E2E 先読み", "E2E 届く瞬間の j", "E2E PC で読了を戻す", "E2E カードの高さ", "E2E 未読に戻すの幅", "E2E 開いてフルロード", "E2E 開いたままリロード", "E2E 既読をスキップして戻す"].map(
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
// The seen card of these folders has everything a card's last row can show: a two-digit reading
// time, 日本語で読める and (with the messages below) 対話中.
const crowdedFolders = ["E2E カードの高さ", "E2E 未読に戻すの幅"];
const crowdedRow = { title: "A crowded seen card", lang: "other", charCount: 9000 };
const seenArticles = seenFolders.flatMap((f, i) => {
  const [a, b] = [seenFeeds[i * 2], seenFeeds[i * 2 + 1]];
  const row = (n: number, title: string, site: typeof a, extra = {}) =>
    article(1700 + i * 10 + n, {
      title,
      titleJa: title,
      source: site.name,
      feedId: site.id,
      fetchedAt: old(1700 + i * 10 + n),
      ...extra,
    });
  return [
    row(1, `${f.name} A1`, a),
    row(2, `${f.name} A2`, a),
    row(3, `${f.name} B1`, b),
    row(4, `${f.name} 既読`, b, { seenAt: new Date(now), ...(crowdedFolders.includes(f.name) ? crowdedRow : {}) }),
    row(5, `${f.name} スキップ`, b, { status: "skipped" as const }),
    row(6, `${f.name} 読了`, b, { status: "read" as const, readAt: new Date(now) }),
  ];
});
const seenInserted = await db
  .insert(schema.articles)
  .values(seenArticles)
  .returning({ id: schema.articles.id, titleJa: schema.articles.titleJa });
await db.insert(schema.messages).values(
  seenInserted
    .filter((r) => crowdedFolders.some((f) => r.titleJa === `${f} 既読`))
    .map((r) => ({ articleId: r.id, role: "user" as const, content: "カードの対話です" })),
);

// 「すべて既読」's 「元に戻す」 (e2e/seen.spec.ts): one folder per test with site A of two unread
// articles and, where the test needs it, a seen one. The folder tests have site B with one more.
// Few rows: every unread one is on the Board at `/`.
const undoSeenFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E PC で既読を戻す", "E2E スマホで既読を戻す", "E2E フォルダの既読を戻す", "E2E 開いたまま既読を戻す", "E2E 既読の取消に失敗", "E2E 表示後の新着", "E2E 列のあとでフォルダを戻す"].map(
      (name, i) => ({ name, position: 109 + i }),
    ),
  )
  .returning();
const undoSeenSites = undoSeenFolders.flatMap((f, i) => [
  { folder: f, site: "A", slug: `undo-seen-${i}-a`, titles: ["A1", "A2", ...(i < 3 ? ["既読"] : [])] },
  ...(["E2E フォルダの既読を戻す", "E2E 列のあとでフォルダを戻す"].includes(f.name)
    ? [{ folder: f, site: "B", slug: `undo-seen-${i}-b`, titles: ["B1"] }]
    : []),
]);
const undoSeenFeeds = await db
  .insert(schema.feeds)
  .values(undoSeenSites.map((s) => feed(s.slug, `${s.folder.name} ${s.site}`, s.folder.id)))
  .returning();
const undoSeenArticles = undoSeenFeeds.flatMap((f, i) =>
  undoSeenSites[i].titles.map((t, j) => {
    const n = 1950 + i * 5 + j;
    const title = `${undoSeenSites[i].folder.name} ${t}`;
    return article(n, {
      title,
      titleJa: title,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(n),
      ...(t === "既読" ? { seenAt: new Date(now) } : {}),
    });
  }),
);
await db.insert(schema.articles).values(undoSeenArticles);

// A full load of a page other than the list starts the faded rows again (e2e/seen.spec.ts, #112):
// one folder per test with site A of two unread articles; 直接開いて戻す has a third, opened
// next after 読了.
const freshFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E 記事を直接開く", "E2E 古い since で直接開く", "E2E 直接開いてから開く", "E2E スマホで直接開く", "E2E フィードを挟む", "E2E 一覧の URL を開く", "E2E 直接開いて戻す", "E2E 既読を含むで戻す"].map(
      (name, i) => ({ name, position: 162 + i }),
    ),
  )
  .returning();
const freshFeeds = await db
  .insert(schema.feeds)
  .values(freshFolders.map((f, i) => feed(`fresh-${i}-a`, `${f.name} A`, f.id)))
  .returning();
const freshArticles = freshFeeds.flatMap((f, i) =>
  (freshFolders[i].name === "E2E 直接開いて戻す" ? ["A1", "A2", "A3"] : ["A1", "A2"]).map((t, j) => {
    const n = 2800 + i * 10 + j;
    const title = `${freshFolders[i].name} ${t}`;
    return article(n, { title, titleJa: title, source: f.name, feedId: f.id, fetchedAt: old(n) });
  }),
);
await db.insert(schema.articles).values(freshArticles);

// The Board (e2e/board.spec.ts): one folder per test that changes state.
const boardFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E ボード", "E2E ボードで開く", "E2E ボードで既読", "E2E ボードで失敗", "E2E ボードのスマホ", "E2E ボードから読了", "E2E ボードから戻す", "E2E 遅い一覧", "E2E 最後の未読", "E2E ファビコン", "E2E 五十本を越える", "E2E 止まりだけ", "E2E 横向きで戻る", "E2E 三本だけ", "E2E 横向きで四本目", "E2E 列の先読み", "E2E 別の窓"].map(
      (name, i) => ({ name, position: 110 + i }),
    ),
  )
  .returning();
const [boardShow, boardOpen, boardSeen, boardFail, boardPhone, boardRead, boardBack, boardSlow, boardLast, boardIcons, boardOver, boardStopped, boardSide, boardThree, boardFourth, boardPrefetch, boardOtherWindow] = boardFolders;
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
    feed("board-side", "E2E 横向きで開く", boardSide.id),
    feed("board-widen", "E2E 広げて一覧", boardSide.id),
    feed("board-beside", "E2E 横並びで開く", boardSide.id),
    feed("board-three", "E2E 三本の列", boardThree.id),
    feed("board-fourth", "E2E 四本目の列", boardFourth.id),
    feed("board-prefetch", "E2E 先読みの列", boardPrefetch.id),
    feed("board-other-window", "E2E 別の窓の列", boardOtherWindow.id),
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
  ...boardRows("E2E 横向きで開く", 2),
  ...boardRows("E2E 広げて一覧", 2),
  ...boardRows("E2E 横並びで開く", 2),
  ...boardRows("E2E 三本の列", 6),
  ...boardRows("E2E 四本目の列", 5),
  // Enough to scroll the column by a screen at 1440×900, which marks the rows passed as seen.
  ...boardRows("E2E 先読みの列", 20),
  ...boardRows("E2E 別の窓の列", 6),
];
const boardInserted = await db.insert(schema.articles).values(boardArticles).returning();
const boardTalked = boardInserted.find((a) => a.titleJa === "E2E 列 少ない 2")!;
await db.insert(schema.messages).values({ articleId: boardTalked.id, role: "user", content: "列の対話です" });

// The activity log (e2e/activity.spec.ts): one folder per test that reads or skips, each with 3
// unread articles and a read one, for the 読了 screen.
const activityFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E 記録 ボード", "E2E 記録 スマホ", "E2E 記録 横向き", "E2E 記録 次へ", "E2E 記録 遮断", "E2E 記録 500"].map(
      (name, i) => ({ name, position: 130 + i }),
    ),
  )
  .returning();
const activityFeeds = await db
  .insert(schema.feeds)
  .values(activityFolders.map((f, i) => feed(`activity-${i}`, `${f.name}のサイト`, f.id)))
  .returning();
const activityArticles = activityFeeds.flatMap((f, i) =>
  [1, 2, 3, 4].map((j) =>
    article(3000 + i * 10 + j, {
      title: `${activityFolders[i].name} ${j}`,
      titleJa: `${activityFolders[i].name} ${j}`,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(3000 + i * 10 + j),
      ...(j === 4 ? { status: "read" as const, readAt: new Date(now) } : {}),
    }),
  ),
);
await db.insert(schema.articles).values(activityArticles);

// Time and scroll on an article (e2e/reading.spec.ts): one folder per test, each with 3 unread
// articles whose body is long enough to scroll.
const readingFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E 滞在 時間", "E2E 滞在 隠す", "E2E 滞在 PC", "E2E 滞在 スマホ", "E2E 滞在 次へ", "E2E 滞在 遮断"].map(
      (name, i) => ({ name, position: 140 + i }),
    ),
  )
  .returning();
const readingFeeds = await db
  .insert(schema.feeds)
  .values(readingFolders.map((f, i) => feed(`reading-${i}`, `${f.name}のサイト`, f.id)))
  .returning();
const readingArticles = readingFeeds.flatMap((f, i) =>
  [1, 2, 3].map((j) =>
    article(3100 + i * 10 + j, {
      title: `${readingFolders[i].name} ${j}`,
      titleJa: `${readingFolders[i].name} ${j}`,
      source: f.name,
      feedId: f.id,
      contentHtml: longBody,
      fetchedAt: old(3100 + i * 10 + j),
    }),
  ),
);
await db.insert(schema.articles).values(readingArticles);

// The owner's actions in the activity log (e2e/actions.spec.ts): one folder per test, each with
// sites A and B. A has 4 unread articles, a read one and a seen one; B has 2 unread.
const actionFolders = await db
  .insert(schema.folders)
  .values(
    [
      "E2E 操作 記事",
      "E2E 操作 カード",
      "E2E 操作 スマホ",
      "E2E 操作 ボード",
      "E2E 操作 一覧",
      "E2E 操作 AI",
      "E2E 操作 失敗",
      "E2E 操作 遮断",
      "E2E 操作 既読を戻す",
      "E2E 操作 一覧で既読を戻す",
      "E2E 操作 既読の取消に失敗",
    ].map((name, i) => ({ name, position: 150 + i })),
  )
  .returning();
const actionFeeds = await db
  .insert(schema.feeds)
  .values(actionFolders.flatMap((f, i) => ["A", "B"].map((s) => feed(`action-${i}-${s}`, `${f.name} ${s}`, f.id))))
  .returning();
const actionArticles = actionFeeds.flatMap((f, i) =>
  (f.name.endsWith(" A") ? ["1", "2", "3", "4", " 読了", " 既読"] : ["1", "2"]).map((suffix, j) => {
    const n = 3200 + i * 10 + j;
    return article(n, {
      title: `${f.name}${suffix}`,
      titleJa: `${f.name}${suffix}`,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(n),
      ...(suffix === " 読了" ? { status: "read" as const, readAt: new Date(now) } : {}),
      ...(suffix === " 既読" ? { seenAt: new Date(now) } : {}),
    });
  }),
);
await db.insert(schema.articles).values(actionArticles);

// Seen by scrolling (e2e/scroll-seen.spec.ts): one folder per test, each with site A of 14 short
// articles (25 where a Board column must scroll). Some have a site B beside it, and two
// (位置, 続き) have more than a page of the list.
const skimFolders = await db
  .insert(schema.folders)
  .values(
    [
      "E2E 流し読み スマホ",
      "E2E 流し読み 失敗",
      "E2E 流し読み 取消失敗",
      "E2E 流し読み 列",
      "E2E 流し読み フォルダ",
      "E2E 流し読み 横向き",
      "E2E 流し読み 開く",
      "E2E 流し読み 位置",
      "E2E 流し読み ボードへ",
      "E2E 流し読み 対象外",
      "E2E 流し読み PC 一覧",
      "E2E 流し読み 続き",
      "E2E 流し読み 保存中",
    ].map((name, i) => ({ name, position: 170 + i })),
  )
  .returning();
const skimSites = skimFolders.flatMap((f, i) => [
  // 14 scroll a phone or a pane; a column on a PC takes 25. Kept low: every row is on the Board at `/`.
  { folder: f, site: "A", slug: `skim-${i}-a`, count: /位置|続き/.test(f.name) ? 32 : /列|フォルダ/.test(f.name) ? 25 : 14 },
  ...(/列|フォルダ/.test(f.name) ? [{ folder: f, site: "B", slug: `skim-${i}-b`, count: 3 }] : []),
]);
const skimFeeds = await db
  .insert(schema.feeds)
  .values(skimSites.map((s) => feed(s.slug, `${s.folder.name} ${s.site}`, s.folder.id)))
  .returning();
const skimArticles = skimFeeds.flatMap((f, i) =>
  Array.from({ length: skimSites[i].count }, (_, j) => {
    const n = 4000 + i * 100 + j;
    return article(n, { title: `${f.name} ${j + 1}`, titleJa: `${f.name} ${j + 1}`, source: f.name, feedId: f.id, fetchedAt: old(n) });
  }),
);
await db.insert(schema.articles).values(skimArticles);

// The article sheet over the Board on PCs (e2e/panes.spec.ts): one folder per test. The last
// folders, so that the Board at `/` scrolls sideways to reach them. シート A has enough rows to
// scroll its column; 五十二本 runs past a column's 50.
const sheetFolders = await db
  .insert(schema.folders)
  .values(
    ["E2E シート", "E2E シートで j", "E2E シートで読了", "E2E シートを直接", "E2E シートで入力", "E2E シートへ広げる", "E2E シートでキー"].map((name, i) => ({
      name,
      position: 190 + i,
    })),
  )
  .returning();
const sheetSites: { folder: number; name: string; count: number; long?: boolean; firstRead?: boolean }[] = [
  { folder: 0, name: "E2E シート A", count: 20 },
  { folder: 0, name: "E2E シート B", count: 2 },
  { folder: 1, name: "E2E シート 三本", count: 3 },
  { folder: 1, name: "E2E シート 隣", count: 2 },
  { folder: 1, name: "E2E シート 五十二本", count: 52 },
  { folder: 2, name: "E2E シート 読了", count: 2 },
  { folder: 3, name: "E2E シート 直接", count: 2 },
  { folder: 4, name: "E2E シート 入力", count: 1 },
  // e2e/board.spec.ts: opened on a phone, then widened to a PC.
  { folder: 5, name: "E2E 広げてシート", count: 2 },
  // e2e/panes.spec.ts: keys go to the article, not the column behind it. A column that scrolls,
  // and bodies long enough to scroll the article.
  { folder: 6, name: "E2E シート キー", count: 20, long: true },
  // e2e/panes.spec.ts: j past the end of a column. The newest row is read, and made unread again
  // once the column has loaded.
  { folder: 1, name: "E2E シート 新着", count: 3, firstRead: true },
];
const sheetFeeds = await db
  .insert(schema.feeds)
  .values(sheetSites.map((s, i) => feed(`sheet-${i}`, s.name, sheetFolders[s.folder].id)))
  .returning();
const sheetArticles = sheetFeeds.flatMap((f, i) =>
  Array.from({ length: sheetSites[i].count }, (_, j) => {
    const n = 6000 + i * 100 + j;
    const body = sheetSites[i].long ? { contentHtml: `<p>記事 ${n} の長い本文です。段落を重ねています。</p>`.repeat(80) } : {};
    const read = sheetSites[i].firstRead && j === 0 ? { status: "read" as const, readAt: new Date(now), seenAt: new Date(now) } : {};
    return article(n, { title: `${f.name} ${j + 1}`, titleJa: `${f.name} ${j + 1}`, source: f.name, feedId: f.id, fetchedAt: old(n), ...body, ...read });
  }),
);
await db.insert(schema.articles).values(sheetArticles);

// An article the list does not show, opened from its URL (e2e/leave.spec.ts): 30 rows that fill
// the feed's list, then pairs that tests open and read. The oldest in the seed, so in すべて too
// each row is followed by the next. A row of another feed in the folder sits between 39 and 40.
const [unlistedFolder] = await db.insert(schema.folders).values({ name: "E2E 載っていない記事", position: 200 }).returning();
const [unlistedFeed, unlistedOther] = await db
  .insert(schema.feeds)
  .values([
    feed("unlisted", "E2E 載っていないサイト", unlistedFolder.id),
    feed("unlisted-other", "E2E 載っていない別サイト", unlistedFolder.id),
  ])
  .returning();
const unlistedArticles = [
  ...Array.from({ length: 43 }, (_, i) =>
    article(8000 + i, {
      title: `載っていない記事 ${i + 1}`,
      titleJa: `載っていない記事 ${i + 1}`,
      source: unlistedFeed.name,
      feedId: unlistedFeed.id,
      // Leaves room after 39 (i = 38) for the other feed's row.
      fetchedAt: old(8000 + i * 2),
    }),
  ),
  article(8100, {
    title: "載っていない別サイトの記事",
    titleJa: "載っていない別サイトの記事",
    source: unlistedOther.name,
    feedId: unlistedOther.id,
    fetchedAt: old(8000 + 38 * 2 + 1),
  }),
  // For j (e2e/leave.spec.ts): rows between 30 and 31, so the feed's list does not show them and
  // the rows above stay as they are. Pairs that tests open with j, the other feed's row between
  // the filtered ones; j 7 to j 10 for j past an article already opened past the list (#164).
  ...(
    [
      ["j 1", unlistedFeed],
      ["j 2", unlistedFeed],
      ["j 3", unlistedFeed],
      ["j と j の間 1", unlistedOther],
      ["j 4", unlistedFeed],
      ["j 5", unlistedFeed],
      ["j と j の間 2", unlistedOther],
      ["j 6", unlistedFeed],
      ["j 7", unlistedFeed],
      ["j 8", unlistedFeed],
      ["j 9", unlistedFeed],
      ["j 10", unlistedFeed],
    ] as const
  ).map(([name, f], i) =>
    article(8200 + i, {
      title: `載っていない記事 ${name}`,
      titleJa: `載っていない記事 ${name}`,
      source: f.name,
      feedId: f.id,
      fetchedAt: old(8000 + 29 * 2 + (i + 1) * 0.15),
    }),
  ),
];
await db.insert(schema.articles).values(unlistedArticles);

// The timeline (e2e/timeline.spec.ts): one folder per test that changes state, each with sites A
// and B. A feed's articles were fetched in one go, A after B, but came out in turns: "<folder> 1"
// is the newest published (A), "<folder> 2" the next (B), and so on. In `E2E 時系列`, a B article
// dated a day ahead was fetched between 6 and 7, and a paused feed has the newest unread of all.
const timelineFolders = await db
  .insert(schema.folders)
  .values(
    [
      "E2E 時系列",
      "E2E 時系列の続き",
      "E2E 時系列で開く",
      "E2E 時系列から閉じる",
      "E2E 時系列のスマホ",
      "E2E 時系列と別のタブ",
      "E2E 時系列でスキップ失敗",
      "E2E 時系列の記録",
      "E2E 時系列から新着",
    ].map((name, i) => ({ name, position: 210 + i })),
  )
  .returning();
// More than a page of the list (30) in the first two; the phone's scrolls.
const timelineCounts = [34, 32, 4, 4, 16, 4, 4, 4, 2];
const timelineFeeds = await db
  .insert(schema.feeds)
  .values(timelineFolders.flatMap((f, i) => ["A", "B"].map((s) => feed(`timeline-${i}-${s}`, `${f.name} ${s}`, f.id))))
  .returning();
const [timelineStopped] = await db
  .insert(schema.feeds)
  .values({ ...feed("timeline-paused", "E2E 時系列 止めた", timelineFolders[0].id), enabled: false })
  .returning();
const fetchedA = old(9000);
const fetchedB = old(9010);
const publishedFrom = old(9100).getTime();
let timelineN = 9000;
const timelineArticles = timelineFolders.flatMap((f, i) => {
  const [a, b] = timelineFeeds.filter((x) => x.folderId === f.id);
  return Array.from({ length: timelineCounts[i] }, (_, k) =>
    article(timelineN++, {
      title: `${f.name} ${k + 1}`,
      titleJa: `${f.name} ${k + 1}`,
      source: (k % 2 === 0 ? a : b).name,
      feedId: (k % 2 === 0 ? a : b).id,
      ...(i === 4 ? { contentHtml: longBody } : {}),
      fetchedAt: k % 2 === 0 ? fetchedA : fetchedB,
      publishedAt: new Date(publishedFrom - k * 60_000),
    }),
  );
});
const timelineB = timelineFeeds[1];
timelineArticles.push(
  article(timelineN++, {
    title: "E2E 時系列 未来",
    titleJa: "E2E 時系列 未来",
    source: timelineB.name,
    feedId: timelineB.id,
    fetchedAt: new Date(publishedFrom - 5.5 * 60_000),
    publishedAt: new Date(now + 86_400_000),
  }),
  article(timelineN++, {
    title: "E2E 時系列 止めた 1",
    titleJa: "E2E 時系列 止めた 1",
    source: timelineStopped.name,
    feedId: timelineStopped.id,
    fetchedAt: fetchedA,
    publishedAt: new Date(publishedFrom + 60_000),
  }),
);
await db.insert(schema.articles).values(timelineArticles);

// 「今朝の 5 本」 (e2e/picks.spec.ts): a feed of its own whose 5 articles are the picks of the pick
// day the seed is made in and of the next one, so a run that passes 6:00 JST still finds them.
// No other test opens them. Each test that opens one opens its own row (see the spec).
const [picksFolder, candidateFolder] = await db
  .insert(schema.folders)
  .values(["E2E 今朝のフォルダ", "E2E ピック候補"].map((name, i) => ({ name, position: 230 + i })))
  .returning();
const [picksFeed, candidateFeed] = await db
  .insert(schema.feeds)
  .values([feed("picks", "E2E 今朝のサイト", picksFolder.id), feed("pick-candidates", "E2E ピック候補のサイト", candidateFolder.id)])
  .returning();
const pickTitles = ["今朝の 1 本目", "今朝の 2 本目", "今朝の 3 本目", "今朝の 4 本目", "今朝の 5 本目"];
const pickArticles = await db
  .insert(schema.articles)
  .values(
    pickTitles.map((title, j) =>
      article(9500 + j, {
        // The second is a foreign article, for 英→日.
        ...(j === 1 ? { title: "Second pick of the morning", lang: "other" } : { title }),
        titleJa: title,
        source: picksFeed.name,
        feedId: picksFeed.id,
        charCount: 1200 * (j + 1),
        fetchedAt: old(9500 + j),
      }),
    ),
  )
  .returning({ id: schema.articles.id });
await db.insert(schema.picks).values(
  [pickDay(new Date(now)), pickDay(new Date(now + 86_400_000))].flatMap((day) =>
    pickArticles.map((a, position) => ({ day, position, articleId: a.id, reason: `${pickTitles[position]}を選んだ理由です。` })),
  ),
);
// What the morning's choice is made from (e2e/picks.spec.ts): unread, summarized and fetched within
// the last day, and fetched 20 hours before the seed, so they stay so for the whole run.
const candidateArticles = ["選ぶ候補 A", "選ぶ候補 B"].map((title, j) =>
  article(9600 + j, {
    title,
    titleJa: title,
    summary: `${title}の要約です。`,
    source: candidateFeed.name,
    feedId: candidateFeed.id,
    fetchedAt: new Date(now - 20 * 3600_000 - j * 60_000),
  }),
);
await db.insert(schema.articles).values(candidateArticles);

console.log(
  `seeded ${pickArticles.length + candidateArticles.length + inserted.length + 1 + filterArticles.length + paneArticles.length + scrollArticles.length + pauseArticles.length + pastArticles.length + sameTimeArticles.length + switchArticles.length + pressArticles.length + leaveArticles.length + seenArticles.length + undoSeenArticles.length + freshArticles.length + boardArticles.length + activityArticles.length + readingArticles.length + actionArticles.length + skimArticles.length + sheetArticles.length + unlistedArticles.length + timelineArticles.length} articles into ${dir}`,
);
