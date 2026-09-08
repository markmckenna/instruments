// Shared tempo state: bpm (quarter notes per minute) and the quantize grid
// resolution (expressed as "1/division" of a whole note, e.g. division=32
// for a 32nd note). Both LoopRecorder (loop-length rounding, note
// quantizing -- see loop.js) and Metronome (click timing -- see
// metronome.js) read from this one source of truth, so changing tempo from
// the UI immediately applies to whichever of them is running. Kept
// dependency-free and pure, like theory.js, so it's easy to unit-test.

const MIN_BPM = 40;
const MAX_BPM = 240;
const MIN_DIVISION = 1; // whole note
const MAX_DIVISION = 128; // 128th note

export class Tempo {
  constructor(bpm = 120, quantizeDivision = 32) {
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

  setBpm(bpm) {
    this.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
    return this.bpm;
  }

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
