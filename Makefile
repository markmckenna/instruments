# Root command backbone for the instruments repo.
# See AGENTS.md ("Make conventions") and PROCESS.md before changing this.
#
# Usage:
#   make hichord      # build/serve the hichord experiment and open it in a browser
#   make list         # list available instruments
#   make check        # run every instrument's automated validations (where it has any)
#   make help         # this message
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

.PHONY: help list check $(INSTRUMENTS)

help:
	@echo "instruments repo — available commands:"
	@echo ""
	@echo "  make <instrument>   Run that instrument locally and open it in a browser"
	@echo "  make list           List available instruments"
	@echo "  make check          Run every instrument's automated validations"
	@echo ""
	@echo "Available instruments: $(INSTRUMENTS)"

list:
	@echo "$(INSTRUMENTS)"

check:
	@for i in $(INSTRUMENTS); do $(MAKE) --no-print-directory -C $$i check || exit 1; done

$(INSTRUMENTS):
	@$(MAKE) -C $@ run
