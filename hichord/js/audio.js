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

const CROSSFADE = 0.015; // seconds; quick cutover between chords on the same voice, avoids clicks

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

    return { oscs, gain: noteGain, filter, midi };
  }

  /**
   * Start (or immediately replace) the chord sounding on `voiceId`. Voice
   * ids are independent of each other -- see the module comment above.
   */
  playChord(voiceId, midiNotes) {
    this.unlock();
    const hadActive = this.active.has(voiceId);
    if (hadActive) this._release(voiceId, CROSSFADE);
    const when = this.ctx.currentTime + (hadActive ? CROSSFADE : 0);
    this.active.set(voiceId, midiNotes.map((m) => this._playNote(m, this.voice, when, midiNotes.length)));
  }

  /**
   * Re-pitch the chord already sounding on `voiceId` in place when possible
   * (e.g. a variant change while a chord button is held), for a smooth "live
   * tweak" feel instead of a hard retrigger. Falls back to playChord() when
   * there's nothing sounding yet on this voice, or when the note count
   * changed (no clean 1:1 mapping to glide between).
   */
  updateChord(voiceId, midiNotes) {
    const notes = this.active.get(voiceId);
    if (!this.ctx || !notes || notes.length === 0) {
      this.playChord(voiceId, midiNotes);
      return;
    }
    if (midiNotes.length === notes.length) {
      const now = this.ctx.currentTime;
      notes.forEach((note, i) => {
        note.midi = midiNotes[i];
        note.oscs.forEach(({ node, octave }) => {
          node.frequency.setTargetAtTime(this._freqFor(note.midi, octave), now, 0.02);
        });
      });
    } else {
      this.playChord(voiceId, midiNotes);
    }
  }

  /** Release whatever's sounding on `voiceId`, using the current voice preset's natural release. */
  stopChord(voiceId) {
    if (!this.ctx || !this.active.has(voiceId)) return;
    this._release(voiceId, this.voice.release);
    this.active.delete(voiceId);
  }

  _release(voiceId, releaseTime) {
    const notes = this.active.get(voiceId);
    if (!notes) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    notes.forEach(({ oscs, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + releaseTime);
      oscs.forEach(({ node }) => node.stop(now + releaseTime + 0.02));
    });
  }
}
