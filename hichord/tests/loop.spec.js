// Loop recorder: hold Tab to record, release to start looping playback,
// Clear loop drops it. Real timing (no fake clock) since the scheduler
// (loop.js) drives itself off the real AudioContext clock via setInterval --
// see DECISIONS.md "Loop recorder" for why.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';

test('recording a note then releasing Tab loops it, and Clear loop stops it', async ({ page }) => {
  const recordBtn = page.locator('[data-action="record"]');
  const loopDisplay = page.locator('[data-display="loop"]');

  await holdKey(page, 'Tab');
  await expect(recordBtn).toHaveClass(/recording/);
  await expect(loopDisplay).toHaveText('Recording…');

  // Release Tab *while J is still held* -- the recorded chord's 'on' event
  // has no matching 'off' within the recording. Per DECISIONS.md ("Recording
  // stopped mid-hold gets a synthetic release at the loop boundary"),
  // stopRecording() appends a synthetic 'off' right at the loop length
  // instead of leaving it dangling, so the note sounds for (almost) the
  // entire loop -- which also makes "is the loop voice currently sounding"
  // deterministic enough for the Clear-loop assertion below.
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'Tab');
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

  const clearMark = await markAudio(page);
  await page.click('[data-action="clear-loop"]');
  await expect(loopDisplay).toHaveText('No loop');
  await expect(recordBtn).not.toHaveClass(/playing/);
  const clearEvents = await audioEventsSince(page, clearMark);
  expect(clearEvents.some((e) => e.type === 'stop')).toBe(true); // whatever the loop last triggered gets released, not left ringing

  const afterClearMark = await markAudio(page);
  await page.waitForTimeout(1200);
  const afterClear = (await audioEventsSince(page, afterClearMark)).filter((e) => e.type === 'start');
  expect(afterClear).toHaveLength(0); // scheduler is actually stopped, not just hidden by the UI
});

test('loop length snaps to the nearest beat, not always rounding up', async ({ page }) => {
  // 0.6s is closer to 1 beat (0.5s) than to 2 beats (1.0s) at 120bpm -- a
  // regression to always-round-up (the previous, effectively-a-no-op "fix")
  // would land on 1.0s instead. Loop the hold slightly past the target
  // beat, matching how someone actually releasing Tab tends to overshoot
  // rather than undershoot.
  await holdKey(page, 'Tab');
  await holdKey(page, 'j');
  await page.waitForTimeout(600);
  await releaseKey(page, 'Tab');
  await releaseKey(page, 'j');

  const loopLength = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return mod.recorder.loopLength;
  });
  expect(loopLength).toBe(0.5);

  await page.click('[data-action="clear-loop"]');
});

test('tapping Tab while a loop is playing cancels and clears it, not just stops scheduling it', async ({
  page,
}) => {
  const loopDisplay = page.locator('[data-display="loop"]');

  await holdKey(page, 'Tab');
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'Tab');
  await releaseKey(page, 'j');
  await expect(loopDisplay).toHaveText('Looping');

  // Let the loop actually start sounding at least once before cancelling it,
  // so there's a note genuinely active on the 'loop' voice to prove gets cut.
  await page.waitForTimeout(700);

  const mark = await markAudio(page);
  await holdKey(page, 'Tab'); // a tap: down and immediately up, no chord held in between
  await releaseKey(page, 'Tab');
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

test('a chord held live keeps sounding on top of loop playback', async ({ page }) => {
  await holdKey(page, 'Tab');
  await holdKey(page, 'j');
  await page.waitForTimeout(150);
  await releaseKey(page, 'j');
  await page.waitForTimeout(100);
  await releaseKey(page, 'Tab');

  const mark = await markAudio(page);
  await holdKey(page, 'o'); // degree 3, IV -- live, independent of whatever the loop is doing
  const startedLive = (await audioEventsSince(page, mark)).filter((e) => e.type === 'start');
  expect(startedLive.length).toBeGreaterThan(0);

  await releaseKey(page, 'o');
  await page.click('[data-action="clear-loop"]');
});
