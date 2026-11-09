// Articles opened beside the list (PCs) are seen, so the list query would drop them on its next
// refresh, while they should stay there, faded, for j / k and for keeping one's place. The list
// is a Server Component that router.refresh() refetches from the URL it was loaded from, so the
// only way to tell it which ones is on the request: a session cookie that InboxShell writes.
// A full load of the list starts again without them.

export const OPENED_COOKIE = "opened";

// Enough for a long sitting; the cookie goes with every request.
const MAX_OPENED = 100;

export function parseOpened(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(".")
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(-MAX_OPENED);
}

export function serializeOpened(ids: number[]) {
  return ids.slice(-MAX_OPENED).join(".");
}
