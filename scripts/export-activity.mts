// Writes the activity log (the `events` table) as three JSON files for handing to Claude:
// views.json, actions.json and feeds.json under .data/exports/, and prints the log's health.
// Every query runs in one READ ONLY transaction, so the script cannot change the database.
// See 「行動ログ」 in README.md for the columns, the options and how to read the output.
//
//   npx tsx scripts/export-activity.mts [--days 90] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--env production]
//
// With DATABASE_URL it reads that database (Neon); without it the PGlite database in PGLITE_DIR
// (default .data/pglite). Do not point it at a PGlite directory a running server has open.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY = 86_400_000;
// Days are counted in Japan time.
const JST = 9 * 3_600_000;
// 「すべて既読」 sets articles.seen_at on the server and is logged once that has been saved, so
// the articles it marked have a seen_at a little before the event. The slack after it covers the
// clocks of the app server and the database differing.
const SEEN_ALL_BEFORE = 120_000;
const SEEN_ALL_AFTER = 5_000;
// Opening an article sets its seen_at when the page renders, and its `open` follows once the page
// is up; an open this close to an article's seen_at means the open set it, not 「すべて既読」.
const OPEN_AFTER_SEEN = 30_000;
// How far a toast's 元に戻す can be from the read or skip it undoes. A card skip shows its toast
// before saving, so the skip's row can come after the undo's, but only by the time the save
// takes; a skip later than that is a new one (after the first one failed to save).
const UNDO_BEFORE = 10 * 60_000;
const UNDO_AFTER = 5_000;
const HEALTH_DAYS = 14;

// ---- options

function usage(message: string): never {
  console.error(`${message}
使い方: npx tsx scripts/export-activity.mts [--days N] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--env production|preview|development|all]
  --days  直近 N 日(既定 90)。--from があれば無視する
  --from  この日(日本時間)の 0 時から
  --to    この日(日本時間)の終わりまで(既定は今)
  --env   含める env をカンマ区切りで。all ですべて(既定 production)`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(days|from|to|env)(?:=(.*))?$/.exec(argv[i]);
    if (!m) usage(`知らない引数です: ${argv[i]}`);
    const value = m[2] ?? argv[++i];
    if (value === undefined) usage(`--${m[1]} に値がありません`);
    opts[m[1]] = value;
  }
  const jstDay = (s: string, name: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) usage(`--${name} は YYYY-MM-DD で書きます: ${s}`);
    return Date.parse(`${s}T00:00:00+09:00`);
  };
  const now = Date.now();
  const to = opts.to ? jstDay(opts.to, "to") + DAY : now;
  let from: number;
  if (opts.from) from = jstDay(opts.from, "from");
  else {
    const days = Number(opts.days ?? 90);
    if (!Number.isInteger(days) || days <= 0) usage(`--days は 1 以上の整数です: ${opts.days}`);
    from = to - days * DAY;
  }
  if (from >= to) usage("期間の始まりが終わりより後です");
  const env = opts.env ?? "production";
  const envs = env === "all" ? null : env.split(",").map((s) => s.trim()).filter(Boolean);
  if (envs && envs.length === 0) usage("--env が空です");
  return { from: new Date(from), to: new Date(to), envs };
}

const { from, to, envs } = parseArgs(process.argv.slice(2));

// ---- reading

type Row = Record<string, unknown>;
type Query = { text: string; params: unknown[] };

/** Runs the queries in one READ ONLY transaction and returns each one's rows. */
async function readOnly(queries: Query[]): Promise<Row[][]> {
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    return (await sql.transaction(
      queries.map((q) => sql.query(q.text, q.params)),
      { readOnly: true },
    )) as Row[][];
  }
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  // PGlite would make an empty database in a directory that is not there.
  if (!existsSync(join(dir, "PG_VERSION"))) {
    console.error(`PGlite のデータベースが見つかりません: ${dir}(DATABASE_URL か PGLITE_DIR を指定してください)`);
    process.exit(1);
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dir);
  try {
    return await pg.transaction(async (tx) => {
      await tx.exec("SET TRANSACTION READ ONLY");
      const out: Row[][] = [];
      for (const q of queries) out.push((await tx.query<Row>(q.text, q.params)).rows);
      return out;
    });
  } finally {
    await pg.close();
  }
}

