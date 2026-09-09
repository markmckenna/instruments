// Tempo (bpm + quantize grid, shared by the loop recorder and the
// metronome click -- see tempo.js's module comment), its on-screen
// controls, and their +/- and {/} keyboard shortcuts.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { Tempo } from '../js/tempo.js';
import { chordMidiNotes } from './support/expected-audio.js';

test.describe('Tempo (pure logic, no browser/audio needed)', () => {
  test('bpm is clamped to the 40-240 range', () => {
    const tempo = new Tempo();
    expect(tempo.setBpm(1000)).toBe(240);
    expect(tempo.setBpm(-50)).toBe(40);
    expect(tempo.setBpm(140)).toBe(140);
  });

  test('quantize doubles/halves within 1 (whole note) to 1/128', () => {
    const tempo = new Tempo(120, 32);
    expect(tempo.doubleQuantize()).toBe(64);
    expect(tempo.doubleQuantize()).toBe(128);
    expect(tempo.doubleQuantize()).toBe(128); // clamped, not 256
    tempo.quantizeDivision = 32;
    expect(tempo.halveQuantize()).toBe(16);
    expect(tempo.halveQuantize()).toBe(8);
    expect(tempo.halveQuantize()).toBe(4);
    expect(tempo.halveQuantize()).toBe(2);
    expect(tempo.halveQuantize()).toBe(1);
    expect(tempo.halveQuantize()).toBe(1); // clamped, not 1/2
  });

  test('quantize() snaps to the nearest grid line at the current bpm/division', () => {
    const tempo = new Tempo(120, 32); // beat = 0.5s, 32nd note = 0.5/8 = 0.0625s
    expect(tempo.quantize(0.09)).toBeCloseTo(0.0625, 5); // nearer to 1 step than 2
    expect(tempo.quantize(0.12)).toBeCloseTo(0.125, 5); // nearer to 2 steps than 1
    expect(tempo.quantize(0)).toBe(0);
  });
});

test('page loads with the documented tempo defaults', async ({ page }) => {
  await expect(page.locator('[data-display="bpm"]')).toHaveText('120');
  await expect(page.locator('[data-display="quantize"]')).toHaveText('1/32');
  await expect(page.locator('[data-action="click-toggle"]')).not.toHaveClass(/active/);
});

test('the bpm control raises/lowers the displayed tempo', async ({ page }) => {
  const bpmDisplay = page.locator('[data-display="bpm"]');
  await page.click('[data-action="bpm-up"]');
  await page.click('[data-action="bpm-up"]');
  await expect(bpmDisplay).toHaveText('122');
  await page.click('[data-action="bpm-down"]');
  await expect(bpmDisplay).toHaveText('121');
});

test('the quantize control halves/doubles the displayed resolution', async ({ page }) => {
  const quantizeDisplay = page.locator('[data-display="quantize"]');
  await page.click('[data-action="quantize-down"]'); // coarser: 1/32 -> 1/16
  await expect(quantizeDisplay).toHaveText('1/16');
  await page.click('[data-action="quantize-up"]'); // finer: 1/16 -> 1/32
  await page.click('[data-action="quantize-up"]'); // finer: 1/32 -> 1/64
  await expect(quantizeDisplay).toHaveText('1/64');
});

test('the bpm control also responds to the +/- keyboard shortcut', async ({ page }) => {
  const bpmDisplay = page.locator('[data-display="bpm"]');
  await holdKey(page, '-');
  await releaseKey(page, '-');
  await expect(bpmDisplay).toHaveText('119');
  await holdKey(page, '+');
  await releaseKey(page, '+');
  await holdKey(page, '+');
  await releaseKey(page, '+');
  await expect(bpmDisplay).toHaveText('121');
});

// { and } are Shift+[ / Shift+] on a physical keyboard, not distinct keys --
// Playwright's keyboard.down() dispatches the bare code without inferring a
// modifier from the character, so these hold a real Shift the same way a
// user's finger would.
async function holdShiftedBracket(page, code) {
  await page.keyboard.down('Shift');
  await holdKey(page, code);
  await releaseKey(page, code);
  await page.keyboard.up('Shift');
}

test('the quantize control also responds to the {/} keyboard shortcut', async ({ page }) => {
  const quantizeDisplay = page.locator('[data-display="quantize"]');
  await holdShiftedBracket(page, 'BracketLeft'); // coarser: 1/32 -> 1/16
  await expect(quantizeDisplay).toHaveText('1/16');
  await holdShiftedBracket(page, 'BracketRight'); // finer: 1/16 -> 1/32
  await expect(quantizeDisplay).toHaveText('1/32');
});

