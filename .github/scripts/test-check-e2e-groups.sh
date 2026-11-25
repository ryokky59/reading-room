#!/usr/bin/env bash
# Tests check-e2e-groups.sh on changed copies of .github/workflows/ci.yml: comments in and around the
# groups' `specs: >-` values (#184, #188) and a name in the wrong case (#170, #181). CI runs it in the
# check job so the cases run with ubuntu's awk (mawk) as well as macOS's. Run from the repository
# root: `bash .github/scripts/test-check-e2e-groups.sh`.
#
# Each case copies ci.yml into a temporary directory, changes the copy and runs check-e2e-groups.sh
# on it through CHECK_E2E_WORKFLOW, with no arguments and with `--group N` and the group's names
# given unquoted, as the e2e job does. Nothing is written to ci.yml or e2e/. The changes are placed
# by position (a group's `- group:` line, its value lines, the e2e job's `steps:` line), not by file
# name, so moving a file to another group does not break the test. Runs with macOS's /bin/bash 3.2:
# no associative arrays or mapfile.
set -euo pipefail

workflow=.github/workflows/ci.yml
script=.github/scripts/check-e2e-groups.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "test-check-e2e-groups: $*" >&2
  exit 1
}

# The line numbers of the positions the cases change in ci.yml, as "name=number" lines: the
# `- group: N` line (gN), its `specs:` line (gN_specs), the first, second and last lines of its
# value (gN_first, gN_second, gN_last) and the e2e job's `steps:` line (steps), the first `steps:`
# after a `- group:` line. A value line is a line indented deeper than its `specs:` line.
positions() {
  awk '
    function indent(s) { match(s, /^[[:space:]]*/); return RLENGTH }
    done { next }
    /^[[:space:]]*- group:[[:space:]]*[0-9]+[[:space:]]*$/ {
      group = $0
      sub(/^[[:space:]]*- group:[[:space:]]*/, "", group)
      sub(/[[:space:]]+$/, "", group)
      printf "g%s=%d\n", group, NR
      specs = -1
      count = 0
      next
    }
    group != "" && /^[[:space:]]*steps:/ { printf "steps=%d\n", NR; done = 1; next }
    group != "" && specs < 0 && /^[[:space:]]*specs:[[:space:]]*>-[[:space:]]*$/ {
      specs = indent($0)
      printf "g%s_specs=%d\n", group, NR
      next
    }
    group != "" && specs >= 0 && indent($0) > specs {
      count++
      if (count == 1) printf "g%s_first=%d\n", group, NR
      if (count == 2) printf "g%s_second=%d\n", group, NR
      printf "g%s_last=%d\n", group, NR
    }
  ' "$workflow"
}

positions >"$tmp/positions"
# The line number of position "$1" in ci.yml, or a failure naming it.
at() {
  local found
  found=$(awk -F= -v name="$1" '$1 == name { value = $2 } END { print value }' "$tmp/positions")
  [ -n "$found" ] || fail "could not find the position \"$1\" in $workflow (a group's \`- group: N\` line, its \`specs: >-\` line, its value lines, or the e2e job's \`steps:\` line). Update this test if the groups have changed shape."
  echo "$found"
}
for name in g1 g1_specs g1_first g1_second g2 g3 g3_last steps; do
  at "$name" >/dev/null
done

# Writes a fresh copy of ci.yml for case "$1" and prints its path.
copy() {
  mkdir -p "$tmp/$1"
  cp "$workflow" "$tmp/$1/ci.yml"
  echo "$tmp/$1/ci.yml"
}

# Inserts line "$3" before line "$2" of file "$1".
insert_before() {
  awk -v at="$2" -v text="$3" 'NR == at { print text } { print }' "$1" >"$1.new"
  mv "$1.new" "$1"
}

# Appends "$3" to line "$2" of file "$1".
append_to() {
  awk -v at="$2" -v text="$3" 'NR == at { $0 = $0 text } { print }' "$1" >"$1.new"
  mv "$1.new" "$1"
}

# Upper-cases the character after the first "e2e/" on line "$2" of file "$1".
upper_after_e2e() {
  awk -v at="$2" '
    NR == at {
      i = index($0, "e2e/")
      if (i > 0) $0 = substr($0, 1, i + 3) toupper(substr($0, i + 4, 1)) substr($0, i + 5)
    }
    { print }
  ' "$1" >"$1.new"
  mv "$1.new" "$1"
}

