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

- **Monophonic chord slot**: only one chord sounds at a time, even if you
  manage to hold two chord buttons at once (last-pressed wins, but releasing
  it falls back to any other chord button still physically held — tracked as
  a stack, not a single value, specifically to handle that fallback cleanly).
  This matches a one-handed chord-instrument mental model and keeps the audio
  engine simple. Revisit if a future iteration wants to layer/hold multiple
  chords (e.g. a two-handed mode).
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

## Not built (deliberately out of scope for this pass)

- No octave-shift control (real HiChord has one on its joystick; the
  README's spec for this experiment doesn't mention one).
- No multi-track looper layering, no tempo control, no MIDI I/O.
- No shared code with other instruments yet — see `../PROCESS.md`.
