// The voice/oscillator/effect schema (pure logic, no browser/audio needed):
// voices.js's parseEnvelope/parseNumeric shorthand parsing and normalization,
// and AudioEngine's own graph-building -- that every level's envelope lands
// on its own AudioParam wired in series with whatever contains it (which is
// what lets nested envelopes compound without this module doing any
// multiplication itself), that a filter's keyTrack/envAmount scale and sweep
// its cutoff correctly, and that pan/randomize/the "base~range" notation all
// resolve once per note. See voices.js's own module comment for the schema
// this exercises.
import { test, expect } from './support/fixtures.js';
import { AudioEngine } from '../js/audio.js';
import { parseEnvelope, parseNumeric, isRandomized, normalizeVoice } from '../js/voices.js';

// Captures console.warn calls made during `fn()` instead of letting them
// print, and restores the original afterward even if `fn` throws.
function withWarnCaptured(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

// Runs `fn()` with Math.random() pinned to `value`, restoring the real one
// afterward even if `fn` throws -- lets a test assert on an exact resolved
// "base~range"/randomize-effect value instead of just "it's in range".
function withFixedRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test.describe('parseEnvelope', () => {
  test('parses a space-separated shorthand string in attack/decay/sustain/release order', () => {
    expect(parseEnvelope('0.08 0.15 0.7 0.35')).toEqual({ attack: 0.08, decay: 0.15, sustain: 0.7, release: 0.35 });
  });

  test('also accepts commas between the numbers', () => {
    expect(parseEnvelope('0.08, 0.15, 0.7, 0.35')).toEqual({ attack: 0.08, decay: 0.15, sustain: 0.7, release: 0.35 });
  });

  test('passes an already-spelled-out object through unchanged', () => {
    const envelope = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };
    expect(parseEnvelope(envelope)).toBe(envelope);
  });

  test('passes an absent envelope through unchanged', () => {
    expect(parseEnvelope(undefined)).toBeUndefined();
  });
});

test.describe('parseNumeric: the "base~range" per-note-random notation', () => {
  test('parses "base~range" into a randomized descriptor', () => {
    const parsed = parseNumeric('0~2');
    expect(isRandomized(parsed)).toBe(true);
    expect(parsed).toEqual({ random: true, base: 0, range: 2 });
  });

  test('accepts negative bases/ranges and surrounding whitespace', () => {
    expect(parseNumeric('-8 ~ 3')).toEqual({ random: true, base: -8, range: 3 });
  });

  test('passes a plain number through untouched', () => {
    expect(parseNumeric(2600)).toBe(2600);
    expect(isRandomized(2600)).toBe(false);
  });

  test('passes a string that isn\'t "base~range" shorthand through untouched', () => {
    expect(parseNumeric('lowpass')).toBe('lowpass');
  });

  test('passes undefined through untouched', () => {
    expect(parseNumeric(undefined)).toBeUndefined();
    expect(isRandomized(undefined)).toBe(false);
  });
});

