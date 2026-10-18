// The inbox filter lives in the URL: `f` is a folder id or "none" (未分類), `s` a feed id.

export type InboxFilter = { f?: string; s?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | undefined) => (v && /^[1-9]\d{0,9}$/.test(v) ? v : undefined);

/** Keeps only well-formed filter values from search params. */
export function parseInboxFilter(params: Record<string, string | string[] | undefined>): InboxFilter {
  const f = one(params.f);
  return { f: f === "none" ? f : id(f), s: id(one(params.s)) };
}

/** Query string (with "?", or "" when empty) for the filter plus any extra params. */
export function inboxQuery(filter: InboxFilter, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (filter.f) q.set("f", filter.f);
  if (filter.s) q.set("s", filter.s);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
