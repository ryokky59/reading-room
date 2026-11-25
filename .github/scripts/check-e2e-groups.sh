#!/usr/bin/env bash
# Checks the E2E groups in .github/workflows/ci.yml against the test files Playwright runs. The
# lists come from `playwright test --list`, which needs no build, server or browser and writes
# nothing to test-results/. Run from the repository root.
#
# With no arguments: every test file Playwright runs (any file under e2e/ that its testMatch picks
# up and that holds at least one test, subfolders and *.test.ts included) must be in exactly one
# group, so a new test file is not left out of CI and none runs twice.
#
# With `--group <N> <args...>`: the files Playwright selects from <args...> (the same arguments the
# e2e job gives `npm run test:e2e`, passed unquoted so the shell splits them the same way) must be
# exactly the files listed in group N. Playwright reads each argument as a case-insensitive regular
# expression, so e2e/a.spec.ts also selects e2e/a.spec.tsx, which is caught here.
#
# Both forms first fail on any line of a group's `specs: >-` value (group N, or every group with no
# arguments) that holds a `#`, naming the group and the line, before Playwright is run: inside `>-`
# a `#` is not a YAML comment but part of the value, so the shell drops every name after it, and the
# checks above would then fail with messages that point elsewhere (or, when `#` starts the first
# line, with only the usage). The value is every line indented deeper than its `specs:` line. A `#`
# on any other line (the `specs: >-` line itself, a line between groups or before `steps:`, after
# the `- group:` value) is a real YAML comment and is not checked.
#
# CHECK_E2E_WORKFLOW, when set, is read in place of .github/workflows/ci.yml, and the errors name it
# instead. test-check-e2e-groups.sh uses it to run this script on changed copies of ci.yml.
set -euo pipefail

workflow=${CHECK_E2E_WORKFLOW:-.github/workflows/ci.yml}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The files that hold a test among those Playwright selects from "$@", one per line, sorted, as
# paths from the repository root.
playwright_files() {
  # The JSON goes to a file so that nothing else Playwright prints can break it.
  if ! PLAYWRIGHT_JSON_OUTPUT_FILE="$tmp/list.json" npx --no-install playwright test --list --reporter=json "$@" >"$tmp/log" 2>&1; then
    cat "$tmp/log" >&2
    echo "::error::playwright test --list failed, so the E2E groups could not be checked. See its output above." >&2
    return 1
  fi
  # The JSON has each file from rootDir.
  node -e '
    const path = require("node:path");
    const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const files = new Set();
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) files.add(path.relative(process.cwd(), path.join(report.config.rootDir, spec.file)));
      for (const child of suite.suites ?? []) walk(child);
    };
    (report.suites ?? []).forEach(walk);
    console.log([...files].join("\n"));
  ' "$tmp/list.json" | sed '/^$/d' | sort
}

# The lines of the `specs: >-` value of group "$1" of the workflow, or of every group when "$1" is
# empty, as "<line number><TAB><group><TAB><line>". A group runs from its `- group: N` line to the
# next `- group:` or `steps:`, and its value is every line in it indented deeper than its `specs:`
# line. The group is the value of the `- group:` line without a trailing comment (` # ...`), so
# `- group: 1 # c` is group 1.
spec_lines() {
  awk -v group="$1" '
    function indent(s) { match(s, /^[[:space:]]*/); return RLENGTH }
    /^[[:space:]]*- group:[[:space:]]*/ {
      current = $0
      sub(/^[[:space:]]*- group:[[:space:]]*/, "", current)
      sub(/[[:space:]]+#.*$/, "", current)
      sub(/[[:space:]]+$/, "", current)
      inside = (group == "" || current == group)
      specs = -1
      next
    }
    /^[[:space:]]*steps:/ { inside = 0 }
    inside && /^[[:space:]]*specs:/ { specs = indent($0); next }
    inside && specs >= 0 && indent($0) > specs { printf "%d\t%s\t%s\n", NR, current, $0 }
  ' "$workflow"
}

# The files listed in group "$1" (every group when "$1" is empty), one per line, sorted. A group
# lists one file per line, alone on the line and starting with e2e/; any other line of the value
# lists nothing. A value line with a `#` (a comment, a file name followed by a comment) never gets
# here: comment_lines stops the script on it first.
listed_files() {
  spec_lines "$1" | cut -f3- | grep -E '^[[:space:]]+e2e/[^[:space:]#]+[[:space:]]*$' | sed -E 's/[[:space:]]//g' | sort || true
}

# Fails, with an error for each, on the lines of the `specs: >-` value of group "$1" (every group
# when "$1" is empty) that hold a `#`, over the same lines listed_files reads.
comment_lines() {
  spec_lines "$1" | awk -F '\t' -v workflow="$workflow" '
    { line = $0; sub(/^[^\t]*\t[^\t]*\t/, "", line) }
    line ~ /#/ {
      printf "::error file=%s,line=%d::Line %d of %s, in E2E group %s, holds a \"#\". Inside \">-\" a \"#\" is not a YAML comment but part of the value, and the shell drops every name after it from the command line. A group holds file names only, one per line.\n", workflow, $1, $1, workflow, $2
      found = 1
    }
    END { exit found }
  '
}

if [ "${1-}" = "--group" ]; then
  if [ "$#" -ge 2 ] && ! comment_lines "$2"; then
    exit 1
  fi
  if [ "$#" -lt 3 ]; then
    echo "::error::Usage: $0 --group <N> <the group's specs>" >&2
    exit 1
  fi
  group=$2
  shift 2
  listed=$(listed_files "$group")
  if [ -z "$listed" ]; then
    echo "::error file=$workflow::E2E group $group lists no test files in $workflow."
    exit 1
  fi
  selected=$(playwright_files "$@")

  status=0
  for spec in $selected; do
    if ! grep -qxF "$spec" <<<"$listed"; then
      echo "::error file=$workflow::$spec runs in E2E group $group but is not listed in it. Playwright reads each listed name as a case-insensitive regular expression, so a name that is the start of another file's name selects that file too."
      status=1
    fi
  done
  for spec in $listed; do
    if ! grep -qxF "$spec" <<<"$selected"; then
      echo "::error file=$workflow::$spec is listed in E2E group $group but does not run in it. A comment line in the group cuts off every name after it, and a name must match the file's case."
      status=1
    fi
  done
  if [ "$status" -eq 0 ]; then
    echo "E2E group $group runs exactly the $(wc -l <<<"$listed" | tr -d ' ') test files it lists."
  fi
  exit "$status"
fi

if ! comment_lines ""; then
  exit 1
fi
present=$(playwright_files)
if [ -z "$present" ]; then
  cat "$tmp/log"
  echo "::error::playwright test --list found no test files, so the E2E groups could not be checked."
  exit 1
fi
listed=$(listed_files "")

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
