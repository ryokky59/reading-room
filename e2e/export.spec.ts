import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "./test";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/lib/db/schema";

// scripts/export-activity.mts, run as a child process against a throwaway PGlite database of its
// own: never the E2E server's (.data/e2e), which the server has open. The script writes into
// .data/exports/ under its working directory, so each test runs it in its own directory.

const root = resolve(__dirname, "..");
const script = join(root, "scripts", "export-activity.mts");

type Rows = { meta: Record<string, unknown>; rows: Record<string, unknown>[] };

/** A fresh, migrated database in a directory of its own; `fill` adds the rows. */
async function makeDb(name: string, fill: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<void>) {
  const work = join(root, ".data", "e2e-export", name);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const dir = join(work, "db");
  const pg = new PGlite(dir);
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: join(root, "drizzle") });
  await fill(db);
  // The script opens the directory itself; two processes must not have it open at once.
  await pg.close();
  return { work, dir };
}

async function run(work: string, dir: string, args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env, PGLITE_DIR: dir };
  delete env.DATABASE_URL;
  const { stdout } = await promisify(execFile)("npx", ["tsx", script, ...args], { cwd: work, env });
  const read = (file: string): Rows => JSON.parse(readFileSync(join(work, ".data", "exports", file), "utf8"));
  return { stdout, read };
}

