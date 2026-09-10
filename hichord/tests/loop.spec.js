// Loop recorder: hold Space to record, release to start looping playback,
// tap Space alone (nothing held) to cancel and drop it. Real timing (no
// fake clock) since the scheduler
// (loop.js) drives itself off the real AudioContext clock via setInterval,
// per its own module comment -- so the tests do too, rather than faking it.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { expectedChordFrequencies } from './support/expected-audio.js';
import { AudioEngine, VOICES, DEFAULT_VOICE_INDEX } from '../js/audio.js';
import { LoopRecorder } from '../js/loop.js';
import { Tempo } from '../js/tempo.js';

test.describe('AudioEngine._envelopeValueAt (pure logic, no browser/audio needed)', () => {
  // Regression coverage for audio.js's _releaseNote, which reads the
  // envelope analytically (via this method) rather than AudioParam.value --
  // see its comment for why. _envelopeValueAt must reproduce whatever
  // _playNote's own ramps would produce at any given time, independent of
  // the real clock.
  const engine = new AudioEngine();
  const note = {
    attackStart: 10,
    attackEnd: 10.1, // 0.1s attack
    decayEnd: 10.3, // 0.2s decay
    level: 1,
    sustainLevel: 0.6,
  };

  test('before the attack starts, the level is 0', () => {
    expect(engine._envelopeValueAt(note, 9)).toBe(0);
    expect(engine._envelopeValueAt(note, 10)).toBe(0);
  });

  test('mid-attack, the level is partway to the peak', () => {
    expect(engine._envelopeValueAt(note, 10.05)).toBeCloseTo(0.5, 5);
  });

  test('mid-decay, the level is partway from the peak down to sustain', () => {
    expect(engine._envelopeValueAt(note, 10.2)).toBeCloseTo(0.8, 5);
  });

  test('once decay finishes, the level holds at sustain indefinitely', () => {
    expect(engine._envelopeValueAt(note, 10.3)).toBeCloseTo(0.6, 5);
    expect(engine._envelopeValueAt(note, 50)).toBeCloseTo(0.6, 5);
  });
});

test.describe('LoopRecorder note quantizing (pure logic, no browser/audio needed)', () => {
  // A fake engine driven by a manually-advanced clock, so onset/release
  // timing can be set precisely instead of racing real audio/JS timing.
  function makeRecorder(quantizeDivision) {
    const engine = { ctx: { currentTime: 0 }, voice: 'test-voice', unlock() {}, stopChord() {}, playChord() {} };
    const recorder = new LoopRecorder(engine, new Tempo(120, quantizeDivision), { enabled: false });
    return { recorder, engine };
  }

  test('a short note keeps its actual duration, instead of the release quantizing onto the same instant as the onset', () => {
    // 1/4 note grid at 120bpm = 0.5s steps.
    const { recorder, engine } = makeRecorder(4);
    recorder.startRecording();
    engine.ctx.currentTime = 0.24; // nearer the 0 grid line than 0.5
    recorder.recordEvent('on', [60]);
    engine.ctx.currentTime = 0.26; // a real 20ms note; independently quantized this would also land on 0
    recorder.recordEvent('off', null);

    const [onEvent, offEvent] = recorder.events;
    expect(onEvent.t).toBe(0); // onset still snaps to the grid
    expect(offEvent.t).toBeCloseTo(0.02, 5); // but the held duration survives, not collapsed to 0
  });
});

test('holding the record key with a chord held actually records events', async ({ page }) => {
  // Asserts recorder.events/state directly rather than only inferring "it
  // must have recorded something" from the UI classes the more thorough
  // test below also checks.
  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(120);
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  const { events, state } = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return { events: mod.recorder.events, state: mod.recorder.state };
  });
  expect(events.length).toBeGreaterThan(0);
  expect(state).toBe('playing');
});

test('recording a note then releasing Space loops it', async ({ page }) => {
  const recordBtn = page.locator('[data-action="record"]');
  const loopDisplay = page.locator('[data-display="loop"]');

  await holdKey(page, 'Space');
  await expect(recordBtn).toHaveClass(/recording/);
  await expect(loopDisplay).toHaveText('Recording…');

  // Release Space *while J is still held* -- the recorded chord's 'on' event
  // has no matching 'off' within the recording. Per loop.js's stopRecording()
  // comment, it appends a synthetic 'off' right at the loop length instead of
  // leaving it dangling, so the note sounds for (almost) the entire loop.
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  await expect(recordBtn).toHaveClass(/playing/);
  await expect(loopDisplay).toHaveText('Looping');

  // Loop length is snapped to the nearest whole beat at 120bpm (minimum
  // 0.5s, see loop.js); 2s comfortably covers at least one full replay of a
  // short loop.
  const mark = await markAudio(page);
  await page.waitForTimeout(2000);
  const replayed = (await audioEventsSince(page, mark)).filter((e) => e.type === 'start');
  expect(replayed.length).toBeGreaterThan(0);
});

test('loop length snaps to the nearest beat, not always rounding up', async ({ page }) => {
  // 0.6s is closer to 1 beat (0.5s) than to 2 beats (1.0s) at 120bpm -- a
  // regression to always-round-up (the previous, effectively-a-no-op "fix")
  // would land on 1.0s instead. Loop the hold slightly past the target
  // beat, matching how someone actually releasing Space tends to overshoot
  // rather than undershoot.
  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(600);
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  const loopLength = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return mod.recorder.loopLength;
  });
  expect(loopLength).toBe(0.5);
});

