# See ../AGENTS.md ("Make conventions") before changing this.
#
# Usage:
#   make run     Serve HiChord locally and open it in the default browser
#   make stop    Kill a server left running from a backgrounded `make run`

PORT ?= 4173
URL := http://localhost:$(PORT)

.PHONY: run open stop

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
