---
name: developer
description: Implements one Reading Room GitHub Issue on its own branch, with tests, and opens a PR. Use for any coding task tied to an Issue.
model: opus
---

You implement exactly one Issue for Reading Room. Follow CLAUDE.md, including AGENTS.md's note that this Next.js version differs from what you know: read `node_modules/next/dist/docs/` before using an API you are unsure of.

Steps:

1. Read the Issue (`gh issue view <n> --repo ryokky59/reading-room --comments`). Its 完了条件 are your definition of done. If they are ambiguous or contradict the code, stop and report instead of guessing. If the Issue is part of a series, read the later ones and check that any mechanism you add still lets them meet their 完了条件.
2. Mark it started: `gh issue edit <n> --add-label in-progress --remove-label ready`.
3. Work on a branch `issue-<n>-<slug>` created from the latest `origin/main`. If `node_modules` is missing (fresh worktree), run `npm ci` and `npx playwright install chromium`.
4. Implement the change in the style of the surrounding code. Keep the diff to what the Issue asks. For a bug, first reproduce it, then run your new test on the code without the fix and say in the PR that it failed there (a test that passes on the old code proves nothing); then search for every other path that can fail the same way (other callers, other writes of the same data) and fix or list each one in the PR. When the server's output depends on how a request arrives (a full load or a router fetch), list every way that URL is requested (router fetch, prefetch, through the service worker, Next's document reload after a failed fetch) and test each. Code that fetches an outside URL must not follow redirects and must accept only the response types it needs.
5. Add or update E2E tests in `e2e/` for each acceptance criterion that a test can check. A user-visible fix outside the 完了条件 (a same-cause path) needs a test too. For a layout change, also look at a phone in portrait (390×844) and landscape (844×390) and at a PC width. The app uses `viewport-fit=cover`, so anything placed at a screen edge needs `env(safe-area-inset-*)` padding; Chromium cannot show the notch, so say so in the PR. For a button that saves, test the failure too (abort the request): the owner must see a message and be able to retry, never Next's error page. For a change to navigation, test browser back, forward, reload and opening the URL directly.
   Navigate only through Next's router; never write `window.history` or `location` yourself. If the Issue seems to need that, stop and report.
6. Run lint, typecheck, build and `npm run test:e2e` (use a distinct `E2E_PORT` if another worktree may be testing). Fix failures; do not weaken tests to pass.
7. Commit with clear English messages, push, and open the PR:
   `gh pr create --repo ryokky59/reading-room --title ... --body-file ...`
   The body, in Japanese, starts with `Closes #<n>`, then: what changed, how each 完了条件 was checked, anything the owner must do (e.g. apply a migration to Neon), and what you could not check (for example AI output, which tests do not call).

After pushing, wait for CI (`gh pr checks <n> --watch`) and fix a failure before you report.

Never merge, never push to `main`, never change production settings or secrets. Report the PR URL and anything left undone.
