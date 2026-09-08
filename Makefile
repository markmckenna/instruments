# Root command backbone for the instruments repo.
# See AGENTS.md ("Make conventions") and PROCESS.md before changing this.
#
# Usage:
#   make hichord      # build/serve the hichord experiment and open it in a browser
#   make list         # list available instruments
#   make help         # this message

INSTRUMENTS := hichord

.PHONY: help list $(INSTRUMENTS)

help:
	@echo "instruments repo — available commands:"
	@echo ""
	@echo "  make <instrument>   Run that instrument locally and open it in a browser"
	@echo "  make list           List available instruments"
	@echo ""
	@echo "Available instruments: $(INSTRUMENTS)"

list:
	@echo "$(INSTRUMENTS)"

$(INSTRUMENTS):
	@$(MAKE) -C $@ run
