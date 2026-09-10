// The voice/oscillator/effect preset schema and its normalization -- pure
// data and validation, no Web Audio node graph here (that's audio.js's
// AudioEngine's job, working from what this module produces). Kept separate
// so the two concerns -- "what shape is a voice/effect" vs. "how does that
// shape become sound" -- don't stay mixed into one file.

/**
 * Normalize an `envelope` value to a plain {attack, decay, sustain, release}
 * object (seconds for attack/decay/release, a 0-1 fraction of peak for
 * sustain) -- the same four numbers every envelope in this module already
 * used, just also accepted as a single CSS-shorthand-style string in that
 * order, e.g. "0.08 0.15 0.7 0.35" (comma-or-space separated, so
 * "0.08, 0.15, 0.7, 0.35" works too). An object argument passes through
 * unchanged, and so does an absent envelope.
 */
export function parseEnvelope(envelope) {
  if (envelope == null || typeof envelope !== 'string') return envelope;
  const [attack, decay, sustain, release] = envelope.trim().split(/[\s,]+/).map(Number);
  return { attack, decay, sustain, release };
}

// Matches "base~range", e.g. "0~2" -- see parseNumeric below.
const RANDOM_RANGE_RE = /^\s*(-?\d+(?:\.\d+)?)\s*~\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Parse a numeric field that may also be written as "base~range" (e.g.
 * `{ detune: '0~2' }`) -- shorthand for "roll a value within +/- range of
 * base, freshly per note, held steady for as long as that note keeps
 * sounding" (see AudioEngine._resolveField, which is what actually rolls
 * it -- this function only recognizes and records the request). Works on
 * any numeric field of a voice, oscillator, or effect, since every
 * normalize function below runs its numeric fields through this. A plain
 * number, or any string that isn't this shape, passes through unchanged.
 */
export function parseNumeric(value) {
  if (typeof value !== 'string') return value;
  const m = value.match(RANDOM_RANGE_RE);
  if (!m) return value;
  return { random: true, base: Number(m[1]), range: Number(m[2]) };
}

/** Whether `value` is a parsed "base~range" descriptor from parseNumeric, not a plain number. */
export function isRandomized(value) {
  return value != null && typeof value === 'object' && value.random === true;
}

// Every BiquadFilterNode type WebAudio supports, each exposed as its own
// effect (named after the filter category itself, e.g. `{ type: 'highpass' }`)
// rather than one generic `filter` effect with a `kind` sub-field -- see
// https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode/type.
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'peaking', 'lowshelf', 'highshelf'];
// Per the BiquadFilterNode spec, `Q` (this schema's `resonance`, see below)
// has no effect on a shelf filter, and `gain` only does anything for a shelf
// or peaking filter -- https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode#instance_properties
const SHELF_TYPES = ['lowshelf', 'highshelf'];
const GAIN_TYPES = ['lowshelf', 'highshelf', 'peaking'];

function filterEffectParams(type) {
  const params = ['frequency', 'keyTrack'];
  if (!SHELF_TYPES.includes(type)) params.push('resonance');
  if (GAIN_TYPES.includes(type)) params.push('gain');
  return params;
}

