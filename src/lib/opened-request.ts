import "server-only";
import { sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getDb } from "@/lib/db";
import type { ListedRows } from "@/lib/inbox";
import { LISTED_COOKIE, parseListed } from "@/lib/opened";

/** The database's clock in whole milliseconds, like every seen_at (`seenNow` in lib/inbox.ts). */
export async function dbNow() {
  const db = await getDb();
  const [row] = await db.select({ now: sql<string>`floor(extract(epoch from now()) * 1000)`.mapWith(Number) }).from(sql`(select 1) as clock`);
  return row.now;
}

/**
 * Which seen articles stay listed for this request (lib/opened.ts). A full load starts again
 * from now, so the first HTML is already right; InboxShell then writes the new `since` to the
 * cookie (ListedSince) for the router's later requests. A full load is the browser asking for the
 * document, which its `accept` says (`text/html, ...`); the router's requests (a refresh, a chip,
 * 「もっと見る」, a prefetch, an action) are fetches and do not ask for HTML. The other signs do
 * not work here: Next hides the `rsc` header from `headers()`, and `sec-fetch-dest` is `empty`
 * for a document that the service worker (public/sw.js) fetches.
 *
 * The list beside an article (`besideArticle`) always keeps the cookie: when the router cannot
 * fetch `/articles/<id>/list` it loads that URL as a document, and the open article must still be
 * listed.
 */
export async function requestListed({ besideArticle = false } = {}): Promise<ListedRows> {
  const fullLoad = !besideArticle && ((await headers()).get("accept") ?? "").includes("text/html");
  const { since, open, cut } = parseListed(fullLoad ? undefined : (await cookies()).get(LISTED_COOKIE)?.value);
  return {
    since: new Date(since ?? (await dbNow())),
    open,
    cut: Object.entries(cut).map(([feed, at]) => ({ feedId: feed === "none" ? null : Number(feed), at: new Date(at) })),
  };
}
