#!/usr/bin/env bash
# Precheck for the Orca automation 「イシューを自動で進める」 (see pick-issue.md).
# Exit 0 starts the agent; exit 1 skips this run without starting it (no cost).
#   - an `auto` Issue is already `in-progress` (an earlier run is still working) → skip
#   - no open `auto` Issue without `auto:blocked` and `in-progress`, and no open `idea` Issue
#     without `auto` (step 1 labels or stops those) → skip
set -euo pipefail
REPO=ryokky59/reading-room
ORCA=/Applications/Orca.app/Contents/Resources/bin/orca
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Tidy up after earlier runs (a failure here does not stop the check). Agents close their own
# worktree (pick-issue.md step 8); this catches what they missed:
#   - worktrees of runs that picked nothing (still on an auto-run-* branch), 60 minutes after creation
#   - local issue-/retro-/auto-run- branches used by no worktree whose work is on main
#     (an ancestor of origin/main, or a merged PR)
cleanup() {
  git -C "$ROOT" fetch -q origin main
  git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{print p, $2}' |
    while read -r path branch; do
      case "$path" in */orca/workspaces/*/auto-run-*) ;; *) continue ;; esac
      case "$branch" in refs/heads/*auto-run-*) ;; *) continue ;; esac
      [ -n "$(find "$path" -maxdepth 0 -mmin +60)" ] || continue
      echo "拾わずに終わった回の worktree を消す: $path"
      "$ORCA" worktree rm --worktree "path:$path" --force >/dev/null
    done
  git -C "$ROOT" branch --format='%(refname:short) %(worktreepath)' |
    awk '$2 == "" && ($1 ~ /^(issue|retro)-/ || $1 ~ /auto-run-/) {print $1}' |
    while read -r b; do
      if git -C "$ROOT" merge-base --is-ancestor "$b" origin/main ||
        [ "$(gh pr list --repo "$REPO" --head "$b" --state merged --json number -q 'length')" -gt 0 ]; then
        git -C "$ROOT" branch -q -D "$b" && echo "マージ済みのブランチを消す: $b"
      fi
    done
}
cleanup || echo "片付けに失敗した（判定は続ける）"

busy=$(gh issue list --repo "$REPO" --state open --label auto --label in-progress --json number -q 'length')
if [ "$busy" -gt 0 ]; then echo "作業中の auto イシューがあるので飛ばす"; exit 1; fi

ready=$(gh issue list --repo "$REPO" --state open --label auto --json number,labels \
  -q '[.[] | select(all(.labels[]; .name != "auto:blocked" and .name != "in-progress"))] | length')
ideas=$(gh issue list --repo "$REPO" --state open --label idea --json number,labels \
  -q '[.[] | select(all(.labels[]; .name != "auto" and .name != "auto:blocked" and .name != "in-progress" and .name != "report"))] | length')
if [ "$ready" -eq 0 ] && [ "$ideas" -eq 0 ]; then echo "拾える auto のイシューも、まだ見ていない idea も無いので飛ばす"; exit 1; fi

echo "拾える auto のイシューが ${ready} 件、まだ見ていない idea が ${ideas} 件ある"