test.describe('normalizeVoice: unrecognized fields degrade instead of breaking the voice', () => {
  const baseVoice = () => ({
    name: 'Test',
    envelope: '0 0 1 0',
    effects: [],
    oscillators: [{ type: 'sine', detune: 0, gain: 1, octave: 0 }],
  });

  test('an unknown effect type is dropped, with a warning, leaving the rest of the voice intact', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({
        ...baseVoice(),
        effects: [{ type: 'lowpass', frequency: 1000 }, { type: 'flanger', frequency: 65 }],
      }),
    );

    expect(voice.effects).toHaveLength(1); // the unknown 'flanger' effect is dropped, not left broken
    expect(voice.effects[0].type).toBe('lowpass');
    expect(warnings.some((w) => w.includes('unknown type "flanger"'))).toBe(true);
  });

  test('an unknown param on a known effect type is dropped, with a warning, leaving that effect otherwise intact', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({ ...baseVoice(), effects: [{ type: 'lowpass', frequency: 1000, Q: 0.5 }] }),
    );

    // Q isn't this schema's name for it -- see "resonance maps to Q" below --
    // so it's still unrecognized even though the effect type itself is fine.
    expect(voice.effects[0]).toEqual({
      type: 'lowpass',
      frequency: 1000,
      resonance: 0.707,
      keyTrack: 1.0,
      envelope: undefined,
      envAmount: 0,
    });
    expect(warnings.some((w) => w.includes('unknown "Q"'))).toBe(true);
  });

  test('resonance maps to Q (default 0.707) and keyTrack defaults to 1.0 when a filter effect omits them', () => {
    const voice = normalizeVoice({ ...baseVoice(), effects: [{ type: 'highpass', frequency: 300 }] });
    expect(voice.effects[0].resonance).toBe(0.707);
    expect(voice.effects[0].keyTrack).toBe(1.0);
  });

  test('a shelf filter has no resonance param at all -- Q does nothing for lowshelf/highshelf per the Web Audio spec', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({ ...baseVoice(), effects: [{ type: 'lowshelf', frequency: 300, resonance: 2, gain: 3 }] }),
    );
    expect(voice.effects[0]).not.toHaveProperty('resonance');
    expect(voice.effects[0].gain).toBe(3);
    expect(warnings.some((w) => w.includes('unknown "resonance"'))).toBe(true);
  });

  test('a non-shelf, non-peaking filter has no gain param at all', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({ ...baseVoice(), effects: [{ type: 'lowpass', frequency: 300, gain: 3 }] }),
    );
    expect(voice.effects[0]).not.toHaveProperty('gain');
    expect(warnings.some((w) => w.includes('unknown "gain"'))).toBe(true);
  });

  test('a randomize effect normalizes its property/range and, unlike a filter, takes no envelope of its own', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({ ...baseVoice(), effects: [{ type: 'randomize', property: 'pan', range: 2, envelope: '0 0 1 0' }] }),
    );
    expect(voice.effects[0]).toEqual({ type: 'randomize', property: 'pan', range: 2 });
    expect(warnings.some((w) => w.includes('unknown "envelope"'))).toBe(true);
  });

  test('reverb/tremolo/delay/distortion each normalize to their own documented params and defaults', () => {
    const voice = normalizeVoice({
      ...baseVoice(),
      effects: [{ type: 'reverb' }, { type: 'tremolo' }, { type: 'delay' }, { type: 'distortion' }],
    });
    expect(voice.effects).toEqual([
      { type: 'reverb', decay: 2.0, wet: 0.3 },
      { type: 'tremolo', rate: 5, depth: 0.5 },
      { type: 'delay', time: 0.25, feedback: 0.3, wet: 0.3 },
      { type: 'distortion', amount: 20, wet: 1.0 },
    ]);
  });

  test('a "base~range" string on a numeric field parses into a randomized descriptor, on a voice or an oscillator', () => {
    const voice = normalizeVoice({
      ...baseVoice(),
      pan: '0~2',
      oscillators: [{ type: 'sine', detune: '0~5', gain: 1, octave: 0 }],
    });
    expect(voice.pan).toEqual({ random: true, base: 0, range: 2 });
    expect(voice.oscillators[0].detune).toEqual({ random: true, base: 0, range: 5 });
  });

  test('pan defaults to 0 (center) on a voice and on an oscillator', () => {
    const voice = normalizeVoice(baseVoice());
    expect(voice.pan).toBe(0);
    expect(voice.oscillators[0].pan).toBe(0);
  });

  test('an unknown oscillator waveform falls back to sine, with a warning, instead of an invalid type', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({ ...baseVoice(), oscillators: [{ type: 'supersaw', detune: 0, gain: 1, octave: 0 }] }),
    );

    expect(voice.oscillators[0].type).toBe('sine');
    expect(warnings.some((w) => w.includes('unknown waveform "supersaw"'))).toBe(true);
  });

  test('an unknown key on a voice or an oscillator is warned about but does not stop normalization', () => {
    const { result: voice, warnings } = withWarnCaptured(() =>
      normalizeVoice({
        ...baseVoice(),
        reverb: 0.5, // not a real voice-level field (that's an effect *type*, not a voice key)
        oscillators: [{ type: 'sine', detune: 0, gain: 1, octave: 0, portamento: 0.1 }],
      }),
    );

    expect(voice.name).toBe('Test'); // normalization still completed
    expect(warnings.some((w) => w.includes('voice "Test"') && w.includes('unknown "reverb"'))).toBe(true);
    expect(warnings.some((w) => w.includes('unknown "portamento"'))).toBe(true);
  });
});

