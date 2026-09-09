# See ../AGENTS.md ("Make conventions") before changing this.
#
# Usage:
#   make run     Serve HiChord locally and open it in the default browser
#   make stop    Kill a server left running from a backgrounded `make run`
#   make check   Run the automated integration tests (see tests/README.md).
#                Strict PASSED/failure contract, see tools/check.sh and
#                ~/.claude/CLAUDE.md "Validation".

PORT ?= 4173
URL := http://localhost:$(PORT)

.PHONY: run open stop check

run:
	@echo "HiChord: $(URL)  (Ctrl+C to stop)"
	@( sleep 1 && $(MAKE) --no-print-directory open ) &
	@python3 -m http.server $(PORT) --directory . --bind 127.0.0.1

open:
	@if command -v open >/dev/null 2>&1; then open "$(URL)"; \
	elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$(URL)"; \
	else echo "Open $(URL) in your browser"; fi

stop:
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true

node_modules: package.json
	@npm install
	@npx playwright install chromium
	@touch node_modules

check: node_modules
	@bash tools/check.sh
