// Chord variants (the QWE/ASD/ZXC grid). Covers both:
//   - Every note voiced independently, by exact pitch (see audio.js's
//     playChord): changing the held variant while a chord is held reconciles
//     the sounding notes by exact MIDI pitch -- a pitch shared before and
//     after keeps sounding untouched, only the pitches that actually changed
//     stop/start.
// and the variant math itself (quality-dependent variants like M7/Mm flip
// behaving differently over a major vs. minor vs. diminished base chord).
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { chordMidiNotes, expectedTransition } from './support/expected-audio.js';

function eventFreqs(events, type) {
  return events.filter((e) => e.type === type).map((e) => e.freq).sort((a, b) => a - b);
}

test.describe('variants', () => {
  test('a variant that only changes one note (Mm flip) only stops/starts that note', async ({ page }) => {
    await holdKey(page, 'j'); // degree 0, I, major triad

    const before = chordMidiNotes(0, 0, 'neutral');
    const after = chordMidiNotes(0, 0, 'mmFlip'); // Mm flip: major<->minor third, still a triad
    const { started, stopped } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'w');
    const events = await audioEventsSince(page, mark);

    expect(eventFreqs(events, 'start')).toEqual(started);
    expect(eventFreqs(events, 'stop')).toEqual(stopped);

    await releaseKey(page, 'w');
    await releaseKey(page, 'j');
  });

  test('a variant that only adds a note (M7) layers it on top, leaving the triad untouched', async ({
    page,
  }) => {
    await holdKey(page, 'j'); // 3-note major triad

    const before = chordMidiNotes(0, 0, 'neutral');
    const after = chordMidiNotes(0, 0, 'm7'); // M7: adds a 4th note, root/3rd/5th unchanged
    const { started, stopped } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'd');
    const events = await audioEventsSince(page, mark);

    expect(stopped).toHaveLength(0); // nothing dropped out, so nothing should stop
    expect(eventFreqs(events, 'stop')).toHaveLength(0);
    expect(eventFreqs(events, 'start')).toEqual(started);

    await releaseKey(page, 'd');
    await releaseKey(page, 'j');
  });

  test('M7 depends on the base chord quality: minor degree gets a minor 7th', async ({ page }) => {
    await holdKey(page, 'i'); // degree 1, ii, minor triad

    const before = chordMidiNotes(0, 1, 'neutral');
    const after = chordMidiNotes(0, 1, 'm7');
    const { started } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'd');
    const events = await audioEventsSince(page, mark);
    expect(eventFreqs(events, 'start')).toEqual(started);

    await releaseKey(page, 'd');
    await releaseKey(page, 'i');
  });

  test('M7 over the diminished vii° button gives a half-diminished (m7♭5)', async ({ page }) => {
    await holdKey(page, ';'); // degree 6, vii°, diminished triad

    const before = chordMidiNotes(0, 6, 'neutral');
    const after = chordMidiNotes(0, 6, 'm7');
    const { started } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'd');
    const events = await audioEventsSince(page, mark);
    expect(eventFreqs(events, 'start')).toEqual(started);

    await releaseKey(page, 'd');
    await releaseKey(page, ';');
  });

  test('6sus2 gives a 6th chord (3rd kept, 6th added) over a major degree', async ({ page }) => {
    await holdKey(page, 'j'); // degree 0, I, major triad

    const before = chordMidiNotes(0, 0, 'neutral');
    const after = chordMidiNotes(0, 0, 'sixSus2');
    const { started } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'z');
    const events = await audioEventsSince(page, mark);
    expect(eventFreqs(events, 'start')).toEqual(started);

    await releaseKey(page, 'z');
    await releaseKey(page, 'j');
  });

  test('6sus2 gives a sus2 (3rd replaced by 2nd, no 6th) over a minor degree', async ({ page }) => {
    await holdKey(page, 'i'); // degree 1, ii, minor triad

    const before = chordMidiNotes(0, 1, 'neutral');
    const after = chordMidiNotes(0, 1, 'sixSus2');
    const { started } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'z');
    const events = await audioEventsSince(page, mark);
    expect(eventFreqs(events, 'start')).toEqual(started);

    await releaseKey(page, 'z');
    await releaseKey(page, 'i');
  });

  test('6sus2 gives a sus2 over the diminished vii° degree too, not a 6th', async ({ page }) => {
    await holdKey(page, ';'); // degree 6, vii°, diminished triad

    const before = chordMidiNotes(0, 6, 'neutral');
    const after = chordMidiNotes(0, 6, 'sixSus2');
    const { started } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await holdKey(page, 'z');
    const events = await audioEventsSince(page, mark);
    expect(eventFreqs(events, 'start')).toEqual(started);

    await releaseKey(page, 'z');
    await releaseKey(page, ';');
  });

  test('releasing the variant while the chord is still held swaps back to the plain triad', async ({
    page,
  }) => {
    await holdKey(page, 'j');
    await holdKey(page, 'w'); // flip to minor

    const before = chordMidiNotes(0, 0, 'mmFlip');
    const after = chordMidiNotes(0, 0, 'neutral'); // back to plain (neutral) triad
    const { started, stopped } = expectedTransition(before, after);

    const mark = await markAudio(page);
    await releaseKey(page, 'w');
    const events = await audioEventsSince(page, mark);

    expect(eventFreqs(events, 'start')).toEqual(started);
    expect(eventFreqs(events, 'stop')).toEqual(stopped);

    await releaseKey(page, 'j');
  });
});
