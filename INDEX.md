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
- **Root command backbone** — `make <instrument>` runs an instrument;
  `make check` runs every instrument's automated validations in a strict
  PASSED/failure contract (see `~/.claude/CLAUDE.md` "Validation").
  [`Makefile`](Makefile), [`tools/check.sh`](tools/check.sh)

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
  chord buttons, every note voiced independently by exact pitch on any
  change, panic/safety valve on blur or tab-hide.
  [`hichord/js/input.js`](hichord/js/input.js), decisions in
  [`hichord/DECISIONS.md`](hichord/DECISIONS.md#input-model)
- **Loop recorder** — record-while-held, snap-to-beat playback via a Web
  Audio lookahead scheduler, quantized note timing.
  [`hichord/js/loop.js`](hichord/js/loop.js), decisions in
  [`hichord/DECISIONS.md`](hichord/DECISIONS.md#loop-recorder)
- **Tempo, click track, quantize** — shared bpm/quantize-grid state, the
  practice metronome click. [`hichord/js/tempo.js`](hichord/js/tempo.js),
  [`hichord/js/metronome.js`](hichord/js/metronome.js), decisions in
  [`hichord/DECISIONS.md`](hichord/DECISIONS.md#tempo-click-track-and-quantize)
- **UI rendering** — reads app state, updates the static markup (no DOM
  construction in JS); dynamic chord/variant grid relabeling and the
  now-playing notes diagnostic. [`hichord/js/ui.js`](hichord/js/ui.js),
  decisions in
  [`hichord/DECISIONS.md`](hichord/DECISIONS.md#dynamic-labeling-and-the-now-playing-panel)
- **Automated integration tests** — Playwright driving the real page/audio
  in a real browser; covers chords, variants, key/voice, loop, keyboard
  safety valves. [`hichord/tests/README.md`](hichord/tests/README.md),
  decisions in [`hichord/DECISIONS.md`](hichord/DECISIONS.md#automated-testing)
