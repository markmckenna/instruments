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
    (m7♭5, `[0,3,6,10]`) over the diminished vii° button. Depends on the
    base chord's quality rather than overriding it, matching the real
    device's "maj7/min7" joystick direction.
  - `6sus2` (Z): also quality-dependent, and in a stronger sense than M7 —
    it's two genuinely different shapes, not one shape with a note that
    changes. Major degrees (I, IV, V) get a 6th chord, `[0,4,7,9]` (3rd
    kept, 6th added); minor and diminished degrees (ii, iii, vi, vii°) get a
    sus2, `[0,2,7]` (3rd replaced by the 2nd, no 6th) instead. An earlier
    version forced one merged `[0,2,7,9]` shape (sus2 *and* add6 at once)
    regardless of quality, mirroring the real joystick's paired "6th/Sus2"
    direction literally — musically wrong for half the buttons, since a
    6th chord doesn't suit a minor triad the way a 6/9-ish major voicing
    does, and vice versa for sus2 over a major triad.
  - `sus4` (X): `[0,5,7]` — suspended triad, no 3rd. Not quality-dependent
    (unlike 6sus2) — a suspended 4th reads the same regardless of what
    3rd it's replacing, so there's no analogous "wrong over half the
    buttons" problem to fix here.
  - `9` (C): `[0,4,7,10,14]` — dominant 9th (root, 3, 5, ♭7, 9).

  These are documented value judgments, not the only valid reading of a
  one-line README bullet — if a chord doesn't sound like what you expected
  when holding a given variant, this list is where to check first and adjust.

- **Register**: chord roots are anchored to `MIDI 60 + keyPitchClass +
  degreeInterval` -- no octave-wrapping. `DEGREES`' intervals (I=0 through
  vii°=11) are already strictly increasing, so this guarantees the tonic (I)
  is always the lowest-rooted chord for the current key and each further
  degree in the JIKOLP; sequence sits higher than the last, in whichever key
  is selected. An earlier version reduced the root to a single octave band
  (`MIDI 60 + rootPitchClass % 12`) for simplicity, but that let a degree's
  root wrap *below* the tonic (e.g. key G's IV, at interval 5, wrapped down
  to C4 instead of sitting above G4) -- audibly wrong for a control surface
  whose whole point is a left-to-right ascending run of chords.

## Input model

