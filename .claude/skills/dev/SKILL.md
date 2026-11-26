---
name: dev
description: Develop one or more Reading Room Issues in parallel, each in its own worktree, ending in PRs that are then reviewed. Use when the owner says /dev <issue numbers> or asks to build an Issue.
---

Issue numbers from the owner: $ARGUMENTS
(If none were given, list Issues labeled `ready` with `gh issue list --repo ryokky59/reading-room --label ready` and ask which to start.)

1. For each Issue, check it exists and is open. If it is still `idea` without `ready`, relabel it `ready` and start when it has a recommended option for every choice; ask the owner first only when it has none, or a step cannot be undone (`CLAUDE.md` 「Decisions」).
2. Run at most 3 at once. For each Issue, start a `developer` agent (Agent tool, subagent_type `developer`, isolation `worktree`) in the same message so they run in parallel. Give each a distinct `E2E_PORT` (3211, 3213, 3215: the E2E stub uses the next port) and the Issue number.
   Do not run two Issues that add a migration at once. Give a developer on a series the later Issues to read.
   An Issue that builds on another Issue's unmerged PR starts from that PR's branch (and opens its PR against it) only after that PR has passed review once; until then, its shared pieces may still change.
   In a series, ask each reviewer what the next Issue must get right (timing of shared helpers, tests it will break, free seed id ranges), and pass that list to the next developer in its prompt.
3. When a developer reports a PR, start a `reviewer` agent for it with that PR number.
4. If the reviewer asks for changes, send the findings back to the developer (SendMessage to the same agent) to fix and push, then review again. Stop after two rounds and report to the owner instead of looping.
5. If the developer or reviewer left a follow-up (a same-cause path not fixed, a finding out of scope), have the `planner` draft it as an Issue (labels by its rules), and link it in the report.
6. Merge each PR whose reviewer's 判定 is マージしてよい under `.claude/automation/pick-issue.md` step 5: its conditions, the commands, the migration and the オーナーに確かめてほしいこと comment. Merge one PR at a time, waiting for its deploy (and migration) before the next. A PR that does not meet them stays open.
7. Report to the owner in Japanese, per Issue: the PR URL, the reviewer's 判定, whether it was merged (and the migration applied), what to check on the phone, and, for a PR left open, why.
8. Then run the `retro` skill for each Issue (Skill tool, args: the PR number) and add its result to the report.