test('{ and } -- with a chord held, they quantize instead of octave-shifting it', async ({ page }) => {
  // Regression guard for input.js's keydown handler, where BracketLeft/
  // BracketRight do double duty (see pressOctaveKey vs. changeQuantize):
  // holding a chord key at the same moment is exactly the case that would
  // otherwise shift its pitch (see octave.spec.js).
  await holdKey(page, 'j');

  const mark = await markAudio(page);
  await holdShiftedBracket(page, 'BracketRight');
  const events = await audioEventsSince(page, mark);

  expect(events).toHaveLength(0); // no octave shift fired
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C'); // pitch unchanged
  await expect(page.locator('[data-display="quantize"]')).toHaveText('1/64'); // finer: 1/32 -> 1/64

  await releaseKey(page, 'j');
});

test('recorded loop events snap to the quantize grid, live play is never touched', async ({ page }) => {
  // Coarsen the grid so a deliberately-off-beat press lands somewhere
  // clearly different from where it was actually pressed, making the snap
  // easy to detect: 1/32 -> 1/16 -> 1/8 -> 1/4 note. A quarter note *is* the
  // beat at 120bpm, so this grid's step is 0.5s.
  await page.click('[data-action="quantize-down"]');
  await page.click('[data-action="quantize-down"]');
  await page.click('[data-action="quantize-down"]');
  await expect(page.locator('[data-display="quantize"]')).toHaveText('1/4');

  await holdKey(page, 'Space');
  await page.waitForTimeout(220); // press J well off the 0.5s grid (nearer 0 than 0.5)
  await holdKey(page, 'j');
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  const events = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return mod.recorder.events;
  });
  const onEvent = events.find((e) => e.type === 'on');
  // Actually pressed ~0.22s in -- nearer the grid line at 0 than the one at
  // 0.5s, so quantizing should snap it all the way down to 0, not leave it
  // at the raw, un-snapped timestamp.
  expect(onEvent.t).toBe(0);
});

test('rapid chord changes at a coarse quantize grid record every chord, none silently dropped', async ({
  page,
}) => {
  // Coarsen to 1/4 -- collisions onto the same quantized instant are common
  // here, which is exactly where silently dropping a note on collision
  // (see loop.js's recordEvent comment) would erase a chord that was
  // genuinely played.
  await page.click('[data-action="quantize-down"]');
  await page.click('[data-action="quantize-down"]');
  await page.click('[data-action="quantize-down"]');
  await expect(page.locator('[data-display="quantize"]')).toHaveText('1/4');

  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(20);
  await releaseKey(page, 'j');
  await holdKey(page, 'o');
  await page.waitForTimeout(20);
  await releaseKey(page, 'o');
  await holdKey(page, 'p');
  await page.waitForTimeout(300);
  await releaseKey(page, 'Space');
  await releaseKey(page, 'p');

  const events = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return mod.recorder.events;
  });
  const recordedNotes = new Set(events.flatMap((e) => e.notes || []));
  const played = [
    ...chordMidiNotes(0, 0, 'neutral'), // J
    ...chordMidiNotes(0, 3, 'neutral'), // O
    ...chordMidiNotes(0, 5, 'neutral'), // P
  ];
  for (const note of played) expect(recordedNotes.has(note)).toBe(true);
});

test('loop playback phase-locks to a running click, not to whenever the record key was released', async ({
  page,
}) => {
  await page.click('[data-action="click-toggle"]');
  await page.waitForTimeout(130); // let the click's own phase get going

  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(370); // a deliberately not-on-a-beat hold duration
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  const { loopStart, clickStart, beatSeconds } = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return {
      loopStart: mod.recorder._loopStartCtxTime,
      clickStart: mod.metronome._startCtxTime,
      beatSeconds: mod.tempo.beatSeconds,
    };
  });
  const beatsSinceClickStart = (loopStart - clickStart) / beatSeconds;
  // Should land on a whole beat relative to the click's own phase -- not an
  // arbitrary offset from whenever Space happened to be released, which is
  // what let a loop's repeat drift out of sync with an ongoing click the
  // longer a recording ran before being stopped.
  expect(beatsSinceClickStart).toBeCloseTo(Math.round(beatsSinceClickStart), 5);
});

test('the metronome click plays a steady click on every beat while enabled', async ({ page }) => {
  const clickBtn = page.locator('[data-action="click-toggle"]');

  const mark = await markAudio(page);
  await clickBtn.click();
  await expect(clickBtn).toHaveClass(/active/);
  await page.waitForTimeout(1100); // 120bpm = 0.5s/beat -> ~2 clicks

  const clicks = (await audioEventsSince(page, mark)).filter((e) => e.type === 'click');
  expect(clicks.length).toBeGreaterThanOrEqual(2);

  const disableMark = await markAudio(page);
  await clickBtn.click();
  await expect(clickBtn).not.toHaveClass(/active/);
  await page.waitForTimeout(600);
  const afterDisable = (await audioEventsSince(page, disableMark)).filter((e) => e.type === 'click');
  expect(afterDisable).toHaveLength(0);
});