# The names of group "$2" in workflow copy "$1" as the e2e job passes them: the lines of its
# `specs: >-` value (indented deeper than `specs:`), trimmed and joined with one space, as `>-`
# folds a value of this shape. The group is the `- group:` value without a trailing ` # ...`.
group_args() {
  awk -v group="$2" '
    function indent(s) { match(s, /^[[:space:]]*/); return RLENGTH }
    /^[[:space:]]*- group:/ {
      current = $0
      sub(/^[[:space:]]*- group:[[:space:]]*/, "", current)
      sub(/[[:space:]]+#.*$/, "", current)
      sub(/[[:space:]]+$/, "", current)
      inside = (current == group)
      specs = -1
      next
    }
    /^[[:space:]]*steps:/ { inside = 0 }
    inside && specs < 0 && /^[[:space:]]*specs:/ { specs = indent($0); next }
    inside && specs >= 0 && indent($0) > specs {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      out = out (out == "" ? "" : " ") line
    }
    END { print out }
  ' "$1"
}

cases=0
checks=0
failures=0

# Starts case "$1" (its name, for the report).
case_name=
start() {
  case_name=$1
  cases=$((cases + 1))
}

# Runs check-e2e-groups.sh on workflow copy "$1", with no arguments when "$2" is "all" and with
# `--group "$2"` and that group's names otherwise, and checks that it exits with "$3". Each further
# argument is a check on the output: "+text" must appear, "-text" must not, "=1" means the output is
# exactly one line. The command runs under `bash -c` with the names unquoted, so the shell drops
# everything after a "#" as it does in CI; the exit code is taken outside it.
expect() {
  local wf=$1 group=$2 code=$3 command output actual problems=
  shift 3
  if [ "$group" = all ]; then
    command="bash $script"
  else
    command="bash $script --group $group $(group_args "$wf" "$group")"
  fi
  checks=$((checks + 1))
  set +e
  output=$(CHECK_E2E_WORKFLOW="$wf" bash -c "$command" 2>&1)
  actual=$?
  set -e
  [ "$actual" -eq "$code" ] || problems="exit code"
  local want
  for want in "$@"; do
    case $want in
      +*) grep -qF -- "${want#+}" <<<"$output" || problems="$problems${problems:+; }missing \"${want#+}\"" ;;
      -*) ! grep -qF -- "${want#-}" <<<"$output" || problems="$problems${problems:+; }unexpected \"${want#-}\"" ;;
      =1) [ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -eq 1 ] || problems="$problems${problems:+; }not exactly one line" ;;
      *) fail "unknown check \"$want\" in case \"$case_name\"" ;;
    esac
  done
  if [ -n "$problems" ]; then
    failures=$((failures + 1))
    echo "FAIL: $case_name"
    echo "  command: CHECK_E2E_WORKFLOW=$wf $command"
    echo "  expected exit code $code, got $actual ($problems)"
    echo "  output:"
    printf '%s\n' "$output" | sed 's/^/    /'
  fi
}

# Every group, each passing: check-e2e-groups.sh exits 0 for every form.
expect_all_pass() {
  local wf=$1 g
  shift
  expect "$wf" all 0 "+test files are in exactly one E2E group." "$@"
  for g in 1 2 3; do
    expect "$wf" "$g" 0 "+E2E group $g runs exactly the" "$@"
  done
}

# The one error check-e2e-groups.sh gives for a "#" on line "$3" of the value of group "$2" in copy
# "$1": the line and the group, and nothing the later checks would print.
comment_error() {
  echo "+::error file=$1,line=$3::Line $3 of $1, in E2E group $2, holds a \"#\"."
}
comment_checks=("=1" "-Usage" "-does not run in it" "-is in no E2E group" "-case-insensitive regular expression")

g1=$(at g1)
g1_specs=$(at g1_specs)
g1_first=$(at g1_first)
g1_second=$(at g1_second)
g2=$(at g2)
g3_last=$(at g3_last)
steps=$(at steps)

# 1. Nothing changed.
start "1: ci.yml unchanged"
wf=$(copy 1)
for g in 1 2 3; do
  expect "$wf" "$g" 0 "+E2E group $g runs exactly the" "-lists no test files"
done
expect "$wf" all 0 "+All " "+test files are in exactly one E2E group."

# 2. A comment line between groups is a YAML comment.
start "2: comment line before \`- group: 2\`"
wf=$(copy 2)
insert_before "$wf" "$g2" "          # between groups"
expect_all_pass "$wf" '-holds a "#"'