// The envs to keep, comma-separated, or null for all; `$n` is the parameter that holds them.
const envParam = envs?.join(",") ?? null;
const envFilter = (n: number) => `($${n}::text IS NULL OR e.env = ANY(string_to_array($${n}::text, ',')))`;
const healthFrom = new Date(Date.parse(jstDate(Date.now())) - JST - (HEALTH_DAYS - 1) * DAY);

const [eventRows, openRows, articleRows, feedRows, folderRows, lastRows, recentRows] = await readOnly([
  {
    text: `SELECT e.* FROM events e
      WHERE e.created_at >= $1 AND e.created_at < $2 AND ${envFilter(3)}
      ORDER BY e.created_at, e.id`,
    params: [from.toISOString(), to.toISOString(), envParam],
  },
  // Every open, to tell whether a skip or 「すべて既読」 came before the article was ever opened.
  // Not filtered by env: an article opened on a preview has been opened all the same.
  {
    text: `SELECT e.article_id, e.created_at FROM events e
      WHERE e.type = 'open' AND e.article_id IS NOT NULL AND e.created_at < $1`,
    params: [to.toISOString()],
  },
  {
    text: `SELECT id, title, title_ja, source, feed_id, lang, char_count, status, fetched_at, seen_at, read_at
      FROM articles`,
    params: [],
  },
  {
    text: `SELECT f.id, f.name, f.url, f.enabled, f.folder_id, fo.name AS folder
      FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id`,
    params: [],
  },
  { text: "SELECT id, name FROM folders", params: [] },
  {
    text: `SELECT max(e.created_at) AS last, count(*)::int AS n FROM events e WHERE ${envFilter(1)}`,
    params: [envParam],
  },
  {
    text: `SELECT e.created_at, e.type FROM events e
      WHERE e.created_at >= $1 AND ${envFilter(2)}`,
    params: [healthFrom.toISOString(), envParam],
  },
]);

// ---- shaping

const time = (v: unknown) => (v == null ? null : new Date(v as string | Date).getTime());
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
function jstDate(t: number) {
  return new Date(t + JST).toISOString().slice(0, 10);
}
const num = (v: unknown) => (v == null ? null : Number(v));
const props = (v: unknown): Record<string, unknown> => {
  if (v == null) return {};
  if (typeof v === "string") return JSON.parse(v);
  return v as Record<string, unknown>;
};
function median(values: number[]) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

type Feed = { id: number; name: string; url: string; enabled: boolean; folderId: number | null; folder: string | null };
const feeds = new Map<number, Feed>(
  feedRows.map((r) => [
    Number(r.id),
    {
      id: Number(r.id),
      name: String(r.name),
      url: String(r.url),
      enabled: Boolean(r.enabled),
      folderId: num(r.folder_id),
      folder: (r.folder as string | null) ?? null,
    },
  ]),
);

type Article = {
  id: number;
  title: string;
  titleOriginal: string;
  site: string;
  feedId: number | null;
  folderId: number | null;
  folder: string;
  lang: string | null;
  charCount: number;
  status: string;
  fetchedAt: number | null;
  seenAt: number | null;
};
const folders = new Map<number, string>(folderRows.map((r) => [Number(r.id), String(r.name)]));

