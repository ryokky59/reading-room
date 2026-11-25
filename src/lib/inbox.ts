// The inbox filter lives in the URL: `f` is a folder id or "none" (未分類), `s` a feed id,
// `v=t` the timeline (every site mixed, newest published first; not with `s`), `n` how many cards
// are shown (grown by 「もっと見る」), `a=1` also shows seen (既読) articles.

import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { articles, feeds } from "./db/schema";

export type InboxFilter = { f?: string; s?: string; v?: "t"; n?: string; a?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | undefined) => (v && /^[1-9]\d{0,9}$/.test(v) ? v : undefined);

/** Keeps only well-formed filter values from search params. */
export function parseInboxFilter(params: Record<string, string | string[] | undefined>): InboxFilter {
  const f = one(params.f);
  const s = id(one(params.s));
  return {
    f: f === "none" ? f : id(f),
    s,
    // A site's list keeps its own order.
    v: !s && one(params.v) === "t" ? "t" : undefined,
    n: id(one(params.n)),
    a: one(params.a) === "1" ? "1" : undefined,
  };
}

/**
 * Whether `/` shows the Board. A site (`s`) shows its feed list, 既読を含む (`a`) the plain list
 * (the Board has only unread), and `v=t` the timeline. InboxShell reads the same params from the
 * URL (showsBoardUrl); keep them in step.
 */
export function showsBoard(filter: InboxFilter) {
  return !filter.s && !filter.a && !filter.v;
}

/** Query string (with "?", or "" when empty) for the filter, its params always in this order. */
export function inboxQuery(filter: InboxFilter): string {
  const q = new URLSearchParams();
  if (filter.f) q.set("f", filter.f);
  if (filter.s) q.set("s", filter.s);
  if (filter.v) q.set("v", filter.v);
  if (filter.n) q.set("n", filter.n);
  if (filter.a) q.set("a", filter.a);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Unread articles (`status = 'inbox' AND seen_at IS NULL`) in the filter's folder or site; with
 * `a`, the seen ones too. The query must left join `feeds`.
 */
export function inboxWhere(filter: InboxFilter) {
  return and(eq(articles.status, "inbox"), filter.a ? undefined : isNull(articles.seenAt), placeWhere(filter));
}

/** Articles of the filter's folder or site, of any status. The query must left join `feeds`. */
export function placeWhere(filter: InboxFilter) {
  const folderId = filter.f && filter.f !== "none" ? Number(filter.f) : null;
  const feedId = filter.s ? Number(filter.s) : null;
  return feedId !== null
    ? eq(articles.feedId, feedId)
    : filter.f === "none"
      ? isNull(feeds.folderId)
      : folderId !== null
        ? eq(feeds.folderId, folderId)
        : undefined;
}

/**
 * The time a seen_at is written with: the database's clock, in whole milliseconds. The cookie
 * (lib/opened.ts) carries milliseconds, and a microsecond more in the column would put a row on
 * the wrong side of a `cut`.
 */
export const seenNow = sql<Date>`date_trunc('milliseconds', now())`;

/** The seen articles that stay listed (lib/opened.ts), as the query takes them. */
export type ListedRows = { since: Date; open: number | null; cut: { feedId: number | null; at: Date }[]; kept: number[] };

/**
 * What a list or the Board shows of the filter: unread, plus the seen articles that stay in place
 * until the next full load (`listed`). The query must left join `feeds`.
 */
export function listedWhere(filter: InboxFilter, { since, open, cut, kept }: ListedRows) {
  if (filter.a) return inboxWhere(filter);
  // "Another feed, or seen after the cut". Not `NOT (feed_id = X AND ...)`, which is null, and
  // so drops the row, for an article without a feed.
  const afterCuts = cut.map(({ feedId, at }) =>
    feedId === null
      ? or(isNotNull(articles.feedId), gt(articles.seenAt, at))
      : or(isNull(articles.feedId), ne(articles.feedId, feedId), gt(articles.seenAt, at)),
  );
  return and(
    inboxWhere({ ...filter, a: "1" }),
    or(
      isNull(articles.seenAt),
      open === null ? undefined : eq(articles.id, open),
      and(gte(articles.seenAt, since), ...afterCuts),
      // Put back by 「元に戻す」, but a 「すべて既読」 of its feed since takes it out.
      kept.length === 0 ? undefined : and(inArray(articles.id, kept), ...afterCuts),
    ),
  );
}

/** The order the list shows unread articles in, newest first; the id breaks ties so paging is stable. */
export const inboxOrder = [desc(articles.fetchedAt), desc(articles.publishedAt), desc(articles.id)];

/**
 * The timeline's order: when the article came out, newest first. A date in the future (a feed's
 * mistake) is held to when it was fetched, so it does not stay on top; an article with none (added
 * by URL) goes by when it was fetched. Fetching saves a feed at a time, so inboxOrder would put
 * each fetch's sites in blocks. The id breaks ties.
 */
// Spelled out: inside `sql`, drizzle renders the columns bare. `least` skips a null.
export const timelineTime = sql<Date>`least(articles.published_at, articles.fetched_at)`;
export const timelineOrder = [desc(timelineTime), desc(articles.id)];

/** The order of the filter's list: the timeline's for `v=t`, else inboxOrder. */
export function listOrder(filter: InboxFilter) {
  return filter.v ? timelineOrder : inboxOrder;
}

/**
 * Articles of feeds being fetched, and those with no feed (URL から追加): a stopped feed (paused,
 * or failing) has its unread behind 止まっているフィード on the Board, and the timeline leaves
 * them out too. The query must left join `feeds`.
 */
export const runningWhere = or(isNull(articles.feedId), and(eq(feeds.enabled, true), isNull(feeds.lastError)));
