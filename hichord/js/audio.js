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
// See voices.js for the actual voice/oscillator/effect schema and presets --
// this module only turns an already-normalized voice into a Web Audio node
// graph, it doesn't define what a voice *is*.

// MIDI is this module's concern, not theory.js's: theory.js's DEGREES/
// VARIANTS describe chord *shape* in the abstract (scale degrees, semitone
// offsets from a root); turning that into actual MIDI note numbers and
// pitch names is audio-side math, alongside _freqFor below.
import { DEGREES, VARIANTS, NEUTRAL_VARIANT, invertOffsets, pcName } from './theory.js';
import { VOICES, DEFAULT_VOICE_INDEX, FILTER_TYPES, isRandomized } from './voices.js';

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

const CLICK_DURATION = 0.02; // seconds -- short enough to read as a click, not a tone

// The MIDI note a filter's `keyTrack` (see voices.js) tracks *from* -- 0%
// tracking never moves the cutoff regardless of what's played, 100% moves it
// in exact lockstep with how far the played note (or, for an oscillator's
// own filter, that oscillator's own octave-shifted note) sits from this
// anchor. Middle C, same anchor buildChord's own `baseMidi` defaults to, so
// a filter tuned "as heard" while noodling around middle C keeps that same
// voicing there regardless of how far the tracking is turned up.
const KEY_TRACK_REFERENCE_MIDI = 60;

