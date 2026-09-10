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

// Alternate (flat) spelling, for keyDisplayName below only -- every other
// pitch-class name in this app (chord buttons included) stays on the single
// NOTE_NAMES/pcName spelling; there's no real ambiguity once it's just
// labeling one specific chord, only when it's naming the key itself.
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]); // white keys -- no sharp/flat spelling to disambiguate

/**
 * Display name for the current *key* (the top-level Key control), not a
 * chord button: a natural pitch class (no black-key ambiguity) is just its
 * plain name, same as pcName; an accidental one shows both spellings (e.g.
 * "F♯/G♭") since neither reads as more "correct" out of context.
 */
export function keyDisplayName(pc) {
  const normalized = ((pc % 12) + 12) % 12;
  return NATURAL_PCS.has(normalized) ? NOTE_NAMES[normalized] : `${NOTE_NAMES[normalized]}/${FLAT_NAMES[normalized]}`;
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

/**
 * Rotate a chord's semitone offsets (ascending, root-first, as VARIANTS'
 * `offsets` produce) into a given inversion: the bottom `inversionIndex`
 * notes move up an octave, in that order. `inversionIndex` isn't expected
 * to already be in range -- it's wrapped here, mod the *current* offsets
 * length -- so a raw, ever-incrementing counter (input.js cycles one this
 * way per chord button, see its "/" handling) always lands on a valid
 * voicing of whatever chord shape is currently in play, even right after a
 * variant change altered its note count. That's what keeps an inversion
 * from jumping oddly the moment a modifier changes the chord under it: the
 * rotation is expressed structurally (how many of the current notes to
 * lift), never as a fixed absolute voicing baked in before the modifier.
 */
export function invertOffsets(offsets, inversionIndex) {
  const n = offsets.length;
  const k = ((inversionIndex % n) + n) % n;
  return offsets.slice(k).concat(offsets.slice(0, k).map((o) => o + 12));
}

/** Chord-symbol suffix for an inversion, e.g. "/1i" for the 1st inversion; '' for root position. */
export function inversionSuffix(inversionIndex, noteCount) {
  const k = ((inversionIndex % noteCount) + noteCount) % noteCount;
  return k > 0 ? `/${k}i` : '';
}

/** Chord-symbol suffix for an octave shift, e.g. "+1", "-2"; '' when unshifted. */
export function octaveSuffix(octaveShift) {
  if (!octaveShift) return '';
  return octaveShift > 0 ? `+${octaveShift}` : `${octaveShift}`;
}

/**
 * Full chord-button display name including inversion/octave state, e.g.
 * "Am/1i+1" -- variantChordName's root+quality/variant suffix, then
 * inversion, then octave, matching the order the README describes them in.
 */
export function chordDisplayName(keyPc, degreeIndex, variantId, { inversionIndex = 0, octaveShift = 0 } = {}) {
  const degree = DEGREES[degreeIndex];
  const variant = VARIANTS[variantId] || VARIANTS[NEUTRAL_VARIANT];
  const noteCount = variant.offsets(degree.quality).length;
  return (
    variantChordName(keyPc, degreeIndex, variantId) +
    inversionSuffix(inversionIndex, noteCount) +
    octaveSuffix(octaveShift)
  );
}
