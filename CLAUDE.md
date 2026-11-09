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

Rules:

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
- Add or update an E2E test for each user-visible change. Add seed rows rather than relying on test order.
- To show a timing bug is fixed, run the test several times with a fresh seed before each run. `--repeat-each` reuses one seed, so tests that open or mark rows fail from the second repeat on.
- Read a Playwright result from its `N failed` line or `test-results/.last-run.json`, not from the last line of output: `| tail` hides the failed list above the summary and replaces Playwright's exit code.
- When several worktrees test at once, set `E2E_PORT` at least 2 apart.
- If new Tailwind classes have no effect, delete `.next` and build again.

## Notes

- Local dev without `DATABASE_URL` uses PGlite under `.data/` and migrates automatically. Schema changes need a Drizzle migration in `drizzle/`; say in the PR that it must be applied to production Neon before deploy. If two migrations collide on a number, regenerate one with `drizzle-kit generate`; a renamed file keeps its old `when`, and Drizzle silently skips it in production.
- Production is protected by Vercel Authentication; there is no app-level login.
- Vercel has one `DATABASE_URL` entry for Production and Preview, so a preview may be using the production database. A PR with a migration or a new write says so in what the owner should check.
- Models are set in `src/lib/ai.ts`.
- On phones the list stays mounted under `display: none` while an article is open (see `InboxShell.tsx`). Code that measures or animates the list must cope with zero sizes while it is hidden.
