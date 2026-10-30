import "server-only";
import { and, asc, count, desc, eq, isNotNull, isNull, lte, max, or, sql } from "drizzle-orm";
import { articles, feeds, folders, getDb } from "./db";
import { formatAgo, hostname } from "./format";
import { inboxQuery, inboxWhere, listedWhere, type InboxFilter } from "./inbox";

/** Rows a column shows on PCs; the rest are behind 「あと N 件」. */
export const COLUMN_ROWS = 50;
/** Rows a section shows on phones; the rest are behind 「もっと見る」. */
export const PHONE_ROWS = 3;

// Mid tones that hold up on the light and the dark background alike.
const PALETTE = [
  "#c8553d",
  "#d08c2f",
  "#a39a1f",
  "#5f9e3e",
  "#2f9e7a",
  "#2c98a8",
  "#3b82c4",
  "#5a6fd1",
  "#8560c9",
  "#b455b0",
  "#c9527f",
  "#8a7a66",
];

/** The feed's color. From its id, so it stays the same when the feed is renamed. */
export function feedColor(feedId: number | null) {
  if (feedId === null) return "var(--muted)";
  // A multiplicative hash: neighbouring ids, usually added together, land apart.
  return PALETTE[(Math.imul(feedId, 2654435761) >>> 0) % PALETTE.length];
}

/**
 * The favicon of the site of `url`, from an outside service: the browser sends it the host names
 * of the owner's feeds. `FAVICON_SERVICE` swaps the service, and blank turns favicons off (the
 * initial shows instead). E2E points it at a local stub.
 */
export function faviconUrl(url: string | undefined) {
  const service = process.env.FAVICON_SERVICE ?? "https://icons.duckduckgo.com/ip3";
  const host = url && hostname(url);
  return service && host ? `${service}/${host}.ico` : null;
}

/** Unread counts per folder (null = 未分類) and site; articles without a feed count as 未分類. */
export type Bucket = { folderId: number | null; feedId: number | null; name: string | null; n: number };

/** One aggregate query for every tab's, chip's and column's unread count. */
export async function unreadBuckets(): Promise<Bucket[]> {
  const db = await getDb();
  return db
    .select({ folderId: feeds.folderId, feedId: articles.feedId, name: feeds.name, n: count() })
    .from(articles)
    .leftJoin(feeds, eq(feeds.id, articles.feedId))
    .where(inboxWhere({}))
    .groupBy(feeds.folderId, articles.feedId, feeds.name);
}

export async function folderList() {
  const db = await getDb();
  return db.select({ id: folders.id, name: folders.name }).from(folders).orderBy(asc(folders.position), asc(folders.id));
}

/** 「12 分前に取得」 for the header; null before the first fetch. */
export async function lastFetchedLabel() {
  const db = await getDb();
  const [{ last }] = await db.select({ last: max(feeds.lastFetchedAt) }).from(feeds);
  return last ? `${formatAgo(last)}に取得` : null;
}

export type BoardRowData = {
  id: number;
  title: string;
  titleJa: string | null;
  summary: string | null;
  lang: string | null;
  charCount: number;
  publishedAt: Date | null;
  fetchedAt: Date;
  seenAt: Date | null;
  started: boolean;
};

export type BoardColumn = {
  feedId: number | null; // null is 「URL から追加」
  name: string;
  color: string;
  favicon: string | null;
  lastFetchedAt: Date | null;
  unread: number;
  rows: BoardRowData[];
  /** Search string a row's article opens with. */
  articleQuery: string;
  /** Search string of the list behind the column. */
  listQuery: string;
};

export type BoardGroup = { key: string; name: string; columns: BoardColumn[] };

export type StoppedFeed = {
  id: number;
  name: string;
  state: string;
  error: string | null;
  unread: number;
  listQuery: string;
};

/**
 * What the Board shows for the folder tab in `filter.f`. Seen articles in `kept` stay in their
 * columns, as they do in a list (lib/opened.ts).
 */
