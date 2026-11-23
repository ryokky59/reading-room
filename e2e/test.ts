// The `test` every spec uses: Playwright's, plus putting the database back to the seed after a
// test fails, so the retry (and whatever runs next) does not start from rows the failure left
// changed. A green run never resets; each reset costs about as long as starting the app.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { test as base } from "@playwright/test";
import { DIRTY_FILE, RESET_PORT } from "./env";

export * from "@playwright/test";

export const test = base.extend<{ cleanSeed: void }>({
  cleanSeed: [
    async ({}, use, testInfo) => {
      // Playwright starts a new worker after a failure, so the note is kept in a file.
      if (existsSync(DIRTY_FILE)) {
        const res = await fetch(`http://127.0.0.1:${RESET_PORT}/reset`, { method: "POST" });
        if (!res.ok) throw new Error(`could not reset the database: ${res.status} ${await res.text()}`);
        rmSync(DIRTY_FILE);
      }
      await use();
      if (testInfo.status !== testInfo.expectedStatus) writeFileSync(DIRTY_FILE, testInfo.titlePath.join(" > "));
    },
    // The reset is not the test's time; it restarts the app, which a slow runner takes seconds for.
    { auto: true, timeout: 60_000 },
  ],
});
