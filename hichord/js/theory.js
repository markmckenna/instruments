// Music theory for HiChord: key/scale/chord-shape math -- degrees, triad
// qualities, and variant shapes, keyed by abstract ids. No keycodes (see
// input.js for the physical-key <-> id mappings), no MIDI/frequency math
// (see audio.js for turning a shape from here into actual pitches), no DOM.
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
// triad quality that degree naturally has in a major key. Index into this
// array (0-6) is the shared "degree index" used throughout the app; input.js
// maps its 7 chord-button keycodes onto these indices in order.
export const DEGREES = [
  { roman: 'I', interval: 0, quality: 'maj' },
  { roman: 'ii', interval: 2, quality: 'min' },
  { roman: 'iii', interval: 4, quality: 'min' },
  { roman: 'IV', interval: 5, quality: 'maj' },
  { roman: 'V', interval: 7, quality: 'maj' },
  { roman: 'vi', interval: 9, quality: 'min' },
  { roman: 'vii°', interval: 11, quality: 'dim' },
];

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function pcName(pc) {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

// Chord-symbol suffix for each of a diatonic triad's three possible
// qualities -- the single source of truth for how a plain (no variant, or
// the neutral variant) triad is labeled, and the base every other variant's
// `suffix` below builds on.
export const QUALITY_SUFFIX = { maj: '', min: 'm', dim: '°' };

// The chord-variant shapes (README: "QWE-ASD-ZXC provide chord variants
// while held, in order: augmented, Mm flip, dom7, dim, neutral, M7, 6sus2,
// sus4, 9" -- that physical grid layout, and which key maps to which id
// here, lives in input.js). Each variant is a function of the base degree's
// diatonic quality -> semitone offsets from the chord root, so e.g. "m7"
// adds a major 7th over a major triad but a minor 7th over a minor one.
// `suffix` is the matching chord-symbol suffix for display (see
// variantChordName) -- kept alongside `offsets` rather than derived from it,
// since a couple of variants (sixSus2, m7) change *shape* by quality in a
// way a generic interval-to-symbol mapping would have to special-case
// anyway. `mood` is a fixed, evocative one-word name for the grid position
// itself (how it feels to reach for, not what it technically does) -- shown
// on the button alongside the key letter and whatever `suffix` currently
// reads.
export const VARIANTS = {
  aug: { label: 'aug', mood: 'Dreamy', offsets: () => [0, 4, 8], suffix: () => 'aug' },
  mmFlip: {
    label: 'Mm flip',
    mood: 'Inverted',
    offsets: (q) => (q === 'maj' ? [0, 3, 7] : [0, 4, 7]),
    suffix: (q) => (q === 'maj' ? 'm' : ''), // flips to the *other* triad quality
  },
  dom7: { label: 'dom7', mood: 'Bluesy', offsets: () => [0, 4, 7, 10], suffix: () => '7' },
  dim: { label: 'dim', mood: 'Dark', offsets: () => [0, 3, 6], suffix: () => '°' },
  neutral: {
    label: 'neutral',
    mood: 'Base',
    offsets: (q) => (q === 'maj' ? [0, 4, 7] : q === 'min' ? [0, 3, 7] : [0, 3, 6]),
    suffix: (q) => QUALITY_SUFFIX[q], // unmodified -- same suffix the plain triad already uses
  },
  m7: {
    label: 'M7',
    mood: 'Jazzy',
    offsets: (q) => (q === 'maj' ? [0, 4, 7, 11] : q === 'min' ? [0, 3, 7, 10] : [0, 3, 6, 10]),
    suffix: (q) => (q === 'maj' ? 'maj7' : q === 'min' ? 'm7' : 'm7♭5'),
  },
  sixSus2: {
    label: '6sus2',
    mood: 'Sweet',
    // Major degrees (I, IV, V) get a 6th chord (add6, 3rd kept); minor and
    // diminished degrees (ii, iii, vi, vii°) get a sus2 (3rd replaced by the
    // 2nd) instead -- two different, quality-picked shapes under one id, not
    // one shape covering both at once as the original "6sus2" name (and the
    // real HiChord's paired "6th/Sus2" joystick direction) implied.
    offsets: (q) => (q === 'maj' ? [0, 4, 7, 9] : [0, 2, 7]),
    suffix: (q) => (q === 'maj' ? '6' : 'sus2'),
  },
  sus4: { label: 'sus4', mood: 'Open', offsets: () => [0, 5, 7], suffix: () => 'sus4' },
  ninth: { label: '9', mood: 'Lush', offsets: () => [0, 4, 7, 10, 14], suffix: () => '9' },
};

// The "nothing held" / fallback variant -- the plain diatonic triad,
// unmodified. Used as the default whenever no variant key is actually held.
export const NEUTRAL_VARIANT = 'neutral';

export function chordRootName(keyPc, degreeIndex) {
  const degree = DEGREES[degreeIndex];
  return pcName(keyPc + degree.interval);
}

/**
 * Full chord-symbol name (root + quality/variant suffix) for a chord button
 * + variant -- e.g. "Cmaj7", "Am7♭5", "F6". Passing NEUTRAL_VARIANT (or any
 * unrecognized id) gives the plain diatonic triad name, so this one function
 * covers both "what's this button labeled right now" (variant held or not)
 * and "what would this variant do to the currently-held chord" (see ui.js).
 */
export function variantChordName(keyPc, degreeIndex, variantId) {
  const degree = DEGREES[degreeIndex];
  const variant = VARIANTS[variantId] || VARIANTS[NEUTRAL_VARIANT];
  return chordRootName(keyPc, degreeIndex) + variant.suffix(degree.quality);
}
