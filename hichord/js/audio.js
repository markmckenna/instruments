// Web Audio sound engine. Polyphonic across independent "voices" (a caller-
// chosen id): input.js plays whatever's currently held on voice id 'live'
// and loop.js plays loop events back on voice id 'loop', so the two can
// sound at once instead of clobbering each other. Multiple chord buttons
// held together are combined into one 'live' voice before reaching here
// (see input.js's currentSound()) rather than each getting their own id,
// since there's still just one variant/joystick control shaping "whatever's
// currently held" as a single sound.

// Direct Web Audio oscillators/envelopes, no synthesis library -- the sound
// palette here (a few detuned oscillators run through per-voice/oscillator
// effects chains, each stage optionally shaped by its own ADSR envelope) is
// simple enough that a dependency would add more weight than value. Soft Pad
// is the default (a little attack/decay, per the top-level README's spec).
// See VOICES below for the actual voice/oscillator/effect schema.

// MIDI is this module's concern, not theory.js's: theory.js's DEGREES/
// VARIANTS describe chord *shape* in the abstract (scale degrees, semitone
// offsets from a root); turning that into actual MIDI note numbers and
// pitch names is audio-side math, alongside _freqFor below.
import { DEGREES, VARIANTS, NEUTRAL_VARIANT, invertOffsets, pcName } from './theory.js';

/** Scientific pitch notation for a MIDI note number, e.g. 60 -> "C4". */
export function midiName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return pcName(midi) + octave;
}

/**
 * Build the sounding chord for a held chord button + held variant, as MIDI
 * note numbers -- the bridge from theory.js's abstract chord-degree/variant
 * shapes to concrete pitches this engine can play.
 * @param {number} keyPc pitch class of the current key's root (0-11)
 * @param {number} degreeIndex index into theory.js's DEGREES (0-6)
 * @param {string} variantId an id in theory.js's VARIANTS (defaults to the neutral/center one)
 * @param {object} [options]
 * @param {number} [options.baseMidi] MIDI note the key root is anchored near (default 60)
 * @param {number} [options.octaveShift] whole octaves to transpose this chord's root by -- global register + this key's own offset, see input.js
 * @param {number} [options.inversionIndex] which inversion to voice, see theory.js's invertOffsets
 * @param {'chord'|'arpeggio'|'lead'} [options.mode] playback mode (see input.js): 'arpeggio' shapes the note *set* the same as 'chord' -- sequencing it one at a time is input.js's Arpeggiator's job, not this function's; 'lead' drops the chord to just its root. The bass note is a separate toggle, not a mode -- see buildBassNote below.
 * @returns {number[]} MIDI note numbers, root first
 */
export function buildChord(keyPc, degreeIndex, variantId, options = {}) {
  const { baseMidi = 60, octaveShift = 0, inversionIndex = 0, mode = 'chord' } = options;
  const degree = DEGREES[degreeIndex];
  // No modulo here (unlike chordRootName's pitch-class-only naming in
  // theory.js): DEGREES' intervals are 0-11 and already strictly increasing
  // with degree index, so anchoring the root at baseMidi + keyPc + interval
  // (rather than wrapping back into a single octave band) guarantees the
  // tonic (interval 0) is always the lowest-rooted chord for the current
  // key, and each further degree in the JIKOLP; sequence sits higher than
  // the last. octaveShift then just transposes that anchored root further.
  const rootMidi = baseMidi + keyPc + degree.interval + octaveShift * 12;

  if (mode === 'lead') return [rootMidi]; // root only -- variant/inversion don't apply to a single note

  const variant = VARIANTS[variantId] || VARIANTS[NEUTRAL_VARIANT];
  const offsets = invertOffsets(variant.offsets(degree.quality), inversionIndex);
  const notes = offsets.map((o) => rootMidi + o);

  // Every chord doubles its own root an octave up by default, added last
  // (after inversion, like the bass note below) so it's a fixed top note
  // rather than something an inversion could rotate away. Skipped if the
  // shape already lands a note there itself (e.g. a triad's own 1st
  // inversion already puts its root at +12) to avoid sounding it twice.
  const octaveUpRoot = rootMidi + 12;
  if (!notes.includes(octaveUpRoot)) notes.push(octaveUpRoot);

  return notes;
}

