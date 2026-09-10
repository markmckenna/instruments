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
  shapes, inversion as a structural rotation of a chord's own offsets) and
  the chord-symbol name to display for one; no keycodes, no MIDI.
  [`hichord/js/theory.js`](hichord/js/theory.js)
- **Voice/oscillator/effect schema** — what a sound preset *is*: oscillators
  with detune/gain/octave/pan, a nestable envelope/effects chain (voice,
  oscillator, and per-effect), every Web Audio filter type exposed as its own
  effect (resonance/keyTrack/envAmount), reverb/tremolo/delay/distortion, and
  the "base~range" per-note randomization notation. Pure
  data/validation, no Web Audio node graph. [`hichord/js/voices.js`](hichord/js/voices.js)
- **Audio engine** — turning an abstract chord/variant/inversion/octave-shift
  and playback mode into actual MIDI pitches and then into a Web Audio node
  graph built from a normalized voice (see the schema above): independent
  per-voice polyphony where each note attacks/releases only when it actually
  needs to (nothing retriggers just because the chord around it changed),
  gain staging to avoid clipping, and nested envelopes/keyTrack/randomization
  resolved fresh per note but compounding via plain series wiring, no
  compositing math of its own. [`hichord/js/audio.js`](hichord/js/audio.js)
- **Input handling** — translating keyboard/pointer input into "what chord +
  variant is currently held" (polyphonic chord buttons, a single-variant
  "joystick" control, per-key octave/inversion/locked-modifier state, a
  global octave register, and the current playback mode), including the
  physical-key layout itself, plus a safety valve for lost focus.
  [`hichord/js/input.js`](hichord/js/input.js)
- **Loop handling** — recording what's played into a beat-quantized,
  looping sequence, and replaying it through a lookahead scheduler
  phase-locked to the shared tempo. [`hichord/js/loop.js`](hichord/js/loop.js)
- **Arpeggiation** — sequencing a held chord's notes one at a time instead of
  together, on its own tempo-driven clock, reusing the audio engine's
  exact-pitch reconciliation to step from note to note.
  [`hichord/js/arpeggiator.js`](hichord/js/arpeggiator.js)
- **Time/tempo handling** — the shared bpm/quantize-resolution state
  everything else (looping, the metronome, arpeggiation) reads from, and the
  practice click itself. [`hichord/js/tempo.js`](hichord/js/tempo.js),
  [`hichord/js/metronome.js`](hichord/js/metronome.js)
- **UI management** — rendering held/available state onto the static
  markup, including labels that dynamically reflect what a control would
  actually do. [`hichord/js/ui.js`](hichord/js/ui.js)
