import { defineConfig, devices } from "@playwright/test";
import { DIGEST_RETRY_INTERVAL_MS, PGLITE_DIR, PORT } from "./e2e/env";

// e2e/stub.mts, which stands in for the feeds and the favicon service.
const STUB_PORT = PORT + 1;
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
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    trace: "retain-on-failure",
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
