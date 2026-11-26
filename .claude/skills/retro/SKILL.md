---
name: retro
description: Look back on one finished Reading Room Issue and improve the development process. Runs at the end of /dev for each Issue, or when the owner says /retro <issue or PR number>.
---

Issue or PR number: $ARGUMENTS
(If none was given, take the most recently closed Issue: `gh issue list --repo ryokky59/reading-room --state closed --limit 1`.)

The goal is a better process next time, not a report. Run this yourself (not in a subagent): the conversation with the owner is part of the evidence.

1. Gather what happened:
   - The Issue with comments, and its PR: `gh pr view <n> --repo ryokky59/reading-room --comments`, `gh pr checks <n>`, the commit list.
   - How many review rounds there were and what the reviewer flagged.
   - What the developer reported as unchecked or left undone.
   - What the owner had to correct, ask twice, or check by hand, and anything after merge (a revert, a follow-up fix, a production problem).
2. For each friction point, name the cause in the process: an Issue that was vague or wrong, an agent instruction that was missing or misleading, a check that did not catch it, a step the owner had to do that an agent could have done. Skip what went fine; skip one-off bad luck.
3. Turn causes into changes to the process files: `CLAUDE.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`. Prefer sharpening or deleting an existing rule over adding a new one, and keep each file short. Do not change app code here; that needs an Issue.
4. Post the retrospective on the PR (or the Issue when there is no PR) in Japanese with `gh pr comment <n> --body-file ...`:
   - うまくいったこと (one or two lines)
   - 手戻り・詰まったこと と その原因
   - 改善 (file and the change), or 「今回は変更なし」
5. If there are changes, make them in a worktree on a branch `retro-<issue>-<slug>` from the latest `origin/main`, and open a PR titled `振り返り #<issue>: ...` whose body links the retrospective comment. Merge it once its checks pass (`gh pr merge <PR> --merge`), unless it changes app code or removes a stop for a step that cannot be undone (`.claude/automation/pick-issue.md` step 7); then leave it open with a comment saying why. Never push to `main`.
6. Tell the owner in Japanese, in about three lines: the main lesson, and the process PR URL and whether it was merged (or that nothing changed).
