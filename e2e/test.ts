// The `test` every spec uses: Playwright's, plus putting the database back to the seed after a
// test fails, so the retry (and whatever runs next) does not start from rows the failure left
// changed. A green run never resets; each reset costs about as long as starting the app.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { test as base } from "@playwright/test";
import { CRASHED_FILE, DIRTY_FILE, RESET_SOCKET } from "./env";

export * from "@playwright/test";

/** Asks e2e/server.mts to put the database back to the seed, and waits until the app is up again. */
function reset() {
  return new Promise<void>((resolve, reject) => {
    const req = request({ socketPath: RESET_SOCKET, path: "/reset", method: "POST" }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () =>
        res.statusCode === 204 ? resolve() : reject(new Error(`could not reset the database: ${res.statusCode} ${body}`)),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

export const test = base.extend<{ cleanSeed: void }>({
  cleanSeed: [
    async ({}, use, testInfo) => {
      if (existsSync(CRASHED_FILE)) throw new Error(`e2e/server.mts: ${readFileSync(CRASHED_FILE, "utf8")}`);
      // Playwright starts a new worker after a failure, so the note is kept in a file.
      if (existsSync(DIRTY_FILE)) {
        await reset();
        rmSync(DIRTY_FILE);
      }
      await use();
      if (testInfo.status !== testInfo.expectedStatus) writeFileSync(DIRTY_FILE, testInfo.titlePath.join(" > "));
    },
    // The reset is not the test's time; it restarts the app, which a slow runner takes seconds for.
    { auto: true, timeout: 60_000 },
  ],
});