test("記事・フィードと open / leave / skip / read から 3 つのファイルを書き出す", async () => {
  test.setTimeout(90_000);
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000);
  const ids: Record<string, number> = {};
  const feedIds: Record<string, number> = {};

  const { work, dir } = await makeDb("full", async (db) => {
    const [folder] = await db.insert(schema.folders).values({ name: "書き出しのフォルダ" }).returning();
    const fs = await db
      .insert(schema.feeds)
      .values([
        { name: "サイト A", url: "https://a.example/feed", folderId: folder.id },
        { name: "サイト B", url: "https://b.example/feed", folderId: folder.id },
      ])
      .returning();
    feedIds.A = fs[0].id;
    feedIds.B = fs[1].id;
    const article = (key: string, feed: "A" | "B", a: Partial<typeof schema.articles.$inferInsert> = {}) => ({
      url: `https://${feed.toLowerCase()}.example/${key}`,
      title: `Article ${key}`,
      titleJa: `記事 ${key}`,
      source: `サイト ${feed}`,
      feedId: feedIds[feed],
      charCount: 3000,
      fetchedAt: ago(600),
      ...a,
    });
    const rows = await db
      .insert(schema.articles)
      .values([
        // Opened, left twice, skipped from inside the article.
        article("opened-skipped", "A", { status: "skipped", seenAt: ago(100) }),
        // Skipped from the list without ever being opened.
        article("list-skipped", "A", { status: "skipped" }),
        // Opened, then skipped from the list beside it in the same tab.
        article("opened-list-skipped", "A", { status: "skipped", seenAt: ago(80) }),
        article("read", "A", { status: "read", seenAt: ago(70) }),
        // Opened only on a preview deployment, then skipped from the list in production.
        article("preview", "B", { status: "skipped", seenAt: ago(60) }),
        // Opened a minute before 「すべて既読」 on its site: opening it set its seen_at.
        article("opened-then-seen-all", "B", { seenAt: new Date(now - 30 * 60_000 - 61_000) }),
        // A card skip whose save failed after its toast's 元に戻す, then skipped again 10 s later.
        article("reskipped", "B", { status: "skipped" }),
        // Marked by 「すべて既読」 without being opened.
        article("seen-all", "B", { seenAt: new Date(now - 30 * 60_000 - 2_000) }),
        // Opened long before 「すべて既読」.
        article("opened-b", "B", { seenAt: ago(50) }),
      ])
      .returning({ id: schema.articles.id, url: schema.articles.url });
    for (const r of rows) ids[r.url.split("/").pop()!] = r.id;

    const base = {
      env: "production",
      sessionId: "s1",
      device: "phone",
      layout: "single",
      vw: 390,
      vh: 844,
      standalone: true,
      screen: "article",
    };
    await db.insert(schema.events).values([
      { ...base, createdAt: ago(100), type: "open", articleId: ids["opened-skipped"], source: "list", viewId: "v1" },
      // The later leave is inserted first: the last one by time counts, not by id.
      {
        ...base,
        createdAt: ago(98),
        type: "leave",
        articleId: ids["opened-skipped"],
        viewId: "v1",
        dwellMs: 9000,
        activeMs: 8000,
        scrollPct: 80,
        props: { body_lang: "ja" },
      },
      {
        ...base,
        createdAt: ago(99),
        type: "leave",
        articleId: ids["opened-skipped"],
        viewId: "v1",
        dwellMs: 3000,
        activeMs: 3000,
        scrollPct: 40,
        props: { body_lang: "original" },
      },
      {
        ...base,
        createdAt: ago(98),
        type: "skip",
        articleId: ids["opened-skipped"],
        viewId: "v1",
        props: { via: "button" },
      },
      { ...base, createdAt: ago(90), type: "skip", screen: "list", articleId: ids["list-skipped"], props: { via: "button" } },
      {
        ...base,
        sessionId: "s2",
        device: "pc",
        layout: "split",
        vw: 1440,
        vh: 900,
        standalone: false,
        createdAt: ago(80),
        type: "open",
        articleId: ids["opened-list-skipped"],
        source: "board",
        viewId: "v2",
      },
      {
        ...base,
        sessionId: "s2",
        device: "pc",
        layout: "split",
        vw: 1440,
        vh: 900,
        standalone: false,
        createdAt: ago(79),
        type: "skip",
        screen: "list",
        articleId: ids["opened-list-skipped"],
        props: { via: "button" },
      },
      { ...base, createdAt: ago(70), type: "open", articleId: ids.read, source: "board", viewId: "v3" },
      { ...base, createdAt: ago(69), type: "leave", articleId: ids.read, viewId: "v3", dwellMs: 60_000, activeMs: 50_000, scrollPct: 100, props: { body_lang: "ja" } },
      { ...base, createdAt: ago(69), type: "read", articleId: ids.read, viewId: "v3", props: { via: "button" } },
      { ...base, env: "preview", createdAt: ago(60), type: "open", articleId: ids.preview, source: "list", viewId: "vp" },
      { ...base, env: "preview", createdAt: ago(59), type: "leave", articleId: ids.preview, viewId: "vp", dwellMs: 5000, activeMs: 5000, scrollPct: 50, props: { body_lang: "ja" } },
      { ...base, createdAt: ago(55), type: "skip", screen: "list", articleId: ids.preview, props: { via: "button" } },
      { ...base, createdAt: ago(50), type: "open", articleId: ids["opened-b"], source: "list", viewId: "v4" },
      { ...base, createdAt: ago(40), type: "undo", screen: "list", articleId: ids.reskipped, props: { of: "skip" } },
      {
        ...base,
        createdAt: new Date(now - 40 * 60_000 + 10_000),
        type: "skip",
        screen: "list",
        articleId: ids.reskipped,
        props: { via: "button" },
      },
      {
        ...base,
        createdAt: new Date(now - 30 * 60_000 - 60_000),
        type: "open",
        articleId: ids["opened-then-seen-all"],
        source: "board",
        viewId: "v5",
      },
      { ...base, createdAt: ago(30), type: "seen_all", screen: "board", props: { feedId: feedIds.B } },
      // An undo whose skip never saved.
      { ...base, createdAt: ago(20), type: "undo", screen: "list", articleId: ids["opened-b"], props: { of: "skip" } },
    ]);
  });

  const { stdout, read } = await run(work, dir);
  for (const file of ["views.json", "actions.json", "feeds.json"]) {
    expect(existsSync(join(work, ".data", "exports", file)), file).toBe(true);
  }

  const views = read("views.json").rows;
  const v1 = views.find((v) => v.viewId === "v1")!;
  expect(v1).toMatchObject({
    articleId: ids["opened-skipped"],
    title: "記事 opened-skipped",
    site: "サイト A",
    folder: "書き出しのフォルダ",
    charCount: 3000,
    device: "phone",
    source: "list",
    dwellMs: 9000,
    activeMs: 8000,
    scrollPct: 80,
    bodyLang: "ja",
    leaveRows: 2,
    outcome: "skip",
  });
  // v4 was opened and never left.
  expect(views.find((v) => v.viewId === "v4")).toMatchObject({ dwellMs: null, leaveRows: 0 });
  // Preview rows are left out by default.
  expect(views.map((v) => v.viewId)).not.toContain("vp");

  const actions = read("actions.json").rows;
  // An open on a preview still counts as having opened the article.
  expect(actions.find((a) => a.type === "skip" && a.articleId === ids.preview)).toMatchObject({
    openedBefore: true,
    unopenedSkip: false,
  });
  expect(actions.find((a) => a.type === "skip" && a.articleId === ids["list-skipped"])).toMatchObject({
    unopenedSkip: true,
    viewId: null,
  });
  expect(actions.find((a) => a.type === "skip" && a.articleId === ids["opened-list-skipped"])).toMatchObject({
    unopenedSkip: false,
    openedBefore: true,
    layout: "split",
  });
  expect(actions.find((a) => a.type === "seen_all")).toMatchObject({
    target: { kind: "feed", id: feedIds.B, name: "サイト B" },
    seenArticleIds: [ids["seen-all"]],
    // The old shape, with no seenAt: nothing can undo it.
    undone: false,
  });
  expect(actions.find((a) => a.type === "undo" && a.articleId === ids["opened-b"])).toMatchObject({ of: "skip", undoes: null });
  // A skip 10 s after an unmatched undo is a new skip, not the one it undid.
  expect(actions.find((a) => a.type === "undo" && a.articleId === ids.reskipped)).toMatchObject({ undoes: null });
  expect(actions.find((a) => a.type === "skip" && a.articleId === ids.reskipped)).toMatchObject({
    undone: false,
    unopenedSkip: true,
  });

  const feeds = read("feeds.json").rows;
  expect(feeds.find((f) => f.feedId === feedIds.A)).toMatchObject({
    site: "サイト A",
    fetched: 4,
    opened: 3,
    read: 1,
    skipped: 3,
    // Only the one skipped from the list before being opened.
    skippedUnopened: 1,
    seenUnopened: 0,
    byDevice: {
      phone: { opens: 2, reads: 1, skips: 2, views: 2, medianDwellMs: 34_500 },
      pc: { opens: 1, reads: 0, skips: 1, views: 0, medianDwellMs: null },
    },
  });
  expect(feeds.find((f) => f.feedId === feedIds.B)).toMatchObject({
    // opened-b and opened-then-seen-all; the preview open is not counted.
    opened: 2,
    skipped: 2,
    // reskipped only: preview was opened on a preview deployment.
    skippedUnopened: 1,
    seenUnopened: 1,
  });

  expect(stdout).toContain("最後のイベント:");
  expect(stdout).toContain("直近 14 日の件数");
  // v1 and v3 have a leave, v2, v4 and v5 do not.
  expect(stdout).toContain("leave が無い閲覧: 3 / 5(60%)");

  // --env all brings the preview rows back.
  const all = await run(work, dir, ["--env", "all"]);
  expect(all.read("views.json").rows.map((v) => v.viewId)).toContain("vp");
});

