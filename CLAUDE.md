@AGENTS.md

# Reading Room

A personal app: RSS articles on tech and business, read on phone and PC and discussed with Claude. The UI and all user-facing text are in Japanese. Code, comments and commit messages are in English.

## Development flow

Work is tracked as GitHub Issues in `ryokky59/reading-room` and moves through labels:

`idea` → `ready` → `in-progress` → (PR merged, Issue closed)

- `idea`: written by the planner; a feature or product change. With a recommended option it also gets `auto` and `ready` and is built without waiting (see Decisions below).
- `ready`: it can be picked up.
- `in-progress`: a developer has a branch for it.
- `auto`: the Orca automation builds it. It picks these up one at a time, develops, reviews and merges them by `.claude/automation/pick-issue.md`. The planner gives it, with `ready`, to every Issue that has a recommended way to go and nothing that cannot be undone.
- `auto:blocked`: the automation stopped and asked the owner on the Issue, for one of the reasons under Decisions. Removing the label lets it pick the Issue up again.
- `curator`: the idea came from a morning report (below), not from the owner. Labeled like any other Issue.
- `report`: the one Issue where the morning reports arrive as comments. It is not work to pick up.

Rules:

- What to read from and what to build next is proposed by the `curator` agent, from the owner's reading data (read-only, through `.claude/scripts/reading-data.mjs`). Each proposal names the option it recommends, so it can be built without waiting; the owner can still stop or change it on the Issue. A second Orca automation runs it at 6:00 every morning by `.claude/automation/morning-report.md`: a report on the `report` Issue, and at most one new `idea` Issue.
- Issues are drafted by the `planner` agent, including small follow-ups from a review.
- One Issue, one branch, one PR. Branch names are `issue-<number>-<short-slug>`.
- Never push to `main` directly. A PR is merged once the reviewer's 判定 is マージしてよい and every check passes, under the conditions in `.claude/automation/pick-issue.md` step 5: by the automation, or by the session that ran `/dev`. The developer and reviewer agents themselves do not merge.
- A PR body starts with `Closes #<number>` and lists how each acceptance criterion was checked.
- What only a real phone or the Vercel preview can show does not hold a PR back. It is written after merging in a PR comment under オーナーに確かめてほしいこと, and the owner checks it on their phone (#77).
- After each Issue's PR is reviewed, run a retrospective (`/retro`) and turn what went wrong into changes to these process files. Those changes go in their own PR on a `retro-<issue>-<slug>` branch.

## Decisions

The default (the owner, 2026-11-26): do not wait for the owner. When an Issue, a review or an agent's report has a recommended option (「おすすめ」, 「案 A（おすすめ）」, 「このドラフトは〜で書いている」, or only one sensible way), go ahead with it: build, open the PR, review and merge, and say in the PR which option was taken and why. The owner reads the result and can change course on the Issue or with a new one. An answer the owner has written on the Issue always wins over the recommendation.

Stop and ask the owner (`auto:blocked`, with the options and what each would do) only when:

- there is no recommended option, or several options and none is marked as the one to take; or
- the step cannot be undone: deleting or overwriting production data (a migration that drops a table or column, or rewrites or deletes rows; a delete from production outside a migration), deleting a feed's history, or anything else whose loss a revert does not bring back; or
- it needs something only the owner can give: a secret's value, a login (`npx neonctl auth`), a paid plan.

A new dependency, a change to AI cost, a schema migration that only adds, and a change to these process files are not reasons to stop by themselves: they follow the recommendation like anything else, and the PR says what they cost.

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
- Add or update an E2E test for each user-visible change. Add seed rows rather than relying on test order, and only as many as the test needs: every unread row shows on the Board at `/`, and a heavier Board slows every test that loads it. New seed rows take the next free article number and folder `position` at the end of `e2e/seed.mts`, so two open PRs take the same ones: when merging `main` into a branch that adds seed rows, compare both ranges with what `main` added, also where git reports no conflict (#102: picks and the timeline both took articles 9000– and positions 210–).
- A seed article with no summary and tries left is digested again by any test that fetches (「今すぐ取得」), and the stub in `digest.spec.ts` fails it: its `digestAttempts` rises during the suite. A row that must stay "still to come" gets a `digestTriedAt` in the future (#68: the test passed alone and failed in the full run).
- To show a timing bug is fixed, or a new test is stable, run it several times with a fresh seed before each run, each run's output in its own file: a failure seen only in a summary cannot be read afterwards (#193: 1 of 13 failed, and the next 12 did not repeat it). `--repeat-each` reuses one seed, so tests that open or mark rows fail from the second repeat on.
- Once a test has shown the timeline, `/` loaded in it is replaced by `/?v=t` after hydration (`useRememberedView`), so `openTab` or a press right after `page.goto("/")` races that replace. Move on by what is on screen (the folder tab on the timeline) instead (#222: the #205 test passed its CI and then failed every run on `main`).
- A passing full run does not show a test is stable alone. After a change to what every test shares (`playwright.config.ts`, `e2e/test.ts`, `e2e/server.mts`, the seed), also run alone, with a fresh seed each, the tests that use what changed (#127: blocking the Service Worker made one `page.route` test fail 4 of 5 alone while every full run passed).
- `test.fixme` or `test.skip` on an existing test is a last resort: report what the test shows, and when it is the recommended way, the comment above the test names the Issue that brings it back.
- An undo must put the screen back as it was before the action, not only the rows it changed. Test it after a different action has left state of its own (another button's `cut` in the listed Cookie, an open article): an action that rewrites shared state can drop what was there, and an undo that restores only its own part loses it. Test too that it brings back nothing else: have rows that must stay away (seen earlier, cut), in both orders around the one undone (#112: an undo moved `since` back to the article's first open and returned every row seen since; the test had only the order that passed).
- From 1024px wide an opened article slides in from the right for 0.22s, and `toBeVisible()` passes while it is still off screen. A test that reads the article's position right after opening it polls the value (`expect.poll`), or compares sizes that a transform does not change (#132: the pane's right edge read 2096 at 1440×900).
- `gh pr checks <n> --watch` can end with exit code 0 while the `e2e` jobs are still pending: they start after `check`, and a watch begun right after a push ends before they are listed. Run `gh pr checks <n>` once more after it and merge or report only when no line says `pending` (#102).
- Read a Playwright result from its `N failed` line or `test-results/.last-run.json`, not from the last line of output: `| tail` hides the failed list above the summary and replaces Playwright's exit code.
- When several worktrees test at once, set `E2E_PORT` at least 2 apart and not 1000 apart (`E2E_PORT + 1` and `E2E_PORT + 1000` are used too).
- CI runs E2E in three jobs, `e2e 1` to `e2e 3`, each with its own seed and server and its own report (`playwright-report-<group>`). Each runs the spec files listed for its group in `.github/workflows/ci.yml`, both projects. A new spec goes in the group that took least time; `check` fails while a spec is in no group or in two. Locally, `npm run test:e2e` still runs everything at once.
- In CI, Playwright stops itself at 15 minutes (`globalTimeout`): the job shows as failed and its report is uploaded, with `"status": "timedout"` in `test-results/.last-run.json`. The job's own 20-minute limit only catches a job stuck outside Playwright, and shows as cancelled with no report. Before re-running, read the log for a failed test: a re-run only helps when nothing had failed. When an `e2e` job passes 12 minutes, say so in the PR so the groups get rebalanced before the limit is reached.
- Before `npm ci`, a build or an E2E run, look at the free disk (`df -h /`). Under 2 GB, do not start: write on the Issue or PR what is done and what is left, and report. A full disk stops the shell mid-run, and what the run had found is lost with it (#56: twice, with the review not yet posted). Look right before each run, not once per session, and make the look stop the command (`[ "$(df -g / | awk 'NR==2{print $4}')" -ge 2 ] && npx playwright test …`): other worktrees fill the disk within the hour (#162: 15 GB at the start, 1.7 GB when the full run began, and only the printed `df` showed it).
- If new Tailwind classes have no effect, delete `.next` and build again.
- `next build` stops with a notice that this Next.js has a known vulnerability (`SecurityFatalError`, exit code 1); in an agent's shell this is every other build, not CI or Vercel. Run it again within 5 minutes and it builds. Do not run the upgrade the notice suggests (`next upgrade --agent=security`) inside another Issue's PR: it changes dependencies, and it is Issue #111's work. Say in the report that it appeared.

## Notes

- Local dev without `DATABASE_URL` uses PGlite under `.data/` and migrates automatically. Schema changes need a Drizzle migration in `drizzle/`. A PR with a migration is merged like any other once CI passes; right after the merge, whoever merged it applies it to production Neon and checks that production recovered (`.claude/automation/pick-issue.md` step 5). Write migrations so the code before and after them both run, where that is possible: production runs the new code for the minutes before the migration lands. If two migrations collide on a number, regenerate one with `drizzle-kit generate`; a renamed file keeps its old `when`, and Drizzle silently skips it in production. Whether a migration is in production is read, not taken from what someone remembers: `echo "select hash from drizzle.__drizzle_migrations order by created_at desc limit 1" | node .claude/scripts/reading-data.mjs` gives the `shasum -a 256` of the last file applied (#102: the owner took `0011_picks` for applied; the log ended at 0010 and the table was not there).
- Production is protected by Vercel Authentication; there is no app-level login. An agent reads a preview or production page through the Vercel MCP tool `web_fetch_vercel_url` (it goes through a share link). The Board comes back as over 1 MB of HTML saved to a file: count strings in it (`data-row`, the section's label, `Application error`) rather than reading it, and say in the PR that the HTML was checked, not the look in a browser.
- The production database is Neon project `round-feather-65545481`. Give the id in any `neonctl` command (`npx neonctl connection-string main --project-id round-feather-65545481`); without it the CLI asks which org to use and hangs inside `$(...)`.
- Vercel has one `DATABASE_URL` entry for Production and Preview, so a preview may be using the production database. A PR with a migration or a new write says so under オーナーに確かめてほしいこと.
- Models are set in `src/lib/ai.ts`.
- A Cookie the client writes to tell the server what to send (`listed`, `layout`) is shared by every window and tab of the browser, and they can differ in size and in what is open. Code that depends on one must cope with another window having rewritten it since this one last wrote it; test that by setting the Cookie from the test while the page is open (#65).
- On phones the list stays mounted under `display: none` while an article is open (see `InboxShell.tsx`). Code that measures or animates the list must cope with zero sizes while it is hidden.
- In `npm run dev` only, opening (or reloading) an article URL with no query, such as `/articles/1`, at PC width leaves the address bar at `/articles/<id>/list`. The screen is right (the article and the list beside it); only the URL stays. With a query (`/articles/1?a=1`) it returns to the article's URL, and so does opening `/articles/<id>/list` directly. A production build (`next build` / `next start`, so E2E and Vercel) always returns. It is not a bug to fix in the app: it looks like the dev router's, and replacing `router.replace` with `history.replaceState` was turned down because it changes how production returns the URL (#173).