const articles = new Map<number, Article>(
  articleRows.map((r) => {
    const feedId = num(r.feed_id);
    const feed = feedId === null ? undefined : feeds.get(feedId);
    return [
      Number(r.id),
      {
        id: Number(r.id),
        title: String(r.title_ja ?? r.title),
        titleOriginal: String(r.title),
        site: String(r.source),
        feedId,
        folderId: feed?.folderId ?? null,
        folder: feed?.folder ?? "未分類",
        lang: (r.lang as string | null) ?? null,
        charCount: Number(r.char_count),
        status: String(r.status),
        fetchedAt: time(r.fetched_at),
        seenAt: time(r.seen_at),
      },
    ];
  }),
);
/** The article's fields every file repeats; null fields when it is gone or the event has none. */
function articleFields(id: number | null) {
  const a = id === null ? undefined : articles.get(id);
  return {
    articleId: id,
    title: a?.title ?? null,
    site: a?.site ?? null,
    feedId: a?.feedId ?? null,
    folder: a?.folder ?? null,
  };
}

type Event = {
  id: number;
  at: number;
  env: string;
  sessionId: string;
  type: string;
  device: string;
  layout: string;
  vw: number;
  vh: number;
  standalone: boolean;
  screen: string;
  articleId: number | null;
  source: string | null;
  viewId: string | null;
  dwellMs: number | null;
  activeMs: number | null;
  scrollPct: number | null;
  props: Record<string, unknown>;
};
const events: Event[] = eventRows.map((r) => ({
  id: Number(r.id),
  at: time(r.created_at)!,
  env: String(r.env),
  sessionId: String(r.session_id),
  type: String(r.type),
  device: String(r.device),
  layout: String(r.layout),
  vw: Number(r.vw),
  vh: Number(r.vh),
  standalone: Boolean(r.standalone),
  screen: String(r.screen),
  articleId: num(r.article_id),
  source: (r.source as string | null) ?? null,
  viewId: (r.view_id as string | null) ?? null,
  dwellMs: num(r.dwell_ms),
  activeMs: num(r.active_ms),
  scrollPct: num(r.scroll_pct),
  props: props(r.props),
}));

const opensOf = new Map<number, number[]>();
for (const r of openRows) {
  const id = Number(r.article_id);
  opensOf.set(id, [...(opensOf.get(id) ?? []), time(r.created_at)!]);
}
const openedBefore = (articleId: number | null, at: number) =>
  articleId !== null && (opensOf.get(articleId) ?? []).some((t) => t <= at);

// The toast's 元に戻す, paired with the read or skip of the same article closest before it.
// Its `screen` comes from the URL and says nothing; the row it undoes may be missing (a card
// skip can fail to save after its toast was used). The 元に戻す of a 「すべて既読」 has no
// article: it is paired by `seenAt`, the one seen_at that 「すべて既読」 set and the undo cleared.
const undoneBy = new Map<number, number>();
const undoes = new Map<number, number | null>();
const seenAtOf = (e: Event) => (typeof e.props.seenAt === "number" ? e.props.seenAt : null);
for (const u of events.filter((e) => e.type === "undo")) {
  const of = u.props.of;
  const candidates = events.filter((e) =>
    of === "seen_all"
      ? e.type === "seen_all" && seenAtOf(u) !== null && seenAtOf(e) === seenAtOf(u) && !undoneBy.has(e.id)
      : e.type === of &&
        e.articleId === u.articleId &&
        e.articleId !== null &&
        !undoneBy.has(e.id) &&
        e.at >= u.at - UNDO_BEFORE &&
        e.at <= u.at + UNDO_AFTER,
  );
  // The latest one before the undo; failing that, the first one after it.
  const match = candidates.filter((e) => e.at <= u.at).at(-1) ?? candidates.find((e) => e.at > u.at);
  undoes.set(u.id, match?.id ?? null);
  if (match) undoneBy.set(match.id, u.id);
}

