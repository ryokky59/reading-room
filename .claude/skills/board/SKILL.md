---
name: board
description: Show the state of Reading Room work - Issues by label and open PRs with their checks. Use when the owner says /board or asks what is in progress.
---

Gather:

- `gh issue list --repo ryokky59/reading-room --state open --json number,title,labels`
- `gh pr list --repo ryokky59/reading-room --json number,title,headRefName,reviewDecision,statusCheckRollup,url`

Report in Japanese, short, grouped as: 確認待ちの PR (with CI result and preview to check), 開発中 (`in-progress`), 着手できる (`ready`), アイデア (`idea`). Suggest the one next step that unblocks the most.
