// Cross-session settings persistence (see js/settings.js): key, voice, bpm,
// quantize, octave, mode, and bass survive a reload; everything else --
// per-key octave/inversion/lock and the loop -- is scoped to the sitting and
// always resets.
import { test, expect } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';

test('key/voice/bpm/quantize/octave/mode/bass survive a reload', async ({ page }) => {
  await page.click('[data-action="key-next"]'); // C -> G
  await page.click('[data-action="voice-next"]'); // Warm Pad -> Airy Pad
  const bpmDisplay = page.locator('[data-display="bpm"]');
  await bpmDisplay.click();
  await bpmDisplay.fill('90');
  await bpmDisplay.press('Enter');
  await page.click('[data-action="quantize-down"]'); // 1/64 -> 1/32
  await holdKey(page, '['); // global octave shift, no chord targeted
  await releaseKey(page, '[');
  await page.click('[data-action="mode-cycle"]'); // Chord -> Arpeggio
  await page.click('[data-action="bass-toggle"]'); // on -> off

  await page.reload();

  await expect(page.locator('[data-display="key"]')).toHaveText('G');
  await expect(page.locator('[data-display="voice"]')).toHaveText('Airy Pad');
  await expect(bpmDisplay).toHaveValue('90');
  await expect(page.locator('[data-display="quantize"]')).toHaveText('1/32');
  await expect(page.locator('[data-display="octave"]')).toHaveText('-1');
  await expect(page.locator('[data-display="mode"]')).toHaveText('Arpeggio');
  await expect(page.locator('[data-action="bass-toggle"]')).not.toHaveClass(/active/);
});

test('per-key octave/inversion/lock and the loop reset on reload, unlike the settings above', async ({ page }) => {
  await holdKey(page, 'j');
  await holdKey(page, 'd'); // M7
  await holdKey(page, '.'); // lock M7 to J
  await releaseKey(page, '.');
  await releaseKey(page, 'd');
  await holdKey(page, '/'); // 1st inversion
  await releaseKey(page, '/');
  await holdKey(page, ']'); // shifts J up an octave, already sounding
  await releaseKey(page, ']');
  await releaseKey(page, 'j');
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('Cmaj7/1i+1');

  await holdKey(page, 'Space');
  await holdKey(page, 'k');
  await releaseKey(page, 'k');
  await releaseKey(page, 'Space');
  await expect(page.locator('[data-display="loop"]')).toHaveText('Looping');

  await page.reload();

  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C'); // lock/inversion/octave all cleared
  await expect(page.locator('[data-display="loop"]')).toHaveText('No loop');
  await expect(page.locator('[data-action="record"]')).not.toHaveClass(/playing/);
});
