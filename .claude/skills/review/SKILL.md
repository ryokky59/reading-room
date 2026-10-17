---
name: review
description: Review and test a Reading Room pull request with the reviewer agent. Use when the owner says /review <PR number>.
---

PR number: $ARGUMENTS
(If none was given, list open PRs with `gh pr list --repo ryokky59/reading-room` and ask which.)

Start a `reviewer` agent (Agent tool, subagent_type `reviewer`) for the PR. When it finishes, tell the owner in Japanese: the 判定, the main findings, and what to try on the phone via the Vercel preview URL on the PR. If they want the findings fixed, run a `developer` agent on the PR's branch with the findings.