// 「すべて既読」 keeps no list of what it marked. Its target is whichever of feedId / folderId
// props has (a null value means フィードなし / 未分類); the articles are those in the target whose
// seen_at is just before the event.
type Target = { kind: "feed" | "folder"; id: number | null; name: string | null };
function seenAllTarget(e: Event): Target | null {
  if ("feedId" in e.props) {
    const id = e.props.feedId as number | null;
    return { kind: "feed", id, name: id === null ? "フィードなし" : (feeds.get(id)?.name ?? null) };
  }
  if ("folderId" in e.props) {
    const id = e.props.folderId as number | null;
    return { kind: "folder", id, name: id === null ? "未分類" : (folders.get(id) ?? null) };
  }
  return null;
}
function feedTarget(e: Event): Target | null {
  if (!("feedId" in e.props)) return null;
  const id = e.props.feedId as number;
  return { kind: "feed", id, name: feeds.get(id)?.name ?? null };
}
function seenAllArticles(e: Event, target: Target | null) {
  if (!target) return [];
  return [...articles.values()]
    .filter((a) => {
      const inTarget =
        target.kind === "feed"
          ? a.feedId === target.id
          : target.id === null
            ? a.feedId === null || a.folderId === null
            : a.folderId === target.id;
      return (
        inTarget &&
        a.seenAt !== null &&
        a.seenAt >= e.at - SEEN_ALL_BEFORE &&
        a.seenAt <= e.at + SEEN_ALL_AFTER &&
        // Seen by being opened just before, not by this.
        !(opensOf.get(a.id) ?? []).some((t) => t >= a.seenAt! - SEEN_ALL_AFTER && t <= a.seenAt! + OPEN_AFTER_SEEN)
      );
    })
    .map((a) => a.id);
}

// ---- actions.json

const ACTION_TYPES = new Set(["read", "skip", "undo", "restore", "unsee", "seen_all", "chat", "original", "feed_pause", "feed_resume"]);
/** Articles 「すべて既読」 marked before they were ever opened, with the time. */
const seenUnopened = new Map<number, number>();
const actions = events
  .filter((e) => ACTION_TYPES.has(e.type))
  .map((e) => {
    const target = e.type === "seen_all" || (e.type === "undo" && e.props.of === "seen_all") ? seenAllTarget(e) : null;
    // An undone 「すべて既読」 marked nothing that stays: a seen_at left in its target since was set
    // by something else (scrolling past, opening).
    const marked = e.type === "seen_all" && !undoneBy.has(e.id) ? seenAllArticles(e, target) : [];
    for (const id of marked) if (!openedBefore(id, e.at) && !seenUnopened.has(id)) seenUnopened.set(id, e.at);
    const opened = openedBefore(e.articleId, e.at);
    return {
      id: e.id,
      at: iso(e.at),
      type: e.type,
      ...articleFields(e.articleId),
      device: e.device,
      layout: e.layout,
      vw: e.vw,
      vh: e.vh,
      standalone: e.standalone,
      screen: e.screen,
      sessionId: e.sessionId,
      viewId: e.viewId,
      via: (e.props.via as string | undefined) ?? null,
      kind: (e.props.kind as string | undefined) ?? null,
      of: (e.props.of as string | undefined) ?? null,
      // seen_all and its undo: the site or folder it marked; feed_pause / feed_resume: the site.
      target: target ?? feedTarget(e),
      seenArticleIds: e.type === "seen_all" ? marked : null,
      openedBefore: e.articleId === null ? null : opened,
      unopenedSkip: e.type === "skip" ? e.screen === "list" && !opened : null,
      undone: e.type === "read" || e.type === "skip" || e.type === "seen_all" ? undoneBy.has(e.id) : null,
      undoes: e.type === "undo" ? undoes.get(e.id) : null,
    };
  });

// ---- views.json

type View = { open: Event | null; leaves: Event[]; actions: Event[] };
const viewMap = new Map<string, View>();
for (const e of events) {
  if (!e.viewId) continue;
  const v = viewMap.get(e.viewId) ?? { open: null, leaves: [], actions: [] };
  if (e.type === "open") v.open ??= e;
  else if (e.type === "leave") v.leaves.push(e);
  else v.actions.push(e);
  viewMap.set(e.viewId, v);
}
const lastLeave = (leaves: Event[]) =>
  leaves.reduce<Event | null>(
    (last, e) =>
      !last || e.at > last.at || (e.at === last.at && (e.dwellMs ?? 0) >= (last.dwellMs ?? 0)) ? e : last,
    null,
  );
