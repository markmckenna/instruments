// Web Audio sound engine. Monophonic chord slot: only one chord sounds at a
// time (matches a one-handed chord instrument), so callers don't need to
// manage note-stealing themselves -- playChord() always cleanly cuts off
// whatever was previously sounding before starting the new chord.

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

const CROSSFADE = 0.015; // seconds; quick cutover between chords, avoids clicks

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voiceIndex = 0;
    this.activeNotes = [];
  }

  // Must be triggered from within a user-gesture handler (keydown/pointerdown),
  // otherwise iOS/macOS Safari will keep the context suspended indefinitely.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
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

  _playNote(midi, voice, when) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = voice.filterHz;
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, when);
    noteGain.gain.linearRampToValueAtTime(1, when + voice.attack);
    noteGain.gain.linearRampToValueAtTime(voice.sustain, when + voice.attack + voice.decay);
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

  /** Start (or immediately replace) the sounding chord. */
  playChord(midiNotes) {
    this.unlock();
    const hadActive = this.activeNotes.length > 0;
    if (hadActive) this._release(CROSSFADE);
    const when = this.ctx.currentTime + (hadActive ? CROSSFADE : 0);
    this.activeNotes = midiNotes.map((m) => this._playNote(m, this.voice, when));
  }

  /**
   * Re-pitch the currently sounding chord in place when possible (e.g. a
   * variant change while a chord button is held), for a smooth "live tweak"
   * feel instead of a hard retrigger. Falls back to playChord() when there's
   * nothing sounding yet, or when the note count changed (no clean 1:1
   * mapping to glide between).
   */
  updateChord(midiNotes) {
    if (!this.ctx || this.activeNotes.length === 0) {
      this.playChord(midiNotes);
      return;
    }
    if (midiNotes.length === this.activeNotes.length) {
      const now = this.ctx.currentTime;
      this.activeNotes.forEach((note, i) => {
        note.midi = midiNotes[i];
        note.oscs.forEach(({ node, octave }) => {
          node.frequency.setTargetAtTime(this._freqFor(note.midi, octave), now, 0.02);
        });
      });
    } else {
      this.playChord(midiNotes);
    }
  }

  /** Release whatever is sounding, using the current voice's natural release. */
  stopChord() {
    if (!this.ctx || this.activeNotes.length === 0) return;
    this._release(this.voice.release);
    this.activeNotes = [];
  }

  _release(releaseTime) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.activeNotes.forEach(({ oscs, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + releaseTime);
      oscs.forEach(({ node }) => node.stop(now + releaseTime + 0.02));
    });
  }
}
