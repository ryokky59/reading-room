// The activity log's vocabulary, shared by track() in the browser (lib/track.ts) and by
// /api/activity, which accepts only these values. A new kind of event is one more entry in
// EVENT_TYPES; the columns are already there (see `events` in lib/db/schema.ts).

/**
 * The kinds of event. `open`: an article was opened. `leave`: the time spent on it and how far
 * it was read, sent on leaving it and when its tab is hidden; the last one of a view counts.
 */
export const EVENT_TYPES = ["open", "leave"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Where an article was opened from; see 「行動ログ」 in README.md. */
export const OPEN_SOURCES = ["board", "list", "next", "key", "read", "direct"] as const;
export type OpenSource = (typeof OPEN_SOURCES)[number];

export const SCREENS = ["board", "list", "article", "read", "feeds"] as const;
export type Screen = (typeof SCREENS)[number];

export const DEVICES = ["phone", "pc"] as const;
export const LAYOUTS = ["single", "split"] as const;

/** What a page sends to /api/activity. `env` and the time are added by the server. */
export type ActivityEvent = {
  type: EventType;
  sessionId: string;
  device: (typeof DEVICES)[number];
  layout: (typeof LAYOUTS)[number];
  vw: number;
  vh: number;
  standalone: boolean;
  screen: Screen;
  articleId?: number | null;
  source?: OpenSource | null;
  viewId?: string | null;
  dwellMs?: number | null;
  activeMs?: number | null;
  scrollPct?: number | null;
  props?: Record<string, unknown> | null;
};

/** The longest body /api/activity reads, in bytes. */
export const MAX_EVENT_BYTES = 4096;

const INT_MAX = 2 ** 31 - 1;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** The event in `body`, or null when anything in it is missing, unknown or of the wrong type. */
export function parseEvent(body: unknown): ActivityEvent | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const e = body as Record<string, unknown>;
  // Optional fields may be left out or null.
  const opt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || v === null || ok(v);
  const valid =
    oneOf(EVENT_TYPES, e.type) &&
    isId(e.sessionId) &&
    oneOf(DEVICES, e.device) &&
    oneOf(LAYOUTS, e.layout) &&
    isInt(e.vw, 0, 100_000) &&
    isInt(e.vh, 0, 100_000) &&
    typeof e.standalone === "boolean" &&
    oneOf(SCREENS, e.screen) &&
    opt(e.articleId, (v) => isInt(v, 1, INT_MAX)) &&
    opt(e.source, (v) => oneOf(OPEN_SOURCES, v)) &&
    opt(e.viewId, isId) &&
    opt(e.dwellMs, (v) => isInt(v, 0, INT_MAX)) &&
    opt(e.activeMs, (v) => isInt(v, 0, INT_MAX)) &&
    opt(e.scrollPct, (v) => isInt(v, 0, 100)) &&
    opt(e.props, (v) => typeof v === "object" && !Array.isArray(v));
  if (!valid) return null;
  return {
    type: e.type,
    sessionId: e.sessionId,
    device: e.device,
    layout: e.layout,
    vw: e.vw,
    vh: e.vh,
    standalone: e.standalone,
    screen: e.screen,
    articleId: (e.articleId as number | null | undefined) ?? null,
    source: (e.source as OpenSource | null | undefined) ?? null,
    viewId: (e.viewId as string | null | undefined) ?? null,
    dwellMs: (e.dwellMs as number | null | undefined) ?? null,
    activeMs: (e.activeMs as number | null | undefined) ?? null,
    scrollPct: (e.scrollPct as number | null | undefined) ?? null,
    props: (e.props as Record<string, unknown> | null | undefined) ?? null,
  } as ActivityEvent;
}
