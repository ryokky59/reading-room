// Runs the app for the E2E tests (playwright.config.ts starts this as its web server).
//
// The seed is built once, into SEED_DIR, and the app runs on a copy of it. A test that fails can
// leave rows changed, and a request it had held back can still reach the server as its page
// closes, so the next test (the retry, in CI) would start from that. `POST /reset` on RESET_SOCKET
// stops the app, copies the seed over its database and starts it again; e2e/test.ts asks for it
// before the first test after a failure. Copying takes well under a second; seeding again would
// take as long as the first seed.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { CRASHED_FILE, DIRTY_FILE, PGLITE_DIR, PORT, RESET_SOCKET, SEED_DIR } from "./env";

const log = (message: string) => console.error(`[e2e] ${message}`);

function run(command: string, args: string[], env: Record<string, string>) {
  return spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

async function seed() {
  const child = run("npx", ["tsx", "e2e/seed.mts"], { PGLITE_DIR: SEED_DIR });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`seeding failed (exit code ${code})`);
}

let app: ChildProcess | undefined;

async function start() {
  rmSync(PGLITE_DIR, { recursive: true, force: true });
  cpSync(SEED_DIR, PGLITE_DIR, { recursive: true });
  const child = run("node_modules/.bin/next", ["start", "-p", String(PORT)], { PGLITE_DIR });
  app = child;
  // Playwright does not watch its web server once the tests have started. If the app stops on
  // its own, say so where every later test will report it, rather than as a refused connection.
  child.on("exit", (code, signal) => {
    if (app !== child) return; // stopped for a reset
    const message = `the app exited on its own (${signal ?? `exit code ${code}`}); its output is above`;
    log(message);
    writeFileSync(CRASHED_FILE, message);
  });
  // Ready once it answers; the first request also opens and migrates the database.
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the app exited (exit code ${child.exitCode})`);
    const ok = await fetch(`http://localhost:${PORT}/`, { redirect: "manual" }).then(
      (res) => res.status < 500,
      () => false,
    );
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function stop() {
  const child = app;
  app = undefined;
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}

let resetting = Promise.resolve();

rmSync(DIRTY_FILE, { force: true });
rmSync(CRASHED_FILE, { force: true });
rmSync(RESET_SOCKET, { force: true }); // left by a run that was killed

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/reset") {
    res.writeHead(404).end();
    return;
  }
  const started = Date.now();
  const done = resetting.then(async () => {
    await stop();
    await start();
  });
  resetting = done.catch(() => {});
  done.then(
    () => {
      log(`database put back to the seed and app restarted in ${Date.now() - started} ms`);
      res.writeHead(204).end();
    },
    (error: unknown) => {
      log(`reset failed: ${error}`);
      res.writeHead(500).end(String(error));
    },
  );
}).listen(RESET_SOCKET);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app?.kill("SIGTERM");
    process.exit(0);
  });
}

await seed();
await start();
