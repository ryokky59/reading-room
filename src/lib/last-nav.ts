// The path of the navigation the App Router started last, noted by src/instrumentation-client.ts.
// Null until the first navigation after a full load.
let last: string | null = null;

/** Called with the URL of each navigation as it starts: push, replace, <Link> and back / forward. */
export function noteNavStart(url: string) {
  // push / replace pass a relative URL, back / forward an absolute one.
  last = new URL(url, window.location.href).pathname;
}

export function lastNavPath() {
  return last;
}

/**
 * Whether the screen is still at `path` (or at `${path}/list`, the URL while the list arrives
 * after a full load, #66) and no navigation elsewhere has started: for a push after something
 * awaited, which would replace what the owner opened meanwhile. Browser back changes the URL at
 * once; a <Link>, router.push or j / k changes it only once its page has arrived, but is noted
 * as it starts.
 */
export function stillOn(path: string) {
  const at = (p: string) => p === path || p === `${path}/list`;
  return at(window.location.pathname) && (last === null || at(last));
}