const views = [...viewMap.entries()].map(([viewId, v]) => {
  const first = v.open ?? v.leaves[0] ?? v.actions[0];
  const leave = lastLeave(v.leaves);
  const done = v.actions.filter((e) => (e.type === "read" || e.type === "skip") && !undoneBy.has(e.id)).at(-1);
  return {
    viewId,
    openedAt: iso(v.open?.at ?? null),
    ...articleFields(first.articleId),
    charCount: first.articleId === null ? null : (articles.get(first.articleId)?.charCount ?? null),
    lang: first.articleId === null ? null : (articles.get(first.articleId)?.lang ?? null),
    device: first.device,
    layout: first.layout,
    vw: first.vw,
    vh: first.vh,
    standalone: first.standalone,
    sessionId: first.sessionId,
    source: v.open?.source ?? null,
    // From the last leave of the view; null when none arrived.
    leftAt: iso(leave?.at ?? null),
    dwellMs: leave?.dwellMs ?? null,
    activeMs: leave?.activeMs ?? null,
    scrollPct: leave?.scrollPct ?? null,
    bodyLang: (leave?.props.body_lang as string | undefined) ?? null,
    leaveRows: v.leaves.length,
    outcome: done?.type ?? null,
    actions: v.actions.map((e) => ({
      type: e.type,
      at: iso(e.at),
      via: (e.props.via as string | undefined) ?? null,
      kind: (e.props.kind as string | undefined) ?? null,
      undone: e.type === "read" || e.type === "skip" ? undoneBy.has(e.id) : null,
    })),
  };
});
views.sort((a, b) => String(a.openedAt ?? a.leftAt).localeCompare(String(b.openedAt ?? b.leftAt)));

// ---- feeds.json

type Tally = {
  fetched: Set<number>;
  opened: Set<number>;
  read: Set<number>;
  skipped: Set<number>;
  skippedUnopened: Set<number>;
  seenUnopened: Set<number>;
  devices: Map<string, { opens: number; reads: number; skips: number; dwell: number[] }>;
};
const tallies = new Map<string, { feedId: number | null; site: string; folder: string; enabled: boolean | null; t: Tally }>();
const tallyKey = (a: Article) => (a.feedId === null ? `site:${a.site}` : `feed:${a.feedId}`);
const newTally = (): Tally => ({
  fetched: new Set(),
  opened: new Set(),
  read: new Set(),
  skipped: new Set(),
  skippedUnopened: new Set(),
  seenUnopened: new Set(),
  devices: new Map(),
});
for (const f of feeds.values()) {
  tallies.set(`feed:${f.id}`, { feedId: f.id, site: f.name, folder: f.folder ?? "未分類", enabled: f.enabled, t: newTally() });
}
function tallyOf(articleId: number | null) {
  const a = articleId === null ? undefined : articles.get(articleId);
  if (!a) return null;
  const key = tallyKey(a);
  if (!tallies.has(key)) tallies.set(key, { feedId: a.feedId, site: a.site, folder: a.folder, enabled: null, t: newTally() });
  return tallies.get(key)!.t;
}
const deviceOf = (t: Tally, device: string) => {
  if (!t.devices.has(device)) t.devices.set(device, { opens: 0, reads: 0, skips: 0, dwell: [] });
  return t.devices.get(device)!;
};
for (const a of articles.values()) {
  if (a.fetchedAt !== null && a.fetchedAt >= from.getTime() && a.fetchedAt < to.getTime()) tallyOf(a.id)!.fetched.add(a.id);
}
for (const e of events) {
  const t = tallyOf(e.articleId);
  if (!t || e.articleId === null) continue;
  if (e.type === "open") {
    t.opened.add(e.articleId);
    deviceOf(t, e.device).opens++;
  } else if ((e.type === "read" || e.type === "skip") && !undoneBy.has(e.id)) {
    if (e.type === "read") {
      t.read.add(e.articleId);
      deviceOf(t, e.device).reads++;
    } else {
      t.skipped.add(e.articleId);
      deviceOf(t, e.device).skips++;
      if (e.screen === "list" && !openedBefore(e.articleId, e.at)) t.skippedUnopened.add(e.articleId);
    }
  }
}
for (const id of seenUnopened.keys()) tallyOf(id)?.seenUnopened.add(id);
for (const v of views) {
  const t = tallyOf(v.articleId);
  if (t && v.dwellMs !== null) deviceOf(t, v.device).dwell.push(v.dwellMs);
}
const feedsOut = [...tallies.values()]
  .map(({ feedId, site, folder, enabled, t }) => ({
    feedId,
    site,
    folder,
    enabled,
    fetched: t.fetched.size,
    opened: t.opened.size,
    read: t.read.size,
    skipped: t.skipped.size,
    skippedUnopened: t.skippedUnopened.size,
    seenUnopened: t.seenUnopened.size,
    byDevice: Object.fromEntries(
      [...t.devices.entries()].map(([device, d]) => [
        device,
        { opens: d.opens, reads: d.reads, skips: d.skips, views: d.dwell.length, medianDwellMs: median(d.dwell) },
      ]),
    ),
  }))
  .sort((a, b) => b.fetched - a.fetched || b.opened - a.opened || a.site.localeCompare(b.site));

