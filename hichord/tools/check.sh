#!/usr/bin/env bash
# Wraps this instrument's automated validation in the repo-wide validator
# contract -- see ~/.claude/CLAUDE.md "Validation": exit 0/nonzero, print
# exactly `PASSED` on success (each stage's own verbose output is captured to
# a log but not shown), and on failure print diagnostics specific enough to
# localize the problem plus save the full output to a file. Two stages, in
# order: a `node --check` syntax pass over every JS module, then the
# Playwright integration suite.
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

# Cheap syntax-error guard over every JS module, regardless of what the
# Playwright suite below covers -- see ../../PROCESS.md "Validation
# approach". Runs first: a syntax error would otherwise surface as a
# confusing Playwright failure (or a page that silently fails to load) far
# from the actual broken file.
syntax_log="build/syntax-check.log"
: > "$syntax_log"
syntax_failed=0
while IFS= read -r -d '' f; do
  echo "== $f ==" >>"$syntax_log"
  if ! node --check "$f" >>"$syntax_log" 2>&1; then
    syntax_failed=1
  fi
done < <(find js tests -name '*.js' -print0)

if [ "$syntax_failed" -ne 0 ]; then
  cat "$syntax_log"
  echo
  echo "FAILED: node --check found a syntax error in one or more JS modules above (look for the '== <file> ==' header just before the error)."
  echo "Full output saved to hichord/$syntax_log."
  exit 1
fi

# Use a running `make test-host-start` server if there is one -- lets the
# suite run somewhere a sandboxed agent can't spawn a browser process itself.
# Falls back to Playwright launching its own local browser otherwise, same
# as always. See tools/browser-endpoint.sh for how the server is detected.
source tools/browser-endpoint.sh

npx playwright test > "$log" 2>&1
status=$?

if [ "$status" -eq 0 ]; then
  echo "PASSED"
  exit 0
fi

# Distinguish "no browser was reachable at all" from an actual failing test
# -- a sandboxed agent session can neither install nor launch a local
# browser (see tests/README.md "Running under a sandboxed agent"), and
# re-discovering that by trial and error each time wastes a round trip on
# something this log already knows. Checked before the generic failure
# dump below so this specific case never gets buried in Playwright's own
# (unrelated-looking) output.
if [ -z "${PW_TEST_CONNECT_WS_ENDPOINT:-}" ] && grep -qE "Executable doesn't exist|browserType\.launch|EPERM|Please run the following command" "$log"; then
  echo "FAILED: no browser was reachable to run the Playwright suite against."
  echo "No PW_TEST_CONNECT_WS_ENDPOINT is set (no live 'make test-host-start' server was found in build/browser-server.log), and this sandbox can't install or launch a local browser itself."
  echo "Ask the person running this session to run 'make test-host-start' in a plain local shell, then re-run 'make check'."
  echo "Full Playwright output saved to hichord/$log, for reference."
  exit "$status"
fi
if [ -n "${PW_TEST_CONNECT_WS_ENDPOINT:-}" ] && grep -qE "ECONNREFUSED|WebSocket error|Target closed" "$log"; then
  echo "FAILED: the recorded browser-server endpoint ($PW_TEST_CONNECT_WS_ENDPOINT) didn't respond."
  echo "It may have been stopped from outside this session -- run 'make test-host-stop' then 'make test-host-start' in a plain local shell, then re-run 'make check'."
  echo "Full Playwright output saved to hichord/$log, for reference."
  exit "$status"
fi

cat "$log"
echo
echo "FAILED: hichord's Playwright suite -- see tests/README.md for what's covered."
echo "Full output saved to hichord/$log."
if ls build/test-results/*/trace.zip >/dev/null 2>&1; then
  echo "Trace(s) for the failing test(s) saved under hichord/build/test-results/ -- inspect one with:"
  echo "  npx playwright show-trace <path-to-trace.zip>"
fi
exit "$status"