- **Polyphonic chord buttons**: holding several chord buttons at once sounds
  all of them together (`currentSound()` in `input.js` merges every held
  button's notes, deduped, into one chord) rather than the earlier
  last-pressed-wins behavior. The variant/joystick control stays a stack —
  there's still only one variant control, matching the real device's single
  joystick, so it shapes whatever's held uniformly rather than needing its
  own per-chord state.
- **Every note voiced independently, by exact pitch**: whatever should be
  sounding on a voice (a new chord button added to what's already held, a
  variant change, a key change) is compared against what's already sounding
  by exact MIDI pitch (`AudioEngine.playChord`, see Audio engine below). A
  pitch that's wanted both before and after is left completely untouched —
  no retrigger, no re-envelope — so adding I to an already-held J only
  attacks I's new notes on top, and dropping back to J only releases the
  notes I added, never cutting J's own notes. This replaced an earlier
  index-based "glide" (`AudioEngine.updateChord`, since removed) that bent a
  held chord's oscillators to a new pitch in place when the note count
  matched, and fully stopped/restarted every note otherwise — which is what
  caused a chord to audibly cut and re-attack just because a second chord
  button was added alongside it.
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

- Recording only runs while Space (or the on-screen record button) is held.
  Releasing it immediately starts looping whatever was captured, snapped to
  the nearest beat at the shared Tempo's bpm (minimum length: 1 beat) — see
  "Loop length snaps to the nearest beat" below for why nearest rather than
  always rounding up. Pressing/holding Space again starts a *new* recording,
  replacing the old loop outright (there's no overdub/multi-layer mode here
  — the README describes one loop, not a layered looper) — and, if a loop
  was playing, immediately silences it (`stopChord('loop')`) rather than
  leaving its last-triggered note stuck ringing once the scheduler that
  would otherwise have released it stops. This is also what makes a quick
  tap of Space (no chord held in between) behave as "cancel and clear" the
  previous loop: nothing gets recorded, so `stopRecording()` lands back on
  `idle`, and the old loop's sound has already been cut.
  **Space, not Tab**: an earlier version used Tab, which conflicts with
  browser/OS focus-cycling accessibility features (e.g. macOS's Full
  Keyboard Access) that can intercept Tab before the page ever sees the
  keydown at all — silently breaking recording, not just stealing focus.
  Space doesn't carry that meaning anywhere on this page.
- If a chord was already sounding at the moment recording starts, that
  chord's notes are captured as the loop's `t=0` state — otherwise a chord
  you were holding before you started recording would silently drop out of
  the loop.
- **Live play and loop playback are independent `AudioEngine` voices**
  (`'live'` and `'loop'`, see Audio engine below), so holding a chord while
  the loop is playing mixes the two instead of one stealing the other's
  sound — this is what makes it possible to play over top of a running loop.
- **Recording stopped mid-hold gets a synthetic release at the loop
  boundary**: if you release Space while still holding a chord, that chord's
  `'on'` event has no matching `'off'` within the recording. Without a fix,
  every loop iteration would fire that same `'on'` again while its notes are
  already sounding from the previous iteration (`playChord()` leaves
  already-sounding notes alone, see Audio engine below), so they'd never
  actually get released — audible as one continuous note rather than a loop.
  `stopRecording()` now appends a synthetic `'off'` event at exactly the loop
  length when the last recorded event is an unmatched `'on'`, so playback
  always cleanly releases the note before repeating.
- **Loop length snaps to the nearest beat, not always up, and may clip the
  tail**: an earlier version always rounded the recorded length *up* to the
  next whole beat, which tacks on up to almost a full beat of dead air at the
  loop's tail every time (any overshoot past a beat boundary, even a few ms,
  jumps the loop length up by a whole extra beat) — and because that overshoot
  *is* the loop's own length, it compounds on every repeat, which is what made
  playback feel like it drifted further behind an external tempo the longer
  it played, not just "off by a fixed amount". (A first attempt at fixing this
  only rounded up in a more roundabout way — computing `Math.round` and then
  falling back to a bump-up whenever it rounded down — which is mathematically
  identical to plain `Math.ceil` in every case, so it silently fixed nothing.)
  `stopRecording()` now uses a plain `Math.round`, genuinely allowing the loop
  to come out *shorter* than what was played: any event whose timestamp would
  land past the new (possibly shorter) length gets clamped to it, clipping at
  most a quarter beat off whatever was still sounding. That's a much smaller
  problem than the dead air rounding up used to add — a note that far into
  its release/sustain has long since settled, so a slightly early cutoff is
  inaudible, unlike silence.
- **`clear()` and `stopPlaying()` explicitly stop the `'loop'` voice.**
  Previously they only stopped the scheduler (no more events would be
  *scheduled*), but whatever the loop had most recently triggered kept
  ringing — for a long-release voice this could sound like "Clear loop
  doesn't work." Both now call `engine.stopChord('loop')` so pressing Clear
  (or otherwise stopping playback) is heard immediately.
- Every "the sounding chord changed" moment (new chord button press, or a
  variant change while held) is recorded as a fresh note-on event with the
  full note set sounding at that instant, not a delta. On loop playback each
  event goes through the same `playChord()` reconciliation live play does, so
  a pitch shared between one event and the next keeps sounding across them
  rather than retriggering — playback reproduces the same per-note
  independence live play has, not an approximation of it.