// ---- writing

const meta = {
  generatedAt: new Date().toISOString(),
  from: from.toISOString(),
  to: to.toISOString(),
  env: envs ?? "all",
  readme: "README.md の「行動ログ」",
};
const outDir = join(".data", "exports");
mkdirSync(outDir, { recursive: true });
const files = { views, actions, feeds: feedsOut };
for (const [name, rows] of Object.entries(files)) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ meta, rows }, null, 2) + "\n");
}

// ---- health

const envLabel = envs ? envs.join(", ") : "すべて";
console.log(`期間: ${jstDate(from.getTime())} 〜 ${jstDate(to.getTime() - 1)}(日本時間)、env: ${envLabel}`);
if (events.length === 0) console.log(`この期間の記録がありません。`);
const last = time(lastRows[0]?.last);
if (last === null) console.log("記録がありません(events に該当する行が 1 行もない)。");
else {
  const ago = Math.round((Date.now() - last) / 3_600_000);
  console.log(`最後のイベント: ${new Date(last).toISOString()}(${ago} 時間前)、全期間 ${lastRows[0].n} 行`);
}
const daily = new Map<string, { all: number; open: number }>();
for (let i = HEALTH_DAYS - 1; i >= 0; i--) daily.set(jstDate(Date.now() - i * DAY), { all: 0, open: 0 });
for (const r of recentRows) {
  const d = daily.get(jstDate(time(r.created_at)!));
  if (!d) continue;
  d.all++;
  if (r.type === "open") d.open++;
}
console.log(`直近 ${HEALTH_DAYS} 日の件数(日本時間、0 の日は記録が止まっていないか確かめる):`);
for (const [day, d] of daily) console.log(`  ${day}  ${String(d.all).padStart(5)} 行(open ${d.open})`);
const opened = views.filter((v) => v.openedAt !== null);
if (opened.length) {
  const missing = opened.filter((v) => v.leaveRows === 0).length;
  console.log(`leave が無い閲覧: ${missing} / ${opened.length}(${Math.round((missing / opened.length) * 100)}%)`);
}
console.log(`書き出し: ${outDir}/ views ${views.length} 行、actions ${actions.length} 行、feeds ${feedsOut.length} 行`);
