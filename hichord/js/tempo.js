// Shared tempo state: bpm (quarter notes per minute) and the quantize grid
// resolution (expressed as "1/division" of a whole note, e.g. division=32
// for a 32nd note). Both LoopRecorder (loop-length rounding, note
// quantizing -- see loop.js) and Metronome (click timing -- see
// metronome.js) read from this one source of truth, so changing tempo from
// the UI immediately applies to whichever of them is running. Kept
// dependency-free and pure, like theory.js, so it's easy to unit-test.

// Outside this range a "beat" stops being a useful unit, either for playing
// along or for the loop-length snap (see loop.js) to mean anything.
const MIN_BPM = 40;
const MAX_BPM = 240;
// Quantize resolution is bounded to whole-note..128th-note, past which
// either end stops being a useful grid.
const MIN_DIVISION = 1; // whole note
const MAX_DIVISION = 128; // 128th note

export class Tempo {
  constructor(bpm = 120, quantizeDivision = 64) {
    this.bpm = bpm;
    this.quantizeDivision = quantizeDivision;
  }

  /** Length, in seconds, of one beat (quarter note) at the current bpm. */
  get beatSeconds() {
    return 60 / this.bpm;
  }

  /** Length, in seconds, of one quantize grid step at the current bpm/division. */
  get quantizeSeconds() {
    return (this.beatSeconds * 4) / this.quantizeDivision;
  }

  // Doesn't retroactively rescale an already-recorded loop -- its events and
  // length (see loop.js) are baked in seconds, not beats, so this only
  // affects the click's tempo and future recordings' beat-snapping/quantizing.
  setBpm(bpm) {
    this.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
    return this.bpm;
  }

  // Doubles/halves rather than an arbitrary step: "twice as fine" is the
  // musically meaningful move (matches how note durations themselves
  // relate), and keeps the on-screen control to two buttons.
  /** Halves the quantize grid step (32nd note -> 64th note, finer/more precise). */
  doubleQuantize() {
    this.quantizeDivision = Math.min(MAX_DIVISION, this.quantizeDivision * 2);
    return this.quantizeDivision;
  }

  /** Doubles the quantize grid step (32nd note -> 16th note, coarser/less precise). */
  halveQuantize() {
    this.quantizeDivision = Math.max(MIN_DIVISION, this.quantizeDivision / 2);
    return this.quantizeDivision;
  }

  /** Snap a raw seconds-offset to the nearest quantize grid line. */
  quantize(t) {
    const step = this.quantizeSeconds;
    return Math.round(t / step) * step;
  }
}
