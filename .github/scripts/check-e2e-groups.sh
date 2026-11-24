#!/usr/bin/env bash
# Every spec file in e2e/ must be in exactly one of the E2E groups in .github/workflows/ci.yml,
# so a new spec is not left out of CI and none runs twice. Run from the repository root.
set -euo pipefail

workflow=.github/workflows/ci.yml
# A group lists one spec per line, alone on the line (comments never match).
listed=$(grep -E '^[[:space:]]+e2e/[A-Za-z0-9._-]+\.spec\.ts[[:space:]]*$' "$workflow" | sed -E 's/[[:space:]]//g' | sort || true)
present=$(ls e2e/*.spec.ts | sort)

status=0
for spec in $present; do
  count=$(grep -cxF "$spec" <<<"$listed" || true)
  if [ "$count" -eq 0 ]; then
    echo "::error file=$workflow::$spec is in no E2E group. Add it to one group in $workflow."
    status=1
  elif [ "$count" -gt 1 ]; then
    echo "::error file=$workflow::$spec is in $count E2E groups. Keep it in one."
    status=1
  fi
done
for spec in $(uniq <<<"$listed"); do
  if ! grep -qxF "$spec" <<<"$present"; then
    echo "::error file=$workflow::$spec is in an E2E group but does not exist."
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "All $(wc -l <<<"$present" | tr -d ' ') spec files are in exactly one E2E group."
fi
exit "$status"
