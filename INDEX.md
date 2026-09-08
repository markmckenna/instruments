# Concept Index

Every important concept in this repo, one line each, linked to its source of
truth. Read this before writing new code or planning a feature; update it
whenever a concept is added or removed (see `~/.claude/CLAUDE.md`
"Concept Indexing").

## Repo-wide

- **Instrument layout & conventions** — one self-contained directory per
  instrument, no cross-imports, standard file set (`README.md`,
  `DECISIONS.md`, `Makefile`). [`AGENTS.md`](AGENTS.md)
- **Cross-cutting process decisions** — repo structure, tooling defaults,
  Make command backbone, port registry, validation approach, git workflow.
  [`PROCESS.md`](PROCESS.md)
- **Root command backbone** — `make <instrument>` runs an instrument,
  `make test` runs every instrument's automated tests. [`Makefile`](Makefile)

## HiChord (`hichord/`)

- **What it is & controls** — the instrument itself, how to run it, manual
  smoke-test checklist. [`hichord/README.md`](hichord/README.md)
- **Chord & variant theory** — key/scale/chord math (circle of fifths,
  diatonic degrees, the 9-variant grid). [`hichord/js/theory.js`](hichord/js/theory.js),
  decisions in [`hichord/DECISIONS.md`](hichord/DECISIONS.md#chord--variant-theory)
- **Audio engine** — Web Audio oscillators/envelopes, independent polyphonic
  voices, gain staging/limiter. [`hichord/js/audio.js`](hichord/js/audio.js),
  decisions in [`hichord/DECISIONS.md`](hichord/DECISIONS.md#audio-engine)
- **Input model** — keyboard (`event.code`) + pointer wiring, polyphonic
  chord buttons, glide-vs-retrigger on variant change, panic/safety valve on
  blur or tab-hide. [`hichord/js/input.js`](hichord/js/input.js), decisions in
  [`hichord/DECISIONS.md`](hichord/DECISIONS.md#input-model)
- **Loop recorder** — record-while-held, snap-to-beat playback via a Web
  Audio lookahead scheduler. [`hichord/js/loop.js`](hichord/js/loop.js),
  decisions in [`hichord/DECISIONS.md`](hichord/DECISIONS.md#loop-recorder)
- **UI rendering** — reads app state, updates the static markup (no DOM
  construction in JS). [`hichord/js/ui.js`](hichord/js/ui.js)
- **Automated integration tests** — Playwright driving the real page/audio
  in a real browser; covers chords, variants, key/voice, loop, keyboard
  safety valves. [`hichord/tests/README.md`](hichord/tests/README.md),
  decisions in [`hichord/DECISIONS.md`](hichord/DECISIONS.md#automated-testing)
