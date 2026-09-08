# instruments
Experimenting with digital musical instruments

## Experiment One: HiChord

- A musical instrument that functions basically like the HiChord (https://hichord.shop/pages/manual)
- Simple on-screend display showing HiChord-like key layout, indicating which keyboard keys go with which position
  - On screen buttons light up as keys are pressed
- `JIKOLP;` produce chords in the diatonic scale while held (in that order, starting with the root)
- Arrows left/right switch keys (ordered by circle of fifths); arrows up/down switch voices
  - default voicing has a little bit of attack/decay
- 3x3 grid of letters `QWE-ASD-ZXC` provide chord variants while held (in order: augmented, Mm flip, dom7, dim, neutral, M7, 6sus2, sus4, 9)
- Hold tab to record a loop; release to continue the loop (snap to tempo, 120bpm)

**Implementation:** [`hichord/`](hichord/README.md) — run it with `make hichord` from the repo root.

## Working in this repo

See [`AGENTS.md`](AGENTS.md) for repo conventions and [`PROCESS.md`](PROCESS.md) for cross-cutting process decisions.
