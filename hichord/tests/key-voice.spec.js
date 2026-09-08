// Key and voice controls: switching key relabels every chord button (and,
// if a chord is currently held, re-pitches it in place -- same glide path as
// a variant change, see variants.spec.js); switching voice changes the
// oscillator layout actually used to sound a held chord.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { expectedChordFrequencies } from './support/expected-audio.js';
import { CHORD_KEYS, DEGREES, CIRCLE_OF_FIFTHS, chordRootName } from '../js/theory.js';
import { QUALITY_SUFFIX } from '../js/ui.js';

function expectedChordName(keyPc, degreeIndex) {
  return chordRootName(keyPc, degreeIndex) + QUALITY_SUFFIX[DEGREES[degreeIndex].quality];
}

test('page loads with the documented defaults', async ({ page }) => {
  await expect(page.locator('[data-display="key"]')).toHaveText('C');
  await expect(page.locator('[data-display="voice"]')).toHaveText('Soft Pad');
  await expect(page.locator('[data-display="loop"]')).toHaveText('No loop');
  for (const [degreeIndex, { code }] of CHORD_KEYS.entries()) {
    await expect(page.locator(`[data-base="${code}"] .chord-name`)).toHaveText(expectedChordName(0, degreeIndex));
  }
});

test('changing key relabels every chord button', async ({ page }) => {
  await page.click('[data-action="key-next"]'); // C -> G, one step around the circle of fifths
  const g = CIRCLE_OF_FIFTHS[1];
  await expect(page.locator('[data-display="key"]')).toHaveText(g.name);
  for (const [degreeIndex, { code }] of CHORD_KEYS.entries()) {
    await expect(page.locator(`[data-base="${code}"] .chord-name`)).toHaveText(expectedChordName(g.pc, degreeIndex));
  }
});

test('changing key while a chord is held re-pitches it in place (glide)', async ({ page }) => {
  await holdKey(page, 'j');

  const mark = await markAudio(page);
  await page.click('[data-action="key-next"]');
  const events = await audioEventsSince(page, mark);

  expect(events.filter((e) => e.type === 'start')).toHaveLength(0);
  const glideTargets = events.filter((e) => e.type === 'glide').map((e) => e.target).sort((a, b) => a - b);
  expect(glideTargets).toEqual(expectedChordFrequencies(CIRCLE_OF_FIFTHS[1].pc, 0, 'KeyS'));

  await releaseKey(page, 'j');
});

test('changing voice relabels the display and changes what a held chord actually sounds like', async ({
  page,
}) => {
  await page.click('[data-action="voice-next"]'); // Soft Pad -> Pluck
  await expect(page.locator('[data-display="voice"]')).toHaveText('Pluck');

  const mark = await markAudio(page);
  await holdKey(page, 'j');
  const started = (await audioEventsSince(page, mark))
    .filter((e) => e.type === 'start')
    .map((e) => e.freq)
    .sort((a, b) => a - b);
  expect(started).toEqual(expectedChordFrequencies(0, 0, 'KeyS', 1)); // voiceIndex 1 = Pluck

  await releaseKey(page, 'j');
});
