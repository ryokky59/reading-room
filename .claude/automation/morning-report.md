# Morning report (steps for the Orca automation)

Orca starts this at 6:00 every morning in a fresh worktree from `origin/main`. The owner is not there; they read the result on their phone over the morning. The point is that they open Reading Room knowing what to read today, and that a problem in how the app is used reaches them as a proposal instead of going unnoticed.

This run only reads: the code, the Issues and the production data. It changes no file and opens no PR. Follow `CLAUDE.md`. Write to the owner in Japanese.

## Labels

- `report`: the one open Issue that collects these reports, one comment a morning.
- `curator`: an Issue that came from a morning report. It also carries `idea` until the owner decides.

## Steps

1. **Prepare**: if `node_modules` is missing, run `npm ci` (the data script needs it). Check that the data can be read: `echo "select 1 as ok" | node .claude/scripts/reading-data.mjs`. If it cannot, today's report (step 5) is that, with the error and what the owner should do (usually `npx neonctl auth`); skip steps 3 and 4.
2. **Find the report Issue**: `gh issue list --repo ryokky59/reading-room --state open --label report`. If there is none, create it with the title 「朝のレポート」, the label `report`, and a body of two or three lines saying what arrives here and when. Read its last seven comments (`gh issue view <n> --comments`): they are what the owner has already been told, and a reply the owner wrote among them is an answer to use from now on.
3. **Ask the curator**: start one `curator` agent (Agent tool, subagent_type `curator`). Give it the earlier reports and ask for these four things, saying that the owner is away, so it should decide what it can and say what it could not:
   - **読まれ方**: yesterday and the last seven days. How much came in, how much was read, and what the owner did since the last report (a feed stopped or added, a pile marked 既読).
   - **今朝の 5 本**: at most five from the inbox to read today. Recent ones first; an article from an earlier report only if it still beats the newer ones.
   - **フィード**: only what changed since the last report: a feed that broke, a proposal the owner acted on and what it did to the numbers. A review of every feed only when the last one in the reports is more than seven days old.
   - **機能**: the one thing that most gets in the way of reading now, with a proposal, when it is new. Not new: an open Issue covers it, an earlier report proposed it, or the owner declined it (a closed `curator` Issue with no merged PR). "Nothing new today" is a good answer and the usual one; a proposal every morning would only teach the owner to skip them.
4. **Turn a new proposal into an Issue**: at most one a run, and only while fewer than three open Issues carry both `curator` and `idea` (`gh issue list --repo ryokky59/reading-room --state open --label curator --label idea`). With three waiting, name the proposal in the report and leave it there. Otherwise start a `planner` agent with the curator's proposal and evidence, and ask it to create the Issue with `--label idea --label curator`. A proposal is a product choice, so it is never `auto` or `ready`.
5. **Post** the report as one comment on the report Issue (`gh issue comment <n> --body-file ...`, the file outside the repository). The curator's answer is your material, not the comment: write what the owner needs this morning, short enough for one phone screen or two.

   ```
   ## M/D（曜日）

   ### 今朝の 5 本
   1. [記事のタイトル](https://reading-room-five-mu.vercel.app/articles/<id>) — サイト名。なぜ今日これか、1 行。

   ### 読まれ方
   - 昨日: 入った N 本、読了 N 本。直近 7 日: 入った N 本、読了 N 本。
   - (what changed, or what the owner's last action did; leave out if nothing)

   ### フィード
   (only when something changed or the weekly review ran; otherwise leave the section out)

   ### 提案
   (the new Issue with its number and one line on why, or 「今日はなし」. Then the `curator` Issues still waiting for a decision, as numbers.)
   ```

   Mark an estimate as one. Do not quote the owner's メモ, 学び or chats; say what they show in your own words.
6. **Close**: write two or three lines on what you did, then run as the very last command `/Applications/Orca.app/Contents/Resources/bin/orca worktree rm --worktree current --force`. It removes this worktree and this terminal, so nothing runs after it.

## Never

- Change, commit or push a file, or open or merge a PR.
- Change a feed or anything else in production. The data script is the only way this run touches production, and it only reads.
- Create more than one Issue a run (the report Issue, when missing, does not count), or edit, close or relabel an Issue. The only comment you write is the report.
- Skip the report because there is little to say. A short one tells the owner the run happened.
