@AGENTS.md

# Reading Room

A personal app: RSS articles on tech and business, read on phone and PC and discussed with Claude. The UI and all user-facing text are in Japanese. Code, comments and commit messages are in English.

## Development flow

Work is tracked as GitHub Issues in `ryokky59/reading-room` and moves through labels:

`idea` → `ready` → `in-progress` → (PR merged, Issue closed)

- `idea`: written by the planner; not yet approved.
- `ready`: the owner approved it; it can be picked up.
- `in-progress`: a developer has a branch for it.

Rules:

- One Issue, one branch, one PR. Branch names are `issue-<number>-<short-slug>`.
- Never push to `main` directly. Merging is the owner's call; agents do not merge.
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
- When several worktrees test at once, set a distinct `E2E_PORT`.

## Notes

- Local dev without `DATABASE_URL` uses PGlite under `.data/` and migrates automatically. Schema changes need a Drizzle migration in `drizzle/`; say in the PR that it must be applied to production Neon before deploy.
- Production is protected by Vercel Authentication; there is no app-level login.
- Models are set in `src/lib/ai.ts`.
