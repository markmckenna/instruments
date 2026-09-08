# HiChord

A browser-based chord instrument, loosely modeled on the [HiChord](https://hichord.shop/pages/manual)
hardware — see the [repo root README](../README.md#experiment-one-hichord) for
the original one-paragraph spec, and [`DECISIONS.md`](./DECISIONS.md) for the
music-theory and implementation choices made while building it.

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

## Controls

**Chords** — hold a key to sound its chord (root position triad in the
current key), release to stop. Multiple chord buttons can be held at once —
they overlay into one combined chord rather than the most recent one
stealing the sound:

| Key | `J` | `I` | `K` | `O` | `L` | `P` | `;` |
|---|---|---|---|---|---|---|---|
| Degree | I | ii | iii | IV | V | vi | vii° |

**Variants** — hold a grid key *at the same time as* a chord key to reshape
the held chord; release the variant key to go back to the plain chord:

|     | Q: aug | W: Mm flip | E: dom7 |
|---|---|---|---|
|     | A: dim | S: neutral | D: M7 |
|     | Z: 6sus2 | X: sus4 | C: 9 |

**Key** — `←` / `→` (or the on-screen arrows) step through all 12 keys in
circle-of-fifths order.

**Voice** — `↑` / `↓` (or the on-screen arrows) cycle through 4 sounds: Soft
Pad (default), Pluck, Organ, Warm Pad.

**Loop** — hold `Tab` (or the on-screen record button) while you play;
release it and the loop plays back on repeat, snapped to the nearest beat at
120bpm. Hold `Tab` again to record a new loop (replaces the old one). "Clear
loop" stops playback and drops it. You can keep playing chords live while
the loop plays back — the two mix rather than one cutting the other off.

On a touchscreen (no physical keyboard), every control above has an on-screen
equivalent — chord buttons, the 3x3 variant grid, key/voice arrows, and the
record button all respond to touch/tap-and-hold the same way keys do.

## Automated tests

`make check` runs the Playwright integration test suite (real browser, real
Web Audio) covering chords, variants, key/voice switching, and the loop
recorder. See [`tests/README.md`](tests/README.md) for what's covered and
[`DECISIONS.md`](./DECISIONS.md#automated-testing) for why. These don't
replace the manual smoke test below -- they don't cover cross-browser
behavior or touch-specific quirks.

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
7. Hold `Tab`, play a couple of chords, release — loop should start playing
   back on its own, in time, repeating cleanly with no glitch at the seam.
   While it's playing, hold a chord button — you should hear your chord
   mixed on top of the loop, not the loop cutting out.
8. Tap "Clear loop" — playback (and whatever it was last sounding) should
   stop immediately.
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
  (you can play live over the loop, but that play isn't added into it), no
  tempo control (fixed at 120bpm per the original spec).
- No persistence — reloading the page resets key/voice/loop.
