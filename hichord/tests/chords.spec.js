// Chord buttons: holding one sounds its root-position diatonic triad and
// lights up; releasing stops it cleanly; holding several at once overlays
// them into one combined chord (DECISIONS.md "Polyphonic chord buttons").
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdButtonByMouse, releaseMouse, holdKey, releaseKey } from './support/interactions.js';
import { expectedChordFrequencies, expectedMergedFrequencies } from './support/expected-audio.js';
import { CHORD_KEYS } from '../js/theory.js';

test.describe('chord buttons (key of C, default voice)', () => {
  for (const [degreeIndex, { code, label }] of CHORD_KEYS.entries()) {
    test(`holding ${label} sounds its triad and releasing stops it`, async ({ page }) => {
      const btn = page.locator(`[data-base="${code}"]`);

      const pressMark = await markAudio(page);
      await holdButtonByMouse(page, `[data-base="${code}"]`);
      await expect(btn).toHaveClass(/active/);

      const started = (await audioEventsSince(page, pressMark))
        .filter((e) => e.type === 'start')
        .map((e) => e.freq)
        .sort((a, b) => a - b);
      expect(started).toEqual(expectedChordFrequencies(0, degreeIndex, 'KeyS'));

      const releaseMark = await markAudio(page);
      await releaseMouse(page);
      await expect(btn).not.toHaveClass(/active/);

      const stopped = (await audioEventsSince(page, releaseMark)).filter((e) => e.type === 'stop');
      expect(stopped).toHaveLength(started.length);
    });
  }

  test('holding two chord buttons overlays both chords, releasing one drops back to the other', async ({
    page,
  }) => {
    // J (degree 0, I) held via keyboard, O (degree 3, IV) held via mouse --
    // two real, independent input mechanisms held concurrently. See
    // support/interactions.js for why this beats a fabricated second pointer.
    await holdKey(page, 'j');

    const mergeMark = await markAudio(page);
    await holdButtonByMouse(page, '[data-base="KeyO"]');
    const mergeEvents = await audioEventsSince(page, mergeMark);
    const mergedStarted = mergeEvents
      .filter((e) => e.type === 'start')
      .map((e) => e.freq)
      .sort((a, b) => a - b);
    expect(mergedStarted).toEqual(expectedMergedFrequencies(0, [0, 3], 'KeyS'));
    // The lone-J chord that was sounding before the merge gets released, not left running underneath.
    expect(mergeEvents.filter((e) => e.type === 'stop').length).toBeGreaterThan(0);

    const dropMark = await markAudio(page);
    await releaseMouse(page); // release O, J alone should keep sounding
    const dropStarted = (await audioEventsSince(page, dropMark))
      .filter((e) => e.type === 'start')
      .map((e) => e.freq)
      .sort((a, b) => a - b);
    expect(dropStarted).toEqual(expectedChordFrequencies(0, 0, 'KeyS'));

    await releaseKey(page, 'j');
  });
});
