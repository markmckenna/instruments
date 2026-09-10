// Bass toggle (KeyB / the on-screen B button, on by default): an independent
// low root, always in scientific-pitch octave 2 regardless of a chord's own
// octave shift (see audio.js's buildBassNote), layered onto whatever mode is
// already doing rather than being a mode itself (see input.js's
// refreshSound). Not arpeggiated even when Arpeggio mode is on -- it gets
// its own voice ('bass' live, 'loop-bass' in a loop) precisely so the
// arpeggiator's note-by-note stepping on 'live'/'loop' never touches it.
import { test, expect, markAudio, audioEventsSince } from './support/fixtures.js';
import { holdKey, releaseKey } from './support/interactions.js';
import { buildBassNote, midiName } from '../js/audio.js';

test('bass defaults on, and both the button and the B key toggle it', async ({ page }) => {
  const bassBtn = page.locator('[data-action="bass-toggle"]');
  const notesDisplay = page.locator('[data-display="playing-notes"]');

  await expect(bassBtn).toHaveClass(/active/); // on by default

  await holdKey(page, 'j'); // C
  await expect(notesDisplay).toContainText(midiName(buildBassNote(0, 0))); // C2
  await releaseKey(page, 'j');

  await holdKey(page, 'b'); // toggle off via the keyboard shortcut
  await releaseKey(page, 'b');
  await expect(bassBtn).not.toHaveClass(/active/);

  await holdKey(page, 'j');
  await expect(notesDisplay).not.toContainText(midiName(buildBassNote(0, 0)));
  await releaseKey(page, 'j');

  await bassBtn.click(); // back on via the on-screen button
  await expect(bassBtn).toHaveClass(/active/);
});

test('the bass note stays in octave 2 no matter how the chord above it is octave-shifted', async ({ page }) => {
  await holdKey(page, 'j');
  await holdKey(page, ']'); // shift J's pitch up live, per octave.spec.js
  await releaseKey(page, ']');

  const notesDisplay = page.locator('[data-display="playing-notes"]');
  await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C+1');
  await expect(notesDisplay).toContainText(midiName(buildBassNote(0, 0))); // still C2, not shifted along with the chord

  await releaseKey(page, 'j');
});

test('bass is never arpeggiated -- it sustains while Arpeggio mode steps through the rest of the chord', async ({
  page,
}) => {
  await page.click('[data-action="mode-cycle"]'); // Chord -> Arpeggio

  await holdKey(page, 'j');
  await page.waitForTimeout(50);

  const sample = async () => page.evaluate(async () => {
    const mod = await import('/js/input.js');
    return { live: mod.engine.active.get('live'), bass: mod.engine.active.get('bass') };
  });

  const first = await sample();
  expect(first.live).toHaveLength(1); // the arpeggiator, stepping one note at a time
  expect(first.bass).toHaveLength(1); // the bass note, constant

  await page.waitForTimeout(150); // past at least one more 16th-note step
  const later = await sample();
  expect(later.live).toHaveLength(1);
  expect(later.bass).toHaveLength(1);
  expect(later.bass[0].midi).toBe(first.bass[0].midi); // same note the whole time, never retriggered by a step

  await releaseKey(page, 'j');
});

test('a bass note recorded during Arpeggio mode plays back on its own track, not arpeggiated', async ({ page }) => {
  await page.click('[data-action="mode-cycle"]'); // Chord -> Arpeggio

  await holdKey(page, 'Space');
  await holdKey(page, 'j');
  await page.waitForTimeout(300); // several 125ms arpeggio steps
  await releaseKey(page, 'Space');
  await releaseKey(page, 'j');

  const events = await page.evaluate(async () => (await import('/js/input.js')).recorder.events);
  const bassOnEvents = events.filter((e) => e.type === 'on' && e.track === 'bass');
  const mainOnEvents = events.filter((e) => e.type === 'on' && e.track === 'main');
  expect(bassOnEvents.length).toBeGreaterThan(0);
  // The bass note was recorded once (held steady), unlike the arpeggiated
  // main track's many single-note steps.
  expect(mainOnEvents.length).toBeGreaterThan(bassOnEvents.length);

  const mark = await markAudio(page);
  await page.waitForTimeout(600);
  const replayed = await audioEventsSince(page, mark);
  expect(replayed.some((e) => e.type === 'start')).toBe(true); // the loop actually plays back
});
