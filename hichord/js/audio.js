// Web Audio sound engine. Polyphonic across independent "voices" (a caller-
// chosen id): input.js plays whatever's currently held on voice id 'live'
// and loop.js plays loop events back on voice id 'loop', so the two can
// sound at once instead of clobbering each other. Multiple chord buttons
// held together are combined into one 'live' voice before reaching here
// (see input.js's currentSound()) rather than each getting their own id,
// since there's still just one variant/joystick control shaping "whatever's
// currently held" as a single sound.

// Direct Web Audio oscillators/envelopes, no synthesis library -- the sound
// palette here (a few detuned oscillators through a low-pass filter with an
// ADSR-ish envelope) is simple enough that a dependency would add more
// weight than value. Soft Pad is the default (a little attack/decay, per
// the top-level README's spec).

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
 * @param {'chord'|'bass'|'arpeggio'|'lead'} [options.mode] playback mode (see input.js): 'arpeggio' shapes the note *set* the same as 'chord' -- sequencing it one at a time is input.js's Arpeggiator's job, not this function's; 'lead' drops the chord to just its root; 'bass' adds a low root note under it
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

  if (mode === 'bass') notes.push(rootMidi - 24); // this chord's own root, 2 octaves down, regardless of the voicing (incl. inversion) above it

  return notes;
}

export const VOICES = [
  {
    name: 'Soft Pad',
    attack: 0.08,
    decay: 0.15,
    sustain: 0.7,
    release: 0.35,
    filterHz: 2600,
    oscillators: [
      { type: 'triangle', detune: 0, gain: 1.0, octave: 0 },
      { type: 'sine', detune: 0, gain: 0.35, octave: 1 },
    ],
  },
  {
    name: 'Pluck',
    attack: 0.004,
    decay: 0.22,
    sustain: 0.25,
    release: 0.18,
    filterHz: 3200,
    oscillators: [
      { type: 'sawtooth', detune: -4, gain: 0.9, octave: 0 },
      { type: 'sawtooth', detune: 4, gain: 0.9, octave: 0 },
    ],
  },
  {
    name: 'Organ',
    attack: 0.01,
    decay: 0.05,
    sustain: 1.0,
    release: 0.06,
    filterHz: 6000,
    oscillators: [
      { type: 'square', detune: 0, gain: 0.5, octave: 0 },
      { type: 'sine', detune: 0, gain: 0.6, octave: 1 },
    ],
  },
  {
    name: 'Warm Pad',
    attack: 0.35,
    decay: 0.3,
    sustain: 0.65,
    release: 0.6,
    filterHz: 1800,
    oscillators: [
      { type: 'sine', detune: -6, gain: 0.7, octave: 0 },
      { type: 'triangle', detune: 6, gain: 0.7, octave: 0 },
    ],
  },
];

const CLICK_DURATION = 0.02; // seconds -- short enough to read as a click, not a tone

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.clickBuffer = null; // precomputed noise burst reused by every playClick() -- see unlock()
    this.voiceIndex = 0;
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

  _playNote(midi, voice, when, chordSize) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.filterHz;
    // Normalize by how many notes are in *this* chord, not a fixed level --
    // otherwise a wide voicing (e.g. the 5-note "9" variant) sums to several
    // times the amplitude of a plain triad.
    const level = 1 / Math.sqrt(Math.max(1, chordSize));
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, when);
    noteGain.gain.linearRampToValueAtTime(level, when + voice.attack);
    noteGain.gain.linearRampToValueAtTime(level * voice.sustain, when + voice.attack + voice.decay);
    filter.connect(noteGain);
    noteGain.connect(this.master);

    const oscs = voice.oscillators.map((spec) => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.detune.value = spec.detune;
      osc.frequency.value = this._freqFor(midi, spec.octave);
      const oscGain = ctx.createGain();
      oscGain.gain.value = spec.gain;
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(when);
      return { node: osc, octave: spec.octave || 0 };
    });

    // attackEnd/decayEnd/level/sustainLevel let _releaseNote() work out what
    // the gain *should* be at any later release time analytically, instead
    // of reading the AudioParam's live .value -- see _releaseNote().
    return {
      oscs,
      gain: noteGain,
      filter,
      midi,
      attackStart: when,
      attackEnd: when + voice.attack,
      decayEnd: when + voice.attack + voice.decay,
      level,
      sustainLevel: level * voice.sustain,
    };
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
    const t = when ?? this.ctx.currentTime;
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
    const t = when ?? this.ctx.currentTime;
    const existing = this.active.get(voiceId) || [];
    const target = new Set(midiNotes);
    const keep = existing.filter((note) => target.has(note.midi));
    const drop = existing.filter((note) => !target.has(note.midi));
    const already = new Set(keep.map((note) => note.midi));
    // De-dupe here too (not just trust the caller): if two chord buttons
    // merged into `midiNotes` happen to share a pitch, it must attack once,
    // not once per button, so that pitch's loudness doesn't stack.
    const toAdd = midiNotes.filter((m, i) => !already.has(m) && midiNotes.indexOf(m) === i);

    drop.forEach((note) => this._releaseNote(note, voice.release, t));
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
    const t = when ?? this.ctx.currentTime;
    this.active.get(voiceId).forEach((note) => this._releaseNote(note, voice.release, t));
    this.active.delete(voiceId);
  }

  _releaseNote(note, releaseTime, at) {
    const { oscs, gain } = note;
    // Read the gain analytically from the same attack/decay curve _playNote
    // scheduled, rather than the AudioParam's live .value: `at` can be up to
    // LOOKAHEAD (see loop.js) in the *future* relative to real "now" when
    // this runs, so .value (which only reflects "now") would be stale for
    // any note whose attack/decay hasn't finished by the time this is
    // called, snapping the gain to a wrong, too-low value right as the curve
    // was still climbing.
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(this._envelopeValueAt(note, at), at);
    gain.gain.linearRampToValueAtTime(0.0001, at + releaseTime);
    oscs.forEach(({ node }) => node.stop(at + releaseTime + 0.02));
  }

  /** What _playNote()'s attack/decay/sustain ramp evaluates to at time `t`. */
  _envelopeValueAt(note, t) {
    const { attackStart, attackEnd, decayEnd, level, sustainLevel } = note;
    if (t <= attackStart) return 0;
    if (t < attackEnd) return level * ((t - attackStart) / (attackEnd - attackStart));
    if (t < decayEnd) return level + (sustainLevel - level) * ((t - attackEnd) / (decayEnd - attackEnd));
    return sustainLevel;
  }
}
