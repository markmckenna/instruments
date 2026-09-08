// Chord variants (the QWE/ASD/ZXC grid). Covers both documented behaviors
// from DECISIONS.md:
//   - "Variant keys glide, not retrigger": changing the held variant while a
//     chord is held re-pitches in place (setTargetAtTime), no new oscillators,
//     as long as the note count doesn't change.
//   - when the note count *does* change (e.g. triad -> 4-note M7), it falls
//     back to a full stop-then-restart.
// and the variant math itself (quality-dependent variants like M7/Mm flip
// behaving differently over a major vs. minor vs. diminished base chord).
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { expectedChordFrequencies } from './support/expected-audio.js';

test.describe('variants', () => {
  test('a same-note-count variant (Mm flip) glides in place, no retrigger', async ({ page }) => {
    await holdKey(page, 'j'); // degree 0, I, major triad

    const mark = await markAudio(page);
    await holdKey(page, 'w'); // Mm flip: major<->minor third, still a triad
    const events = await audioEventsSince(page, mark);

    expect(events.filter((e) => e.type === 'start')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'stop')).toHaveLength(0);
    const glideTargets = events
      .filter((e) => e.type === 'glide')
      .map((e) => e.target)
      .sort((a, b) => a - b);
    expect(glideTargets).toEqual(expectedChordFrequencies(0, 0, 'KeyW'));

    await releaseKey(page, 'w');
    await releaseKey(page, 'j');
  });

  test('a note-count-changing variant (M7) falls back to a full retrigger', async ({ page }) => {
    await holdKey(page, 'j'); // 3-note major triad

    const mark = await markAudio(page);
    await holdKey(page, 'd'); // M7: adds a 4th note -> no clean glide mapping
    const events = await audioEventsSince(page, mark);

    const stopped = events.filter((e) => e.type === 'stop');
    const started = events.filter((e) => e.type === 'start').map((e) => e.freq).sort((a, b) => a - b);
    expect(stopped.length).toBeGreaterThan(0);
    expect(started).toEqual(expectedChordFrequencies(0, 0, 'KeyD'));

    await releaseKey(page, 'd');
    await releaseKey(page, 'j');
  });

  test('M7 depends on the base chord quality: minor degree gets a minor 7th', async ({ page }) => {
    await holdKey(page, 'i'); // degree 1, ii, minor triad

    const mark = await markAudio(page);
    await holdKey(page, 'd');
    const started = (await audioEventsSince(page, mark))
      .filter((e) => e.type === 'start')
      .map((e) => e.freq)
      .sort((a, b) => a - b);
    expect(started).toEqual(expectedChordFrequencies(0, 1, 'KeyD'));

    await releaseKey(page, 'd');
    await releaseKey(page, 'i');
  });

  test('M7 over the diminished vii° button gives a half-diminished (m7♭5)', async ({ page }) => {
    await holdKey(page, ';'); // degree 6, vii°, diminished triad

    const mark = await markAudio(page);
    await holdKey(page, 'd');
    const started = (await audioEventsSince(page, mark))
      .filter((e) => e.type === 'start')
      .map((e) => e.freq)
      .sort((a, b) => a - b);
    expect(started).toEqual(expectedChordFrequencies(0, 6, 'KeyD'));

    await releaseKey(page, 'd');
    await releaseKey(page, ';');
  });

  test('releasing the variant while the chord is still held glides back to the plain triad', async ({
    page,
  }) => {
    await holdKey(page, 'j');
    await holdKey(page, 'w'); // flip to minor

    const mark = await markAudio(page);
    await releaseKey(page, 'w'); // back to plain (neutral) triad -- still 3 notes, should glide
    const events = await audioEventsSince(page, mark);

    expect(events.filter((e) => e.type === 'start')).toHaveLength(0);
    const glideTargets = events
      .filter((e) => e.type === 'glide')
      .map((e) => e.target)
      .sort((a, b) => a - b);
    expect(glideTargets).toEqual(expectedChordFrequencies(0, 0, 'KeyS'));

    await releaseKey(page, 'j');
  });
});
