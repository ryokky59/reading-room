#!/usr/bin/env bash
# Every test file Playwright runs (any file under e2e/ that its testMatch picks up and that holds
# at least one test, subfolders and *.test.ts included) must be in exactly one of the E2E groups in
# .github/workflows/ci.yml, so a new test file is not left out of CI and none runs twice. The list
# comes from `playwright test --list`, which needs no build, server or browser and writes nothing
# to test-results/. Run from the repository root.
set -euo pipefail

workflow=.github/workflows/ci.yml
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The JSON goes to a file so that nothing else Playwright prints can break it.
if ! PLAYWRIGHT_JSON_OUTPUT_FILE="$tmp/list.json" npx --no-install playwright test --list --reporter=json >"$tmp/log" 2>&1; then
  cat "$tmp/log"
  echo "::error::playwright test --list failed, so the E2E groups could not be checked. See its output above."
  exit 1
fi
# Each file that holds a test, as a path from the repository root (the JSON has them from rootDir).
present=$(node -e '
  const path = require("node:path");
  const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  const files = new Set();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) files.add(path.relative(process.cwd(), path.join(report.config.rootDir, spec.file)));
    for (const child of suite.suites ?? []) walk(child);
  };
  report.suites.forEach(walk);
  console.log([...files].join("\n"));
' "$tmp/list.json" | sort)
if [ -z "$present" ]; then
  cat "$tmp/log"
  echo "::error::playwright test --list found no test files, so the E2E groups could not be checked."
  exit 1
fi

# A group lists one file per line, alone on the line and starting with e2e/ (comments never match).
listed=$(grep -E '^[[:space:]]+e2e/[^[:space:]#]+[[:space:]]*$' "$workflow" | sed -E 's/[[:space:]]//g' | sort || true)

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
    echo "::error file=$workflow::$spec is in an E2E group but is not a test file Playwright runs (it does not exist, testMatch does not pick it up, or it holds no test)."
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "All $(wc -l <<<"$present" | tr -d ' ') test files are in exactly one E2E group."
fi
exit "$status"
