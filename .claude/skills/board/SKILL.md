---
name: board
description: Show the state of Reading Room work - Issues by label and open PRs with their checks. Use when the owner says /board or asks what is in progress.
---

Gather:

- `gh issue list --repo ryokky59/reading-room --state open --json number,title,labels`
- `gh pr list --repo ryokky59/reading-room --json number,title,headRefName,reviewDecision,statusCheckRollup,url`
- Production errors from the last 7 days: Vercel MCP `get_runtime_errors` with the project and team ids in `.vercel/project.json`. Ignore the `url.parse()` deprecation warning. Failures in `/api/cron` matter most: the owner never sees them.

Report in Japanese, short, grouped as: 本番のエラー (new or still recurring error groups, with count and route; omit if none), 確認待ちの PR (with CI result and preview to check), 開発中 (`in-progress`), 着手できる (`ready`), アイデア (`idea`). Suggest the one next step that unblocks the most. A recurring production error without an Issue comes first: offer to write one.