/**
 * The low bass note for a chord button (its own root, always anchored in
 * scientific-pitch octave 2 -- see midiName -- regardless of that key's own
 * octave shift or the global register: the bass toggle (see input.js) is
 * meant to give a steady, predictable low end, not one that follows
 * register shifts made for the chord above it). Independent of `mode`,
 * variant, and inversion, same as `buildChord`'s own root always is.
 */
export function buildBassNote(keyPc, degreeIndex) {
  const degree = DEGREES[degreeIndex];
  const pc = (keyPc + degree.interval) % 12;
  return 36 + pc; // 36 = C2
}

/**
 * Normalize an `envelope` value to a plain {attack, decay, sustain, release}
 * object (seconds for attack/decay/release, a 0-1 fraction of peak for
 * sustain) -- the same four numbers every envelope in this module already
 * used, just also accepted as a single CSS-shorthand-style string in that
 * order, e.g. "0.08 0.15 0.7 0.35" (comma-or-space separated, so
 * "0.08, 0.15, 0.7, 0.35" works too). An object argument passes through
 * unchanged, and so does an absent envelope (see VOICES below).
 */
export function parseEnvelope(envelope) {
  if (envelope == null || typeof envelope !== 'string') return envelope;
  const [attack, decay, sustain, release] = envelope.trim().split(/[\s,]+/).map(Number);
  return { attack, decay, sustain, release };
}

function normalizeEffect(effect) {
  return { ...effect, envelope: parseEnvelope(effect.envelope) };
}

function normalizeOscillator(osc) {
  return { ...osc, envelope: parseEnvelope(osc.envelope), effects: (osc.effects || []).map(normalizeEffect) };
}

