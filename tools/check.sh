#!/usr/bin/env bash
# Repo-wide validator entrypoint -- what `make check` (repo root) calls. See
# ~/.claude/CLAUDE.md "Validation" for the contract every validator in this
# repo follows: exit 0/nonzero, print exactly `PASSED` on success, and on
# failure print diagnostics specific enough to localize the problem plus
# save the full output to a file.
#
# This one is a *collection* (it runs each instrument's own `make check`,
# see AGENTS.md), so on success it suppresses every instrument's own PASSED
# and prints exactly one itself; on failure it relays each failing
# instrument's own diagnostic output (which already names its own saved
# log, e.g. hichord/build/check.log) and also saves a combined copy here.
set -uo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
report="build/check.log"
: > "$report"

failed=""
for instrument in $(make --no-print-directory list); do
  if output=$(make -C "$instrument" check 2>&1); then
    continue
  fi
  failed="$failed $instrument"
  { echo "=== $instrument ==="; echo "$output"; echo; } >> "$report"
done

if [ -z "$failed" ]; then
  echo "PASSED"
  exit 0
fi

echo "FAILED:$failed"
echo
cat "$report"
echo
echo "(Combined output also saved to $report -- each instrument's own log,"
echo "named above, has the same content plus that instrument's own context.)"
exit 1
