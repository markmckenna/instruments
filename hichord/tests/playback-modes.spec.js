// Playback mode (backtick / the mode-cycle button): cycles Chord -> Arpeggio
// -> Lead -> back to Chord, changing what holding a chord button actually
// plays. A loop always plays back the literal notes it captured, so a mode
// switch after recording must never change it (see loop.js's recordEvent --
// it's already storing resolved notes, not the abstract mode, which is what
// makes that guarantee free). Bass is its own toggle, not a mode -- see
// bass.spec.js.
import { test, expect } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { buildChord, midiName } from '../js/audio.js';

function sortedNoteNames(notes) {
  return [...notes].sort((a, b) => a - b).map(midiName).join(' ');
}

test('the mode control cycles Chord -> Arpeggio -> Lead -> Chord', async ({ page }) => {
  const modeDisplay = page.locator('[data-display="mode"]');
  const cycleBtn = page.locator('[data-action="mode-cycle"]');

  await expect(modeDisplay).toHaveText('Chord');
  await cycleBtn.click();
  await expect(modeDisplay).toHaveText('Arpeggio');
  await cycleBtn.click();
  await expect(modeDisplay).toHaveText('Lead');
  await cycleBtn.click();
  await expect(modeDisplay).toHaveText('Chord');
});

test('Chord mode doubles the root an octave up by default', async ({ page }) => {
  const notesDisplay = page.locator('[data-display="playing-notes"]');
  await holdKey(page, 'j');
  await expect(notesDisplay).toHaveText(sortedNoteNames(buildChord(0, 0, 'neutral')));
  await releaseKey(page, 'j');
});

test('Lead mode sounds only the root, no chord', async ({ page }) => {
  await holdKey(page, '`'); // Chord -> Arpeggio
  await releaseKey(page, '`');
  await holdKey(page, '`'); // Arpeggio -> Lead
  await releaseKey(page, '`');

  const notesDisplay = page.locator('[data-display="playing-notes"]');
  await holdKey(page, 'j');
  await expect(notesDisplay).toHaveText('C4');
  await releaseKey(page, 'j');

  await holdKey(page, '`'); // Lead -> Chord
  await releaseKey(page, '`');
});

test('Lead mode greys out the variant grid and ignores it, in both directions', async ({ page }) => {
  await holdKey(page, '`'); // Chord -> Arpeggio
  await releaseKey(page, '`');
  await holdKey(page, '`'); // Arpeggio -> Lead
  await releaseKey(page, '`');

  const dVariantName = page.locator('[data-variant="KeyD"] .variant-name');
  const jChordName = page.locator('[data-base="KeyJ"] .chord-name');

  await expect(page.locator('[data-variant="KeyD"]')).toHaveClass(/disabled/);

  // Holding a variant while a chord is held would normally relabel the
  // chord to what the variant would do to it (e.g. "Cmaj7") -- in Lead mode
  // it must stay the plain root name, since the variant has no effect.
  await holdKey(page, 'j');
  await holdKey(page, 'd'); // M7
  await expect(jChordName).toHaveText('C');
  // And the reverse: holding just the chord would normally relabel the
  // variant grid to real chord names -- also suppressed here.
  await releaseKey(page, 'd');
  await expect(dVariantName).toHaveText('M7');
  await releaseKey(page, 'j');

  await holdKey(page, '`'); // Lead -> Chord
  await releaseKey(page, '`');
});

test('Arpeggio mode sequences the chord one note at a time instead of sounding it all at once', async ({ page }) => {
  await page.click('[data-action="mode-cycle"]'); // Chord -> Arpeggio

  await holdKey(page, 'j');
  await page.waitForTimeout(50);
  const firstActive = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return mod.engine.active.get('live');
  });
  expect(firstActive).toHaveLength(1); // one note sounding, not the whole chord

  // 16th notes at the default 120bpm step every 125ms -- wait past at least
  // one more step and confirm it's still exactly one note at a time (i.e.
  // actually stepping, not just starting on one note and stopping there).
  await page.waitForTimeout(150);
  const laterActive = await page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return mod.engine.active.get('live');
  });
  expect(laterActive).toHaveLength(1);

  await releaseKey(page, 'j');
  await page.click('[data-action="mode-cycle"]'); // Arpeggio -> Lead
  await page.click('[data-action="mode-cycle"]'); // Lead -> Chord
});

test('a mode switch after recording never changes the loop already laid down', async ({ page }) => {
  await page.click('[data-action="mode-cycle"]'); // Chord -> Arpeggio

  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(300); // several 125ms arpeggio steps
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  const recordedEvents = await page.evaluate(async () => (await import('/js/input.js')).recorder.events);
  const onEvents = recordedEvents.filter((e) => e.type === 'on');
  // The arpeggio pattern itself got captured -- several single-note 'on'
  // events, not one merged chord.
  expect(onEvents.length).toBeGreaterThan(1);
  expect(onEvents.some((e) => e.notes && e.notes.length === 1)).toBe(true);

  await page.click('[data-action="mode-cycle"]'); // Arpeggio -> Lead
  await page.click('[data-action="mode-cycle"]'); // Lead -> Chord

  const afterModeSwitch = await page.evaluate(async () => (await import('/js/input.js')).recorder.events);
  expect(afterModeSwitch).toEqual(recordedEvents);
});