test('tapping Space while a loop is playing cancels and clears it, not just stops scheduling it', async ({
  page,
}) => {
  const loopDisplay = page.locator('[data-display="loop"]');

  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');
  await expect(loopDisplay).toHaveText('Looping');

  // Let the loop actually start sounding at least once before cancelling it,
  // so there's a note genuinely active on the 'loop' voice to prove gets cut.
  await page.waitForTimeout(700);

  const mark = await markAudio(page);
  await holdKey(page, 'Space'); // a tap: down and immediately up, no chord held in between
  await releaseKey(page, 'Space');
  await expect(loopDisplay).toHaveText('No loop');

  const events = await audioEventsSince(page, mark);
  // Whatever the loop last triggered must be cut immediately, not left
  // ringing just because nothing new is scheduled to replace it.
  expect(events.some((e) => e.type === 'stop')).toBe(true);

  const afterMark = await markAudio(page);
  await page.waitForTimeout(1200);
  const afterTap = (await audioEventsSince(page, afterMark)).filter((e) => e.type === 'start');
  expect(afterTap).toHaveLength(0); // scheduler is actually stopped, not just hidden by the UI
});

test('cycling voices after recording reshapes live play but not the loop already laid down', async ({ page }) => {
  await page.click('[data-action="bass-toggle"]'); // bass defaults on -- off here so this stays plain chord math

  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  // Switch voice *after* the loop was recorded (default voice at record
  // time is whatever DEFAULT_VOICE_INDEX names -- derived, not hardcoded,
  // so this doesn't silently drift out of sync with VOICES again the next
  // time a preset is added/reordered, the way this test previously assumed
  // "next after the default" is always 'Soft Pad').
  const nextVoiceIndex = (DEFAULT_VOICE_INDEX + 1) % VOICES.length;
  await page.click('[data-action="voice-next"]');
  await expect(page.locator('[data-display="voice"]')).toHaveText(VOICES[nextVoiceIndex].name);

  // Loop length is 0.5s (one beat at 120bpm, see the loop-length test above);
  // 1.2s spans more than one replay, so dedupe before comparing -- it's the
  // *set* of frequencies used that must match the recorded voice, not the
  // count. Dedupe the expected side too: the chord's own
  // root-doubled-an-octave-up note (see audio.js's buildChord)
  // coincidentally shares a frequency with a lower note's own octave-up
  // harmonic partial, so the raw expected list isn't pairwise-distinct here
  // even within a single chord instance.
  const mark = await markAudio(page);
  await page.waitForTimeout(1200);
  const replayed = [
    ...new Set(
      (await audioEventsSince(page, mark))
        .filter((e) => e.type === 'start')
        .map((e) => e.freq),
    ),
  ].sort((a, b) => a - b);
  const expected = [...new Set(expectedChordFrequencies(0, 0, 'neutral', DEFAULT_VOICE_INDEX))].sort((a, b) => a - b);
  expect(replayed).toEqual(expected); // still the voice in effect when it was recorded, not the now-current next one
});

test('a chord held live keeps sounding on top of loop playback', async ({ page }) => {
  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'j');
  await page.waitForTimeout(100);
  await releaseKey(page, 'Space');

  const mark = await markAudio(page);
  await holdKey(page, 'o'); // degree 3, IV -- live, independent of whatever the loop is doing
  const startedLive = (await audioEventsSince(page, mark)).filter((e) => e.type === 'start');
  expect(startedLive.length).toBeGreaterThan(0);

  await releaseKey(page, 'o');
});

test('a note that follows a long silent stretch in the loop still gets its full attack on every repeat', async ({
  page,
}) => {
  // Regression case: a gap of dead air followed by a burst of quick notes at
  // a very fine quantize grid -- reported as the first note after the gap
  // sounding late and without an attack, identically on every repeat. See
  // audio.js's AudioEngine._notBefore for the fix (never schedule a ramp
  // whose endpoints are already behind the audio clock) and fixtures.js's
  // 'param' probe events this asserts against.
  await page.click('[data-action="quantize-up"]'); // 1/32 -> 1/64
  await page.click('[data-action="quantize-up"]'); // 1/64 -> 1/128
  await expect(page.locator('[data-display="quantize"]')).toHaveText('1/128');

  // A faster tempo keeps the loop (and so this test) short while still
  // exercising the same fine 1/128 grid the report used -- quantize
  // resolution is a division of the beat, independent of bpm.
  const bpmInput = page.locator('[data-display="bpm"]');
  await bpmInput.click();
  await bpmInput.fill('240');
  await bpmInput.press('Enter');
  await expect(bpmInput).toHaveValue('240');

  await holdKey(page, 'Space');
  await page.waitForTimeout(1000); // ~4 beats of dead air at 240bpm
  for (const key of ['j', 'i', 'k', 'o']) {
    await holdKey(page, key);
    await page.waitForTimeout(40);
    await releaseKey(page, key);
    await page.waitForTimeout(20);
  }
  await releaseKey(page, 'Space');
  await expect(page.locator('[data-display="loop"]')).toHaveText('Looping');

  const mark = await markAudio(page);
  await page.waitForTimeout(4000); // several full repeats of the (short, fast-tempo) loop
  const paramEvents = (await audioEventsSince(page, mark)).filter((e) => e.type === 'param');
  expect(paramEvents.length).toBeGreaterThan(0); // sanity check the probe actually saw playback happen
  const late = paramEvents.filter((e) => e.scheduledFor < e.calledAt);
  expect(late).toEqual([]);
});
