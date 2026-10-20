// The inbox filter lives in the URL: `f` is a folder id or "none" (未分類), `s` a feed id,
// `n` how many cards are shown (grown by 「もっと見る」).

import { and, desc, eq, isNull } from "drizzle-orm";
import { articles, feeds } from "./db/schema";

export type InboxFilter = { f?: string; s?: string; n?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | undefined) => (v && /^[1-9]\d{0,9}$/.test(v) ? v : undefined);

/** Keeps only well-formed filter values from search params. */
export function parseInboxFilter(params: Record<string, string | string[] | undefined>): InboxFilter {
  const f = one(params.f);
  return { f: f === "none" ? f : id(f), s: id(one(params.s)), n: id(one(params.n)) };
}

/** Query string (with "?", or "" when empty) for the filter plus any extra params. */
export function inboxQuery(filter: InboxFilter, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (filter.f) q.set("f", filter.f);
  if (filter.s) q.set("s", filter.s);
  if (filter.n) q.set("n", filter.n);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Unread articles in the filter's folder or site. The query must left join `feeds`. */
export function inboxWhere(filter: InboxFilter) {
  const folderId = filter.f && filter.f !== "none" ? Number(filter.f) : null;
  const feedId = filter.s ? Number(filter.s) : null;
  return and(
    eq(articles.status, "inbox"),
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
