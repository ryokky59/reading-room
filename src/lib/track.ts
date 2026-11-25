// The activity log, in the browser: track() sends one event to /api/activity with the device and
// screen it happened on. Sending never waits, never retries and never throws: a lost event
// changes nothing on screen. The values are listed in lib/events.ts and in README.md.

import { isWide, listScreenOf, showsBoardUrl } from "@/components/InboxShell";
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
  if (pathname === "/") return showsBoardUrl(pathname, params) ? "board" : listScreenOf(params);
  return null;
}

/**
 * Sends one event. Never throws and never waits; nothing happens if it is lost. `screen` is read
 * from the URL when sent unless given: an effect cleanup runs after the URL has changed to the
 * next screen, so say it there.
 */
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

/**
 * The view id of article `articleId` while it is open, else null. Call it when the event is
 * sent, not when the article mounts: ActivityLog comes after the page in the root layout, so
 * its effect makes the new view after the article's mount effects have run. An effect cleanup
 * on leaving still sees the old view, since cleanups run before mount effects.
 */
export function currentViewId(articleId: number) {
  return view?.articleId === articleId ? view.viewId : null;
}

// The screen shown before the current one, and how the next article is being opened when the
// article view says so itself (markOpenSource). `lastList` is the kind of list its URL had: an
// article's URL carries the filter of the list beside it.
let lastScreen: Screen | null = null;
let lastList: "list" | "timeline" = "list";
let pendingSource: OpenSource | null = null;

/**
 * Says how the article about to be opened was chosen, for the ones the screen before cannot tell:
 * `next` after 読了 / スキップ, `key` for j / k. Call it just before router.push to that article.
 */
export function markOpenSource(source: OpenSource) {
  pendingSource = source;
}

/** How an article opened from `screen` was chosen, when nothing marked it. */
function sourceFrom(screen: Screen | null, list: "list" | "timeline"): OpenSource {
  switch (screen) {
    case null:
      return "direct"; // the first screen of this page load: a typed or shared URL, or a reload
    case "board":
      return "board";
    case "read":
      return "read";
    case "timeline":
      return "timeline";
    default:
      // A feed list, or the list (or the timeline) beside another article.
      return list;
  }
}

/**
 * Called on every change of screen or of the open article (see ActivityLog). Sends `open` when
 * another article (or the same one again, after leaving it) shows; a URL that changes only the
 * list beside the article, or a router.refresh(), keeps the view. `list` is the kind of list the
 * URL's filter shows (listScreenOf).
 */
export function noteScreen(screen: Screen | null, articleId: number | null, list: "list" | "timeline" = "list") {
  const marked = pendingSource;
  pendingSource = null;
  if (articleId === null) view = null;
  else if (view?.articleId !== articleId) {
    view = { articleId, viewId: randomId() };
    track("open", { screen: "article", articleId, source: marked ?? sourceFrom(lastScreen, lastList) });
  }
  if (screen) {
    lastScreen = screen;
    lastList = list;
  }
}