// Every effect type's own recognized parameters, besides `type` itself and
// (filter types only, see normalizeEffect) the `envelope` every filter
// already took for free. Adding a new effect type means adding an entry
// here (its params), one below in EFFECT_DEFAULTS (if any param should
// default rather than being required), and a matching `_create*Node` in
// AudioEngine.
//
//  - lowpass/highpass/bandpass/notch/allpass/peaking/lowshelf/highshelf: a
//    BiquadFilterNode of that type. `frequency` (Hz) is its cutoff/center;
//    `resonance` maps to WebAudio's own `Q` (named after what it actually
//    does here, since "Q" alone means nothing out of context), default
//    0.707 -- the same default WebAudio itself uses. `keyTrack` (0-1,
//    default 1.0) scales that cutoff by how far the played note sits from
//    middle C: 1.0 tracks the note's pitch exactly (play an octave up, the
//    cutoff rises an octave too), 0.0 leaves the cutoff fixed regardless of
//    note, and anything between falls off proportionally the further from
//    middle C you play -- the standard synth-filter "keyboard tracking"
//    feature, e.g. https://quadrophone.com/synthesis/using-keytracking/.
//    `gain` (dB, shelf/peaking only) maps to WebAudio's own filter `gain`.
//    An `envelope` (see normalizeEffect below) sweeps the cutoff by
//    `envAmount` (Hz, default 0 -- no envelope does anything until you dial
//    some amount in, same as a synth's own filter-envelope-amount knob)
//    above the keyTrack'd base, floored back at that base on release rather
//    than at 0Hz -- see AudioEngine._createFilterNode/_scheduleEnvelope.
//  - reverb: an algorithmic ConvolverNode reverb (no impulse-response file
//    -- exponentially-decaying white noise makes a convincingly reverb-like
//    impulse response on its own, a long-known trick, see
//    https://github.com/adelespinasse/reverbGen and
//    https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode).
//    `decay` (seconds) is the tail length, `wet` (0-1) the dry/wet mix.
//  - tremolo: rhythmic amplitude modulation -- an LFO driving a GainNode, the
//    classic Web Audio tremolo recipe. `rate` (Hz) and `depth` (0-1, how far
//    the amplitude dips).
//  - delay: a single-tap echo (DelayNode + a feedback loop back into itself).
//    `time` (seconds, up to 1), `feedback` (0-1, loop gain per repeat), `wet`
//    (0-1 mix).
//  - distortion: a WaveShaperNode driven by the same curve-generation
//    formula given in MDN's own createWaveShaper() example --
//    https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createWaveShaper.
//    `amount` (WebAudio's own `k` in that formula -- roughly 0 (clean) to
//    100+ (hard clip)), `wet` (0-1 mix).
//  - randomize: not a Web Audio processing node at all -- it patches a
//    named `property` on the effect's own enclosing voice or oscillator,
//    randomly within +/- `range` of that property's own value, freshly per
//    note (same idea as the "base~range" notation above, but as its own
//    effect entry instead of inline on the field -- useful when the field
//    itself is already busy holding a fixed base value you don't want to
//    also rewrite). See AudioEngine._resolveSpec.
const EFFECT_PARAMS = {
  ...Object.fromEntries(FILTER_TYPES.map((type) => [type, filterEffectParams(type)])),
  randomize: ['property', 'range'],
  reverb: ['decay', 'wet'],
  tremolo: ['rate', 'depth'],
  delay: ['time', 'feedback', 'wet'],
  distortion: ['amount', 'wet'],
};

// Defaults for params a preset doesn't set explicitly (besides `envelope`,
// which every filter effect already defaults to "no envelope" -- i.e. held
// at a constant value, same as everywhere else in this schema).
const EFFECT_DEFAULTS = {
  ...Object.fromEntries(
    FILTER_TYPES.map((type) => [
      type,
      {
        keyTrack: 1.0,
        ...(SHELF_TYPES.includes(type) ? {} : { resonance: 0.707 }),
        ...(GAIN_TYPES.includes(type) ? { gain: 0 } : {}),
      },
    ]),
  ),
  reverb: { decay: 2.0, wet: 0.3 },
  tremolo: { rate: 5, depth: 0.5 },
  delay: { time: 0.25, feedback: 0.3, wet: 0.3 },
  distortion: { amount: 20, wet: 1.0 },
};

const OSCILLATOR_WAVEFORMS = ['sine', 'square', 'sawtooth', 'triangle'];
const OSCILLATOR_KEYS = ['type', 'detune', 'gain', 'octave', 'pan', 'envelope', 'effects'];
const VOICE_KEYS = ['name', 'envelope', 'effects', 'oscillators', 'pan'];

// Warn (not throw) about any key on `obj` that isn't in `known` -- see the
// normalize functions below for why: a typo'd or not-yet-implemented field
// on a hand-edited voice should cost you that one field, not the whole
// note. `label` identifies `obj` in the message (e.g. `voice "Organ"`).
function warnUnknownKeys(label, obj, known) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      console.warn(`HiChord: ${label} has an unknown "${key}" -- ignoring it, the note will still play without it.`);
    }
  }
}

function normalizeEffect(effect, context) {
  const label = `${context}'s effect`;
  const knownParams = EFFECT_PARAMS[effect.type];
  if (!knownParams) {
    console.warn(`HiChord: ${label} has an unknown type "${effect.type}" -- ignoring it, the note will still play without it.`);
    return null;
  }
  // Only a filter's cutoff has ever had an envelope shape it over time (a
  // sweep, by `envAmount`) -- the other effect types below have no single
  // "the" param an envelope would obviously shape, so `envelope`/`envAmount`
  // aren't recognized keys for them (setting one warns, same as any other
  // unknown field).
  const supportsEnvelope = FILTER_TYPES.includes(effect.type);
  const envelopeKeys = supportsEnvelope ? ['envelope', 'envAmount'] : [];
  warnUnknownKeys(`${label} (a "${effect.type}")`, effect, ['type', ...knownParams, ...envelopeKeys]);

  const defaults = EFFECT_DEFAULTS[effect.type] || {};
  const out = { type: effect.type };
  for (const key of knownParams) {
    // `property` (randomize's own target-field name) is a string, not a
    // numeric field -- everything else here is.
    out[key] = key === 'property' ? effect[key] : parseNumeric(effect[key] ?? defaults[key]);
  }
  if (supportsEnvelope) {
    out.envelope = parseEnvelope(effect.envelope);
    out.envAmount = parseNumeric(effect.envAmount ?? 0);
  }
  return out;
}