# 3. A comment line before the e2e job's `steps:` is a YAML comment.
start "3: comment line before the e2e job's \`steps:\`"
wf=$(copy 3)
insert_before "$wf" "$steps" "    # before steps"
expect_all_pass "$wf" '-holds a "#"'

# 4. A comment line between `- group: 1` and its `specs:`.
start "4: comment line between \`- group: 1\` and \`specs:\`"
wf=$(copy 4)
insert_before "$wf" "$g1_specs" "            # before specs"
expect_all_pass "$wf" '-holds a "#"'

# 5. A comment after the `- group:` value.
start "5: \`- group: 1 # c\`"
wf=$(copy 5)
append_to "$wf" "$g1" " # c"
expect "$wf" all 0 "+test files are in exactly one E2E group."
expect "$wf" 1 0 "+E2E group 1 runs exactly" "-lists no test files"

# 6. A comment after `specs: >-`.
start "6: \`specs: >- # c\` in group 1"
wf=$(copy 6)
append_to "$wf" "$g1_specs" " # c"
expect "$wf" all 0 "+test files are in exactly one E2E group."
expect "$wf" 1 0 "+E2E group 1 runs exactly"

# 7. A comment line first in group 1's value.
start "7: comment line first in group 1's value"
wf=$(copy 7)
insert_before "$wf" "$g1_first" "              # first"
for g in all 1; do
  expect "$wf" "$g" 1 "$(comment_error "$wf" 1 "$g1_first")" "${comment_checks[@]}"
done
expect "$wf" 2 0 "+E2E group 2 runs exactly"
expect "$wf" 3 0 "+E2E group 3 runs exactly"

# 8. A comment after the first name of group 1.
start "8: \`<name> # slow\` first in group 1's value"
wf=$(copy 8)
append_to "$wf" "$g1_first" " # slow"
for g in all 1; do
  expect "$wf" "$g" 1 "$(comment_error "$wf" 1 "$g1_first")" "${comment_checks[@]}"
done
expect "$wf" 2 0 "+E2E group 2 runs exactly"
expect "$wf" 3 0 "+E2E group 3 runs exactly"

# 9. A comment line between the first two names of group 1.
start "9: comment line second in group 1's value"
wf=$(copy 9)
insert_before "$wf" "$g1_second" "              # slow ones below"
for g in all 1; do
  expect "$wf" "$g" 1 "$(comment_error "$wf" 1 "$g1_second")" "${comment_checks[@]}"
done
expect "$wf" 2 0 "+E2E group 2 runs exactly"
expect "$wf" 3 0 "+E2E group 3 runs exactly"

# 10. Cases 5 and 8 together: the error names group 1, not "1 # c".
start "10: \`- group: 1 # c\` and \`<name> # slow\`"
wf=$(copy 10)
append_to "$wf" "$g1" " # c"
append_to "$wf" "$g1_first" " # slow"
for g in all 1; do
  expect "$wf" "$g" 1 "$(comment_error "$wf" 1 "$g1_first")" "-in E2E group 1 # c" "${comment_checks[@]}"
done

# 11. A comment line after group 3's last name, before `steps:`, is still in the value.
start "11: comment line after group 3's last name"
wf=$(copy 11)
tail_line=$((g3_last + 1))
[ "$tail_line" -eq "$steps" ] || fail "group 3's value does not end right before the e2e job's \`steps:\` line in $workflow. Update case 11."
insert_before "$wf" "$tail_line" "              # tail"
for g in all 3; do
  expect "$wf" "$g" 1 "$(comment_error "$wf" 3 "$tail_line")" "${comment_checks[@]}"
done
expect "$wf" 1 0 "+E2E group 1 runs exactly"
expect "$wf" 2 0 "+E2E group 2 runs exactly"

# 12. A name in the wrong case: Playwright still selects the file, but it is not the listed name.
start "12: first name of group 1 in the wrong case"
wf=$(copy 12)
upper_after_e2e "$wf" "$g1_first"
expect "$wf" 1 1 "+runs in E2E group 1 but is not listed in it" "+is listed in E2E group 1 but does not run in it"
expect "$wf" all 1 "+is in no E2E group" "+is not a test file Playwright runs"

if [ "$failures" -gt 0 ]; then
  echo "$failures of $checks checks failed, in $cases cases."
  exit 1
fi
echo "All $cases cases passed ($checks runs of $script)."
