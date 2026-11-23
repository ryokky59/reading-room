// Values playwright.config.ts gives the app that the tests also need to know.

/**
 * How long a failed AI digest waits before the next try (DIGEST_RETRY_INTERVAL_MS in src/lib/feeds.ts).
 * Long enough for a slow CI runner to fetch and add a site within it.
 */
export const DIGEST_RETRY_INTERVAL_MS = 20_000;
