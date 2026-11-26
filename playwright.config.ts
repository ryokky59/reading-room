import { defineConfig, devices } from "@playwright/test";
import { CRON_SECRET, DIGEST_RETRY_INTERVAL_MS, PGLITE_DIR, PORT, STUB_PORT } from "./e2e/env";

// The AI digest runs when a test imports a feed; a local base URL keeps it from ever reaching the
// Anthropic API. e2e/digest.spec.ts listens there to play the API; elsewhere nothing does, and
// every call fails. The key is a dummy: without one the SDK fails before it sends anything.
// The offset is large so the port stays clear of other worktrees' consecutive E2E_PORTs.
const env = {
  PGLITE_DIR,
  ANTHROPIC_API_KEY: "e2e-dummy",
  ANTHROPIC_AUTH_TOKEN: "",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT + 1000}`,
  E2E_STUB_PORT: String(STUB_PORT),
  FAVICON_SERVICE: `http://localhost:${STUB_PORT}/favicons`,
  // Long enough for e2e/digest.spec.ts to press 「今すぐ取得」 once and add a site within it.
  DIGEST_RETRY_INTERVAL_MS: String(DIGEST_RETRY_INTERVAL_MS),
  // e2e/picks.spec.ts calls /api/cron with it.
  CRON_SECRET,
};

// Tests share one seeded database, so they run one at a time. After a test fails, the next one
// (its retry, in CI) starts from the seed again: e2e/server.mts and e2e/test.ts.
// Run `npm run build` first; the server is a production build on its own port.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI, stop before the job's 20-minute limit (.github/workflows/ci.yml) so a slow run ends as
  // failed, with its report and test-results/.last-run.json, rather than cancelled with nothing.
  // The time counts from the seed and the server starting; the job's setup before it is about 3 min.
  globalTimeout: process.env.CI ? 15 * 60_000 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    trace: "retain-on-failure",
    // Once the app's Service Worker (public/sw.js) controls a page, the page's requests no longer
    // reach page.route, and tests that cut or fail a request see the real one go through (#113).
    // No test checks the Service Worker itself.
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: "npx tsx e2e/stub.mts",
      port: STUB_PORT,
      env,
      reuseExistingServer: false,
    },
    {
      command: "npx tsx e2e/server.mts",
      url: `http://localhost:${PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
