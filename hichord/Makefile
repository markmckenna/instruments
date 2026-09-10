# See ../AGENTS.md ("Make conventions") before changing this.
# Run `make help` for the command list (each target's `## ` comment below is
# that list's one source -- shown both here and by `help` itself).

PORT ?= 4173
URL := http://localhost:$(PORT)

.PHONY: help run open stop browsers test-host-start test-host-stop check test-one

help: ## List available commands
	@echo "hichord -- available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-16s %s\n", $$1, $$2}'

run: ## Serve HiChord locally and open it in the default browser
	@echo "HiChord: $(URL)  (Ctrl+C to stop)"
	@( sleep 1 && $(MAKE) --no-print-directory open ) &
	@python3 -m http.server $(PORT) --directory . --bind 127.0.0.1

open:
	@if command -v open >/dev/null 2>&1; then open "$(URL)"; \
	elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$(URL)"; \
	else echo "Open $(URL) in your browser"; fi

stop: ## Kill a server left running from a backgrounded 'make run'
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true

node_modules: package.json
	@npm install
	@touch node_modules

# Downloads the actual Firefox binary Playwright drives -- kept out of the
# node_modules recipe above so `make check` never needs it just to install
# npm packages: it may instead connect to an already-running browser-server
# via PW_TEST_CONNECT_WS_ENDPOINT (see tools/check.sh), in which case no
# local browser is needed at all. Only test-host-start actually launches a
# real local browser, and that's meant to run in your own unsandboxed shell
# anyway (see "Running under a sandboxed agent" in tests/README.md) --
# `npx playwright install` needs to write to a global cache outside the repo
# (~/Library/Caches/ms-playwright on macOS), which a sandboxed agent session
# generally can't.
browsers: node_modules
	@npx playwright install firefox

# Browser server: a persistent, out-of-process browser that `make check`/
# `npx playwright test` connects to (via PW_TEST_CONNECT_WS_ENDPOINT) instead
# of launching its own browser -- see tools/browser-server.sh and
# tests/README.md ("Running under a sandboxed agent") for why this exists.
# Run these two yourself in a plain local shell (not through a sandboxed
# agent session): the whole point is that the browser process gets spawned
# by *your* shell, not a sandboxed one.
BROWSER_SERVER_PORT ?= 4175

test-host-start: browsers ## Start the Playwright browser server (see comment above)
	@BROWSER_SERVER_PORT=$(BROWSER_SERVER_PORT) bash tools/browser-server.sh start

test-host-stop: ## Stop the Playwright browser server
	@bash tools/browser-server.sh stop

check: node_modules ## Run the automated integration tests (see tests/README.md)
	@bash tools/check.sh

# For fast iteration on one test/bug -- streams Playwright's own output
# straight through instead of capturing it to a log, and skips the
# PASSED/FAILED contract `check` follows (see tools/test-one.sh). Also
# sidesteps any interactive-shell wrapper around `npx` that could otherwise
# get in the way of running Playwright directly.
test-one: node_modules ## Run one test file, e.g. make test-one FILE=tests/loop.spec.js [GREP="test name"]
	@bash tools/test-one.sh "$(FILE)" "$(GREP)"
