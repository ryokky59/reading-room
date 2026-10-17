import { defineConfig, devices } from "@playwright/test";

// Override with E2E_PORT when several worktrees run tests at once.
const PORT = Number(process.env.E2E_PORT ?? 3210);
const env = { PGLITE_DIR: ".data/e2e" };

// Tests share one seeded database, so they run one at a time.
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
  webServer: {
    command: `npx tsx e2e/seed.mts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    env,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
