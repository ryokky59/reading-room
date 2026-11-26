// Tries are at least DIGEST_RETRY_INTERVAL_MS apart (src/lib/feeds.ts), however often feeds are
// fetched, so this rides out an API outage of a few hours.
export const DIGEST_ATTEMPT_LIMIT = 5;
/** What a list card and a Board column's first row say once the digest is given up on. */
export const DIGEST_FAILED = "AI 要約できませんでした";

// Dates are shown and grouped in Japan time regardless of the server's zone.
const JST_OFFSET_MS = 9 * 3600_000;

/** When the morning picks change over (lib/picks.ts), in hours after midnight JST. */
const PICK_DAY_STARTS_HOUR = 6;

/**
 * The pick day `date` falls in, as YYYY-MM-DD: a day in JST that starts at 6:00, so 0:00-5:59 is
 * still the day before. The cron that chooses the picks and the Board that shows them both use it.
 */
export function pickDay(date = new Date()): string {
  return new Date(date.getTime() + JST_OFFSET_MS - PICK_DAY_STARTS_HOUR * 3600_000).toISOString().slice(0, 10);
}

export function monthKey(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 7);
}

/** [start, end) of a YYYY-MM month in JST, as UTC instants. */
export function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split("-").map(Number);
  return [
    new Date(Date.UTC(y, m - 1, 1) - JST_OFFSET_MS),
    new Date(Date.UTC(y, m, 1) - JST_OFFSET_MS),
  ];
}

export function formatDate(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date.getTime() + JST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function readingMinutes(chars: number): number {
  // ~600 Japanese characters a minute; a rough guide for English too.
  return Math.max(1, Math.round(chars / 600));
}

export function formatDateTime(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date.getTime() + JST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

/** How long ago `date` was, for 「12 分前に取得」. */
export function formatAgo(date: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes} 分前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 時間前`;
  return `${Math.floor(minutes / (24 * 60))} 日前`;
}

/** What the header says about fetching: 「12 分前に取得」, or 「新着が N 時間入っていません」 when stale. */
export type FetchedLabel = { text: string; stale: boolean };

/**
 * How long the newest feed article may be before the header says new articles have stopped. The
 * longest gap in production over 10/25-11/23 was two hours; six is three times that (#168).
 */
export const STALE_AFTER_MS = 6 * 3600_000;

/**
 * 「新着が 7 時間入っていません」 once the newest article from a feed is STALE_AFTER_MS old, null
 * before that or with no such article. A feed's `lastFetchedAt` moves on even when every article
 * fails to save, so this is what shows that saving has stopped (#168).
 */
export function staleLabel(newest: Date | null, now = new Date()): string | null {
  if (!newest) return null;
  const ms = now.getTime() - newest.getTime();
  if (ms < STALE_AFTER_MS) return null;
  const hours = Math.floor(ms / 3600_000);
  return hours < 24 ? `新着が ${hours} 時間入っていません` : `新着が ${Math.floor(hours / 24)} 日入っていません`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Before the AI digest has run, treat a title without kana as non-Japanese. */
export function isForeign(lang: string | null, title: string): boolean {
  return lang ? lang === "other" : !/[\u3040-\u30ff]/.test(title);
}
