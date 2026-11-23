// Values playwright.config.ts gives the app that the tests also need to know.

/** The app's port. Override with E2E_PORT when several worktrees run tests at once. */
export const PORT = Number(process.env.E2E_PORT ?? 3210);

/**
 * Where e2e/server.mts takes `POST /reset`: the app is stopped, its database is put back to the
 * seed, and it is started again (see e2e/test.ts). The offset keeps it clear of other worktrees'
 * E2E_PORTs and of the API stand-in at PORT + 1000.
 */
export const RESET_PORT = PORT + 2000;

/** The app's database; the seed is kept beside it, and so is the note that a test failed. */
export const PGLITE_DIR = ".data/e2e";
export const SEED_DIR = `${PGLITE_DIR}-seed`;
export const DIRTY_FILE = `${PGLITE_DIR}-dirty`;

/**
 * How long a failed AI digest waits before the next try (DIGEST_RETRY_INTERVAL_MS in src/lib/feeds.ts).
 * Long enough for a slow CI runner to fetch and add a site within it.
 */
export const DIGEST_RETRY_INTERVAL_MS = 20_000;