- **Scheduling uses the standard Web Audio "lookahead" pattern**: a ~25ms
  `setInterval` looks up to 100ms ahead and, for anything due in that window,
  calls `AudioEngine.playChord`/`stopChord` with an explicit future `when` —
  Web Audio's own sample-accurate clock is what actually triggers the note
  (`osc.start(when)`, gain ramps scheduled from `when`), not the JS timer.
  An earlier version scheduled the *call* itself with `setTimeout(fn,
  delayMs)` and let it stamp "now" as the note's start time once the timeout
  fired — `setTimeout`'s fire time is only as precise as the JS event loop,
  which routinely lands tens of milliseconds late under any contention, and
  that lateness landed directly on every note's actual timing, audible as
  loop playback that lagged behind an external tempo. Live play (`input.js`)
  never passes `when`, so it's unaffected — a live keypress should always
  sound immediately, not scheduled ahead.
- No on-screen bar-count control — loop length is still whatever you
  actually played, free-length-snapped-to-beat, not a fixed number of bars;
  the README only specifies bpm and beat-snapping, not a bar-count mode.
  bpm itself *is* now user-adjustable (see "Tempo, click track, and
  quantize" below) — that started as a fixed 120 the README specifies as a
  default, and became a control once tuning it turned out to matter for
  getting loop timing to actually feel right. Added one small affordance
  beyond the README: a "Clear loop" button, since there's no mobile-friendly
  equivalent otherwise for "stop looping entirely" once one has been
  recorded.

## Audio engine

- Direct Web Audio oscillators/envelopes, no synthesis library — the sound
  palette here is simple enough (a few detuned oscillators through a
  low-pass filter with an ADSR-ish envelope) that a dependency would add
  more weight than value. Four voice presets (Soft Pad / Pluck / Organ /
  Warm Pad) cycle with the up/down arrows or on-screen voice buttons; Soft
  Pad is the default, matching the README's "default voicing has a little
  bit of attack/decay."
- `playChord()` always reconciles against whatever was previously sounding
  itself (diffing by exact pitch, see "Every note voiced independently"
  above) rather than expecting callers to call `stopChord()` first. Caught
  during implementation: an earlier version relied on callers to stop notes
  before starting new ones, which left orphaned oscillators running forever
  if a caller (the loop player, specifically) called `playChord()`
  back-to-back without an intervening stop — audible as buildup/distortion
  over a running loop. Centralizing the reconciliation inside `playChord()`
  makes that class of bug structurally impossible rather than something
  every call site has to remember.
- **Multiple independent voices, identified by a caller-chosen id**:
  `playChord`/`stopChord` all take a `voiceId` and track each one's sounding
  notes separately (`AudioEngine.active`, a `Map`). `input.js` uses `'live'`
  for whatever's currently held; `loop.js` uses `'loop'` for playback.
  Previously there was a single shared `activeNotes` array, so live playing
  and loop playback (or, before chord buttons became polyphonic, any two
  callers) stole each other's notes rather than mixing — this is what makes
  overlaying chords and playing over a running loop work.
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
- **Release reads the envelope analytically, not `AudioParam.value`**:
  `_releaseNote` needs to know the gain a note is *at* when it starts
  releasing, so it can ramp down from there instead of jumping. It used to
  read `gain.gain.value`, which only reflects the value *right now* (real
  wall-clock time) — but a release can be scheduled for a future point on
  the audio clock (loop playback schedules ahead, see "Scheduling uses the
  standard Web Audio 'lookahead' pattern" below), and if a note's own
  attack/decay hadn't finished yet by the time the release was scheduled,
  `.value` would be a stale, too-low reading that then got locked in right
  as the real curve was still climbing — an audible snap-down, which could
  look like "the note already decayed to silence" on whichever loop
  playouts happened to have a short enough hold for this to bite (longer
  holds have already settled into sustain by release time, so weren't
  affected — matching a bug report of "on some, not all, playouts"). Every
  note now carries its own attack/decay timing and target levels
  (`attackStart`/`attackEnd`/`decayEnd`/`level`/`sustainLevel`, set in
  `_playNote`), and `_releaseNote` evaluates that curve at the exact release
  time (`_envelopeValueAt`) instead of asking the AudioParam what it thinks
  "now" is.
- **The metronome click is not a voice**: `AudioEngine.playClick()` is a
  separate, minimal code path rather than routed through `VOICES`/
  `playChord` — a click is a short unpitched percussive blip, not a musical
  note, so none of the chord-voicing machinery (attack/decay/sustain
  shaping, chordSize-based level, multi-oscillator detuning) applies or is
  worth reusing here.
- **The click is a bandpassed noise burst around 10-12kHz, not a low tone**:
  an earlier version used a single ~90Hz oscillator ("a low click," per the
  original ask), which turned out to be nearly inaudible on typical
  speakers — bass that low is exactly what small/laptop speakers reproduce
  worst, and a pure low tone has no transient edge to read as a "click" in
  the first place. A short (`CLICK_DURATION`, 20ms) burst of white noise
  through a bandpass filter centered at 11kHz sits where a percussive click
  actually needs to be to cut through and be perceived as one. The noise
  buffer itself is generated once (in `unlock()`) and reused for every
  click, rather than regenerated per beat, so every click sounds identical
  rather than subtly re-textured each time.

## Tempo, click track, and quantize

- **`Tempo` (`js/tempo.js`) is the single shared source of truth for bpm and
  quantize resolution** — both `LoopRecorder` (loop-length rounding, note
  quantizing) and `Metronome` (click timing) hold a reference to the same
  instance, so a bpm change from the UI applies to whichever of them is
  running immediately, with nothing to keep in sync manually. Kept
  dependency-free and pure, like `theory.js`, since it's just arithmetic —
  no DOM or Web Audio needed to reason about it or test it.
- **bpm is now a UI control, not a fixed constant**: it started as a fixed
  120 (the README's default), but tuning it turned out to matter for making
  loop timing actually feel locked to how you play — see the loop-length
  rounding fix above. Range clamped to 40–240 (outside that band a "beat"
  stops being a useful unit either for playing along or for the loop-length
  snap to mean anything). Changing bpm doesn't retroactively rescale an
  *already-recorded* loop's timing (its events and length are baked in
  seconds, not beats) — it only affects the click's tempo and future
  recordings' beat-snapping/quantizing.
- **Quantize snaps recorded note timing to a grid, live play is never
  touched**: `LoopRecorder.recordEvent()` snaps each event's timestamp to
  the nearest `Tempo.quantizeSeconds` step before it's stored, by
  construction — quantization only ever happens to what gets *recorded*, so
  it fixes loop timing without changing how live play actually sounds or
  feels as you play it. Default 1/32 (a 32nd note): fine enough to tidy up
  ordinary sloppy timing without visibly moving a deliberately-placed note.
  The up/down control doubles/halves the grid resolution (1/32 → 1/64 finer,
  1/32 → 1/16 coarser) rather than offering an arbitrary number, since
  "twice as fine" is the musically meaningful step (matches how note
  durations themselves relate) and keeps the control to two buttons.
  Bounded to 1 (whole note) through 1/128, past which either end stops being
  a useful grid.
- **Same-instant events after quantizing are *not* coalesced — tried once,
  reverted**: playing faster than the quantize grid resolves (or a coarse
  grid, e.g. 1/4) can quantize two different real moments onto the exact
  same timestamp. A version of `recordEvent()` used to replace the previous
  event outright when this happened, on the theory that a same-instant
  attack-then-release is inaudible anyway (`AudioEngine._envelopeValueAt`
  evaluates to exactly 0 right at a note's own `attackStart`, so the
  cancelled attack was never incorrectly silent, just silent). That's true,
  but collapsing through an *intermediate* `'off'` this way could erase an
  entire chord that really was played — `on(A)`, `off`, `on(B)` all landing
  on one instant coalesced down to just `on(B)`, silently dropping A,
  worse at coarser grids where collisions are common (reported as "loop
  record at 1/4 doesn't work at all"). Reverted: every event is kept, and a
  same-instant attack+release pair is left as the harmless silent no-op it
  already was, which is a far smaller cost than ever losing a note outright.
- **Loop playback phase-locks to a running click**: `_startScheduler()`
  anchors the loop's first iteration to `Metronome.nearestBeatTime()` when
  the click is enabled, instead of to the exact real moment the record key
  happened to be released. `loopLength` is always a whole number of beats
  (see above), so once *one* anchor point lands on the click's beat grid,
  every later iteration (an integer number of beats further on) stays on it
  automatically. Without this, the loop's phase relative to the click was
  essentially random — its own internal timing could be perfectly
  quantized and the click perfectly steady, and the loop would still drift
  further out of sync with the click the longer a recording ran before
  being stopped, since nothing tied the two together (reported as "the
  recording ends up being out of sync... depends on when I release the
  record button" — exactly right). Only the loop conforms to the click,
  not the other way around: the click still runs free (see below) whether
  or not anything is being recorded or looped, which is what makes it
  useful as a tempo reference *before* you've recorded anything to lock to.
- **The click is a free-running practice metronome, independent of loop
  record/playback state**: `Metronome` starts counting beats from whenever
  it's turned on and keeps clicking regardless of whether you're recording,
  looping, or doing neither — the point is to give you a tempo reference
  *before* and *while* you play, not only to mark time during playback.
- Same "look a little ahead on a short interval, then let the real audio
  clock trigger it" lookahead pattern as the loop scheduler (see Loop
  recorder above) — kept as its own small scheduler in `metronome.js` rather
  than factored out into one shared with `loop.js`'s, since replaying a
  recorded event list with wraparound and free-running "fire the next beat"
  are different enough shapes that sharing one abstraction would obscure
  more than the ~10 lines of duplication it would save.

## Visual design

- **Layout**: the chord grid puts J/K/L/; on the bottom row and I/O/P on the
  top row (via CSS `grid-template-areas` in `chord-keyboard`, rather than
  per-button inline styles), on a 12-column grid (the LCM of 3 and 4) so
  each row's buttons divide the full row width evenly — 4 columns apiece for
  I/O/P, 3 apiece for J/K/L/; — rather than an earlier version that gave
  I/O/P the same column positions as K/L/; and left the space above J empty.
  The two on-screen panels are ordered Variants (QWE/ASD/ZXC) then
  Chords (JIKOLP;) so that, in the side-by-side desktop layout, the
  left-hand-side keys are the left panel and the right-hand-side keys are
  the right panel, matching where your hands actually go.
- **Color scheme**: the HiChord manual (hichord.shop/pages/manual) documents
  its three top buttons as gray ("Key & Settings"), yellow ("Sounds &
  Effects"), and red ("Modes & Tempo") — those map onto our Key control,
  Voice control, and loop/record control (a mode) respectively, each now
  tinted accordingly. The Tempo and Quantize controls are tinted the same
  red as loop/record, rather than getting their own color, since they're
  the same "Modes & Tempo" concept on the real device, not a fourth
  independent one. The general highlight/active color moved from the
  previous arbitrary teal to a blue, after "Cosmic Blue" (the currently-
  shipping hardware edition). Exact photos of the device's chord-button
  coloring weren't available at the time of writing, so those buttons stay a
  neutral single color (as before) rather than guessing per-button colors.

## Dynamic labeling and the now-playing panel

- **Both grids relabel to show real chord names, not just static
  descriptions**: while exactly one chord button is held, the variant grid
  shows what each variant would actually do to it (e.g. holding J shows the
  M7 button as "Cmaj7", not just "M7"); while a variant is held, the chord
  grid shows what each chord button would actually produce with it (e.g.
  holding D relabels every chord button to "…m7"/"…maj7"/"…m7♭5" as
  appropriate). Both fall back to their static labels — `VARIANTS[code].label`
  for variants, the plain diatonic triad name for chords — the moment
  there's no single unambiguous chord/variant to compute against (nothing
  held, or two-or-more chord buttons held at once: which one's quality
  would even apply?). One function, `theory.js`'s `variantChordName(keyPc,
  degreeIndex, variantCode)`, computes both directions and also the default
  (unheld) chord name (`variantCode: 'KeyS'` reduces to the plain triad) —
  `ui.js` doesn't special-case "nothing held" separately from "a variant is
  held", it always calls the same function with whichever variant code is
  actually in effect.
- **`suffix` lives beside `offsets` in `VARIANTS`, not derived from it**: a
  generic "these intervals map to this chord symbol" function would need to
  special-case 6sus2 and M7 anyway (their *shape*, not just their name,
  depends on quality), so there's no real generality to gain by deriving the
  suffix from the interval list instead of just stating it directly.
- **Each variant button shows three things, in order: key letter, mood,
  then the current reading**: `key-letter` (Q/W/E/...), `variant-mood`
  (Dreamy/Inverted/Bluesy/Dark/Base/Jazzy/Sweet/Open/Lush, in grid order —
  fixed, evocative one-word names for the grid position itself, provided
  directly rather than derived), then `variant-name` (the dynamic-or-static
  reading described above). `mood` lives in `VARIANTS` alongside `label`/
  `offsets`/`suffix` — one more fact about a grid position, not a separate
  table to keep in sync. Unlike `variant-name`, it never changes with held
  state: it names the *position*, not what it's currently doing.
- **The now-playing panel is a diagnostic, not a decorative flourish**: it
  shows the exact MIDI notes currently sounding on the `'live'` voice, named
  in scientific pitch notation (`theory.js`'s `midiName`, e.g. "C4") — a way
  to check what's *actually* playing against what you expect to hear,
  independent of trusting a chord button's label. Placed in the Variants
  panel below its 3x3 grid, which is otherwise dead space in the
  side-by-side desktop layout (that panel is shorter than the Chords panel
  next to it). Scoped to the live voice only, not the loop's playback too —
  the diagnostic use case is checking what you're playing right now, and
  showing two voices' notes interleaved in one line would need a way to
  tell them apart that isn't obviously worth the complexity yet.

## Automated testing

- **Playwright, Chromium only**: HiChord's logic (polyphony, per-note
  independence across variant/key/chord-button changes, loop scheduling, the
  blur/visibility panic valve) has grown
  past what a manual smoke test alone catches reliably (`../PROCESS.md`'s
  validation approach flagged this as the trigger for adding tooling). No
  audio framework or DOM framework needed changing to add tests: Playwright
  drives the real static page in a real browser over `python3 -m http.server`
  (same server the app already uses), so the tests exercise the actual
  `input.js`/`audio.js`/`loop.js`/`theory.js` code paths rather than a mocked
  stand-in. Chromium only for now (not also WebKit/Safari) to keep CI-less
  local runs fast; cross-browser behavior stays on the manual checklist.
- **Real audio, asserted via a probe, not a mock**: tests don't stub Web
  Audio -- `tests/support/fixtures.js` wraps `OscillatorNode.start/stop` in
  the page so real oscillator start/stop frequencies get logged, then
  compared against frequencies computed from the app's own
  `theory.js`/`audio.js` math (`tests/support/expected-audio.js`), not a
  hand-copied table. This is what makes the per-note independence (see
  "Every note voiced independently" above) actually testable: a pitch that
  persists across a chord change shows up as no start/stop pair at all, only
  the genuinely new or dropped pitches do.
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
  dependency, and only for developers who run `make check`.
- See `tests/README.md` for what's covered and how to run them.

## Not built (deliberately out of scope for this pass)

- No octave-shift control (real HiChord has one on its joystick; the
  README's spec for this experiment doesn't mention one).
- No multi-track looper layering (recording overdubs into a loop, or
  stacking more than one loop) or MIDI I/O — live play can now be overlaid
  live and can play over a running loop (see Loop recorder above), but the
  loop itself still holds only one recorded take.
- No shared code with other instruments yet — see `../PROCESS.md`.
