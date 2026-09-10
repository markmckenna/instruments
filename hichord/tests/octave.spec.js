// Octave shift ([ / ]): three different effects depending on what's held
// when the bracket key itself goes down vs. what happens during its hold --
// see input.js's pressOctaveKey/releaseOctaveKey for the full state machine
// this exercises.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { chordMidiNotes, expectedTransition } from './support/expected-audio.js';
import { buildChord } from '../js/audio.js';

// Bass now defaults on (see bass.spec.js) -- turned off here so exact
// frequency-diff assertions below match plain chord math, not chord+bass.
test.beforeEach(async ({ page }) => {
  await page.click('[data-action="bass-toggle"]');
});

test('pressing ] while a chord is already sounding shifts its pitch up an octave, live', async ({ page }) => {
  await holdKey(page, 'j'); // degree 0, I, major triad

  const before = chordMidiNotes(0, 0, 'neutral');
  const after = buildChord(0, 0, 'neutral', { octaveShift: 1 });
  const { started, stopped } = expectedTransition(before, after);

  const mark = await markAudio(page);
  await holdKey(page, ']');
  await releaseKey(page, ']');
  const events = await audioEventsSince(page, mark);

  expect(events.filter((e) => e.type === 'start').map((e) => e.freq).sort((a, b) => a - b)).toEqual(started);
  expect(events.filter((e) => e.type === 'stop').map((e) => e.freq).sort((a, b) => a - b)).toEqual(stopped);
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C+1');
  // A chord already sounding when the bracket key went down is shifted
  // immediately -- it never became a "silent target", so the global
  // register must be untouched.
  await expect(page.locator('[data-display="octave"]')).toHaveText('0');

  await releaseKey(page, 'j');
});

test('holding [ first, then tapping a chord key, shifts that key silently without sounding it', async ({ page }) => {
  await holdKey(page, '[');

  const mark = await markAudio(page);
  await holdKey(page, 'j');
  await releaseKey(page, 'j');
  const events = await audioEventsSince(page, mark);
  expect(events).toHaveLength(0); // never sounded

  await releaseKey(page, '[');

  // The shift still applies, and is remembered even though J isn't held.
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C-1');
  // A chord was targeted during this hold, so releasing [ must NOT also
  // shift the global register.
  await expect(page.locator('[data-display="octave"]')).toHaveText('0');
});

test('tapping [ alone, with no chord key ever pressed during the hold, shifts the global register', async ({ page }) => {
  await holdKey(page, '[');
  await releaseKey(page, '[');

  await expect(page.locator('[data-display="octave"]')).toHaveText('-1');
  // Applies on top of whatever any given key already carries -- shown in
  // every unshifted button's name too.
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C-1');
});

test('holding two chords and shifting applies to both at once', async ({ page }) => {
  await holdKey(page, 'j');
  await holdKey(page, 'o'); // degree 3, IV

  await holdKey(page, ']');
  await releaseKey(page, ']');

  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C+1');
  await expect(page.locator('[data-base="KeyO"] .chord-name')).toHaveText('F+1');

  await releaseKey(page, 'o');
  await releaseKey(page, 'j');
});

test('the global register clamps rather than growing without bound', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await holdKey(page, '[');
    await releaseKey(page, '[');
  }
  await expect(page.locator('[data-display="octave"]')).toHaveText('-3');
});
