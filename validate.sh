#!/usr/bin/env bash
# Single entrypoint for every automated validation in this repo (see
# ~/.claude/CLAUDE.md "Validation"). `make check` is the actual aggregate
# (delegates to each instrument's own `make check`, see AGENTS.md); this
# script just wraps it in the strict contract other tooling can rely on:
# exit 0 and print exactly `PASSED` on success, or exit nonzero and print
# what failed plus how to dig further.
set -uo pipefail

output="$(make check 2>&1)"
status=$?

if [ "$status" -eq 0 ]; then
  echo "PASSED"
  exit 0
fi

echo "$output"
echo
echo "FAILED: \`make check\` exited $status."
echo "Re-run \`make check\` (or, for one instrument, \`cd <instrument> && make check\`) to see the full output above again."
echo "Each instrument's tests/README.md (where it has one) explains what's covered."
exit "$status"
