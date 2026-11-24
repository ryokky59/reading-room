// Tries are at least DIGEST_RETRY_INTERVAL_MS apart (src/lib/feeds.ts), however often feeds are
// fetched, so this rides out an API outage of a few hours.
export const DIGEST_ATTEMPT_LIMIT = 5;
/** What a list card and a Board column's first row say once the digest is given up on. */
export const DIGEST_FAILED = "AI 要約できませんでした";

// Dates are shown and grouped in Japan time regardless of the server's zone.
const JST_OFFSET_MS = 9 * 3600_000;

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
