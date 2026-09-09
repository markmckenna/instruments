// Computes the frequencies HiChord's audio engine *should* produce for a
// given chord, using the app's own pure theory/audio math (no DOM, no Web
// Audio -- both modules are safe to import directly under Node) rather than
// a hand-copied table. If theory.js's chord/variant math ever changes, these
// expectations move with it automatically.
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

/** MIDI notes for one held chord button + variant. */
export function chordMidiNotes(keyPc, degreeIndex, variantCode) {
  return buildChord(keyPc, degreeIndex, variantCode);
}

/** MIDI notes for several chord buttons held at once, deduped (see input.js's currentSound()). */
export function mergedMidiNotes(keyPc, degreeIndices, variantCode) {
  const notes = new Set();
  degreeIndices.forEach((d) => buildChord(keyPc, d, variantCode).forEach((n) => notes.add(n)));
  return Array.from(notes);
}

/** Expected oscillator frequencies for one held chord button + variant. */
export function expectedChordFrequencies(keyPc, degreeIndex, variantCode, voiceIndex = 0) {
  return expandToOscillatorFrequencies(chordMidiNotes(keyPc, degreeIndex, variantCode), voiceIndex);
}

/** Expected oscillator frequencies for several chord buttons held at once. */
export function expectedMergedFrequencies(keyPc, degreeIndices, variantCode, voiceIndex = 0) {
  return expandToOscillatorFrequencies(mergedMidiNotes(keyPc, degreeIndices, variantCode), voiceIndex);
}

/**
 * Expected start/stop oscillator events for a transition between two held
 * MIDI note sets on the same voice, mirroring AudioEngine.playChord()'s
 * exact-pitch diff: a pitch present both before and after keeps sounding
 * untouched -- no start, no stop -- only pitches that dropped out stop, and
 * only pitches that are newly wanted start.
 */
export function expectedTransition(beforeNotes, afterNotes, voiceIndex = 0) {
  const before = new Set(beforeNotes);
  const after = new Set(afterNotes);
  return {
    started: expandToOscillatorFrequencies(afterNotes.filter((n) => !before.has(n)), voiceIndex),
    stopped: expandToOscillatorFrequencies(beforeNotes.filter((n) => !after.has(n)), voiceIndex),
  };
}
