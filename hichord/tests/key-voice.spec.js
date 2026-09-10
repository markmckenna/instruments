// Key and voice controls: switching key relabels every chord button (and,
// if a chord is currently held, reconciles it in place by exact pitch -- same
// diff path as a variant change, see variants.spec.js); switching voice
// changes the oscillator layout actually used to sound a held chord.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { chordMidiNotes, expectedChordFrequencies, expectedTransition } from './support/expected-audio.js';
import { CIRCLE_OF_FIFTHS, variantChordName, keyDisplayName } from '../js/theory.js';
import { CHORD_KEYS } from '../js/input.js';

function expectedChordName(keyPc, degreeIndex) {
  return variantChordName(keyPc, degreeIndex, 'neutral'); // neutral variant == the plain diatonic triad name
}

test.describe('keyDisplayName (pure logic, no browser/audio needed)', () => {
  test('a natural pitch class is just its plain name', () => {
    expect(keyDisplayName(0)).toBe('C');
    expect(keyDisplayName(7)).toBe('G');
  });

  test('an accidental pitch class shows both spellings', () => {
    expect(keyDisplayName(6)).toBe('F♯/G♭');
    expect(keyDisplayName(1)).toBe('C♯/D♭');
  });
});

// Bass now defaults on (see bass.spec.js) -- turned off here so exact
// frequency-diff assertions below match plain chord math, not chord+bass.
test.beforeEach(async ({ page }) => {
  await page.click('[data-action="bass-toggle"]');
});

test('page loads with the documented defaults', async ({ page }) => {
  await expect(page.locator('[data-display="key"]')).toHaveText('C');
  await expect(page.locator('[data-display="voice"]')).toHaveText('Warm Pad');
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

test('the Key display shows both spellings for an accidental key, but chord buttons keep a single spelling', async ({
  page,
}) => {
  for (let i = 0; i < 6; i++) await page.click('[data-action="key-next"]'); // C -> ... -> F♯ (index 6)
  await expect(page.locator('[data-display="key"]')).toHaveText('F♯/G♭');
  // The chord buttons still just use whichever single spelling CIRCLE_OF_FIFTHS/pcName picked -- no ambiguity to show once it's naming one specific chord.
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText(expectedChordName(6, 0));
});

test('changing key while a chord is held keeps any shared pitch sounding and swaps the rest', async ({
  page,
}) => {
  await holdKey(page, 'j');

  const before = chordMidiNotes(CIRCLE_OF_FIFTHS[0].pc, 0, 'neutral');
  const after = chordMidiNotes(CIRCLE_OF_FIFTHS[1].pc, 0, 'neutral');
  const { started, stopped } = expectedTransition(before, after);

  const mark = await markAudio(page);
  await page.click('[data-action="key-next"]');
  const events = await audioEventsSince(page, mark);

  expect(events.filter((e) => e.type === 'start').map((e) => e.freq).sort((a, b) => a - b)).toEqual(started);
  expect(events.filter((e) => e.type === 'stop').map((e) => e.freq).sort((a, b) => a - b)).toEqual(stopped);

  await releaseKey(page, 'j');
});

test('changing voice relabels the display and changes what a held chord actually sounds like', async ({
  page,
}) => {
  await page.click('[data-action="voice-next"]'); // Warm Pad -> Soft Pad
  await expect(page.locator('[data-display="voice"]')).toHaveText('Soft Pad');

  const mark = await markAudio(page);
  await holdKey(page, 'j');
  const started = (await audioEventsSince(page, mark))
    .filter((e) => e.type === 'start')
    .map((e) => e.freq)
    .sort((a, b) => a - b);
  expect(started).toEqual(expectedChordFrequencies(0, 0, 'neutral', 0)); // voiceIndex 0 = Soft Pad

  await releaseKey(page, 'j');
});
