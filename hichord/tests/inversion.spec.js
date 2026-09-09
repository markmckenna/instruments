// Inversions (/): cycles a held chord key's inversion, remembered per key
// and reflected in its name, reinterpreted (not reset) across a variant
// change that alters the chord's note count -- see theory.js's
// invertOffsets for why a raw counter mod the *current* note count is what
// makes that reinterpretation coherent instead of jarring.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { chordMidiNotes, expectedTransition } from './support/expected-audio.js';
import { buildChord, midiName } from '../js/audio.js';

test('tapping / while a chord is held cycles its inversion, audibly and in its name', async ({ page }) => {
  await holdKey(page, 'j'); // C major triad: C4 E4 G4

  const before = chordMidiNotes(0, 0, 'neutral');
  const after = buildChord(0, 0, 'neutral', { inversionIndex: 1 });
  const { started, stopped } = expectedTransition(before, after);

  const mark = await markAudio(page);
  await holdKey(page, '/');
  await releaseKey(page, '/');
  const events = await audioEventsSince(page, mark);

  expect(events.filter((e) => e.type === 'start').map((e) => e.freq).sort((a, b) => a - b)).toEqual(started);
  expect(events.filter((e) => e.type === 'stop').map((e) => e.freq).sort((a, b) => a - b)).toEqual(stopped);
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C/1i');

  await releaseKey(page, 'j');
});

test('an inversion is remembered per key across release/re-press, and wraps back to root position', async ({ page }) => {
  await holdKey(page, 'j');
  await holdKey(page, '/');
  await releaseKey(page, '/');
  await releaseKey(page, 'j');

  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C/1i'); // remembered while not held

  await holdKey(page, 'j');
  await holdKey(page, '/');
  await releaseKey(page, '/');
  await holdKey(page, '/');
  await releaseKey(page, '/');
  // Root position triad has 3 inversions (0, 1, 2) -- one more tap (3rd
  // total) wraps back to plain root position.
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C');

  await releaseKey(page, 'j');
});

test('holding two chords cycles both of their inversions from one tap', async ({ page }) => {
  await holdKey(page, 'j');
  await holdKey(page, 'o'); // degree 3, IV
  await holdKey(page, '/');
  await releaseKey(page, '/');

  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C/1i');
  await expect(page.locator('[data-base="KeyO"] .chord-name')).toHaveText('F/1i');

  await releaseKey(page, 'o');
  await releaseKey(page, 'j');
});

test('an inversion survives a variant that changes the note count, reinterpreted rather than reset', async ({ page }) => {
  const notesDisplay = page.locator('[data-display="playing-notes"]');

  await holdKey(page, 'j'); // C major triad, 3 notes
  await holdKey(page, '/'); // 1st inversion of the triad
  await releaseKey(page, '/');

  const invertedTriad = buildChord(0, 0, 'neutral', { inversionIndex: 1 });
  await expect(notesDisplay).toHaveText(invertedTriad.map(midiName).join(' '));

  // Add M7 (a 4th note) while still holding J -- the raw inversion counter
  // (1) is unchanged, but re-wrapped against the new 4-note shape.
  await holdKey(page, 'd');
  const invertedM7 = buildChord(0, 0, 'm7', { inversionIndex: 1 });
  await expect(notesDisplay).toHaveText(invertedM7.map(midiName).join(' '));

  await releaseKey(page, 'd');
  await releaseKey(page, 'j');
});
