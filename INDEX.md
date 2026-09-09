# Concept Index

Every important concept in this repo, one line each, linked to its source of
truth. A concept is a reusable subsystem, responsibility, or idea — something
worth recognizing as already-solved if the same problem comes up again
elsewhere in the repo — not a file, a test suite, or "how to use this" (see
`~/.claude/CLAUDE.md` "Concept Indexing"). Read this before writing new code
or planning a feature; update it whenever a concept is added or removed.

## Repo-wide

- **Instrument layout & conventions** — one self-contained directory per
  instrument, no cross-imports, standard file set (`README.md`, `Makefile`).
  [`AGENTS.md`](AGENTS.md)
- **Validator contract** — every `make check`, at every level, follows the
  same strict PASSED/failure contract, with nontrivial logic delegated to
  that level's own `tools/check.sh`. [`Makefile`](Makefile),
  [`hichord/tools/check.sh`](hichord/tools/check.sh)

## HiChord (`hichord/`)

- **Chord & variant theory** — the music-theory model, entirely in the
  abstract (circle of fifths, diatonic degrees, quality-dependent variant
  shapes) and the chord-symbol name to display for one; no keycodes, no MIDI.
  [`hichord/js/theory.js`](hichord/js/theory.js)
- **Audio engine** — turning an abstract chord/variant into actual MIDI
  pitches and then into sound: independent per-voice polyphony where each
  note attacks/releases only when it actually needs to (nothing retriggers
  just because the chord around it changed), envelope shaping, and gain
  staging to avoid clipping. [`hichord/js/audio.js`](hichord/js/audio.js)
- **Input handling** — translating keyboard/pointer input into "what chord +
  variant is currently held" (polyphonic chord buttons, a single-variant
  "joystick" control), including the physical-key layout itself, plus a
  safety valve for lost focus. [`hichord/js/input.js`](hichord/js/input.js)
- **Loop handling** — recording what's played into a beat-quantized,
  looping sequence, and replaying it through a lookahead scheduler
  phase-locked to the shared tempo. [`hichord/js/loop.js`](hichord/js/loop.js)
- **Time/tempo handling** — the shared bpm/quantize-resolution state
  everything else (looping, the metronome) reads from, and the practice
  click itself. [`hichord/js/tempo.js`](hichord/js/tempo.js),
  [`hichord/js/metronome.js`](hichord/js/metronome.js)
- **UI management** — rendering held/available state onto the static
  markup, including labels that dynamically reflect what a control would
  actually do. [`hichord/js/ui.js`](hichord/js/ui.js)
