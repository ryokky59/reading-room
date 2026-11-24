@AGENTS.md

# Reading Room

A personal app: RSS articles on tech and business, read on phone and PC and discussed with Claude. The UI and all user-facing text are in Japanese. Code, comments and commit messages are in English.

## Development flow

Work is tracked as GitHub Issues in `ryokky59/reading-room` and moves through labels:

`idea` → `ready` → `in-progress` → (PR merged, Issue closed)

- `idea`: written by the planner; not yet approved.
- `ready`: the owner approved it; it can be picked up.
- `in-progress`: a developer has a branch for it.
- `auto`: needs no decision from the owner (a bug or test fix, a review follow-up with one obvious fix). The planner gives it instead of `idea`, with `ready`. An Orca automation picks these up one at a time, develops, reviews and merges them by `.claude/automation/pick-issue.md`.
- `auto:blocked`: the automation stopped and asked the owner on the Issue. Removing the label lets it pick the Issue up again.
- `curator`: the idea came from a morning report (below), not from the owner. It is `idea` like any other until the owner decides.
- `report`: the one Issue where the morning reports arrive as comments. It is not work to pick up.

Rules:

- What to read from and what to build next is proposed by the `curator` agent, from the owner's reading data (read-only, through `.claude/scripts/reading-data.mjs`). It proposes; the owner picks. A second Orca automation runs it at 6:00 every morning by `.claude/automation/morning-report.md`: a report on the `report` Issue, and at most one new `idea` Issue.
- Issues are drafted by the `planner` agent, including small follow-ups from a review.
- One Issue, one branch, one PR. Branch names are `issue-<number>-<short-slug>`.
- Never push to `main` directly. Merging is the owner's call; agents do not merge. The one exception is the automation, for `auto` Issues and only under the conditions in `.claude/automation/pick-issue.md`.
- A PR body starts with `Closes #<number>` and lists how each acceptance criterion was checked.
- The owner checks PRs on their phone through the Vercel preview URL.
- After each Issue's PR is reviewed, run a retrospective (`/retro`) and turn what went wrong into changes to these process files. Those changes go in their own PR on a `retro-<issue>-<slug>` branch.

## Checks

Run all of these before opening or updating a PR (CI runs the same):

```sh
npm run lint
npm run typecheck
npm run build
npm run test:e2e   # needs a fresh build; Playwright Chromium (`npx playwright install chromium`)
```

- E2E tests live in `e2e/` and run against a production build with a seeded PGlite database (`e2e/seed.mts`). They must not call the Anthropic API or the network.
- E2E blocks the Service Worker (`serviceWorkers: "block"` in `playwright.config.ts`): `page.route` does not reach the requests of a page a Service Worker controls. A test that needs the Service Worker turns it on for its own describe (`test.use({ serviceWorkers: "allow" })`) and cuts the network with `context.setOffline()`, not `page.route`. Only reloading an opened article offline is covered that way (`e2e/leave.spec.ts`, #128); any other change to offline reading or cached pages is checked in a real browser, and the PR says so.
- Specs import `test` from `./test`, not from `@playwright/test`: after a failed test it puts the database back to the seed, so a retry and the tests after it start clean.
- Add or update an E2E test for each user-visible change. Add seed rows rather than relying on test order, and only as many as the test needs: every unread row shows on the Board at `/`, and a heavier Board slows every test that loads it.
- A seed article with no summary and tries left is digested again by any test that fetches (「今すぐ取得」), and the stub in `digest.spec.ts` fails it: its `digestAttempts` rises during the suite. A row that must stay "still to come" gets a `digestTriedAt` in the future (#68: the test passed alone and failed in the full run).
- To show a timing bug is fixed, run the test several times with a fresh seed before each run. `--repeat-each` reuses one seed, so tests that open or mark rows fail from the second repeat on.
- A passing full run does not show a test is stable alone. After a change to what every test shares (`playwright.config.ts`, `e2e/test.ts`, `e2e/server.mts`, the seed), also run alone, with a fresh seed each, the tests that use what changed (#127: blocking the Service Worker made one `page.route` test fail 4 of 5 alone while every full run passed).
- `test.fixme` or `test.skip` on an existing test is the owner's call: report what the test shows, and when they choose it, the comment above the test names the Issue that brings it back.
- An undo must put the screen back as it was before the action, not only the rows it changed. Test it after a different action has left state of its own (another button's `cut` in the listed Cookie, an open article): an action that rewrites shared state can drop what was there, and an undo that restores only its own part loses it. Test too that it brings back nothing else: have rows that must stay away (seen earlier, cut), in both orders around the one undone (#112: an undo moved `since` back to the article's first open and returned every row seen since; the test had only the order that passed).
- From 1024px wide an opened article slides in from the right for 0.22s, and `toBeVisible()` passes while it is still off screen. A test that reads the article's position right after opening it polls the value (`expect.poll`), or compares sizes that a transform does not change (#132: the pane's right edge read 2096 at 1440×900).
- Read a Playwright result from its `N failed` line or `test-results/.last-run.json`, not from the last line of output: `| tail` hides the failed list above the summary and replaces Playwright's exit code.
- When several worktrees test at once, set `E2E_PORT` at least 2 apart and not 1000 apart (`E2E_PORT + 1` and `E2E_PORT + 1000` are used too).
- CI stops the job at 30 minutes, and a run stopped there shows as cancelled, not failed, and uploads no report. Before re-running, read its log for a failed test: a re-run only helps when nothing had failed. When the E2E step passes 20 minutes, say so in the PR so the suite gets split before the limit is reached again.
- Before `npm ci`, a build or an E2E run, look at the free disk (`df -h /`). Under 2 GB, do not start: write on the Issue or PR what is done and what is left, and report. A full disk stops the shell mid-run, and what the run had found is lost with it (#56: twice, with the review not yet posted).
- If new Tailwind classes have no effect, delete `.next` and build again.
- `next build` stops with a notice that this Next.js has a known vulnerability (`SecurityFatalError`, exit code 1); in an agent's shell this is every other build, not CI or Vercel. Run it again within 5 minutes and it builds. Do not run the upgrade the notice suggests (`next upgrade --agent=security`): it changes dependencies, which is the owner's call (Issue #111). Tell the owner it appeared.

## Notes

- Local dev without `DATABASE_URL` uses PGlite under `.data/` and migrates automatically. Schema changes need a Drizzle migration in `drizzle/`; say in the PR that it must be applied to production Neon before deploy. If two migrations collide on a number, regenerate one with `drizzle-kit generate`; a renamed file keeps its old `when`, and Drizzle silently skips it in production.
- Production is protected by Vercel Authentication; there is no app-level login.
- The production database is Neon project `round-feather-65545481`. Give the id in any `neonctl` command (`npx neonctl connection-string main --project-id round-feather-65545481`); without it the CLI asks which org to use and hangs inside `$(...)`.
- Vercel has one `DATABASE_URL` entry for Production and Preview, so a preview may be using the production database. A PR with a migration or a new write says so in what the owner should check.
- Models are set in `src/lib/ai.ts`.
- A Cookie the client writes to tell the server what to send (`listed`, `layout`) is shared by every window and tab of the browser, and they can differ in size and in what is open. Code that depends on one must cope with another window having rewritten it since this one last wrote it; test that by setting the Cookie from the test while the page is open (#65).
- On phones the list stays mounted under `display: none` while an article is open (see `InboxShell.tsx`). Code that measures or animates the list must cope with zero sizes while it is hidden.