test.describe("AudioEngine's envelope/effects graph (fake AudioContext -- no real audio needed)", () => {
  // A minimal stand-in for the handful of Web Audio node methods _playNote/
  // _releaseNote actually call, recording every automation call and every
  // connect() so a test can assert on scheduling and graph shape without a
  // real AudioContext. Every created node is also collected onto the ctx in
  // creation order, so a test can refer to "the voice's own filter" vs.
  // "this oscillator's own filter" by index instead of threading references
  // through by hand.
  function fakeParam() {
    const calls = [];
    return {
      calls,
      setValueAtTime(value, time) {
        calls.push({ op: 'set', value, time });
      },
      linearRampToValueAtTime(value, time) {
        calls.push({ op: 'ramp', value, time });
      },
      cancelScheduledValues(time) {
        calls.push({ op: 'cancel', time });
      },
    };
  }

  function connect(target) {
    this.connectedTo = this.connectedTo || [];
    this.connectedTo.push(target);
  }

  function fakeCtx() {
    const ctx = {
      sampleRate: 44100,
      gains: [],
      filters: [],
      oscillators: [],
      panners: [],
      convolvers: [],
      delays: [],
      shapers: [],
    };
    ctx.createGain = () => {
      const node = { gain: fakeParam(), connect };
      ctx.gains.push(node);
      return node;
    };
    ctx.createBiquadFilter = () => {
      const node = { type: null, frequency: fakeParam(), Q: { value: 1 }, gain: { value: 0 }, connect };
      ctx.filters.push(node);
      return node;
    };
    ctx.createOscillator = () => {
      const node = {
        detune: { value: 0 },
        frequency: { value: 0 },
        connect,
        start(t) {
          this.startedAt = t;
        },
        stop(t) {
          this.stoppedAt = t;
        },
      };
      ctx.oscillators.push(node);
      return node;
    };
    ctx.createStereoPanner = () => {
      const node = { pan: { value: 0 }, connect };
      ctx.panners.push(node);
      return node;
    };
    ctx.createConvolver = () => {
      const node = { buffer: null, connect };
      ctx.convolvers.push(node);
      return node;
    };
    ctx.createDelay = () => {
      const node = { delayTime: { value: 0 }, connect };
      ctx.delays.push(node);
      return node;
    };
    ctx.createWaveShaper = () => {
      const node = { curve: null, oversample: null, connect };
      ctx.shapers.push(node);
      return node;
    };
    ctx.createBuffer = (channels, length, rate) => ({
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    });
    return ctx;
  }

  function fakeEngine() {
    const engine = new AudioEngine();
    engine.ctx = fakeCtx();
    engine.master = { connect };
    return engine;
  }

  test('a level with no envelope of its own is just held at a constant value, not tracked for release', () => {
    const engine = fakeEngine();
    const voice = {
      pan: 0,
      envelope: { attack: 0.01, decay: 0.02, sustain: 0.5, release: 0.1 },
      effects: [{ type: 'lowpass', frequency: 1200, keyTrack: 0, envAmount: 0 }], // no envelope
      oscillators: [{ type: 'sine', detune: 0, gain: 0.8, octave: 0, pan: 0, effects: [] }], // no envelope
    };

    const note = engine._playNote(60, voice, 10, 1);

    expect(note.inner).toEqual([]); // nothing but the voice's own (outer) envelope to release
    expect(engine.ctx.filters[0].frequency.calls).toEqual([{ op: 'set', value: 1200, time: 10 }]);
    expect(engine.ctx.gains[1].gain.calls).toEqual([{ op: 'set', value: 0.8, time: 10 }]); // gains[0] is noteGain, gains[1] the oscillator's
  });

  test('an oscillator-level and effect-level envelope each land on their own AudioParam, in series with the voice above them', () => {
    const engine = fakeEngine();
    const voice = {
      pan: 0,
      envelope: { attack: 0, decay: 1, sustain: 0.5, release: 1 },
      effects: [
        { type: 'lowpass', frequency: 2000, keyTrack: 0, envAmount: 0, envelope: { attack: 0, decay: 1, sustain: 0.25, release: 1 } },
      ],
      oscillators: [
        {
          type: 'sawtooth',
          detune: 0,
          gain: 1,
          octave: 0,
          pan: 0,
          envelope: { attack: 0, decay: 1, sustain: 0.5, release: 1 },
          effects: [
            { type: 'lowpass', frequency: 4000, keyTrack: 0, envAmount: 0, envelope: { attack: 0, decay: 1, sustain: 0.5, release: 1 } },
          ],
        },
      ],
    };

    const note = engine._playNote(60, voice, 10, 1);
    const { gains, filters, oscillators, panners } = engine.ctx;

    // Three independent automations besides the voice's own outer one: the
    // oscillator's gain, the oscillator's own filter, and the voice's filter.
    expect(note.inner).toHaveLength(3);
    expect(note.outer.param).toBe(gains[0].gain);
    expect(note.inner.map((env) => env.param)).toEqual(
      expect.arrayContaining([gains[1].gain, filters[1].frequency, filters[0].frequency]),
    );

    // Graph shape: osc -> oscGain -> its own pan -> its own filter -> the
    // voice's filter -> noteGain -> the voice's own pan -> master. This is
    // *why* nesting envelopes compounds without any math of our own --
    // WebAudio multiplies/chains nodes wired in series on its own.
    expect(oscillators[0].connectedTo).toEqual([gains[1]]);
    expect(gains[1].connectedTo).toEqual([panners[1]]);
    expect(panners[1].connectedTo).toEqual([filters[1]]);
    expect(filters[1].connectedTo).toEqual([filters[0]]);
    expect(filters[0].connectedTo).toEqual([gains[0]]);
    expect(gains[0].connectedTo).toEqual([panners[0]]);
    expect(panners[0].connectedTo).toEqual([engine.master]);
  });

  test('release: each envelope releases at its own rate, except the outer one which uses whatever voice is passed at release time', () => {
    const engine = fakeEngine();
    const attackVoice = {
      pan: 0,
      envelope: { attack: 0, decay: 0, sustain: 1, release: 2 },
      effects: [],
      oscillators: [
        {
          type: 'sine',
          detune: 0,
          gain: 1,
          octave: 0,
          pan: 0,
          envelope: { attack: 0, decay: 0, sustain: 1, release: 0.5 },
          effects: [],
        },
      ],
    };
    const note = engine._playNote(60, attackVoice, 10, 1);

    // Release with a *different* voice's envelope than the one this note attacked with.
    const releaseVoice = { envelope: { attack: 0, decay: 0, sustain: 1, release: 5 } };
    engine._releaseNote(note, releaseVoice, 20);

    const lastRamp = (calls) => calls.filter((c) => c.op === 'ramp').at(-1);
    expect(lastRamp(note.outer.param.calls)).toEqual({ op: 'ramp', value: 0.0001, time: 25 }); // 20 + releaseVoice's 5s, not attackVoice's 2s
    expect(lastRamp(note.inner[0].param.calls)).toEqual({ op: 'ramp', value: 0.0001, time: 20.5 }); // 20 + its own captured 0.5s

    // Oscillators stop once the slowest of all of these has fully released.
    expect(note.oscs[0].node.stoppedAt).toBeCloseTo(20 + 5 + 0.02, 10);
  });

  test('a filter\'s cutoff scales with keyTrack, measured from KEY_TRACK_REFERENCE_MIDI (middle C)', () => {
    const engine = fakeEngine();
    const voiceWith = (keyTrack) => ({
      pan: 0,
      envelope: { attack: 0, decay: 0, sustain: 1, release: 0 },
      effects: [{ type: 'lowpass', frequency: 1000, keyTrack, envAmount: 0 }],
      oscillators: [{ type: 'sine', detune: 0, gain: 1, octave: 0, pan: 0, effects: [] }],
    });
    const cutoffAt = (midi, keyTrack) => {
      engine._playNote(midi, voiceWith(keyTrack), 0, 1);
      return engine.ctx.filters.at(-1).frequency.calls[0].value;
    };

    expect(cutoffAt(72, 1.0)).toBeCloseTo(2000, 6); // an octave above middle C, full tracking -> cutoff doubles
    expect(cutoffAt(72, 0)).toBeCloseTo(1000, 6); // no tracking -> cutoff stays put regardless of pitch
    expect(cutoffAt(72, 0.5)).toBeCloseTo(1000 * Math.SQRT2, 6); // half tracking -> half that octave's worth of scaling
    expect(cutoffAt(48, 1.0)).toBeCloseTo(500, 6); // an octave *below* middle C, full tracking -> cutoff halves
  });

  test('envAmount sweeps the cutoff above its keyTracked base, and release settles back at that base rather than near-0Hz', () => {
    const engine = fakeEngine();
    const voice = {
      pan: 0,
      envelope: { attack: 0, decay: 0, sustain: 1, release: 5 },
      effects: [
        { type: 'lowpass', frequency: 1000, keyTrack: 0, envAmount: 500, envelope: { attack: 0, decay: 1, sustain: 0.5, release: 2 } },
      ],
      oscillators: [{ type: 'sine', detune: 0, gain: 1, octave: 0, pan: 0, effects: [] }],
    };
    const note = engine._playNote(60, voice, 10, 1);
    const filterEnv = note.inner[0];
    expect(filterEnv.floor).toBe(1000); // the unswept, keyTracked base
    expect(filterEnv.level).toBe(1500); // base 1000 + envAmount 500
    expect(filterEnv.sustainLevel).toBe(1250); // floor + (peak - floor) * sustain

    engine._releaseNote(note, voice, 20);
    const lastRamp = (calls) => calls.filter((c) => c.op === 'ramp').at(-1);
    expect(lastRamp(filterEnv.param.calls)).toEqual({ op: 'ramp', value: 1000, time: 22 }); // floors at 1000, not ~0Hz
  });

  test('pan sets a StereoPannerNode at both the voice level and each oscillator\'s own level', () => {
    const engine = fakeEngine();
    const voice = {
      pan: 0.3,
      envelope: { attack: 0, decay: 0, sustain: 1, release: 0 },
      effects: [],
      oscillators: [{ type: 'sine', detune: 0, gain: 1, octave: 0, pan: -0.6, effects: [] }],
    };
    engine._playNote(60, voice, 0, 1);
    const { panners } = engine.ctx;
    expect(panners[0].pan.value).toBe(0.3);
    expect(panners[1].pan.value).toBe(-0.6);
  });

  test('a "base~range" field and a randomize effect both resolve once per note, the randomize effect layering on top of its own field\'s resolved value', () => {
    const engine = fakeEngine();
    withFixedRandom(1, () => {
      // Math.random() pinned to 1 -> every roll lands at its base+range edge.
      const voice = {
        pan: parseNumeric('0~1'),
        envelope: { attack: 0, decay: 0, sustain: 1, release: 0 },
        effects: [{ type: 'randomize', property: 'pan', range: 2 }],
        oscillators: [{ type: 'sine', detune: parseNumeric('0~5'), gain: 1, octave: 0, pan: 0, effects: [] }],
      };
      engine._playNote(60, voice, 0, 1);
    });

    // voice.pan '0~1' resolves to 1, then the voice's own randomize effect
    // (range 2) overrides it again, around that resolved value: 1 + 2 = 3.
    expect(engine.ctx.panners[0].pan.value).toBe(3);
    expect(engine.ctx.oscillators[0].detune.value).toBe(5); // 0 + 5, untouched by any randomize effect
  });

  test.describe('the newer effect types build the Web Audio nodes they document', () => {
    function noteWithEffect(effect) {
      return {
        pan: 0,
        envelope: { attack: 0, decay: 0, sustain: 1, release: 0 },
        effects: [effect],
        oscillators: [{ type: 'sine', detune: 0, gain: 1, octave: 0, pan: 0, effects: [] }],
      };
    }

    test('reverb builds a ConvolverNode fed a synthetic stereo impulse response, mixed dry/wet', () => {
      const engine = fakeEngine();
      engine._playNote(60, noteWithEffect({ type: 'reverb', decay: 1, wet: 0.4 }), 0, 1);
      expect(engine.ctx.convolvers).toHaveLength(1);
      expect(engine.ctx.convolvers[0].buffer.numberOfChannels).toBe(2);
      expect(engine.ctx.convolvers[0].buffer.length).toBe(engine.ctx.sampleRate); // 1s of decay
    });

    test('tremolo drives a gain node from an LFO oscillator, registered as an aux oscillator for release to stop', () => {
      const engine = fakeEngine();
      const note = engine._playNote(60, noteWithEffect({ type: 'tremolo', rate: 6, depth: 0.4 }), 0, 1);
      expect(note.aux).toHaveLength(1);
      // The LFO is built before the note's own oscillator (voice-level
      // effects are built before oscillators in _playNote), so it's first.
      expect(engine.ctx.oscillators[0].frequency.value).toBe(6);
      expect(note.aux[0]).toBe(engine.ctx.oscillators[0]);
    });

    test('delay builds a DelayNode with a feedback loop back into itself', () => {
      const engine = fakeEngine();
      engine._playNote(60, noteWithEffect({ type: 'delay', time: 0.3, feedback: 0.5, wet: 0.3 }), 0, 1);
      expect(engine.ctx.delays).toHaveLength(1);
      const delay = engine.ctx.delays[0];
      expect(delay.delayTime.value).toBe(0.3);
      // The delay's own output feeds both its feedback loop (wired first,
      // see _createDelayNode) and the wet-mix gain (wired second, inside
      // _wetDryMix) -- two connections out, not one.
      const [feedback] = delay.connectedTo;
      expect(feedback.gain.value).toBe(0.5);
      expect(feedback.connectedTo).toEqual([delay]); // ... which loops straight back into it
    });

    test('distortion builds a WaveShaperNode with a non-empty curve', () => {
      const engine = fakeEngine();
      engine._playNote(60, noteWithEffect({ type: 'distortion', amount: 30, wet: 1 }), 0, 1);
      expect(engine.ctx.shapers).toHaveLength(1);
      expect(engine.ctx.shapers[0].curve).toBeInstanceOf(Float32Array);
      expect(engine.ctx.shapers[0].oversample).toBe('4x');
    });
  });
});
