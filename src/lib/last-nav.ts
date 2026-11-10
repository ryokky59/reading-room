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
