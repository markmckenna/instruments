// Web Audio sound engine. Polyphonic across independent "voices" (a caller-
// chosen id): input.js plays whatever's currently held on voice id 'live'
// and loop.js plays loop events back on voice id 'loop', so the two can
// sound at once instead of clobbering each other. Multiple chord buttons
// held together are combined into one 'live' voice before reaching here
// (see input.js's currentSound()) rather than each getting their own id,
// since there's still just one variant/joystick control shaping "whatever's
// currently held" as a single sound.

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

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.voiceIndex = 0;
    this.active = new Map(); // voiceId -> array of sounding notes (see _playNote), one entry per polyphonic voice
  }

  // Must be triggered from within a user-gesture handler (keydown/pointerdown),
  // otherwise iOS/macOS Safari will keep the context suspended indefinitely.
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
    // times the amplitude of a plain triad. This, combined with the master
    // gain/limiter above, is what fixes the clipping: previously every note
    // played at full gain regardless of how many were stacked underneath it.
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
   * Play a single short, low, unpitched "tick" -- the metronome click (see
   * js/metronome.js) -- through its own oscillator, independent of the
   * chord voice system above (a click isn't a musical note: no ADSR preset,
   * no per-chord level normalization, just a fixed short blip).
   */
  playClick(when) {
    this.unlock();
    const t = when ?? this.ctx.currentTime;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 90; // low -- distinct from any chord voice's register
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.6, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.06);
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
   */
  playChord(voiceId, midiNotes, when) {
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

    drop.forEach((note) => this._releaseNote(note, this.voice.release, t));
    const added = toAdd.map((m) => this._playNote(m, this.voice, t, midiNotes.length));
    this.active.set(voiceId, keep.concat(added));
  }

  /**
   * Release whatever's sounding on `voiceId`, using the current voice
   * preset's natural release. `when` schedules this for a precise future
   * audio-clock time instead of right now -- see playChord() above.
   */
  stopChord(voiceId, when) {
    if (!this.ctx || !this.active.has(voiceId)) return;
    const t = when ?? this.ctx.currentTime;
    this.active.get(voiceId).forEach((note) => this._releaseNote(note, this.voice.release, t));
    this.active.delete(voiceId);
  }

  _releaseNote(note, releaseTime, at) {
    const { oscs, gain } = note;
    // Read the gain analytically from the same attack/decay curve _playNote
    // scheduled, rather than the AudioParam's live .value: `at` can be up to
    // LOOKAHEAD (see loop.js) in the *future* relative to real "now" when
    // this runs, so .value (which only reflects "now") would be stale for
    // any note whose attack/decay hasn't finished by the time this is
    // called -- cancelScheduledValues(at) + setValueAtTime(stale value, at)
    // would then snap the gain to a wrong, too-low value right as the curve
    // was still climbing, an audible drop that could look like "the note
    // already decayed to zero" on whichever playouts happened to be short
    // enough for this to bite.
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
