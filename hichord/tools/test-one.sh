#!/usr/bin/env bash
# Runs a single test file (optionally narrowed by a -g name filter) directly
# through Playwright, for fast targeted iteration while working on one test
# or one bug -- unlike `make check`, this streams Playwright's own output
# straight to the terminal instead of capturing it to a log first, and skips
# the PASSED/FAILED validator contract (see ~/.claude/CLAUDE.md
# "Validation") since this is a dev convenience around the suite, not the
# suite's own pass/fail gate -- use `make check` for that. Reuses the same
# browser-server auto-connect as check.sh (see tools/browser-endpoint.sh) so
# this also works from a sandboxed agent session once a browser-server is
# running (see tests/README.md "Running under a sandboxed agent").
#
# A plain `npx playwright test` also works standalone, but calling it
# through here (or `make test-one`) sidesteps any interactive-shell wrapper
# around `npx` (e.g. a security scanner shell function) that isn't in effect
# inside a plain script -- run through `make`/`bash`, not by pasting the
# equivalent npx command into an interactive shell, if such a wrapper ever
# gets in the way.
set -uo pipefail
cd "$(dirname "$0")/.."

file="${1:?Usage: make test-one FILE=tests/foo.spec.js [GREP=\"test name\"]}"
name="${2:-}"

source tools/browser-endpoint.sh

# Two branches rather than a possibly-empty args array: macOS ships bash 3.2,
# where `"${arr[@]}"` on a declared-but-empty array trips `set -u`'s
# unbound-variable check.
if [ -n "$name" ]; then
  npx playwright test "$file" -g "$name"
else
  npx playwright test "$file"
fi
