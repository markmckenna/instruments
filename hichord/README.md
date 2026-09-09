# HiChord

A browser-based chord instrument, loosely modeled on the [HiChord](https://hichord.shop/pages/manual)
hardware — see the [repo root README](../README.md#experiment-one-hichord) for
the original one-paragraph spec. That spec is the source of truth for
behavior; where it leaves a detail unspecified, this instrument follows the
real HiChord's hardware behavior as a tie-breaker (it's what the experiment
is explicitly modeled on) rather than guessing. Implementation/design
rationale lives as comments next to the code they explain, not in a separate
document.

No build step, no dependencies. It's a static page (`index.html` + a few ES
modules) that runs entirely client-side with the Web Audio API.

## Run it

From the repo root:

```sh
make hichord
```

Or standalone:

```sh
cd hichord
make run
```

Both start a local server on `http://localhost:4173` and open it in your
default browser. `Ctrl+C` stops the server. If port 4173 is already in use,
override it: `make run PORT=5050`.

No local server handy and just want to peek at the layout? Opening
`index.html` directly (`file://`) works for looking around, but browsers
restrict some APIs on `file://` — use `make run` for the real thing.

No build step means no cache-busting either: after editing any `js/*.js`
file, do a hard reload (Cmd/Ctrl+Shift+R) rather than a plain refresh. A
plain refresh can serve a stale cached copy of some modules but not others
if the browser doesn't revalidate every one of them, which looks like
random, inconsistent behavior (a control's on-screen effect works but its
display doesn't update, say) rather than an obvious "old version" — it's
tempting to read that as a new bug when it's actually just a stale module.

## Controls

**Chords** — hold a key to sound its chord (root position triad in the
current key), release to stop. Multiple chord buttons can be held at once —
they overlay into one combined chord rather than the most recent one
stealing the sound:

| Key | `J` | `I` | `K` | `O` | `L` | `P` | `;` |
|---|---|---|---|---|---|---|---|
| Degree | I | ii | iii | IV | V | vi | vii° |

**Variants** — hold a grid key *at the same time as* a chord key to reshape
the held chord; release the variant key to go back to the plain chord.
Three of these depend on the base chord's quality rather than overriding it:
Mm flip swaps major⟷minor third (keeping the 5th); M7 gives a major 7th over
a major chord, a minor 7th over a minor chord, and a half-diminished (m7♭5)
over the diminished vii° chord; 6sus2 gives a 6th chord over a major degree
(I, IV, V) but a sus2 over a minor or diminished one (ii, iii, vi, vii°). The
rest (aug, dom7, dim, sus4, 9) always give the same shape regardless of the
base chord's quality — if a variant doesn't sound like what you expected,
this is the first thing to check.

|     | Q: Dreamy — aug | W: Inverted — Mm flip | E: Bluesy — dom7 |
|---|---|---|---|
|     | A: Dark — dim | S: Base — neutral | D: Jazzy — M7 |
|     | Z: Sweet — 6sus2 | X: Open — sus4 | C: Lush — 9 |

Each variant button shows three things: its key letter, a fixed one-word
"mood" naming the grid position itself (Dreamy/Inverted/Bluesy/Dark/Base/
Jazzy/Sweet/Open/Lush, always the same regardless of what's held), and
underneath that, what it currently reads — normally its plain description
(the table above), but while exactly one chord button is held, the actual
chord each variant would produce instead (e.g. holding `J` shows the M7
button as "Cmaj7"). Hold a variant instead and the chord grid relabels the
same way in reverse, showing what each chord button would produce with it.
Both revert to their plain/static reading the moment that's ambiguous (no
chord held, or two-or-more chord buttons held at once).

**Now playing** — below the variant grid, the exact notes currently
sounding (e.g. "C4 E4 G4"), live off the same signal that drives the chord
buttons' sound — a quick way to check what's actually playing if something
doesn't sound quite right.

**Key** — `←` / `→` (or the on-screen arrows) step through all 12 keys in
circle-of-fifths order.

**Voice** — `↑` / `↓` (or the on-screen arrows) cycle through 4 sounds: Soft
Pad (default), Pluck, Organ, Warm Pad.

**Tempo** — the on-screen ↓/↑ arrows tune the bpm (default 120, range
40–240); the ♩ button toggles a metronome click, one per beat, that plays
continuously at the current bpm regardless of recording/looping.

**Quantize** — the on-screen ↓/↑ arrows halve/double the quantize grid a
recorded note's timing snaps to (default 1/32 note). This only ever affects
what gets *recorded* into a loop — live play always sounds exactly when you
press, never snapped.

**Loop** — hold `Space` (or the on-screen record button) while you play;
release it and the loop plays back on repeat, snapped to the nearest beat at
the current bpm. Hold `Space` again to record a new loop (replaces the old
one). "Clear loop" stops playback and drops it. You can keep playing chords
live while the loop plays back — the two mix rather than one cutting the
other off.

On a touchscreen (no physical keyboard), every control above has an on-screen
equivalent — chord buttons, the 3x3 variant grid, key/voice/tempo/quantize
arrows, the click toggle, and the record button all respond to touch/tap-and-
hold the same way keys do.

## Automated tests

`make check` runs the Playwright integration test suite (real browser, real
Web Audio) covering chords, variants, key/voice switching, and the loop
recorder. See [`tests/README.md`](tests/README.md) for what's covered and
why. These don't replace the manual smoke test below -- they don't cover
cross-browser behavior or touch-specific quirks.

## Manual smoke test

Run through this after any change, in each target browser (see below):

1. Load the page — layout should fit without horizontal scrolling, no
   console errors.
2. Hold a chord button (mouse, then touch if available) — you should hear a
   triad start with a short attack, and the button should light up.
3. While still holding it, hold a variant button — the sound should shift
   (not click/pop or double-trigger) to the modified chord: notes shared
   with the plain triad keep sounding without interruption, only the
   note(s) the variant actually changes should fade out/in; release the
   variant and the same thing should happen in reverse, back to the plain
   triad, while the chord button is still held.
4. Release the chord button — sound should fade out (not cut abruptly).
5. Change key with `←`/`→` (and the on-screen arrows) — the 7 chord-button
   labels should update to the new key's chord names.
6. Change voice with `↑`/`↓` — holding a chord button should now sound
   noticeably different (e.g. Organ vs. Pluck).
7. Hold `Space`, play a couple of chords, release — loop should start
   playing back on its own, in time, repeating cleanly with no glitch at the
   seam. While it's playing, hold a chord button — you should hear your
   chord mixed on top of the loop, not the loop cutting out.
8. Tap "Clear loop" — playback (and whatever it was last sounding) should
   stop immediately. Separately, with a loop playing, tap `Space` itself
   (down and up with nothing held) — that should also cancel and clear the
   loop immediately, not leave its last note ringing.
9. Hold two chord buttons at once — you should hear both chords together,
   not just the most recently pressed one, and the first one's notes should
   keep sounding uninterrupted (no cut/re-attack) as the second layers in;
   releasing the second should drop only its own notes and leave the first
   untouched.
10. Switch away from the tab/app mid-hold (e.g. Cmd+Tab) and back — no note
   should be left stuck on, and no recording left stuck in progress.
11. On mobile: rapid taps across chord/variant buttons shouldn't select
    text, trigger a callout menu, zoom the page, or leave a "stuck" (still
    lit, still sounding) button behind.
12. Toggle the ♩ click on — you should clearly hear a crisp, even click on
    every beat (not a low thud, easy to miss), continuing whether or not
    you're recording/looping. Change the BPM while it's clicking — the
    click should retime to match, and the BPM display should update too.
13. Record a loop holding a chord for a couple of beats, release cleanly —
    on repeated playouts the note should hold and release the same way
    every time (no playout randomly cutting to silence early).
14. Change the quantize control down a couple of notches (coarser, e.g.
    1/8) and record a loop pressing slightly off the beat on purpose — the
    loop should audibly snap closer to the beat than you actually played it.
15. Hold `J` — the variant grid should relabel to real chord names (e.g. D
    shows "Cmaj7"); release it and the grid should go back to "aug"/"M7"/etc.
    Hold `D` alone (no chord) — the chord grid should relabel to "…m7" names;
    release it and the grid goes back to plain triad names. The "now
    playing" notes below the variant grid should update to match whatever's
    actually sounding as you do this.

## Browser support

Built for and checked against current desktop Chrome and Safari (macOS) and
mobile Chrome and Safari (iOS). It uses only standard Web Audio API and
Pointer Events, so other evergreen browsers should work but haven't been
explicitly checked.

iOS/macOS Safari note: audio only starts after your first tap/keypress on an
instrument control — this is a Safari requirement (it won't let a page play
audio before a user gesture), not a bug.

## Known limitations

- Loop recorder captures one loop at a time; no overdub/multi-track layering
  (you can play live over the loop, but that play isn't added into it).
- No persistence — reloading the page resets key/voice/loop/tempo/quantize.
- No octave-shift control (the real HiChord has one on its joystick; this
  experiment's spec doesn't call for one).
- No MIDI I/O.
- No on-screen bar-count control — loop length is whatever you actually
  played, snapped to the nearest beat, not a fixed number of bars.
