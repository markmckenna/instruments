// Chord buttons: holding one sounds its root-position diatonic triad and
// lights up; releasing stops it cleanly; holding several at once overlays
// them into one combined chord (see input.js's currentSound()).
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdButtonByMouse, releaseMouse, holdKey, releaseKey } from './support/interactions.js';
import {
  chordMidiNotes,
  mergedMidiNotes,
  expectedChordFrequencies,
  expectedTransition,
} from './support/expected-audio.js';
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

  test('holding a second chord button layers it on top without touching the first, releasing it drops back cleanly', async ({
    page,
  }) => {
    // J (degree 0, I) held via keyboard, O (degree 3, IV) held via mouse --
    // two real, independent input mechanisms held concurrently. See
    // support/interactions.js for why this beats a fabricated second pointer.
    await holdKey(page, 'j');

    const jOnly = chordMidiNotes(0, 0, 'KeyS');
    const merged = mergedMidiNotes(0, [0, 3], 'KeyS');
    const { started: mergeStarted, stopped: mergeStopped } = expectedTransition(jOnly, merged);

    const mergeMark = await markAudio(page);
    await holdButtonByMouse(page, '[data-base="KeyO"]');
    const mergeEvents = await audioEventsSince(page, mergeMark);
    expect(mergeEvents.filter((e) => e.type === 'start').map((e) => e.freq).sort((a, b) => a - b)).toEqual(
      mergeStarted,
    );
    // J's own notes are still wanted in the merged chord, so they must not be
    // touched -- only O's genuinely new notes start, nothing stops.
    expect(mergeStopped).toHaveLength(0);
    expect(mergeEvents.filter((e) => e.type === 'stop')).toHaveLength(0);

    const { started: dropStarted, stopped: dropStopped } = expectedTransition(merged, jOnly);
    const dropMark = await markAudio(page);
    await releaseMouse(page); // release O, J alone should keep sounding
    const dropEvents = await audioEventsSince(page, dropMark);
    // J's notes are still wanted after dropping O, so they must not restart --
    // only O's notes (the ones not shared with J) stop.
    expect(dropStarted).toHaveLength(0);
    expect(dropEvents.filter((e) => e.type === 'start')).toHaveLength(0);
    expect(dropEvents.filter((e) => e.type === 'stop').map((e) => e.freq).sort((a, b) => a - b)).toEqual(
      dropStopped,
    );

    await releaseKey(page, 'j');
  });
});
