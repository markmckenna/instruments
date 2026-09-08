# AGENTS.md

Instructions for any agent (Claude or otherwise) working in this repo. This file
is meant to be *used*, not archived — keep it short and update it when a
convention changes rather than letting it drift out of sync with reality.

## What this repo is

A collection of small, independent digital-instrument experiments (web apps),
one per subdirectory. The point is fast iteration and feel-testing, not
building a platform — but keep an eye on decisions that will matter once we
start sharing code between instruments or wrapping them in a mobile app.

## Layout rules

- Each experiment lives in its own top-level directory (e.g. `hichord/`).
- Every experiment directory is self-contained: no imports from other
  experiment directories. If two instruments need the same logic, that's a
  signal to promote it to a shared location (see "Sharing code" below) —
  don't reach across directories as a shortcut.
- Every experiment directory has:
  - `README.md` — usage docs: what it is, controls, how to run it, browser
    support notes, known limitations.
  - `DECISIONS.md` — the instrument-specific design/technical decisions and
    why, written as you go.
  - `Makefile` — at minimum a `run` target that serves the app and opens it
    in the default browser. See "Make conventions" below.
- The root `README.md` links to each experiment's `README.md`.
- Root-level, cross-cutting process decisions (not specific to one
  instrument) go in `PROCESS.md` at the repo root.
- `INDEX.md` at the repo root lists every important concept in the repo
  (one line + a link to its source of truth). Read it before writing new
  code or planning a feature, and update it whenever a concept is added or
  removed.

## Sharing code

Don't pre-build a shared framework. Promote code to a `shared/` directory
only once a second instrument actually needs something an existing one has —
and even then, keep each instrument able to run standalone (no shared build
step required just to load one instrument). When you do promote something,
note it in `PROCESS.md` and in the `DECISIONS.md` of every instrument
affected.

## Tech approach

- No build step, no bundler, no framework, unless/until a specific instrument
  genuinely needs one. Plain HTML/CSS/JS with native ES modules
  (`<script type="module">`) is the default — it gets us file-level
  organization without tooling, and any future bundler adoption is additive.
- Web Audio API directly for sound; no audio framework dependency until
  there's a concrete reason.
- Pointer Events (not separate mouse/touch handlers) for on-screen controls,
  so desktop and mobile share one code path. Keyboard handling is additive on
  top of that for desktop, using `event.code` (physical key), not
  `event.key`, so layout/shift state doesn't matter.
- Every instrument must work, without a build step, by serving its directory
  over plain HTTP (`python3 -m http.server` or equivalent) and opening
  `index.html`.

## Make conventions (the automation backbone)

- Root `Makefile` has one target per instrument (matching its directory
  name), e.g. `make hichord`. Each just delegates to `$(MAKE) -C <dir> run`.
- Each instrument's own `Makefile` supports `make run` standalone (so
  `cd hichord && make run` and `make hichord` from the root do the same
  thing).
- An instrument with an automated test suite supports `make test` standalone,
  and the root `make test` runs every instrument's tests (skip instruments
  with none).
- `run` should be self-sufficient: serve the directory locally and open it
  in the default browser, blocking in the foreground so `Ctrl+C` cleanly
  stops the server.
- Give each instrument its own fixed local port (registry in `PROCESS.md`)
  so multiple instruments can be run side by side without colliding.
- When you add a new instrument, add it to the `INSTRUMENTS` list in the
  root `Makefile` and give it a port entry in `PROCESS.md`.

## Process / working style

- Don't over-plan small-to-medium changes — build directly, and write down
  decisions as you make them rather than up front. Use `DECISIONS.md`
  (per-instrument) and `PROCESS.md` (repo-wide) for this, not a separate
  planning doc.
- Optimize for low iteration cost: favor additive changes over rewrites, and
  when refactoring shared functionality out of an instrument, confirm the
  instrument still passes its own README's manual smoke-test checklist
  before/after.
- Default validation is a manual smoke test: load the app, run through its
  README's checklist in a real or emulated browser. Once an instrument gets
  complex enough to warrant automated tests, add them in that instrument's
  own directory and note the tooling choice in its `DECISIONS.md` (see
  `PROCESS.md` "Validation approach" for the current per-instrument state).
- Target browsers: current Chrome and Safari, both desktop and mobile. Keep
  this in mind for input handling (touch + pointer + keyboard), audio
  context unlocking (iOS Safari requires a user-gesture-triggered
  resume/create), and viewport/safe-area handling.
- Git: work on a feature branch per experiment/change, commit in small
  logical steps with descriptive messages, so the history itself documents
  how the work proceeded.