test("「すべて既読」の元に戻すは seenAt で対にし、取り消された「すべて既読」は既読にした記事に数えない", async () => {
  test.setTimeout(60_000);
  const now = Date.now();
  const at = (min: number) => now - min * 60_000;
  const ids: Record<string, number> = {};
  const feedIds: Record<string, number> = {};
  let folderId = 0;

  const { work, dir } = await makeDb("seen-all-undo", async (db) => {
    const [folder] = await db.insert(schema.folders).values({ name: "取り消しのフォルダ" }).returning();
    folderId = folder.id;
    const fs = await db
      .insert(schema.feeds)
      .values(["C", "D", "E"].map((s) => ({ name: `サイト ${s}`, url: `https://${s.toLowerCase()}.example/feed`, folderId: folder.id })))
      .returning();
    for (const f of fs) feedIds[f.name.slice(-1)] = f.id;
    const article = (key: string, feed: "C" | "D" | "E", seenAt: number) => ({
      url: `https://${feed.toLowerCase()}.example/${key}`,
      title: `Article ${key}`,
      titleJa: `記事 ${key}`,
      source: `サイト ${feed}`,
      feedId: feedIds[feed],
      fetchedAt: new Date(at(600)),
      seenAt: new Date(seenAt),
    });
    const rows = await db
      .insert(schema.articles)
      .values([
        // Never opened, with a seen_at just before the undone 「すべて既読」 of its site: something
        // else (scrolling past) set it, since the undo cleared the ones that one set.
        article("c-left", "C", at(30) - 2_000),
        // Marked by a 「すべて既読」 that was not undone.
        article("d-seen", "D", at(20) - 2_000),
        // Marked by an old-shape 「すべて既読」, with no seenAt.
        article("e-seen", "E", at(5) - 1_000),
      ])
      .returning({ id: schema.articles.id, url: schema.articles.url });
    for (const r of rows) ids[r.url.split("/").pop()!] = r.id;

    const base = {
      env: "production",
      sessionId: "s1",
      device: "pc",
      layout: "split",
      vw: 1440,
      vh: 900,
      standalone: false,
      screen: "board",
    };
    const seenC = at(30) - 1_000;
    const seenFolder = at(10) - 1_000;
    await db.insert(schema.events).values([
      { ...base, createdAt: new Date(at(30)), type: "seen_all", props: { feedId: feedIds.C, seenAt: seenC } },
      // The URL had moved on; the undo carries the screen of the button all the same.
      { ...base, createdAt: new Date(at(29)), type: "undo", screen: "list", props: { of: "seen_all", feedId: feedIds.C, seenAt: seenC } },
      { ...base, createdAt: new Date(at(20)), type: "seen_all", props: { feedId: feedIds.D, seenAt: at(20) - 2_000 } },
      { ...base, createdAt: new Date(at(10)), type: "seen_all", props: { folderId: folder.id, seenAt: seenFolder } },
      { ...base, createdAt: new Date(at(9)), type: "undo", props: { of: "seen_all", folderId: folder.id, seenAt: seenFolder } },
      { ...base, createdAt: new Date(at(5)), type: "seen_all", props: { feedId: feedIds.E } },
      // An undo whose 「すべて既読」 is not in the log.
      { ...base, createdAt: new Date(at(4)), type: "undo", props: { of: "seen_all", feedId: feedIds.E, seenAt: at(60) } },
    ]);
  });

  const { read } = await run(work, dir);
  const actions = read("actions.json").rows;
  const seenAll = (key: string, id: number) =>
    actions.find((a) => a.type === "seen_all" && (a.target as { id: number }).id === id && (a.target as { kind: string }).kind === key)!;
  const undos = actions.filter((a) => a.type === "undo");
  expect(undos).toHaveLength(3);

  const c = seenAll("feed", feedIds.C);
  expect(c).toMatchObject({ undone: true, seenArticleIds: [], undoes: null });
  expect(undos[0]).toMatchObject({
    of: "seen_all",
    articleId: null,
    screen: "list",
    undoes: c.id,
    target: { kind: "feed", id: feedIds.C, name: "サイト C" },
    undone: null,
  });

  const f = seenAll("folder", folderId);
  expect(f).toMatchObject({ undone: true, seenArticleIds: [] });
  expect(undos[1]).toMatchObject({ undoes: f.id, target: { kind: "folder", id: folderId, name: "取り消しのフォルダ" } });

  expect(seenAll("feed", feedIds.D)).toMatchObject({ undone: false, seenArticleIds: [ids["d-seen"]] });
  expect(seenAll("feed", feedIds.E)).toMatchObject({ undone: false, seenArticleIds: [ids["e-seen"]] });
  expect(undos[2]).toMatchObject({ undoes: null, target: { kind: "feed", id: feedIds.E } });

  const feeds = read("feeds.json").rows;
  expect(feeds.find((x) => x.feedId === feedIds.C)).toMatchObject({ seenUnopened: 0 });
  expect(feeds.find((x) => x.feedId === feedIds.D)).toMatchObject({ seenUnopened: 1 });
  expect(feeds.find((x) => x.feedId === feedIds.E)).toMatchObject({ seenUnopened: 1 });
});

test("イベントが 0 件でもエラーにならず「記録がありません」と出る", async () => {
  test.setTimeout(60_000);
  const { work, dir } = await makeDb("empty", async (db) => {
    await db.insert(schema.feeds).values({ name: "空のサイト", url: "https://empty.example/feed" });
  });
  const { stdout, read } = await run(work, dir);
  expect(stdout).toContain("記録がありません");
  expect(read("views.json").rows).toEqual([]);
  expect(read("actions.json").rows).toEqual([]);
  expect(read("feeds.json").rows.find((f) => f.site === "空のサイト")).toMatchObject({ fetched: 0, opened: 0 });
});
