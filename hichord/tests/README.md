# HiChord integration tests

Automated tests that drive the real app in a real browser (Playwright +
Firefox) -- real DOM, real keyboard/pointer events, real Web Audio. Added
once the app's logic (polyphony, per-note independence across variant/key/
chord-button changes, loop scheduling, the blur/visibility panic valve) grew
past what a manual smoke test alone catches reliably (see `../../PROCESS.md`
"Validation approach"). No audio or DOM framework needed changing to add
tests: Playwright drives the real static page in a real browser over
`python3 -m http.server` (same server the app already uses), so the tests
exercise the actual `input.js`/`audio.js`/`loop.js`/`theory.js` code paths
rather than a mocked stand-in. Firefox only for now (not also Chromium/
WebKit) to keep CI-less local runs fast -- see `playwright.config.js` for
why Firefox is the one picked; cross-browser behavior stays on the manual
checklist in `../README.md`.

## Run them

```sh
cd hichord
make check
```

Or standalone: `npm ci && npx playwright install firefox && npx playwright test`.

Iterating on one test or one bug: `make test-one FILE=tests/loop.spec.js` (add
`GREP="test name"` to narrow further) runs just that file directly through
Playwright instead of the full suite -- see the Makefile for what it does
and why.

### Running under a sandboxed agent

Firefox itself (unlike Chromium -- see `../playwright.config.js`'s own
comment on why Firefox is the browser used here) launches fine from inside a
sandboxed agent session once it's actually installed. The part sandboxed
agent sessions generally can't do is *install* it: `npx playwright install`
needs to write to a global, outside-the-repo cache
(`~/Library/Caches/ms-playwright` on macOS), which such a sandbox denies.
That's why `make check`'s `node_modules` prerequisite only runs `npm
install` (no browser download) -- see `../Makefile`'s `browsers` target,
kept separate for exactly this reason.

So: if Firefox has ever been installed for this repo before (by you, or by
an earlier non-sandboxed `make check`/`make test-host-start`/`make browsers`
run), a sandboxed agent's `make check` should just work, no extra step
needed. If it hasn't yet, run `make browsers` (or `make test-host-start`,
which depends on it) yourself once, in a plain local shell -- after that,
sandboxed runs work directly. `tools/check.sh` also tells the two failure
modes apart on its own (no browser reachable at all, vs. an actual failing
test), so a failing `make check` names which one it hit without needing to
re-diagnose it by hand.

A `make test-host-start` server (a `playwright run-server` your own shell
spawns, so the browser process is a child of it rather than the sandboxed
one -- see `../Makefile` "Browser server" and `../tools/browser-server.sh`)
is still worth using if you want the browser to persist and be reused across
many sandboxed `make check` runs without each one launching its own; `make
check` picks it up automatically via `PW_TEST_CONNECT_WS_ENDPOINT` if it's
running, falling back to a locally-launched Firefox otherwise. `make
test-host-stop` when done.

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
  clock, live play mixes with it, tapping `Space` alone actually stops the
  scheduler; a note following a long silent stretch still gets its full
  attack on every repeat (regression coverage for a late/no-attack bug).
- `bass.spec.js` -- the bass toggle (button and `B` key) layers an extra
  low root under a held chord, fixed to octave 2 regardless of octave
  shift, and never gets swept into an arpeggiated pattern -- it sustains
  on its own voice/track through both live play and loop playback.
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
- `playback-modes.spec.js` -- backtick/the mode-cycle button cycles Chord/
  Arpeggio/Lead; each mode's note-set or timing (including the root doubled
  an octave up by default), Lead mode greying out and ignoring the variant
  grid, and that a mode switch never rewrites an already-recorded loop.
- `tempo.spec.js` -- bpm/quantize controls and their `+`/`-`/`{`/`}`
  keyboard shortcuts (including `+`/`-`'s typematic hold-repeat and typing a
  bpm directly into the field), their effect on recorded timing, quantize's
  grid-collision edge case, loop playback phase-locking to a running click,
  the metronome click itself and its tap-tempo cue (four taps in a row).
- `keyboard-and-safety.spec.js` -- OS key-repeat is ignored, and the
  blur/visibilitychange "panic" safety valve releases a held chord.
- `voice-schema.spec.js` -- pure logic, no browser audio needed:
  `parseEnvelope`'s shorthand-string parsing, and that AudioEngine wires each
  level's envelope (voice/oscillator/effect) onto its own AudioParam in
  series with its parent, which is what makes nested envelopes compound.

Not covered here (left to the manual smoke test in `../README.md`): actually
*hearing* the result, touch-specific browser quirks (text selection/callout
suppression, iOS Safari's gesture-gated `AudioContext`), and cross-browser
behavior -- these tests run Chromium only.
