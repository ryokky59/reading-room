# Pick up one `auto` Issue (steps for the Orca automation)

Orca starts this every 15 minutes in a fresh worktree from `origin/main`, only when `precheck.sh` passes. The owner is not there. Follow `CLAUDE.md`, except where this file says otherwise. Anything the owner must decide, you do not decide for them: write it on the Issue or PR and stop. Write comments to the owner in Japanese.

## Labels

- `auto`: the planner (or the owner) judged that no owner decision is needed. Only these are picked up.
- `in-progress`: being worked on, as in `CLAUDE.md`. On an `auto` Issue it means this automation is working on it.
- `auto:blocked`: stopped for the owner. When they answer and remove it, the Issue is picked up again (their answer is in the comments).

## Steps

1. **Pick**: from `gh issue list --repo ryokky59/reading-room --state open --label auto`, take the lowest-numbered one without `auto:blocked` or `in-progress`. Only one. Read its body and all comments. If none is left, go to step 8.
   If reading it shows step 4 already holds before any development (a question to the owner in the body or comments that nobody answered), stop that Issue as in step 4 and pick the next one in the same run, until one can be developed or none is left. Stopping the run at the first only makes the next run, 15 minutes later, read the next one and stop again (#131: #68 and #77 both had open questions).
   First look at `main`'s latest finished CI run (`gh run list --repo ryokky59/reading-room --branch main --status completed --limit 1`). If it failed, a PR from this run cannot pass its checks either: pick the `auto` Issue about the failing test instead of the lowest-numbered one. If there is none, have the `planner` draft it (step 6), write the failing test on it, and go to step 8 without developing.
2. **Develop**: start one `developer` agent (Agent tool, subagent_type `developer`, no worktree isolation: this worktree is already yours) with the Issue number and `E2E_PORT=3401`. Tell it the owner is away: where it would stop and report, it should report to you instead. If an open PR for the Issue already exists (an earlier run stopped partway; `gh pr list --repo ryokky59/reading-room --search "Closes #<n>"`), do not start a new branch: tell the developer to continue that PR, or go straight to step 3 when its comments say only the review is left. A run that has to stop before step 8 for a reason other than step 4 writes on the Issue what is done and what is left, and removes `in-progress` so a later run picks it up.
3. **Review**: when it reports a PR, start a `reviewer` agent with the PR number and `E2E_PORT=3403`. If the reviewer asks for changes, send them back to the same developer (SendMessage), then review again. At most two rounds.
4. **Stop for the owner** when any of these holds:
   - The Issue is vague or contradicts the code, or the developer or reviewer found something the owner must decide.
   - It needs production data, the production database, secrets, or Vercel settings.
   - It needs a new dependency in `package.json`.
   - The reviewer still says 直してほしい after two rounds, or the checks cannot be made to pass. A check that fails on a test the PR did not touch is re-run once at most: a second failure means `main` is flaky, and more runs only spend CI time (#126: three runs, three different unrelated failures).

   Write a comment on the Issue (and on the PR, if there is one): what you found, and what the owner should decide, with options and your recommendation. Then `gh issue edit <n> --add-label auto:blocked --remove-label in-progress` and go to step 8. Leave an open PR open.
5. **Merge** only when all of these hold. If one does not, stop as in step 4: the PR stays open for the owner.
   - The reviewer's latest 判定 is マージしてよい.
   - `gh pr checks <PR> --watch` ends with every check passing (CI and Vercel).
   - The PR touches nothing under `drizzle/` (a migration must reach production Neon before deploy, which only the owner does), and does not change `package.json` dependencies, `.claude/automation/`, or the `auto` rules in `CLAUDE.md`.
   - Nothing in the PR is left for the owner: no item the PR or reviewer says only a real phone can confirm when it is central to a 完了条件.

   Then `gh pr merge <PR> --merge`, and `git push origin --delete <branch>` (`--delete-branch` merges but then exits 1 in a worktree, where `main` is checked out elsewhere, and leaves the remote branch). Merging deploys to production. Wait until the Vercel status on the new `main` commit is no longer pending (`gh api repos/ryokky59/reading-room/commits/main/status`). If it failed, comment on the PR so the owner sees it.
6. **Follow-ups**: if the developer or reviewer left one (a same-cause path, an out-of-scope finding), have the `planner` draft it as an Issue. Per its rules it gets `auto` only when no owner decision is needed.
7. **Retro**: run the `retro` skill with the PR number. Its process PR (`retro-<issue>-<slug>`) may be merged by you right away (the same two commands) only when it just adds or rewords how to work, check, or instruct agents. Leave it open for the owner, with a comment saying why, when it changes app code, production data, the database, secrets or AI cost rules, or widens what this automation may do or removes a check from it.
8. **Close**: check that `git status` is clean and every change is pushed or merged. Write two or three lines on what you did, then run as the very last command `/Applications/Orca.app/Contents/Resources/bin/orca worktree rm --worktree current --force`. It removes this worktree and this terminal, so nothing runs after it. If something is left (an unpushed change), do not close; write what is left on the Issue instead.

## Never

- Push to `main`, or merge anything other than the PRs step 5 and step 7 allow.
- Develop more than one Issue in a run. Issues stopped at step 1 without development do not count.
- Apply a migration, connect to the production database, or run `vercel env pull`.
- Add or remove `auto` on an Issue yourself (only the planner in step 6 may give it), or change labels other than `in-progress`, `ready` and `auto:blocked`.
