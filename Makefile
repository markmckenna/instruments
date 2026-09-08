# Root command backbone for the instruments repo.
# See AGENTS.md ("Make conventions") and PROCESS.md before changing this.
#
# Usage:
#   make hichord      # build/serve the hichord experiment and open it in a browser
#   make list         # list available instruments
#   make test         # run every instrument's automated tests (where it has any)
#   make help         # this message

INSTRUMENTS := hichord

.PHONY: help list test $(INSTRUMENTS)

help:
	@echo "instruments repo — available commands:"
	@echo ""
	@echo "  make <instrument>   Run that instrument locally and open it in a browser"
	@echo "  make list           List available instruments"
	@echo "  make test           Run every instrument's automated tests"
	@echo ""
	@echo "Available instruments: $(INSTRUMENTS)"

list:
	@echo "$(INSTRUMENTS)"

test:
	@for i in $(INSTRUMENTS); do $(MAKE) -C $$i test || exit 1; done

$(INSTRUMENTS):
	@$(MAKE) -C $@ run
