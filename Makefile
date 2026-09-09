# Root command backbone for the instruments repo.
# See AGENTS.md ("Make conventions") and PROCESS.md before changing this.
# Run `make help` for the command list (each target's `## ` comment below is
# that list's one source -- shown both here and by `help` itself).
#
# `make check` is the strict-contract entrypoint (see ~/.claude/CLAUDE.md
# "Validation"): exit 0 and print exactly `PASSED` on success, or exit
# nonzero with diagnostics + a saved log on failure. It just delegates to
# each instrument's own `make check`, which already satisfies that contract
# on its own (see e.g. hichord/tools/check.sh) -- with a single instrument,
# that's already exactly one PASSED/failure, so there's nothing here worth
# wrapping in its own tools/check.sh. Revisit that once a second instrument
# means more than one PASSED would need suppressing into this target's own.

INSTRUMENTS := hichord

.PHONY: help init list check $(INSTRUMENTS)

help: ## List available commands
	@echo "instruments repo -- available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'
	@printf "  make %-18s %s\n" "<instrument>" "Run that instrument locally and open it in a browser"
	@echo ""
	@echo "Available instruments: $(INSTRUMENTS)"

# Installs each instrument's own dependencies (e.g. hichord's `node_modules`
# target: npm packages plus its Playwright browser binary). Run this
# yourself in a plain local shell, not through an agent's sandboxed tool
# execution: it's a real one-time write to machine-wide state outside the
# repo (e.g. ~/Library/Caches/ms-playwright) and a real network download, so
# it needs the full permissions of your own environment.
init: ## One-time setup: install each instrument's dependencies
	@for i in $(INSTRUMENTS); do \
	  if [ -f $$i/package.json ]; then $(MAKE) --no-print-directory -C $$i node_modules || exit 1; fi; \
	done

list: ## List available instruments
	@echo "$(INSTRUMENTS)"

check: ## Run every instrument's automated validations
	@for i in $(INSTRUMENTS); do $(MAKE) --no-print-directory -C $$i check || exit 1; done

$(INSTRUMENTS):
	@$(MAKE) -C $@ run
