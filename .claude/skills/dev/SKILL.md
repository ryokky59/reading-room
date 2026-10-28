---
name: dev
description: Develop one or more Reading Room Issues in parallel, each in its own worktree, ending in PRs that are then reviewed. Use when the owner says /dev <issue numbers> or asks to build an Issue.
---

Issue numbers from the owner: $ARGUMENTS
(If none were given, list Issues labeled `ready` with `gh issue list --repo ryokky59/reading-room --label ready` and ask which to start.)

1. For each Issue, check it exists and is open. If it is still `idea`, confirm with the owner before starting, then relabel it `ready`.
2. Run at most 3 at once. For each Issue, start a `developer` agent (Agent tool, subagent_type `developer`, isolation `worktree`) in the same message so they run in parallel. Give each a distinct `E2E_PORT` (3211, 3212, 3213) and the Issue number.
3. When a developer reports a PR, start a `reviewer` agent for it with that PR number.
4. If the reviewer asks for changes, send the findings back to the developer (SendMessage to the same agent) to fix and push, then review again. Stop after two rounds and report to the owner instead of looping.
5. Report to the owner in Japanese, per Issue: the PR URL, the reviewer's 判定, what to check on the phone (the Vercel preview URL is on the PR), and anything they must do before merging. Merging is theirs.
6. Then run the `retro` skill for each Issue (Skill tool, args: the PR number) and add its result to the report.
