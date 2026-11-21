// The inbox filter lives in the URL: `f` is a folder id or "none" (未分類), `s` a feed id,
// `n` how many cards are shown (grown by 「もっと見る」), `a=1` also shows seen (既読) articles.

import { and, desc, eq, gt, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { articles, feeds } from "./db/schema";

export type InboxFilter = { f?: string; s?: string; n?: string; a?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | undefined) => (v && /^[1-9]\d{0,9}$/.test(v) ? v : undefined);

/** Keeps only well-formed filter values from search params. */
export function parseInboxFilter(params: Record<string, string | string[] | undefined>): InboxFilter {
  const f = one(params.f);
  return {
    f: f === "none" ? f : id(f),
    s: id(one(params.s)),
    n: id(one(params.n)),
    a: one(params.a) === "1" ? "1" : undefined,
  };
}

/**
 * Whether `/` shows the Board. A site (`s`) shows its feed list, and 既読を含む (`a`) the plain list:
 * the Board has only unread. InboxShell reads the same two params from the URL; keep them in step.
 */
export function showsBoard(filter: InboxFilter) {
  return !filter.s && !filter.a;
}

/** Query string (with "?", or "" when empty) for the filter, its params always in this order. */
export function inboxQuery(filter: InboxFilter): string {
  const q = new URLSearchParams();
  if (filter.f) q.set("f", filter.f);
  if (filter.s) q.set("s", filter.s);
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
  const folderId = filter.f && filter.f !== "none" ? Number(filter.f) : null;
  const feedId = filter.s ? Number(filter.s) : null;
  return and(
    eq(articles.status, "inbox"),
    filter.a ? undefined : isNull(articles.seenAt),
    feedId !== null
      ? eq(articles.feedId, feedId)
      : filter.f === "none"
        ? isNull(feeds.folderId)
        : folderId !== null
          ? eq(feeds.folderId, folderId)
          : undefined,
  );
}

/**
 * The time a seen_at is written with: the database's clock, in whole milliseconds. The cookie
 * (lib/opened.ts) carries milliseconds, and a microsecond more in the column would put a row on
 * the wrong side of a `cut`.
 */
export const seenNow = sql<Date>`date_trunc('milliseconds', now())`;

/** The seen articles that stay listed (lib/opened.ts), as the query takes them. */
export type ListedRows = { since: Date; open: number | null; cut: { feedId: number | null; at: Date }[] };

/**
 * What a list or the Board shows of the filter: unread, plus the seen articles that stay in place
 * until the next full load (`listed`). The query must left join `feeds`.
 */
export function listedWhere(filter: InboxFilter, { since, open, cut }: ListedRows) {
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
    ),
  );
}

/** The order the list shows unread articles in, newest first; the id breaks ties so paging is stable. */
export const inboxOrder = [desc(articles.fetchedAt), desc(articles.publishedAt), desc(articles.id)];
