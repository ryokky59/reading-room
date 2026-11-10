// The activity log, in the browser: track() sends one event to /api/activity with the device and
// screen it happened on. Sending never waits, never retries and never throws: a lost event
// changes nothing on screen. The values are listed in lib/events.ts and in README.md.

import { isWide, showsBoardUrl } from "@/components/InboxShell";
import type { ActivityEvent, EventType, OpenSource, Screen } from "./events";

/** What a caller gives track(); the device, the screen and the open article's view are added. */
export type TrackFields = Partial<
  Pick<ActivityEvent, "screen" | "articleId" | "source" | "viewId" | "dwellMs" | "activeMs" | "scrollPct" | "props">
>;

/** A random id; crypto.randomUUID() needs a secure context, which a phone on the LAN dev server is not. */
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let session: string | null = null;

/** One id per browser tab: sessionStorage keeps it across reloads and drops it with the tab. */
function sessionId() {
  if (session) return session;
  try {
    session = sessionStorage.getItem("activity-session");
    if (!session) {
      session = randomId();
      sessionStorage.setItem("activity-session", session);
    }
  } catch {
    session ??= randomId();
  }
  return session;
}

/** The article id in an article URL (`/articles/<id>` and `/articles/<id>/list`), else null. */
export function articleIdOf(pathname: string) {
  const match = /^\/articles\/(\d+)/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** Which screen a URL shows, or null for one outside the app's screens. */
export function screenOf(pathname: string, params: URLSearchParams): Screen | null {
  if (articleIdOf(pathname) !== null) return "article";
  if (pathname === "/read") return "read";
  if (pathname === "/feeds") return "feeds";
  if (pathname === "/") return showsBoardUrl(pathname, params) ? "board" : "list";
  return null;
}

/** Sends one event. Never throws and never waits; nothing happens if it is lost. */
export function track(type: EventType, fields: TrackFields = {}) {
  try {
    const screen = fields.screen ?? screenOf(location.pathname, new URLSearchParams(location.search));
    if (!screen) return;
    // An event about the open article belongs to its view, unless the caller says otherwise.
    const viewId =
      fields.viewId !== undefined ? fields.viewId : fields.articleId != null ? currentViewId(fields.articleId) : null;
    const event: ActivityEvent = {
      ...fields,
      type,
      sessionId: sessionId(),
      // Pointer, not width: a landscape iPhone or an unfolded phone is as wide as a small PC.
      device: matchMedia("(pointer: coarse)").matches ? "phone" : "pc",
      layout: isWide() ? "split" : "single",
      vw: Math.round(innerWidth),
      vh: Math.round(innerHeight),
      standalone:
        matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      screen,
      viewId,
    };
    const body = JSON.stringify(event);
    // sendBeacon survives the page being closed; it says false when it cannot queue the body.
    if (!navigator.sendBeacon?.("/api/activity", body)) {
      fetch("/api/activity", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {}
}

/** One opening of an article; the events sent while it stays open share its id. */
let view: { articleId: number; viewId: string } | null = null;

/** The view id of article `articleId` while it is open, else null. */
export function currentViewId(articleId: number) {
  return view?.articleId === articleId ? view.viewId : null;
}

// The screen shown before the current one, and how the next article is being opened when the
// article view says so itself (markOpenSource).
let lastScreen: Screen | null = null;
let pendingSource: OpenSource | null = null;

/**
 * Says how the article about to be opened was chosen, for the ones the screen before cannot tell:
 * `next` after 読了 / スキップ, `key` for j / k. Call it just before router.push to that article.
 */
export function markOpenSource(source: OpenSource) {
  pendingSource = source;
}

/** How an article opened from `screen` was chosen, when nothing marked it. */
function sourceFrom(screen: Screen | null): OpenSource {
  switch (screen) {
    case null:
      return "direct"; // the first screen of this page load: a typed or shared URL, or a reload
    case "board":
      return "board";
    case "read":
      return "read";
    default:
      // A feed list, or the list beside another article.
      return "list";
  }
}

/**
 * Called on every change of screen or of the open article (see ActivityLog). Sends `open` when
 * another article (or the same one again, after leaving it) shows; a URL that changes only the
 * list beside the article, or a router.refresh(), keeps the view.
 */
export function noteScreen(screen: Screen | null, articleId: number | null) {
  const marked = pendingSource;
  pendingSource = null;
  if (articleId === null) view = null;
  else if (view?.articleId !== articleId) {
    view = { articleId, viewId: randomId() };
    track("open", { screen: "article", articleId, source: marked ?? sourceFrom(lastScreen) });
  }
  if (screen) lastScreen = screen;
}
