# PROCESS.md

Repo-wide process decisions that apply across instruments. Instrument-specific
decisions live with what they explain — a code comment for a technical
choice, a README section for a user-facing one — see `AGENTS.md` ("Decisions
live with their subject") for the split.

## Repo structure

- One subdirectory per instrument, fully independent of one another (no
  cross-imports) until at least two instruments need the same thing. This
  keeps early experiments changeable without a chain of cross-instrument
  regressions, at the cost of some duplication — an accepted tradeoff while
  the number of instruments is small.
- A `shared/` directory will be introduced the first time two instruments
  actually need the same logic, not before. When that happens, record it
  here (what moved, why, which instruments consume it) and as a comment in
  the promoted code itself.

## Tooling

- No build step / bundler / framework by default. Native ES modules served
  as static files. Rationale: this is an iteration/feel-testing phase; a
  build step adds cost to every change and to onboarding a new instrument,
  for no benefit yet. Revisit if/when we wrap instruments into a mobile app
  (see "Looking ahead").
- Local dev server: `python3 -m http.server`, since it's preinstalled on the
  target dev machine (macOS) and needs no project dependencies.

## Make-based command backbone

- `make <instrument>` from the repo root builds/runs that instrument and
  opens it in the browser (e.g. `make hichord`).
- `cd <instrument> && make run` does the same thing standalone.
- Both block in the foreground (server + `Ctrl+C` to stop) rather than
  daemonizing, to keep the mental model simple and avoid leaking background
  server processes between sessions.
- Port registry (each instrument gets a fixed port so they can run side by
  side):

  | Instrument | Port |
  |---|---|
  | hichord | 4173 |

  When adding an instrument, pick the next free port and add a row here.

## Validation approach

- No repo-wide test framework mandate -- each instrument's `README.md`
  carries a manual smoke-test checklist by default; run it after meaningful
  changes, in real or emulated Chrome + Safari, desktop + mobile.
- Add automated tests per-instrument once its logic (audio scheduling, chord
  theory, timing) grows complex enough that manual testing stops being
  reliable, and note the tooling choice in that instrument's
  `tests/README.md`. First instance: `hichord` (Playwright integration tests
  driving the real page in a real browser; `hichord/tests/README.md`). Reach
  for the same tooling for the next instrument unless it has a concrete
  reason not to.
- `node --check` on each JS module remains a cheap syntax-error guard
  regardless of whether an instrument has a test suite yet.
- Every `make check` (root and each instrument's own) follows the same
  strict contract directly -- see `~/.claude/CLAUDE.md` "Validation": exit
  0/nonzero, print exactly `PASSED` on success, and on failure print
  diagnostics specific enough to localize the problem plus save the full
  output to a file (named in the failure text). Nontrivial validation logic
  lives in that level's own `tools/check.sh`, which `make check` just calls
  -- see `tools/check.sh` (root, a collection: runs every instrument's
  `make check` and suppresses their individual PASSEDs into its own one) and
  `hichord/tools/check.sh` (a leaf: wraps Playwright) for the pattern.

## Git workflow

- Work on a feature branch per unit of work (not directly on `main`).
- Commit in small logical steps (scaffolding → engine/logic → UI/wiring →
  tooling → docs → validation fixes) with descriptive messages, so the
  history documents how the work actually proceeded and can be reviewed
  step by step.

## Looking ahead (not yet acted on)

- Eventual goal: wrap one or more instruments into native-feeling mobile
  app(s). Keeping instruments dependency-light and build-step-free now
  should make that easier later (e.g. via a WebView wrapper, or a later
  bundler pass) rather than harder — but no framework/tooling decision for
  that has been made yet. Don't preemptively build for it; just avoid
  choices that would foreclose it cheaply (e.g. avoid hard dependencies on
  being served from a specific origin/path).
