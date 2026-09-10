// The voice/oscillator/effect envelope schema (pure logic, no browser/audio
// needed): parseEnvelope's shorthand-string parsing, and AudioEngine's own
// graph-building -- that every level's envelope lands on its own AudioParam,
// wired in series with whatever contains it, which is what lets nested
// envelopes compound without this module doing any multiplication itself.
// See audio.js's own comment above VOICES for the schema this exercises.
import { test, expect } from './support/fixtures.js';
import { AudioEngine, parseEnvelope } from '../js/audio.js';

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

test.describe("AudioEngine's envelope/effects graph (fake AudioContext -- no real audio needed)", () => {
  // A minimal stand-in for the handful of Web Audio node methods _playNote/
  // _releaseNote actually call, recording every automation call and every
  // connect() so a test can assert on scheduling and graph shape without a
  // real AudioContext. Every created node is also collected onto the ctx
  // (`gains`, `filters`, `oscillators`) in creation order, so a test can
  // refer to "the voice's own filter" vs. "this oscillator's own filter" by
  // index instead of threading references through by hand.
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
    const ctx = { gains: [], filters: [], oscillators: [] };
    ctx.createGain = () => {
      const node = { gain: fakeParam(), connect };
      ctx.gains.push(node);
      return node;
    };
    ctx.createBiquadFilter = () => {
      const node = { frequency: fakeParam(), connect };
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
      envelope: { attack: 0.01, decay: 0.02, sustain: 0.5, release: 0.1 },
      effects: [{ type: 'filter', frequency: 1200 }], // no envelope
      oscillators: [{ type: 'sine', detune: 0, gain: 0.8, octave: 0, effects: [] }], // no envelope
    };

    const note = engine._playNote(60, voice, 10, 1);

    expect(note.inner).toEqual([]); // nothing but the voice's own (outer) envelope to release
    expect(engine.ctx.filters[0].frequency.calls).toEqual([{ op: 'set', value: 1200, time: 10 }]);
    expect(engine.ctx.gains[1].gain.calls).toEqual([{ op: 'set', value: 0.8, time: 10 }]); // gains[0] is noteGain, gains[1] the oscillator's
  });

  test('an oscillator-level and effect-level envelope each land on their own AudioParam, in series with the voice above them', () => {
    const engine = fakeEngine();
    const voice = {
      envelope: { attack: 0, decay: 1, sustain: 0.5, release: 1 },
      effects: [{ type: 'filter', frequency: 2000, envelope: { attack: 0, decay: 1, sustain: 0.25, release: 1 } }],
      oscillators: [
        {
          type: 'sawtooth',
          detune: 0,
          gain: 1,
          octave: 0,
          envelope: { attack: 0, decay: 1, sustain: 0.5, release: 1 },
          effects: [{ type: 'filter', frequency: 4000, envelope: { attack: 0, decay: 1, sustain: 0.5, release: 1 } }],
        },
      ],
    };

    const note = engine._playNote(60, voice, 10, 1);
    const { gains, filters, oscillators } = engine.ctx;

    // Three independent automations besides the voice's own outer one: the
    // oscillator's gain, the oscillator's own filter, and the voice's filter.
    expect(note.inner).toHaveLength(3);
    expect(note.outer.param).toBe(gains[0].gain);
    expect(note.inner.map((env) => env.param)).toEqual(
      expect.arrayContaining([gains[1].gain, filters[1].frequency, filters[0].frequency]),
    );

    // Graph shape: osc -> oscGain -> its own filter -> the voice's filter -> noteGain -> master.
    // This is *why* nesting envelopes compounds without any math of our
    // own -- WebAudio multiplies/chains nodes wired in series on its own.
    expect(oscillators[0].connectedTo).toEqual([gains[1]]);
    expect(gains[1].connectedTo).toEqual([filters[1]]);
    expect(filters[1].connectedTo).toEqual([filters[0]]);
    expect(filters[0].connectedTo).toEqual([gains[0]]);
    expect(gains[0].connectedTo).toEqual([engine.master]);
  });

  test('release: each envelope releases at its own rate, except the outer one which uses whatever voice is passed at release time', () => {
    const engine = fakeEngine();
    const attackVoice = {
      envelope: { attack: 0, decay: 0, sustain: 1, release: 2 },
      effects: [],
      oscillators: [
        { type: 'sine', detune: 0, gain: 1, octave: 0, envelope: { attack: 0, decay: 0, sustain: 1, release: 0.5 }, effects: [] },
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
});
