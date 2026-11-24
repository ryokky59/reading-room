// Seen articles leave the unread list, but the ones seen in this sitting (opened, or scrolled
// past) should stay in place, faded, for j / k and for keeping one's place. The list is a Server
// Component that router.refresh() refetches from the URL it was loaded from, so the only way to
// tell it which ones is on the request: a session cookie that InboxShell writes. It holds
//
// - `since`: when this sitting's list was loaded in full. Articles seen from then on stay. The
//   server picks it (lib/opened-request.ts) and the page writes it down; every seen_at is the
//   database's clock in whole milliseconds, like this, so the two compare exactly.
// - `open`: the article last opened, which stays whenever it was seen.
// - `cut`: per feed ("none" is the articles without one), the time of its 「すべて既読」. What that
//   feed had seen by then leaves, while the other feeds keep their faded rows.
// - `kept`: articles that 「元に戻す」 put back after 読了 / スキップ, which stay whenever they were
//   seen: one opened from its URL was seen before `since`, and one seen long ago may have been
//   opened under 既読を含む. Moving `since` back to them would bring back every row seen since.
//
// A full load of the list starts again: a new `since`, and nothing else. A full load of another
// page (an article's URL, /feeds, /read) does too, keeping only `open` (ListedOnFullLoad in
// InboxShell); only the list beside an article, when the router loads it as a document, keeps all.

export const LISTED_COOKIE = "listed";

export type Listed = {
  since: number | null;
  open: number | null;
  cut: Readonly<Record<string, number>>;
  kept: readonly number[];
};

export const NOTHING_LISTED: Listed = { since: null, open: null, cut: {}, kept: [] };

// Feeds number about 20; this only bounds a hand-edited cookie.
const MAX_CUTS = 50;

// One a 「元に戻す」; the newest stay.
const MAX_KEPT = 20;

// Ids are int4; a larger one in a hand-edited cookie would make the list query fail.
const MAX_ID = 2147483647;

// The latest time a Date can hold.
const MAX_TIME = 8.64e15;

const idOf = (s: string | undefined) => {
  const n = /^[1-9]\d{0,9}$/.test(s ?? "") ? Number(s) : 0;
  return n > 0 && n <= MAX_ID ? n : null;
};

const timeOf = (s: string | undefined) => {
  const n = /^[1-9]\d{0,15}$/.test(s ?? "") ? Number(s) : 0;
  return n > 0 && n <= MAX_TIME ? n : null;
};

/** A feed (or, alike, a folder) as the cookie and a filter's `f` name it: "none" for null. */
export function cutKey(feedId: number | null) {
  return feedId === null ? "none" : String(feedId);
}

/** Reads `<since>~<open>~<feed>-<time>.<feed>-<time>~<id>.<id>`; anything malformed in it is left out. */
export function parseListed(value: string | undefined): Listed {
  if (!value) return NOTHING_LISTED;
  const [since, open, cuts, kept] = value.split("~");
  const cut: Record<string, number> = {};
  for (const part of (cuts ?? "").split(".").slice(0, MAX_CUTS)) {
    const [feed, time] = part.split("-");
    const at = timeOf(time);
    if (at !== null && (feed === "none" || idOf(feed) !== null)) cut[feed] = at;
  }
  const ids = (kept ?? "").split(".").map(idOf);
  return {
    since: timeOf(since),
    open: idOf(open),
    cut,
    kept: [...new Set(ids.filter((id) => id !== null))].slice(-MAX_KEPT),
  };
}

/** Leaves out the cuts `since` already covers, and all but the newest few. */
export function serializeListed({ since, open, cut, kept }: Listed) {
  const cuts = Object.entries(cut)
    .filter(([, at]) => since === null || at >= since)
    .sort((a, b) => a[1] - b[1])
    .slice(-MAX_CUTS)
    .map(([feed, at]) => `${feed}-${at}`);
  const ids = kept.length > 0 ? `~${[...new Set(kept)].slice(-MAX_KEPT).join(".")}` : "";
  return `${since ?? ""}~${open ?? ""}~${cuts.join(".")}${ids}`;
}
