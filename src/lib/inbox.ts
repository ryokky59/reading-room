// The inbox filter lives in the URL: `f` is a folder id or "none" (未分類), `s` a feed id,
// `n` how many cards are shown (grown by 「もっと見る」), `a=1` also shows seen (既読) articles.

import { and, desc, eq, isNull } from "drizzle-orm";
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

/** The order the list shows unread articles in, newest first; the id breaks ties so paging is stable. */
export const inboxOrder = [desc(articles.fetchedAt), desc(articles.publishedAt), desc(articles.id)];
