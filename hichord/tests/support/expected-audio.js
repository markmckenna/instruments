// Computes the frequencies HiChord's audio engine *should* produce for a
// given chord, using the app's own pure theory/audio math (no DOM, no Web
// Audio -- both modules are safe to import directly under Node) rather than
// a hand-copied table. If DECISIONS.md's chord/variant math ever changes,
// these expectations move with it automatically.
import { buildChord } from '../../js/theory.js';
import { VOICES } from '../../js/audio.js';

// Node's V8 and the Chromium build Playwright drives compute Math.pow a few
// ULPs apart, so comparing raw floats against what the browser's probe
// records (tests/support/fixtures.js) flakes on the last couple of decimal
// digits. Rounding to hundredths of a Hz is still far tighter than anything
// audible and collapses that noise; fixtures.js's probe rounds to the same
// precision on the way in, so the two sides compare exactly.
const PRECISION = 100;
function round(freq) {
  return Math.round(freq * PRECISION) / PRECISION;
}

// Mirrors AudioEngine._freqFor().
function freqFor(midi, octaveOffset = 0) {
  return round(440 * Math.pow(2, (midi - 69) / 12) * Math.pow(2, octaveOffset || 0));
}

// Mirrors AudioEngine._playNote(): one oscillator per (note, voice oscillator spec).
function expandToOscillatorFrequencies(midiNotes, voiceIndex) {
  const voice = VOICES[voiceIndex];
  const freqs = [];
  for (const midi of midiNotes) {
    for (const osc of voice.oscillators) freqs.push(freqFor(midi, osc.octave));
  }
  return freqs.sort((a, b) => a - b);
}

/** Expected oscillator frequencies for one held chord button + variant. */
export function expectedChordFrequencies(keyPc, degreeIndex, variantCode, voiceIndex = 0) {
  return expandToOscillatorFrequencies(buildChord(keyPc, degreeIndex, variantCode), voiceIndex);
}

/** Expected oscillator frequencies for several chord buttons held at once (see input.js's currentSound()). */
export function expectedMergedFrequencies(keyPc, degreeIndices, variantCode, voiceIndex = 0) {
  const notes = new Set();
  degreeIndices.forEach((d) => buildChord(keyPc, d, variantCode).forEach((n) => notes.add(n)));
  return expandToOscillatorFrequencies(Array.from(notes), voiceIndex);
}
