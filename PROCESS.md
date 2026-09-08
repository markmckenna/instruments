# PROCESS.md

Repo-wide process decisions that apply across instruments. Instrument-specific
decisions live in each instrument's own `DECISIONS.md` — see `AGENTS.md` for
the split.

## Repo structure

- One subdirectory per instrument, fully independent of one another (no
  cross-imports) until at least two instruments need the same thing. This
  keeps early experiments changeable without a chain of cross-instrument
  regressions, at the cost of some duplication — an accepted tradeoff while
  the number of instruments is small.
- A `shared/` directory will be introduced the first time two instruments
  actually need the same logic, not before. When that happens, record it
  here (what moved, why, which instruments consume it) and in the
  `DECISIONS.md` of each affected instrument.

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

- No automated test framework yet (nothing here has enough logic branching
  to clearly justify one over the cost of adding test tooling). Each
  instrument's `README.md` carries a manual smoke-test checklist instead;
  run it after meaningful changes, in real or emulated Chrome + Safari,
  desktop + mobile.
- Revisit per-instrument if/when an instrument's logic (e.g. audio
  scheduling, chord theory) grows complex enough that manual testing stops
  being reliable. `node --check` on each JS module is used as a cheap
  syntax-error guard in the meantime.

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
