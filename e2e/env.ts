// Values playwright.config.ts gives the app that the tests also need to know.

/** The app's port. Override with E2E_PORT when several worktrees run tests at once. */
export const PORT = Number(process.env.E2E_PORT ?? 3210);

/** e2e/stub.mts, which stands in for the feeds and the favicon service. */
export const STUB_PORT = PORT + 1;

/** The app's database; the seed is kept beside it, and so is the note that a test failed. */
export const PGLITE_DIR = ".data/e2e";
export const SEED_DIR = `${PGLITE_DIR}-seed`;
export const DIRTY_FILE = `${PGLITE_DIR}-dirty`;
/** Written by e2e/server.mts if the app stops on its own; e2e/test.ts then fails each test with it. */
export const CRASHED_FILE = `${PGLITE_DIR}-crashed`;

/**
 * Where e2e/server.mts takes `POST /reset`: the app is stopped, its database is put back to the
 * seed, and it is started again (see e2e/test.ts). A socket in this worktree's .data rather than
 * a port, so it cannot meet another worktree's ports however their E2E_PORTs are spaced.
 */
export const RESET_SOCKET = `${PGLITE_DIR}-reset.sock`;

/**
 * How long a failed AI digest waits before the next try (DIGEST_RETRY_INTERVAL_MS in src/lib/feeds.ts).
 * Long enough for a slow CI runner to fetch and add a site within it.
 */
export const DIGEST_RETRY_INTERVAL_MS = 20_000;

/**
 * How long the AI may take to choose the morning picks (PICKS_TIMEOUT_MS in src/lib/ai.ts). Far over
 * what a picks call to the stub takes (0.1 s in CI), and short enough for e2e/picks.spec.ts to wait it out.
 */
export const PICKS_TIMEOUT_MS = 3000;

/** The bearer token /api/cron takes in the E2E runs (e2e/picks.spec.ts). */
export const CRON_SECRET = "e2e-cron-secret";