// The standard Web Audio "makeDistortionCurve" formula, straight from MDN's
// own createWaveShaper() example --
// https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createWaveShaper.
// `amount` is WebAudio's own informal "k" in that formula (roughly 0 = clean
// through 100+ = hard clip).
function distortionCurve(amount) {
  const k = amount;
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

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

  /** Roll a "base~range" descriptor (see voices.js's parseNumeric) to a plain number; a plain number/undefined passes through untouched. */
  _resolveField(value) {
    if (!isRandomized(value)) return value;
    const { base, range } = value;
    return base + (Math.random() * 2 - 1) * range;
  }

  /**
   * Resolve `fields` on `spec` (a voice or an oscillator) for one note: any
   * "base~range" value rolls a fresh number now, held steady for as long as
   * this note sounds (_resolveField above); then any `randomize` effect
   * among `effects` overrides its own named field the same way, around
   * whatever that field already resolved to -- see voices.js's EFFECT_PARAMS
   * comment on the `randomize` effect for why that's a separate mechanism
   * from the inline notation instead of just a second way to spell it.
   * `spec`/`effects` are never mutated; a plain `{field: value}` map comes
   * back for the caller to read instead.
   */
  _resolveSpec(spec, fields, effects) {
    const resolved = {};
    for (const field of fields) resolved[field] = this._resolveField(spec[field]);
    for (const effect of effects) {
      if (effect.type !== 'randomize') continue;
      const base = resolved[effect.property];
      if (typeof base !== 'number') continue; // targets a field this spec doesn't have, or isn't numeric -- ignore rather than crash the note
      resolved[effect.property] = base + (Math.random() * 2 - 1) * effect.range;
    }
    return resolved;
  }

  /**
   * Schedule one envelope-shaped ramp on `param`, from `floor` (default 0)
   * up to `peak` and back down to a `sustain`-fraction of the way between
   * them, at a gain node's target level or an effect's target value (e.g. a
   * filter's frequency). `floor` is 0 for every gain envelope (a note starts
   * silent) but a filter-envelope-with-keyTrack instead floors at that
   * filter's own (keyTracked) resting cutoff, so releasing settles back to
   * where the filter sits with no envelope rather than slamming to ~0Hz --
   * see _createFilterNode. With no `envelope`, `param` is just held at
   * `peak` -- no automation, so nothing to release later either (see
   * _releaseNote) -- which is how a level with no envelope of its own defers
   * entirely to whatever level does. Returns a descriptor recording enough
   * to read this ramp's value analytically at any later time
   * (_envelopeValueAt) and later release it, or null when there's nothing to
   * release.
   */
  _scheduleEnvelope(param, peak, envelope, when, floor) {
    if (!envelope) {
      param.setValueAtTime(peak, when);
      return null;
    }
    // `floor` is left as-given (including undefined) on the returned
    // descriptor -- see _releaseNote, which falls back to ~0 (not exactly 0)
    // only when a level never specified one, same as before floors existed
    // -- but the ramp math itself always needs a concrete start value.
    const start = floor ?? 0;
    const { attack, decay, sustain, release } = envelope;
    const sustainLevel = start + (peak - start) * sustain;
    param.setValueAtTime(start, when);
    param.linearRampToValueAtTime(peak, when + attack);
    param.linearRampToValueAtTime(sustainLevel, when + attack + decay);
    return {
      param,
      attackStart: when,
      attackEnd: when + attack,
      decayEnd: when + attack + decay,
      level: peak,
      sustainLevel,
      release,
      floor,
    };
  }

  /**
   * Build `effects` (in order) ending at `destination`, returning the node a
   * caller should connect its own source into -- the first effect's node, or
   * `destination` itself when `effects` is empty, so a source with no
   * effects of its own still fans straight into the shared destination (one
   * voice-level filter processing the whole chord tone, say) instead of
   * needing a pass-through node. Any envelope-carrying effect found along
   * the way is pushed onto `envelopes` for _releaseNote to release later,
   * and any extra oscillator an effect needs (a tremolo's LFO) onto
   * `auxOscillators` for the same release pass to stop. `trackingMidi` is
   * the MIDI pitch a filter effect's own `keyTrack` measures its distance
   * from -- the note itself for a voice-level effect, or that oscillator's
   * own octave-shifted pitch for one of its own effects (see _playNote).
   *
   * `randomize` (see voices.js) patches a field on `spec` itself rather than
   * building a processing node of its own -- see _resolveSpec, which is
   * where it actually gets applied -- so it's skipped here entirely.
   */
  _buildEffectsChain(effects, destination, when, envelopes, auxOscillators, trackingMidi) {
    let entry = destination;
    for (let i = effects.length - 1; i >= 0; i--) {
      if (effects[i].type === 'randomize') continue;
      entry = this._createEffectNode(effects[i], entry, when, envelopes, auxOscillators, trackingMidi);
    }
    return entry;
  }

  _createEffectNode(effect, destination, when, envelopes, auxOscillators, trackingMidi) {
    if (FILTER_TYPES.includes(effect.type)) return this._createFilterNode(effect, destination, when, envelopes, trackingMidi);
    switch (effect.type) {
      case 'reverb':
        return this._createReverbNode(effect, destination);
      case 'tremolo':
        return this._createTremoloNode(effect, destination, when, auxOscillators);
      case 'delay':
        return this._createDelayNode(effect, destination);
      case 'distortion':
        return this._createDistortionNode(effect, destination);
      default:
        throw new Error(`AudioEngine: unknown effect type "${effect.type}"`);
    }
  }

  /**
   * A BiquadFilterNode of `effect.type` (any of voices.js's FILTER_TYPES --
   * the type string doubles as WebAudio's own BiquadFilterNode.type value).
   * `resonance`/`gain` map straight to the node's own Q/gain when that
   * filter type uses them (see voices.js's SHELF_TYPES/GAIN_TYPES). The
   * cutoff itself is `keyTrack`-scaled by how far `trackingMidi` sits from
   * KEY_TRACK_REFERENCE_MIDI (see that constant), then optionally swept by
   * `envAmount` (also scaled the same way, so the whole sweep transposes
   * with the note) over `envelope`'s shape, floored at the unswept
   * (keyTracked) cutoff rather than 0Hz -- see _scheduleEnvelope.
   */
  _createFilterNode(effect, destination, when, envelopes, trackingMidi) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = effect.type;
    if (effect.resonance !== undefined) filter.Q.value = this._resolveField(effect.resonance);
    if (effect.gain !== undefined) filter.gain.value = this._resolveField(effect.gain);

    const keyTrack = this._resolveField(effect.keyTrack);
    const scale = Math.pow(2, (keyTrack * (trackingMidi - KEY_TRACK_REFERENCE_MIDI)) / 12);
    const base = this._resolveField(effect.frequency) * scale;
    const amount = this._resolveField(effect.envAmount) * scale;

    const envelope = this._scheduleEnvelope(filter.frequency, base + amount, effect.envelope, when, base);
    if (envelope) envelopes.push(envelope);

    filter.connect(destination);
    return filter;
  }

  /**
   * Wire a dry/wet blend around an already-built processing chain
   * (`chainInput` .. `chainOutput` -- the same node when the chain is just
   * one node) versus the untouched signal, both feeding `destination`.
   * Returns the node callers should feed their input into. Shared by every
   * effect that offers a wet/dry mix (reverb, delay, distortion) instead of
   * each wiring this three-way fan-out itself.
   */
  _wetDryMix(chainInput, chainOutput, destination, wet) {
    const input = this.ctx.createGain();
    const dry = this.ctx.createGain();
    dry.gain.value = 1 - wet;
    const wetGain = this.ctx.createGain();
    wetGain.gain.value = wet;
    input.connect(dry);
    dry.connect(destination);
    input.connect(chainInput);
    chainOutput.connect(wetGain);
    wetGain.connect(destination);
    return input;
  }

  /**
   * Algorithmic reverb: a ConvolverNode fed a synthetic impulse response
   * instead of a recorded one -- exponentially-decaying white noise makes a
   * convincing reverb tail on its own, a long-known trick (see
   * https://github.com/adelespinasse/reverbGen and
   * https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode), so no
   * sample file is needed just to add reverb.
   */
  _createReverbNode(effect, destination) {
    const convolver = this.ctx.createConvolver();
    convolver.buffer = this._reverbImpulse(this._resolveField(effect.decay));
    return this._wetDryMix(convolver, convolver, destination, this._resolveField(effect.wet));
  }

  _reverbImpulse(decaySeconds) {
    const rate = this.ctx.sampleRate;
    const length = Math.max(1, Math.round(rate * Math.max(decaySeconds, 0.01)));
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    return impulse;
  }

  /**
   * Tremolo: rhythmic amplitude modulation, the classic Web Audio recipe --
   * an LFO (a plain OscillatorNode) driving a GainNode's own gain instead of
   * an audible signal. Centered so the gain swings between (1 - depth) and 1
   * rather than clipping above unity. The LFO has no natural stop of its
   * own (unlike the note's main oscillators, which stop when their envelope
   * finishes -- see _playNote/_releaseNote), so it's pushed onto
   * `auxOscillators` for _releaseNote to stop alongside them.
   */
  _createTremoloNode(effect, destination, when, auxOscillators) {
    const depth = this._resolveField(effect.depth);
    const node = this.ctx.createGain();
    node.gain.value = 1 - depth / 2;
    node.connect(destination);

    const lfo = this.ctx.createOscillator();
    lfo.auxiliary = true; // not a note -- see tests/support/fixtures.js's probe, which skips these
    lfo.frequency.value = this._resolveField(effect.rate);
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = depth / 2;
    lfo.connect(lfoDepth);
    lfoDepth.connect(node.gain);
    lfo.start(when);
    auxOscillators.push(lfo);

    return node;
  }

  /** A single-tap echo: a DelayNode with a feedback loop back into itself, mixed dry/wet like reverb/distortion. */
  _createDelayNode(effect, destination) {
    const delay = this.ctx.createDelay(1); // 1s ceiling comfortably covers this instrument's tempo range (see tempo.js)
    delay.delayTime.value = this._resolveField(effect.time);
    const feedback = this.ctx.createGain();
    feedback.gain.value = this._resolveField(effect.feedback);
    delay.connect(feedback);
    feedback.connect(delay);
    return this._wetDryMix(delay, delay, destination, this._resolveField(effect.wet));
  }

  /** A WaveShaperNode driven by distortionCurve above, mixed dry/wet like reverb/delay. */
  _createDistortionNode(effect, destination) {
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(this._resolveField(effect.amount));
    shaper.oversample = '4x';
    return this._wetDryMix(shaper, shaper, destination, this._resolveField(effect.wet));
  }

  _playNote(midi, voice, when, chordSize) {
    const ctx = this.ctx;
    // Normalize by how many notes are in *this* chord, not a fixed level --
    // otherwise a wide voicing (e.g. the 5-note "9" variant) sums to several
    // times the amplitude of a plain triad.
    const level = 1 / Math.sqrt(Math.max(1, chordSize));

    const noteGain = ctx.createGain();
    const voicePan = ctx.createStereoPanner();
    noteGain.connect(voicePan);
    voicePan.connect(this.master);
    // The voice's own envelope is the note's overall shape, and (unlike
    // every other level) always defined -- see voices.js -- so `outer` is
    // never null.
    const outer = this._scheduleEnvelope(noteGain.gain, level, voice.envelope, when);

    // Every other envelope-carrying param on this note (an oscillator's own,
    // or an effect's) -- see _releaseNote. `aux` collects extra oscillators
    // an effect needs (a tremolo's LFO) that also need stopping there.
    const inner = [];
    const aux = [];

    const voiceValues = this._resolveSpec(voice, ['pan'], voice.effects);
    voicePan.pan.value = voiceValues.pan;

    // Voice-level effects sit between the mixed oscillators and the voice's
    // own envelope, so (e.g.) one filter processes the whole chord tone --
    // every oscillator below fans into this same entry point. A voice-level
    // filter's keyTrack measures from the note itself (no one oscillator's
    // octave shift is "the" pitch here).
    const voiceEntry = this._buildEffectsChain(voice.effects, noteGain, when, inner, aux, midi);

    const oscs = voice.oscillators.map((spec) => {
      const oscValues = this._resolveSpec(spec, ['detune', 'gain', 'octave', 'pan'], spec.effects);

      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.detune.value = oscValues.detune;
      osc.frequency.value = this._freqFor(midi, oscValues.octave);

      const oscGain = ctx.createGain();
      const oscEnvelope = this._scheduleEnvelope(oscGain.gain, oscValues.gain, spec.envelope, when);
      if (oscEnvelope) inner.push(oscEnvelope);

      const oscPan = ctx.createStereoPanner();
      oscPan.pan.value = oscValues.pan;
      osc.connect(oscGain);
      oscGain.connect(oscPan);

      // This oscillator's own effects (if any) run before it joins the
      // voice-level mix -- e.g. a different filter per oscillator, rather
      // than only the one shared voice-level filter. Its own keyTrack
      // measures from *this oscillator's* actual sounding pitch, which can
      // differ from the note's own MIDI pitch by its octave setting.
      const trackingMidi = midi + (oscValues.octave || 0) * 12;
      const oscEntry = this._buildEffectsChain(spec.effects, voiceEntry, when, inner, aux, trackingMidi);
      oscPan.connect(oscEntry);

      osc.start(when);
      return { node: osc, octave: oscValues.octave || 0 };
    });

    return { oscs, outer, inner, aux, midi };
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
   * so each releases at whatever rate it was given when the note attacked,
   * settling at that envelope's own `floor` (0 for a gain envelope, a
   * filter's keyTracked resting cutoff for one of those -- see
   * _scheduleEnvelope) rather than always all the way to ~silence. The
   * actual oscillators (and any auxiliary ones, e.g. a tremolo's LFO) stop
   * once the slowest of all of these has fully released.
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
      env.param.linearRampToValueAtTime(env.floor ?? 0.0001, at + releaseTime);
      return releaseTime;
    };

    let maxRelease = release(note.outer, voice.envelope.release);
    for (const env of note.inner) maxRelease = Math.max(maxRelease, release(env, env.release));

    note.oscs.forEach(({ node }) => node.stop(at + maxRelease + 0.02));
    note.aux.forEach((node) => node.stop(at + maxRelease + 0.02));
  }

  /** What _scheduleEnvelope()'s attack/decay/sustain ramp evaluates to at time `t`. */
  _envelopeValueAt(note, t) {
    const { attackStart, attackEnd, decayEnd, level, sustainLevel, floor = 0 } = note;
    if (t <= attackStart) return floor;
    if (t < attackEnd) return floor + (level - floor) * ((t - attackStart) / (attackEnd - attackStart));
    if (t < decayEnd) return level + (sustainLevel - level) * ((t - attackEnd) / (decayEnd - attackEnd));
    return sustainLevel;
  }
}
