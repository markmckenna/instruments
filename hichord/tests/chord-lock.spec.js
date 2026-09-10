// Chord lock (.): while holding a chord + a variant, locks that variant to
// the chord so it keeps sounding shaped that way once the variant is
// released; tapping . again while holding the chord updates or clears the
// lock; a physically-held variant still overrides a lock live.
import { test, expect } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { buildChord, midiName } from '../js/audio.js';

// Bass now defaults on (see bass.spec.js) -- turned off here so exact
// notesDisplay assertions below match plain chord math, not chord+bass.
test.beforeEach(async ({ page }) => {
  await page.click('[data-action="bass-toggle"]');
});

test('locking a variant to a chord keeps it shaped that way after release', async ({ page }) => {
  const jName = page.locator('[data-base="KeyJ"] .chord-name');

  await holdKey(page, 'j');
  await holdKey(page, 'd'); // M7
  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'd');

  await expect(jName).toHaveText('Cmaj7'); // still shaped, variant key already released
  await releaseKey(page, 'j');
  await expect(jName).toHaveText('Cmaj7'); // remembered while not held, like octave/inversion

  const notesDisplay = page.locator('[data-display="playing-notes"]');
  await holdKey(page, 'j');
  await expect(notesDisplay).toHaveText(buildChord(0, 0, 'm7').map(midiName).join(' '));
  await releaseKey(page, 'j');
});

test('tapping . again while holding just the chord (no variant) removes the lock', async ({ page }) => {
  const jName = page.locator('[data-base="KeyJ"] .chord-name');

  await holdKey(page, 'j');
  await holdKey(page, 'd');
  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'd');
  await expect(jName).toHaveText('Cmaj7');

  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'j');
  await expect(jName).toHaveText('C');
});

test('tapping . again with a different variant held updates the lock instead of adding a second one', async ({ page }) => {
  const jName = page.locator('[data-base="KeyJ"] .chord-name');

  await holdKey(page, 'j');
  await holdKey(page, 'e'); // dom7
  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'e');
  await expect(jName).toHaveText('C7');

  await holdKey(page, 'w'); // Mm flip
  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'w');
  await releaseKey(page, 'j');
  await expect(jName).toHaveText('Cm'); // Mm flip's suffix over a major degree
});

test('a physically-held variant overrides a lock live, reverting to the lock once released', async ({ page }) => {
  const notesDisplay = page.locator('[data-display="playing-notes"]');

  await holdKey(page, 'j');
  await holdKey(page, 'e'); // dom7
  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'e');

  await holdKey(page, 'q'); // aug -- physically held, should override the dom7 lock
  await expect(notesDisplay).toHaveText(buildChord(0, 0, 'aug').map(midiName).join(' '));

  await releaseKey(page, 'q'); // back to the lock
  await expect(notesDisplay).toHaveText(buildChord(0, 0, 'dom7').map(midiName).join(' '));

  await releaseKey(page, 'j');
});

test('holding two chords locks both from one tap', async ({ page }) => {
  await holdKey(page, 'j');
  await holdKey(page, 'o'); // degree 3, IV
  await holdKey(page, 'e'); // dom7
  await holdKey(page, '.');
  await releaseKey(page, '.');
  await releaseKey(page, 'e');
  await releaseKey(page, 'o');
  await releaseKey(page, 'j');

  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C7');
  await expect(page.locator('[data-base="KeyO"] .chord-name')).toHaveText('F7');
});
