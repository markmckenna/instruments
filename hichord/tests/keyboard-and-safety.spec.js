// Keyboard-specific behavior that the mouse-driven tests elsewhere don't
// exercise: OS key-repeat must not re-trigger (DECISIONS.md / input.js's
// `if (e.repeat) return`), and the blur/visibility "panic" safety valve must
// release everything if the tab loses focus mid-hold.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { expectedChordFrequencies } from './support/expected-audio.js';

test('a synthetic OS key-repeat keydown does not retrigger the chord', async ({ page }) => {
  await holdKey(page, 'j');

  const mark = await markAudio(page);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true, repeat: true }));
  });
  const events = await audioEventsSince(page, mark);
  expect(events).toHaveLength(0);

  await releaseKey(page, 'j');
});

test('losing window focus mid-hold releases the chord (blur panic)', async ({ page }) => {
  const btn = page.locator('[data-base="KeyJ"]');
  await holdKey(page, 'j');
  await expect(btn).toHaveClass(/active/);

  const mark = await markAudio(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(btn).not.toHaveClass(/active/);

  const stopped = (await audioEventsSince(page, mark)).filter((e) => e.type === 'stop');
  expect(stopped.length).toEqual(expectedChordFrequencies(0, 0, 'KeyS').length);

  // key is still physically "down" as far as the OS is concerned in this
  // test, but the app's held-state was cleared -- release it so it doesn't
  // leak into the next test.
  await releaseKey(page, 'j');
});

test('the tab going hidden mid-hold releases the chord (visibilitychange panic)', async ({ page }) => {
  const btn = page.locator('[data-base="KeyJ"]');
  await holdKey(page, 'j');
  await expect(btn).toHaveClass(/active/);

  const mark = await markAudio(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(btn).not.toHaveClass(/active/);

  const stopped = (await audioEventsSince(page, mark)).filter((e) => e.type === 'stop');
  expect(stopped.length).toEqual(expectedChordFrequencies(0, 0, 'KeyS').length);

  await releaseKey(page, 'j');
});
