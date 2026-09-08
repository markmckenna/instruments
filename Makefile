# Root command backbone for the instruments repo.
# See AGENTS.md ("Make conventions") and PROCESS.md before changing this.
#
# Usage:
#   make hichord      # build/serve the hichord experiment and open it in a browser
#   make list         # list available instruments
#   make check        # run every instrument's automated validations (where it has any)
#   make help         # this message
#
# `make check` is also reachable via `./validate.sh` at the repo root, which
# wraps it in the exit-code/PASSED contract other tooling can rely on.

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
	@for i in $(INSTRUMENTS); do $(MAKE) -C $$i check || exit 1; done

$(INSTRUMENTS):
	@$(MAKE) -C $@ run