export async function loadBoard(filter: InboxFilter, kept: number[]) {
  const db = await getDb();
  const running = or(isNull(articles.feedId), and(eq(feeds.enabled, true), isNull(feeds.lastError)));
  const ranked = db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      title: articles.title,
      titleJa: articles.titleJa,
      summary: articles.summary,
      lang: articles.lang,
      charCount: articles.charCount,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
      seenAt: articles.seenAt,
      // Spelled out: inside `sql`, drizzle renders ${articles.id} as a bare "id".
      started: sql<boolean>`exists (select 1 from messages m where m.article_id = articles.id)`.as("started"),
      // The same order as inboxOrder, so a column and its feed list agree.
      place: sql<number>`row_number() over (partition by articles.feed_id order by articles.fetched_at desc, articles.published_at desc, articles.id desc)`.as(
        "place",
      ),
    })
    .from(articles)
    .leftJoin(feeds, eq(feeds.id, articles.feedId))
    .where(and(listedWhere({ f: filter.f }, kept), running))
    .as("ranked");
  const [rows, feedRows, latest, folderRows, buckets] = await Promise.all([
    db.select().from(ranked).where(lte(ranked.place, COLUMN_ROWS)).orderBy(ranked.place),
    db
      .select({
        id: feeds.id,
        name: feeds.name,
        folderId: feeds.folderId,
        enabled: feeds.enabled,
        lastFetchedAt: feeds.lastFetchedAt,
        lastError: feeds.lastError,
      })
      .from(feeds)
      .orderBy(asc(feeds.name), asc(feeds.id)),
    // The newest article of any status, so the favicon stays when a column empties.
    db
      .selectDistinctOn([articles.feedId], { feedId: articles.feedId, url: articles.url })
      .from(articles)
      .where(isNotNull(articles.feedId))
      .orderBy(articles.feedId, desc(articles.fetchedAt)),
    folderList(),
    unreadBuckets(),
  ]);
  type FeedRow = (typeof feedRows)[number];

  const urlOf = new Map(latest.map((a) => [a.feedId, a.url]));
  const unreadOf = (feedId: number | null) => buckets.filter((b) => b.feedId === feedId).reduce((t, b) => t + b.n, 0);
  const rowsOf = (feedId: number | null) => rows.filter((r) => r.feedId === feedId);
  const folderParam = (id: number | null) => (id === null ? "none" : String(id));
  const shown = (id: number | null) => filter.f === undefined || filter.f === folderParam(id);
  const isStopped = (f: FeedRow) => !f.enabled || f.lastError !== null;
  // A feed with nothing unread leads to its seen articles: without `a`, its list would go
  // straight back to the Board.
  const feedList = (f: FeedRow, unread: number) =>
    inboxQuery({ f: folderParam(f.folderId), s: String(f.id), a: unread > 0 ? undefined : "1" });

  const column = (f: FeedRow): BoardColumn => {
    const unread = unreadOf(f.id);
    return {
      feedId: f.id,
      name: f.name,
      color: feedColor(f.id),
      favicon: faviconUrl(urlOf.get(f.id)),
      lastFetchedAt: f.lastFetchedAt,
      unread,
      rows: rowsOf(f.id),
      articleQuery: inboxQuery({ f: folderParam(f.folderId), s: String(f.id) }),
      listQuery: feedList(f, unread),
    };
  };
  const columnsOf = (id: number | null) =>
    feedRows
      .filter((f) => f.folderId === id && !isStopped(f))
      .map(column)
      // Stable, unlike sorting by count: a column stays put as it is read, until it is empty.
      .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0));

  const groups: BoardGroup[] = folderRows
    .filter((f) => shown(f.id))
    .map((f) => ({ key: String(f.id), name: f.name, columns: columnsOf(f.id) }));
  if (shown(null)) {
    const unread = unreadOf(null);
    const noFeed = rowsOf(null);
    const fromUrl: BoardColumn = {
      feedId: null,
      name: "URL から追加",
      color: feedColor(null),
      favicon: null,
      lastFetchedAt: null,
      unread,
      rows: noFeed,
      // These have no `s` to narrow by, so they open and list as 未分類; with `a`, as without it
      // the list would be this Board.
      articleQuery: inboxQuery({ f: "none" }),
      listQuery: inboxQuery({ f: "none", a: "1" }),
    };
    groups.push({
      key: "none",
      name: "未分類",
      columns: [...columnsOf(null), ...(noFeed.length > 0 || unread > 0 ? [fromUrl] : [])],
    });
  }

  const stopped: StoppedFeed[] = feedRows
    .filter((f) => isStopped(f) && shown(f.folderId))
    .map((f) => {
      const unread = unreadOf(f.id);
      return {
        id: f.id,
        name: f.name,
        state: f.enabled ? "取得エラー" : "止めています",
        error: f.enabled ? f.lastError : null,
        unread,
        listQuery: feedList(f, unread),
      };
    });

  return { groups: groups.filter((g) => g.columns.length > 0), stopped, folders: folderRows, buckets };
}