function normalizeVoice(voice) {
  return {
    ...voice,
    envelope: parseEnvelope(voice.envelope),
    effects: (voice.effects || []).map(normalizeEffect),
    oscillators: voice.oscillators.map(normalizeOscillator),
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
 * accepts. `effects` is an ordered list of processing stages; the only type
 * so far is `filter` (a lowpass biquad filter, `frequency` in Hz), and it
 * too takes an optional `envelope` -- there it shapes the filter's cutoff
 * over time instead of a gain (0 Hz at the very start of an attack, same as
 * gain envelopes start from silence).
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
 */
export const VOICES = [
  {
    name: 'Soft Pad',
    envelope: '0.08 0.15 0.7 0.35',
    effects: [{ type: 'filter', frequency: 2600 }],
    oscillators: [
      { type: 'triangle', detune: 0, gain: 1.0, octave: 0 },
      { type: 'sine', detune: 0, gain: 0.35, octave: 1 },
    ],
  },
  {
    name: 'Pluck',
    envelope: '0.004 0.22 0.25 0.18',
    effects: [{ type: 'filter', frequency: 3200 }],
    oscillators: [
      { type: 'sawtooth', detune: -4, gain: 0.9, octave: 0 },
      { type: 'sawtooth', detune: 4, gain: 0.9, octave: 0 },
    ],
  },
  {
    name: 'Organ',
    envelope: '0.012 0.04 1.0 0.12',
    effects: [
      { type: 'filter', frequency: 4200 },
      { type: 'highpass', frequency: 65 },
    ],
    oscillators: [
      { type: 'triangle', detune: 0, gain: 0.55, octave: -1 },
      { type: 'square', detune: 0, gain: 0.32, octave: 0 },
      { type: 'sine', detune: 0, gain: 0.45, octave: 0 },
    ],
  },
  {
    name: 'Warm Pad',
    envelope: '0.7 1.2 0.75 2.2',
    effects: [{ type: 'filter', frequency: 1300 }],
    oscillators: [
      { type: 'sawtooth', detune: -11, gain: 0.45, octave: 0 },
      { type: 'sawtooth', detune: 7, gain: 0.45, octave: 0 },
      { type: 'triangle', detune: -3, gain: 0.55, octave: -1 },
      { type: 'sine', detune: 0, gain: 0.30, octave: -2 },
    ],
  },
  {
    name: 'Warm Pad Old',
    envelope: '0.35 0.3 0.65 0.6',
    effects: [{ type: 'filter', frequency: 1800 }],
    oscillators: [
      { type: 'sine', detune: -6, gain: 0.7, octave: 0 },
      { type: 'triangle', detune: 6, gain: 0.7, octave: 0 },
    ],
  },
].map(normalizeVoice);

// Default voice a fresh AudioEngine starts on -- Warm Pad, per the
// top-level README's "a little bit of attack/decay" spec (Warm Pad's own
// attack/decay is the most pronounced of the four). Looked up by name
// rather than a bare index literal so this stays correct if VOICES is ever
// reordered; exported so tests/support/expected-audio.js's own default
// tracks it too instead of hardcoding a second copy.
export const DEFAULT_VOICE_INDEX = VOICES.findIndex((v) => v.name === 'Warm Pad');

const CLICK_DURATION = 0.02; // seconds -- short enough to read as a click, not a tone

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.clickBuffer = null; // precomputed noise burst reused by every playClick() -- see unlock()
    this.voiceIndex = DEFAULT_VOICE_INDEX;
    this.active = new Map(); // voiceId -> array of sounding notes (see _playNote), one entry per polyphonic voice
  }

  // Must be triggered from within a user-gesture handler (keydown/pointerdown),
  // otherwise iOS/macOS Safari will keep the context suspended indefinitely.
  // Idempotent (a no-op once this.ctx exists), so callers can call it
  // defensively just to ensure the context exists.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      // Limiter as a headroom safety net: with several voices able to sound
      // at once now (multiple held chords, plus live play over a running
      // loop), the raw sum of their oscillators can exceed 0dBFS even after
      // the per-chord gain staging in _playNote. Fast attack + high ratio
      // catches those peaks without audibly pumping normal single-chord play.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;
      this.limiter.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.limiter);

      // White noise, built once and reused for every click (see playClick)
      // rather than regenerated per beat -- a metronome click should sound
      // identical every time, not subtly re-textured.
      const size = Math.ceil(this.ctx.sampleRate * CLICK_DURATION);
      this.clickBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
      const data = this.clickBuffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get voice() {
    return VOICES[this.voiceIndex];
  }

  cycleVoice(delta) {
    this.voiceIndex = (this.voiceIndex + delta + VOICES.length) % VOICES.length;
    return this.voice;
  }

  _freqFor(midi, octaveOffset) {
    return 440 * Math.pow(2, (midi - 69) / 12) * Math.pow(2, octaveOffset || 0);
  }

  /**
   * Schedule one envelope-shaped ramp on `param`, peaking at `peak` (a gain
   * node's target level, or an effect's target value, e.g. a filter's
   * frequency). With no `envelope`, `param` is just held at `peak` --
   * no automation, so nothing to release later either (see _releaseNote) --
   * which is how a level with no envelope of its own defers entirely to
   * whatever level does. Returns a descriptor recording enough to read this
   * ramp's value analytically at any later time (_envelopeValueAt) and
   * later release it, or null when there's nothing to release.
   */
  _scheduleEnvelope(param, peak, envelope, when) {
    if (!envelope) {
      param.setValueAtTime(peak, when);
      return null;
    }
    const { attack, decay, sustain, release } = envelope;
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(peak, when + attack);
    param.linearRampToValueAtTime(peak * sustain, when + attack + decay);
    return {
      param,
      attackStart: when,
      attackEnd: when + attack,
      decayEnd: when + attack + decay,
      level: peak,
      sustainLevel: peak * sustain,
      release,
    };
  }

  /**
   * Build `effects` (in order) ending at `destination`, returning the node a
   * caller should connect its own source into -- the first effect's node, or
   * `destination` itself when `effects` is empty, so a source with no
   * effects of its own still fans straight into the shared destination (one
   * voice-level filter processing the whole chord tone, say) instead of
   * needing a pass-through node. Any envelope-carrying effect found along
   * the way is pushed onto `envelopes` for _releaseNote to release later.
   */
  _buildEffectsChain(effects, destination, when, envelopes) {
    let entry = destination;
    for (let i = effects.length - 1; i >= 0; i--) {
      const node = this._createEffectNode(effects[i], when, envelopes);
      node.connect(entry);
      entry = node;
    }
    return entry;
  }

  _createEffectNode(effect, when, envelopes) {
    if (effect.type !== 'filter') throw new Error(`AudioEngine: unknown effect type "${effect.type}"`);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const envelope = this._scheduleEnvelope(filter.frequency, effect.frequency, effect.envelope, when);
    if (envelope) envelopes.push(envelope);
    return filter;
  }

  _playNote(midi, voice, when, chordSize) {
    const ctx = this.ctx;
    // Normalize by how many notes are in *this* chord, not a fixed level --
    // otherwise a wide voicing (e.g. the 5-note "9" variant) sums to several
    // times the amplitude of a plain triad.
    const level = 1 / Math.sqrt(Math.max(1, chordSize));

    const noteGain = ctx.createGain();
    noteGain.connect(this.master);
    // The voice's own envelope is the note's overall shape, and (unlike
    // every other level) always defined -- see VOICES -- so `outer` is
    // never null.
    const outer = this._scheduleEnvelope(noteGain.gain, level, voice.envelope, when);

    // Every other envelope-carrying param on this note (an oscillator's own,
    // or an effect's) -- see _releaseNote.
    const inner = [];
    // Voice-level effects sit between the mixed oscillators and the voice's
    // own envelope, so (e.g.) one filter processes the whole chord tone --
    // every oscillator below fans into this same entry point.
    const voiceEntry = this._buildEffectsChain(voice.effects, noteGain, when, inner);

    const oscs = voice.oscillators.map((spec) => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.detune.value = spec.detune;
      osc.frequency.value = this._freqFor(midi, spec.octave);

      const oscGain = ctx.createGain();
      const oscEnvelope = this._scheduleEnvelope(oscGain.gain, spec.gain, spec.envelope, when);
      if (oscEnvelope) inner.push(oscEnvelope);
      osc.connect(oscGain);

      // This oscillator's own effects (if any) run before it joins the
      // voice-level mix -- e.g. a different filter per oscillator, rather
      // than only the one shared voice-level filter.
      const oscEntry = this._buildEffectsChain(spec.effects, voiceEntry, when, inner);
      oscGain.connect(oscEntry);

      osc.start(when);
      return { node: osc, octave: spec.octave || 0 };
    });

    return { oscs, outer, inner, midi };
  }

  /**
   * Play a single short "tick" -- the metronome click (see js/metronome.js)
   * -- independent of the chord voice system above (a click isn't a musical
   * note: no ADSR preset, no per-chord level normalization, just a fixed
   * short blip). A bandpassed noise burst around 10-12kHz rather than a
   * pitched oscillator: that's the register a click actually needs to cut
   * through and read as a percussive "tick" instead of a low, easily-masked
   * tone.
   */
  playClick(when) {
    this.unlock();
    const t = this._notBefore(when);
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.clickBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 11000;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.9, t + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_DURATION);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start(t);
    noise.stop(t + CLICK_DURATION + 0.01);
  }

  /**
   * Make `voiceId` sound exactly `midiNotes`, however it got there -- a new
   * chord button added to (or dropped from) whatever's already held, a
   * variant change, a key change, or nothing sounding yet. Every note is
   * voiced fully independently: a note already sounding on this voice that's
   * still wanted (same MIDI pitch) is left completely untouched -- no
   * retrigger, no re-envelope, not even a re-pitch -- so it never cuts or
   * re-attacks just because the rest of the chord around it changed. Notes
   * no longer wanted are released individually; newly-wanted notes attack
   * fresh, layered on top. Voice ids are independent of each other -- see
   * the module comment above.
   *
   * `when` lets a caller schedule this for a precise future point on the
   * audio clock instead of right now -- loop.js's scheduler uses this so
   * playback timing comes from Web Audio's own sample-accurate clock rather
   * than from whenever the calling JS happens to run (see loop.js). Live
   * input (input.js) never passes it, so it defaults to "now".
   *
   * `voice` lets a caller pin which voice preset sounds this call instead of
   * whatever's currently selected on the engine -- loop.js passes the preset
   * that was current when the loop was *recorded*, so cycling voices while a
   * loop plays reshapes only new live playing, not the loop already laid down.
   */
  playChord(voiceId, midiNotes, when, voice = this.voice) {
    this.unlock();
    const t = this._notBefore(when);
    const existing = this.active.get(voiceId) || [];
    const target = new Set(midiNotes);
    const keep = existing.filter((note) => target.has(note.midi));
    const drop = existing.filter((note) => !target.has(note.midi));
    const already = new Set(keep.map((note) => note.midi));
    // De-dupe here too (not just trust the caller): if two chord buttons
    // merged into `midiNotes` happen to share a pitch, it must attack once,
    // not once per button, so that pitch's loudness doesn't stack.
    const toAdd = midiNotes.filter((m, i) => !already.has(m) && midiNotes.indexOf(m) === i);

    drop.forEach((note) => this._releaseNote(note, voice, t));
    const added = toAdd.map((m) => this._playNote(m, voice, t, midiNotes.length));
    this.active.set(voiceId, keep.concat(added));
  }

  /**
   * Release whatever's sounding on `voiceId`, using `voice`'s natural release
   * (defaulting to whatever's currently selected on the engine). `when`
   * schedules this for a precise future audio-clock time instead of right
   * now -- see playChord() above for both params.
   */
  stopChord(voiceId, when, voice = this.voice) {
    if (!this.ctx || !this.active.has(voiceId)) return;
    const t = this._notBefore(when);
    this.active.get(voiceId).forEach((note) => this._releaseNote(note, voice, t));
    this.active.delete(voiceId);
  }

  /**
   * Resolve a caller-supplied `when` (or "now" if omitted) to a time never
   * earlier than the current audio-clock instant. A lookahead scheduler
   * (loop.js, metronome.js) always computes `when` to land comfortably in
   * the future, but a delayed setInterval tick (main-thread jank) can still
   * make the actual playChord/stopChord call happen *after* that instant
   * has already passed. Scheduling an attack/release ramp whose start and
   * end are both already behind the audio clock doesn't play out as a ramp
   * at all -- Web Audio just snaps straight to the ramp's endpoint -- which
   * is what a note that sounds "late, with no attack" (or an abrupt,
   * click-y release) actually is. Clamping here guarantees every note this
   * engine ever schedules gets its full envelope, at the cost of landing a
   * hair later than originally intended only in that rare delayed-tick case.
   */
  _notBefore(when) {
    return Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime);
  }

  /**
   * Release every envelope-carrying param on `note`. The voice's own (outer)
   * envelope releases using `voice`'s *current* release time, not
   * necessarily the one in effect when the note attacked -- so cycling
   * voices mid-hold (see playChord/stopChord's own `voice` param) reshapes
   * an already-sounding note's release the same way it always could, before
   * oscillator/effect envelopes existed. Every other envelope (an
   * oscillator's or an effect's own) has no such "current voice" to re-read,
   * so each releases at whatever rate it was given when the note attacked.
   * The actual oscillators stop once the slowest of all of these has fully
   * released.
   */
  _releaseNote(note, voice, at) {
    const release = (env, releaseTime) => {
      // Read the value analytically from the same ramp _playNote scheduled,
      // rather than the AudioParam's live .value: `at` can be up to
      // LOOKAHEAD (see loop.js) in the *future* relative to real "now" when
      // this runs, so .value (which only reflects "now") would be stale for
      // any envelope whose attack/decay hasn't finished by the time this is
      // called, snapping it to a wrong, too-low value right as the curve was
      // still climbing.
      env.param.cancelScheduledValues(at);
      env.param.setValueAtTime(this._envelopeValueAt(env, at), at);
      env.param.linearRampToValueAtTime(0.0001, at + releaseTime);
      return releaseTime;
    };

    let maxRelease = release(note.outer, voice.envelope.release);
    for (const env of note.inner) maxRelease = Math.max(maxRelease, release(env, env.release));

    note.oscs.forEach(({ node }) => node.stop(at + maxRelease + 0.02));
  }

  /** What _scheduleEnvelope()'s attack/decay/sustain ramp evaluates to at time `t`. */
  _envelopeValueAt(note, t) {
    const { attackStart, attackEnd, decayEnd, level, sustainLevel } = note;
    if (t <= attackStart) return 0;
    if (t < attackEnd) return level * ((t - attackStart) / (attackEnd - attackStart));
    if (t < decayEnd) return level + (sustainLevel - level) * ((t - attackEnd) / (decayEnd - attackEnd));
    return sustainLevel;
  }
}