function normalizeOscillator(osc, context) {
  warnUnknownKeys(context, osc, OSCILLATOR_KEYS);
  let type = osc.type;
  if (!OSCILLATOR_WAVEFORMS.includes(type)) {
    console.warn(`HiChord: ${context} has an unknown waveform "${type}" -- falling back to "sine".`);
    type = 'sine';
  }
  return {
    type,
    detune: parseNumeric(osc.detune),
    gain: parseNumeric(osc.gain),
    octave: parseNumeric(osc.octave),
    pan: parseNumeric(osc.pan ?? 0),
    envelope: parseEnvelope(osc.envelope),
    effects: (osc.effects || []).map((e) => normalizeEffect(e, context)).filter(Boolean),
  };
}

/** Exported for tests -- see the module comment above VOICES for what this does and why. */
export function normalizeVoice(voice) {
  const context = `voice "${voice.name}"`;
  warnUnknownKeys(context, voice, VOICE_KEYS);
  return {
    name: voice.name,
    envelope: parseEnvelope(voice.envelope),
    pan: parseNumeric(voice.pan ?? 0),
    effects: (voice.effects || []).map((e) => normalizeEffect(e, context)).filter(Boolean),
    oscillators: voice.oscillators.map((osc, i) => normalizeOscillator(osc, `${context}'s oscillator ${i + 1}`)),
  };
}

/**
 * Voice presets. Each voice is a small mixing/processing tree, built fresh
 * per note in AudioEngine._playNote:
 *
 *   oscillator -> [its own effects] -> [its own envelope] --\
 *   oscillator -> [its own effects] -> [its own envelope] ----> [voice's own effects] -> [voice's own envelope] -> master
 *   oscillator -> [its own effects] -> [its own envelope] --/
 *
 * `envelope` (required at voice level, optional everywhere else) is the
 * ADSR this module has always used -- attack/decay/release in seconds,
 * sustain as a 0-1 fraction of peak -- written either as that object or as
 * the "attack decay sustain release" shorthand string parseEnvelope above
 * accepts. `pan` (-1 left .. 0 center .. 1 right, default 0) is available on
 * a voice and on each oscillator, mapping straight to WebAudio's own
 * StereoPannerNode. `effects` is an ordered list of processing stages -- see
 * the EFFECT_PARAMS comment above for what each effect type does.
 *
 * Any numeric field anywhere in this shape (an oscillator's `detune`, an
 * effect's `frequency`, ...) can be written as a plain number, or as a
 * "base~range" string (e.g. `'0~2'`) to have AudioEngine roll it randomly
 * within +/- range of base, freshly for each note and held steady for as
 * long as that note sounds -- see parseNumeric above and
 * AudioEngine._resolveField.
 *
 * Every level's envelope (the voice, an individual oscillator, an
 * individual effect) is its own independent automation on its own
 * AudioParam, wired in series -- so nesting them needs no special
 * compositing logic of its own: WebAudio already multiplies gain stages (and
 * chains filters) in series the same way any signal chain does. A voice
 * with its own decay and an oscillator on it with its *own* decay just have
 * two ramps happening in series, and the two compound exactly because
 * they're multiplying. A level with no `envelope` of its own just holds its
 * param at a constant value (`gain` for an oscillator, `frequency` for a
 * filter) and lets whatever contains it do all the time-shaping -- exactly
 * today's behavior for every voice below, none of which use oscillator- or
 * effect-level envelopes yet.
 *
 * An unrecognized oscillator waveform, effect type, or extra key anywhere
 * in this shape (a typo, or a param this module doesn't implement yet) is
 * `console.warn`ed and then dropped/defaulted rather than thrown -- see the
 * normalize functions above -- so a mistake while hand-editing a voice
 * costs that one field, not the whole note.
 */
