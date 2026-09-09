# HiChord integration tests

Automated tests that drive the real app in a real browser (Playwright +
Chromium) -- real DOM, real keyboard/pointer events, real Web Audio. See
`../DECISIONS.md` ("Automated testing") for why Playwright and why now.

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
  hand-copying a table of expected notes. If the chord/variant math in
  `theory.js` changes, the expectations move with it.
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
- `tempo.spec.js` -- bpm/quantize controls and their effect on recorded
  timing, quantize's grid-collision edge case, loop playback phase-locking
  to a running click, the metronome click itself.
- `keyboard-and-safety.spec.js` -- OS key-repeat is ignored, and the
  blur/visibilitychange "panic" safety valve releases a held chord.

Not covered here (left to the manual smoke test in `../README.md`): actually
*hearing* the result, touch-specific browser quirks (text selection/callout
suppression, iOS Safari's gesture-gated `AudioContext`), and cross-browser
behavior -- these tests run Chromium only.
