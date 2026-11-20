// Articles opened beside the list (PCs) or from the Board are seen, so the list query would drop them on its next
// refresh, while they should stay there, faded, for j / k and for keeping one's place. The list
// is a Server Component that router.refresh() refetches from the URL it was loaded from, so the
// only way to tell it which ones is on the request: a session cookie that InboxShell writes.
// A full load of the list starts again without them (lib/opened-request.ts).

export const OPENED_COOKIE = "opened";

// Enough for a long sitting; the cookie goes with every request.
const MAX_OPENED = 100;

// Ids are int4; a larger one in a hand-edited cookie would make the list query fail.
const MAX_ID = 2147483647;

export function parseOpened(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(".")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id <= MAX_ID)
    .slice(-MAX_OPENED);
}

export function serializeOpened(ids: number[]) {
  return ids.slice(-MAX_OPENED).join(".");
}