export const VOICES = [
  {
    name: 'Soft Pad',
    envelope: '0.08 0.15 0.7 0.35',
    // keyTrack explicitly 0 on every preset below: keyTrack defaults to 1.0
    // (full tracking, see EFFECT_PARAMS above), but these four filter
    // cutoffs were all originally tuned as plain fixed values -- pin them
    // to the old fixed-cutoff behavior rather than changing these presets'
    // sound now that tracking exists.
    effects: [{ type: 'lowpass', frequency: 2600, keyTrack: 0 }],
    oscillators: [
      { type: 'triangle', detune: 0, gain: 1.0, octave: 0 },
      { type: 'sine', detune: 0, gain: 0.35, octave: 1 },
    ],
  },
  {
    // A snappy filter-envelope pluck: the lowpass slams open on attack
    // (envAmount) and falls back to its keyTrack'd resting cutoff well
    // before the note's own (much longer) amplitude decay finishes, a
    // peaking bump adds some low-mid body, and a highpass trims the mud
    // underneath it.
    name: 'Pluck',
    envelope: '0.003 0.85 0.0 0.35',
    effects: [
      { type: 'lowpass', frequency: 1400, resonance: 1.1, keyTrack: 0.7, envelope: '0.002 0.18 0.0 0.2', envAmount: 3200 },
      { type: 'peaking', frequency: 200, resonance: 1.2, gain: 4 },
      { type: 'highpass', frequency: 80 },
    ],
    oscillators: [
      { type: 'sawtooth', detune: 0, gain: 0.75, octave: 0 },
      { type: 'triangle', detune: -2, gain: 0.45, octave: 0 },
      { type: 'sine', detune: 0, gain: 0.35, octave: 1, envelope: '0.002 0.12 0.0 0.1' },
    ],
  },
  {
    name: 'Organ',
    envelope: '0.012 0.04 1.0 0.12',
    effects: [
      { type: 'lowpass', frequency: 4200, keyTrack: 0 },
    ],
    oscillators: [
      // 16' — weight
      { type: 'triangle', detune: 0,   gain: 0.55, octave: -1 },
      // 8' — the note you actually hear
      { type: 'square',   detune: 0,   gain: 0.32, octave: 0 },
      { type: 'sine',     detune: 0,   gain: 0.45, octave: 0 },
      // 4' — presence
      { type: 'sine',     detune: 0,   gain: 0.30, octave: 1 },
      // 2⅔' nasard — the fifth, quiet
      { type: 'sine',     detune: 702, gain: 0.10, octave: 1 },
      // 2' — air and sparkle
      { type: 'sine',     detune: 0,   gain: 0.13, octave: 2, envelope: '0.03 0.06 0.9 0.10' },
    ],
  },
  {
    name: 'Warm Pad',
    envelope: '0.7 1.2 0.75 2.2',
    effects: [{ type: 'lowpass', frequency: 1300, keyTrack: 0 }],
    oscillators: [
      { type: 'sawtooth', detune: -11, gain: 0.45, octave: 0 },
      { type: 'sawtooth', detune: 7, gain: 0.45, octave: 0 },
      { type: 'triangle', detune: -3, gain: 0.55, octave: -1 },
      { type: 'sine', detune: 0, gain: 0.30, octave: -2 },
    ],
  },
  {
    // Demonstrates several of the newer schema features together: a
    // gently humanized detune per oscillator (the "base~range" notation),
    // hard-panned oscillators spread wide, a keyTrack'd highpass that
    // brightens as you play higher, and a touch of reverb + tremolo.
    name: 'Airy Pad',
    envelope: '0.9 0.6 0.8 1.8',
    effects: [
      { type: 'highpass', frequency: 220, resonance: 0.5 },
      { type: 'reverb', decay: 2.5, wet: 0.35 },
      { type: 'tremolo', rate: 4, depth: 0.15 },
    ],
    oscillators: [
      { type: 'sawtooth', detune: '-8~3', gain: 0.4, octave: 0, pan: -0.6 },
      { type: 'sawtooth', detune: '8~3', gain: 0.4, octave: 0, pan: 0.6 },
      { type: 'triangle', detune: 0, gain: 0.5, octave: -1, pan: 0 },
    ],
  },
].map(normalizeVoice);

// Default voice a fresh AudioEngine starts on -- Warm Pad, per the
// top-level README's "a little bit of attack/decay" spec (Warm Pad's own
// attack/decay is the most pronounced of the four original voices). Looked
// up by name rather than a bare index literal so this stays correct if
// VOICES is ever reordered; exported so tests/support/expected-audio.js's
// own default tracks it too instead of hardcoding a second copy.
export const DEFAULT_VOICE_INDEX = VOICES.findIndex((v) => v.name === 'Warm Pad');
