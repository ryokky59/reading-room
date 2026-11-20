import "server-only";
import { cookies, headers } from "next/headers";
import { OPENED_COOKIE, parseOpened } from "@/lib/opened";

/**
 * The opened articles (lib/opened.ts) for this request. A full load starts without them, so the
 * first HTML is already right and InboxShell only has to drop the cookie. A full load is the
 * browser asking for the document, which its `accept` says (`text/html, ...`); the router's
 * requests (a refresh, a chip, 「もっと見る」, a prefetch, an action) are fetches and do not ask
 * for HTML. The other signs do not work here: Next hides the `rsc` header from `headers()`, and
 * `sec-fetch-dest` is `empty` for a document that the service worker (public/sw.js) fetches.
 */
export async function requestOpened(): Promise<number[]> {
  const fullLoad = ((await headers()).get("accept") ?? "").includes("text/html");
  return fullLoad ? [] : parseOpened((await cookies()).get(OPENED_COOKIE)?.value);
}
