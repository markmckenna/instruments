// Music theory for HiChord: key/scale/chord math, no audio or DOM here.
// Kept dependency-free and pure so it's easy to unit-test or reuse later.

// The 12 keys, ordered by circle of fifths (as the README specifies for the
// left/right key-switch control), each with its pitch class (C = 0).
export const CIRCLE_OF_FIFTHS = [
  { name: 'C', pc: 0 },
  { name: 'G', pc: 7 },
  { name: 'D', pc: 2 },
  { name: 'A', pc: 9 },
  { name: 'E', pc: 4 },
  { name: 'B', pc: 11 },
  { name: 'F♯', pc: 6 },
  { name: 'D♭', pc: 1 },
  { name: 'A♭', pc: 8 },
  { name: 'E♭', pc: 3 },
  { name: 'B♭', pc: 10 },
  { name: 'F', pc: 5 },
];

// Diatonic major-scale degrees: semitone interval from the key root, and the
// triad quality that degree naturally has in a major key.
export const DEGREES = [
  { roman: 'I', interval: 0, quality: 'maj' },
  { roman: 'ii', interval: 2, quality: 'min' },
  { roman: 'iii', interval: 4, quality: 'min' },
  { roman: 'IV', interval: 5, quality: 'maj' },
  { roman: 'V', interval: 7, quality: 'maj' },
  { roman: 'vi', interval: 9, quality: 'min' },
  { roman: 'vii°', interval: 11, quality: 'dim' },
];

// The 7 chord buttons, in the physical left-to-right order given in the
// top-level README ("JIKOLP; produce chords ... in that order, starting with
// the root"), mapped by index onto DEGREES above.
export const CHORD_KEYS = [
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyI', label: 'I' },
  { code: 'KeyK', label: 'K' },
  { code: 'KeyO', label: 'O' },
  { code: 'KeyL', label: 'L' },
  { code: 'KeyP', label: 'P' },
  { code: 'Semicolon', label: ';' },
];

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function pcName(pc) {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

// The 3x3 chord-variant grid (README: "QWE-ASD-ZXC provide chord variants
// while held, in order: augmented, Mm flip, dom7, dim, neutral, M7, 6sus2,
// sus4, 9"). Each variant is a function of the base degree's diatonic
// quality -> semitone offsets from the chord root, so e.g. "M7" adds a
// major 7th over a major triad but a minor 7th over a minor one.
export const VARIANTS = {
  KeyQ: { label: 'aug', offsets: () => [0, 4, 8] },
  KeyW: { label: 'Mm flip', offsets: (q) => (q === 'maj' ? [0, 3, 7] : [0, 4, 7]) },
  KeyE: { label: 'dom7', offsets: () => [0, 4, 7, 10] },
  KeyA: { label: 'dim', offsets: () => [0, 3, 6] },
  KeyS: { label: 'neutral', offsets: (q) => (q === 'maj' ? [0, 4, 7] : q === 'min' ? [0, 3, 7] : [0, 3, 6]) },
  KeyD: { label: 'M7', offsets: (q) => (q === 'maj' ? [0, 4, 7, 11] : q === 'min' ? [0, 3, 7, 10] : [0, 3, 6, 10]) },
  KeyZ: { label: '6sus2', offsets: () => [0, 2, 7, 9] },
  KeyX: { label: 'sus4', offsets: () => [0, 5, 7] },
  KeyC: { label: '9', offsets: () => [0, 4, 7, 10, 14] },
};

// Row-major layout of the grid above, for building the on-screen 3x3 UI.
export const VARIANT_GRID = [
  ['KeyQ', 'KeyW', 'KeyE'],
  ['KeyA', 'KeyS', 'KeyD'],
  ['KeyZ', 'KeyX', 'KeyC'],
];

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Build the sounding chord for a held chord button + held variant.
 * @param {number} keyPc pitch class of the current key's root (0-11)
 * @param {number} degreeIndex index into DEGREES/CHORD_KEYS (0-6)
 * @param {string} variantCode a key in VARIANTS (defaults to the neutral/center one)
 * @param {number} baseMidi MIDI note the key root is anchored near
 * @returns {number[]} MIDI note numbers, root first
 */
export function buildChord(keyPc, degreeIndex, variantCode, baseMidi = 60) {
  const degree = DEGREES[degreeIndex];
  const variant = VARIANTS[variantCode] || VARIANTS.KeyS;
  const offsets = variant.offsets(degree.quality);
  // No modulo here (unlike chordRootName's pitch-class-only naming below):
  // DEGREES' intervals are 0-11 and already strictly increasing with degree
  // index, so anchoring the root at baseMidi + keyPc + interval (rather than
  // wrapping back into a single octave band) guarantees the tonic (interval
  // 0) is always the lowest-rooted chord for the current key, and each
  // further degree in the JIKOLP; sequence sits higher than the last.
  const rootMidi = baseMidi + keyPc + degree.interval;
  return offsets.map((o) => rootMidi + o);
}

export function chordRootName(keyPc, degreeIndex) {
  const degree = DEGREES[degreeIndex];
  return pcName(keyPc + degree.interval);
}
