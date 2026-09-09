#!/usr/bin/env bash
# Wraps the Playwright suite in the repo-wide validator contract -- see
# ~/.claude/CLAUDE.md "Validation": exit 0/nonzero, print exactly `PASSED`
# on success (Playwright's own verbose pass/fail listing is captured to a
# log but not shown), and on failure print diagnostics specific enough to
# localize the problem plus save the full output to a file.
#
# Playwright's own per-test failure output already names the exact
# file:line and an expected/actual diff (and, since playwright.config.js
# sets `trace: 'retain-on-failure'`, a trace.zip to inspect) -- that's
# already the specific diagnostic the contract asks for, so it's relayed in
# full on failure rather than re-summarized.
set -uo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
log="build/check.log"

npx playwright test > "$log" 2>&1
status=$?

if [ "$status" -eq 0 ]; then
  echo "PASSED"
  exit 0
fi

cat "$log"
echo
echo "FAILED: hichord's Playwright suite -- see tests/README.md for what's covered."
echo "Full output saved to hichord/$log."
if ls test-results/*/trace.zip >/dev/null 2>&1; then
  echo "Trace(s) for the failing test(s) saved under hichord/test-results/ -- inspect one with:"
  echo "  npx playwright show-trace <path-to-trace.zip>"
fi
exit "$status"
