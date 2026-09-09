# HiChord integration tests

Automated tests that drive the real app in a real browser (Playwright +
Chromium) -- real DOM, real keyboard/pointer events, real Web Audio. Added
once the app's logic (polyphony, per-note independence across variant/key/
chord-button changes, loop scheduling, the blur/visibility panic valve) grew
past what a manual smoke test alone catches reliably (see `../../PROCESS.md`
"Validation approach"). No audio or DOM framework needed changing to add
tests: Playwright drives the real static page in a real browser over
`python3 -m http.server` (same server the app already uses), so the tests
exercise the actual `input.js`/`audio.js`/`loop.js`/`theory.js` code paths
rather than a mocked stand-in. Chromium only for now (not also WebKit/
Safari) to keep CI-less local runs fast; cross-browser behavior stays on the
manual checklist in `../README.md`.

## Run them

```sh
cd hichord
make check
```

Or standalone: `npm ci && npx playwright install chromium && npx playwright test`.

## How they work

- `support/fixtures.js` provides the `test`/`expect` every spec imports. It
  installs a small Web Audio probe (`page.addInitScript`) before the app's
  own scripts run, wrapping `OscillatorNode.start/stop` so tests can assert
  on what the audio engine actually did (`markAudio` / `audioEventsSince`)
  instead of only on DOM state. It also fails any test whose page logged a
  console error or an uncaught exception.
- `support/expected-audio.js` computes the frequencies a chord *should*
  produce by importing `js/theory.js` and `js/audio.js` directly (both are
  dependency-free and DOM-free, so they run fine under Node) rather than
  hand-copying a table of expected notes. If the chord/variant shapes in
  `theory.js` or `buildChord` in `audio.js` change, the expectations move
  with them. Specs that need the physical-key layout itself (`CHORD_KEYS`,
  `VARIANT_GRID`, `VARIANT_KEYS`) import `js/input.js` directly the same
  way -- its keyboard/DOM wiring is deferred behind `initInput()` rather
  than run at module load, so importing it for its plain data doesn't
  require a browser either.
- `support/interactions.js` holds on-screen buttons with a real mouse and
  physical keys with real keyboard events, rather than fabricating
  `PointerEvent`s -- `input.js` calls `setPointerCapture` unguarded, which
  throws for a pointerId that was never actually pressed down. Simultaneous
  holds (polyphony) are done by combining one mouse hold with one keyboard
  hold, which is also a closer stand-in for two simultaneous touches than a
  single input device could give.

## What's covered

- `chords.spec.js` -- each chord button's triad, release, and polyphony
  (multiple buttons held at once, each one's notes independent of the
  other's).
- `variants.spec.js` -- the QWE/ASD/ZXC grid: a variant change only
  starts/stops the notes that actually differ, leaving any note shared with
  the previous chord sounding untouched, plus quality-dependent variants
  (M7, Mm flip, 6sus2) over major/minor/diminished bases.
- `key-voice.spec.js` -- key switching relabels every chord button and
  reconciles a held chord's notes by exact pitch; voice switching changes
  the actual oscillator layout used.
- `dynamic-labels.spec.js` -- the variant grid's fixed mood names (Dreamy/
  Inverted/.../Lush) render in grid order regardless of held state; holding
  one chord relabels the variant grid to real chord names (and reverts once
  released, or once a second chord is also held); holding a variant relabels
  the chord grid the same way in reverse; the now-playing panel names the
  actual sounding notes.
- `loop.spec.js` -- record/release starts real looping playback on the real
  clock, live play mixes with it, Clear loop actually stops the scheduler.
- `octave.spec.js` -- the three effects of `[`/`]` (shift a sounding chord,
  silently target a chord while held first, shift the global register when
  no chord's involved), applying to every held chord at once, and the
  resulting chord-name suffix.
- `inversion.spec.js` -- `/` cycles a held chord's inversion, remembered per
  key, reflected in its name, and reinterpreted (not reset) across a variant
  change that alters the chord's note count.
- `chord-lock.spec.js` -- `.` locks/updates/clears a variant on a held
  chord, a locked chord keeps sounding shaped by it once released, and a
  physically-held variant still overrides a lock live.
- `playback-modes.spec.js` -- backtick/tap cycles Chord/Bass/Arpeggio/Lead;
  each mode's note-set or timing, and that a mode switch never rewrites an
  already-recorded loop.
- `tempo.spec.js` -- bpm/quantize controls and their effect on recorded
  timing, quantize's grid-collision edge case, loop playback phase-locking
  to a running click, the metronome click itself.
- `keyboard-and-safety.spec.js` -- OS key-repeat is ignored, and the
  blur/visibilitychange "panic" safety valve releases a held chord.

Not covered here (left to the manual smoke test in `../README.md`): actually
*hearing* the result, touch-specific browser quirks (text selection/callout
suppression, iOS Safari's gesture-gated `AudioContext`), and cross-browser
behavior -- these tests run Chromium only.
