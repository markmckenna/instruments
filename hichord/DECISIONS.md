# HiChord: Design & Implementation Decisions

Instrument-specific decisions. Repo-wide decisions are in `../PROCESS.md`;
working conventions for future changes are in `../AGENTS.md`.

## Source of truth for behavior

The top-level README's experiment description is the spec. The real HiChord
hardware (hichord.shop) uses a 7-button + joystick layout, not a QWERTY
keyboard — I fetched its manual for reference but did not copy its exact
control scheme, since our README already defines a different, keyboard-native
one. Where the README leaves a detail unspecified, I used the real HiChord's
joystick behavior as a tie-breaker, since it's what the experiment is
explicitly modeled on. Concretely, the 3x3 variant grid's spatial layout
(Q=up-left, S=center, C=down-right, etc.) lines up with the real device's
8-direction joystick + click, which is why the variants are defined the way
they are below.

## Chord & variant theory

- **Diatonic chords (JIKOLP;)**: standard major-key harmony — I, ii, iii, IV,
  V, vi, vii° — assigned to the 7 keys in the README's stated left-to-right
  order. Root position triads.
- **Variant grid (QWE/ASD/ZXC)**, mapped from the real HiChord joystick
  directions the grid's spatial layout mirrors:
  - `aug` (Q): forces `[0,4,8]` — augmented triad, root position, regardless
    of the base chord's quality.
  - `Mm flip` (W): toggles major⟷minor third, perfect fifth kept.
  - `dom7` (E): forces `[0,4,7,10]` — a dominant 7th chord on that root,
    regardless of base quality (dominant chords are inherently major-third).
  - `dim` (A): forces `[0,3,6]` — diminished triad on that root.
  - `neutral` (S): the plain diatonic triad, unmodified. This is a real,
    separate held key (the grid's center), not "no variant held" — holding S
    and holding nothing produce the same sound but are tracked the same way
    any other variant is.
  - `M7` (D): adds a 7th *using the base chord's own quality* — major 7th
    over a major triad, minor 7th over a minor one, and a half-diminished
    (m7♭5, `[0,3,6,10]`) over the diminished vii° button. This is the one
    variant that depends on the base chord's quality rather than overriding
    it, matching the real device's "maj7/min7" joystick direction.
  - `6sus2` (Z): `[0,2,7,9]` — root, 2nd, 5th, 6th; no 3rd. A sus2/add6
    voicing (common pop-chord color), matching the joystick's paired
    "6th/Sus2" direction as one merged variant rather than two.
  - `sus4` (X): `[0,5,7]` — suspended triad, no 3rd.
  - `9` (C): `[0,4,7,10,14]` — dominant 9th (root, 3, 5, ♭7, 9).

  These are documented value judgments, not the only valid reading of a
  one-line README bullet — if a chord doesn't sound like what you expected
  when holding a given variant, this list is where to check first and adjust.

- **Register**: chord roots are anchored to `MIDI 60 + rootPitchClass` (so
  everything lands within one octave band, C4–B4-ish), with chord tones
  stacked upward from there. This keeps voicings in a consistent, pleasant
  register without needing separate octave-tracking logic; it means the
  "root" of a chord isn't always the lowest sounding pitch (e.g. wide
  variants can invert relative to a plain ear's expectation), which is a
  reasonable trade for implementation simplicity but worth revisiting if a
  future pass wants proper voice-leading.

## Input model

- **Polyphonic chord buttons**: holding several chord buttons at once sounds
  all of them together (`currentSound()` in `input.js` merges every held
  button's notes, deduped, into one chord) rather than the earlier
  last-pressed-wins behavior. The variant/joystick control stays a stack —
  there's still only one variant control, matching the real device's single
  joystick, so it shapes whatever's held uniformly rather than needing its
  own per-chord state.
- **Variant keys glide, not retrigger**: changing the held variant while a
  chord button is held re-pitches the currently-sounding notes in place
  (`AudioEngine.updateChord`) rather than cutting and restarting them, as
  long as the note count matches. This was a deliberate choice for feel —
  it's what makes holding J and tapping across the variant grid feel like
  "shaping" one held note rather than a stutter of retriggers. When the note
  count changes (e.g. a 3-note triad to a 5-note `9` chord) there's no clean
  1:1 pitch mapping to glide, so it falls back to a quick (15ms) crossfaded
  retrigger instead.
- **`event.code`, not `event.key`**: keyboard handling is physical-position
  based, so it's independent of the OS keyboard layout/language and of
  shift/caps state. This also means the control scheme is described in terms
  of physical key position (matches the on-screen layout) rather than
  characters typed.
- **iOS Safari note**: `AudioContext` is created and resumed lazily, inside
  `AudioEngine.unlock()`, only ever called from within a user-gesture handler
  (a keydown or pointerdown). Creating it eagerly on page load would leave it
  permanently suspended on iOS/macOS Safari.

## Loop recorder

- Recording only runs while Tab (or the on-screen record button) is held.
  Releasing it immediately starts looping whatever was captured, snapped to
  the nearest beat at the fixed 120bpm the README specifies (minimum length:
  1 beat). Pressing/holding Tab again starts a *new* recording, replacing the
  old loop outright (there's no overdub/multi-layer mode here — the README
  describes one loop, not a layered looper).
- If a chord was already sounding at the moment recording starts, that
  chord's notes are captured as the loop's `t=0` state — otherwise a chord
  you were holding before you started recording would silently drop out of
  the loop.
- **Live play and loop playback are independent `AudioEngine` voices**
  (`'live'` and `'loop'`, see Audio engine below), so holding a chord while
  the loop is playing mixes the two instead of one stealing the other's
  sound — this is what makes it possible to play over top of a running loop.
- **Recording stopped mid-hold gets a synthetic release at the loop
  boundary**: if you release Tab while still holding a chord, that chord's
  `'on'` event has no matching `'off'` within the recording. Without a fix,
  every loop iteration would fire that same `'on'` again on top of the
  still-sounding note (`playChord()` re-triggers rather than releasing),
  which never actually stops — audible as one continuous note rather than a
  loop. `stopRecording()` now appends a synthetic `'off'` event at exactly
  the loop length when the last recorded event is an unmatched `'on'`, so
  playback always cleanly releases the note before repeating.
- **`clear()` and `stopPlaying()` explicitly stop the `'loop'` voice.**
  Previously they only stopped the scheduler (no more events would be
  *scheduled*), but whatever the loop had most recently triggered kept
  ringing — for a long-release voice this could sound like "Clear loop
  doesn't work." Both now call `engine.stopChord('loop')` so pressing Clear
  (or otherwise stopping playback) is heard immediately.
- Every "the sounding chord changed" moment (new chord button press, or a
  variant change while held) is recorded as a fresh note-on event, even when
  it was actually a live glide rather than a retrigger. On loop playback this
  replays as a series of quick crossfaded retriggers rather than exactly
  reproducing the original glide. This is a deliberate simplification — full
  glide-accurate loop fidelity would need a richer event format for
  marginal audible benefit at 120bpm loop granularity.
- Scheduling uses the standard Web Audio "lookahead" pattern (a ~25ms
  interval that schedules anything due in the next 100ms via the audio
  clock, not `setInterval` timing directly) so loop timing doesn't drift or
  jitter with UI thread hiccups.
- No on-screen tempo/bar-count control — 120bpm and free-length-snapped-to-
  beat is what the README specifies, so that's all that's implemented.
  Added one small affordance beyond the README: a "Clear loop" button, since
  there's no mobile-friendly equivalent otherwise for "stop looping
  entirely" once one has been recorded.

## Audio engine

- Direct Web Audio oscillators/envelopes, no synthesis library — the sound
  palette here is simple enough (a few detuned oscillators through a
  low-pass filter with an ADSR-ish envelope) that a dependency would add
  more weight than value. Four voice presets (Soft Pad / Pluck / Organ /
  Warm Pad) cycle with the up/down arrows or on-screen voice buttons; Soft
  Pad is the default, matching the README's "default voicing has a little
  bit of attack/decay."
- `playChord()` always releases whatever was previously sounding itself
  (short 15ms crossfade), rather than expecting callers to call `stopChord()`
  first. Caught during implementation: an earlier version relied on callers
  to stop notes before starting new ones, which left orphaned oscillators
  running forever if a caller (the loop player, specifically) called
  `playChord()` back-to-back without an intervening stop — audible as
  buildup/distortion over a running loop. Centralizing the release inside
  `playChord()` makes that class of bug structurally impossible rather than
  something every call site has to remember.
- **Multiple independent voices, identified by a caller-chosen id**:
  `playChord`/`updateChord`/`stopChord` all now take a `voiceId` and track
  each one's sounding notes separately (`AudioEngine.active`, a `Map`).
  `input.js` uses `'live'` for whatever's currently held; `loop.js` uses
  `'loop'` for playback. Previously there was a single shared `activeNotes`
  array, so live playing and loop playback (or, before chord buttons became
  polyphonic, any two callers) stole each other's notes rather than mixing —
  this is what makes overlaying chords and playing over a running loop work.
- **Gain staging fixed to stop clipping**: every note used to play at full
  oscillator gain regardless of how many notes were in the chord, so a wide
  voicing (the 5-note `9` variant, say) summed to several times the
  amplitude of a plain triad and clipped. `_playNote` now scales each note's
  gain by `1/sqrt(chordSize)`, master gain dropped from 0.8 to 0.5, and a
  `DynamicsCompressorNode` (fast attack, high ratio) sits between the master
  bus and the destination as a headroom safety net for whatever the
  per-chord normalization doesn't fully catch — now more necessary than
  before since independent voices (multiple held chords, live-over-loop) can
  sum together.

## Visual design

- **Layout**: the chord grid puts J/K/L/; on the bottom row and I/O/P on the
  top row (via CSS `grid-template-areas` in `chord-keyboard`, rather than
  per-button inline styles), each top button centered over the boundary of
  two bottom ones — mirroring where those keys actually sit on a physical
  keyboard. The two on-screen panels are ordered Variants (QWE/ASD/ZXC) then
  Chords (JIKOLP;) so that, in the side-by-side desktop layout, the
  left-hand-side keys are the left panel and the right-hand-side keys are
  the right panel, matching where your hands actually go.
- **Color scheme**: the HiChord manual (hichord.shop/pages/manual) documents
  its three top buttons as gray ("Key & Settings"), yellow ("Sounds &
  Effects"), and red ("Modes & Tempo") — those map onto our Key control,
  Voice control, and loop/record control (a mode) respectively, each now
  tinted accordingly. The general highlight/active color moved from the
  previous arbitrary teal to a blue, after "Cosmic Blue" (the currently-
  shipping hardware edition). Exact photos of the device's chord-button
  coloring weren't available at the time of writing, so those buttons stay a
  neutral single color (as before) rather than guessing per-button colors.

## Automated testing

- **Playwright, Chromium only**: HiChord's logic (polyphony, glide-vs-retrigger
  variant math, loop scheduling, the blur/visibility panic valve) has grown
  past what a manual smoke test alone catches reliably (`../PROCESS.md`'s
  validation approach flagged this as the trigger for adding tooling). No
  audio framework or DOM framework needed changing to add tests: Playwright
  drives the real static page in a real browser over `python3 -m http.server`
  (same server the app already uses), so the tests exercise the actual
  `input.js`/`audio.js`/`loop.js`/`theory.js` code paths rather than a mocked
  stand-in. Chromium only for now (not also WebKit/Safari) to keep CI-less
  local runs fast; cross-browser behavior stays on the manual checklist.
- **Real audio, asserted via a probe, not a mock**: tests don't stub Web
  Audio -- `tests/support/fixtures.js` wraps `OscillatorNode.start/stop` and
  `AudioParam.setTargetAtTime` in the page so real oscillator frequencies and
  glide targets get logged, then compared against frequencies computed from
  the app's own `theory.js`/`audio.js` math (`tests/support/expected-audio.js`),
  not a hand-copied table. This is what makes the glide-vs-retrigger
  distinction (see "Variant keys glide, not retrigger" above) actually
  testable: a glide shows up as `setTargetAtTime` calls with no new
  oscillators, a retrigger as stop+start pairs.
- **Real input, not synthetic events**: on-screen buttons are held with a
  real Playwright mouse pointer and physical keys with real keyboard events,
  not fabricated `PointerEvent`s -- `input.js`'s `bindPress()` calls
  `el.setPointerCapture(e.pointerId)` unguarded, which throws for a
  pointerId that was never actually pressed down. Two-button polyphony is
  tested by combining one mouse hold with one keyboard hold rather than
  inventing a second pointer.
- **Test tooling is local to `hichord/`**: `package.json`/`node_modules` live
  in this directory, not the repo root, matching the "every experiment
  directory is self-contained" rule in `../AGENTS.md` -- the app itself still
  has zero dependencies and no build step; only the test runner is a
  dependency, and only for developers who run `make test`.
- See `tests/README.md` for what's covered and how to run them.

## Not built (deliberately out of scope for this pass)

- No octave-shift control (real HiChord has one on its joystick; the
  README's spec for this experiment doesn't mention one).
- No multi-track looper layering (recording overdubs into a loop, or
  stacking more than one loop) or tempo control or MIDI I/O — live play can
  now be overlaid live and can play over a running loop (see Loop recorder
  above), but the loop itself still holds only one recorded take.
- No shared code with other instruments yet — see `../PROCESS.md`.
