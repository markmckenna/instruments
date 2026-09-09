// Dynamic labeling: while a single chord button is held, the variant grid
// relabels to show what each variant would actually do to it; while a
// variant is held, the chord grid relabels to show what each chord button
// would actually produce with it. Both fall back to their static labels
// (VARIANTS[id].label for variants, the plain diatonic triad name for
// chords) whenever there's no single unambiguous chord/variant to compute
// against. Also covers the "now playing" notes diagnostic these share a
// data source with (input.js's currentSound()).
import { test, expect } from './support/fixtures.js';
import { holdKey, releaseKey, holdButtonByMouse, releaseMouse } from './support/interactions.js';
import { VARIANTS, variantChordName } from '../js/theory.js';
import { VARIANT_GRID, VARIANT_KEYS } from '../js/input.js';

test('every variant button shows its fixed mood name, in grid order, regardless of held state', async ({
  page,
}) => {
  for (const row of VARIANT_GRID) {
    for (const code of row) {
      await expect(page.locator(`[data-variant="${code}"] .variant-mood`)).toHaveText(VARIANTS[VARIANT_KEYS[code]].mood);
    }
  }

  // Unaffected by the dynamic .variant-name relabeling right next to it.
  await holdKey(page, 'j');
  await expect(page.locator('[data-variant="KeyD"] .variant-mood')).toHaveText('Jazzy');
  await releaseKey(page, 'j');
});

test.describe('variant grid relabels while one chord is held', () => {
  test('shows what each variant would actually produce, then reverts once released', async ({ page }) => {
    await holdKey(page, 'j'); // degree 0, I, major triad (C)

    await expect(page.locator('[data-variant="KeyQ"] .variant-name')).toHaveText(variantChordName(0, 0, 'aug'));
    await expect(page.locator('[data-variant="KeyD"] .variant-name')).toHaveText(variantChordName(0, 0, 'm7'));
    await expect(page.locator('[data-variant="KeyZ"] .variant-name')).toHaveText(variantChordName(0, 0, 'sixSus2'));

    await releaseKey(page, 'j');
    await expect(page.locator('[data-variant="KeyQ"] .variant-name')).toHaveText('aug');
    await expect(page.locator('[data-variant="KeyD"] .variant-name')).toHaveText('M7');
    await expect(page.locator('[data-variant="KeyZ"] .variant-name')).toHaveText('6sus2');
  });

  test('holding two chords at once is ambiguous, so variant buttons stay on their static labels', async ({
    page,
  }) => {
    await holdKey(page, 'j');
    await holdButtonByMouse(page, '[data-base="KeyO"]'); // second chord button, held concurrently

    await expect(page.locator('[data-variant="KeyD"] .variant-name')).toHaveText('M7');
    await expect(page.locator('[data-variant="KeyZ"] .variant-name')).toHaveText('6sus2');

    await releaseMouse(page);
    await releaseKey(page, 'j');
  });
});

test.describe('chord grid relabels while a variant is held', () => {
  test('shows the actual chord each button would produce, then reverts once released', async ({ page }) => {
    await holdKey(page, 'd'); // M7

    await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText(variantChordName(0, 0, 'm7')); // Cmaj7
    await expect(page.locator('[data-base="KeyI"] .chord-name')).toHaveText(variantChordName(0, 1, 'm7')); // Dm7
    await expect(page.locator('[data-base="Semicolon"] .chord-name')).toHaveText(variantChordName(0, 6, 'm7')); // Bm7♭5

    await releaseKey(page, 'd');
    await expect(page.locator('[data-base="KeyJ"] .chord-name')).toHaveText('C');
  });
});

test('the now-playing panel shows the actual sounding notes, named out', async ({ page }) => {
  const notesDisplay = page.locator('[data-display="playing-notes"]');
  await expect(notesDisplay).toHaveText('—');

  await holdKey(page, 'j'); // C major triad, root anchored at MIDI 60 (C4): C4 E4 G4
  await expect(notesDisplay).toHaveText('C4 E4 G4');

  await releaseKey(page, 'j');
  await expect(notesDisplay).toHaveText('—');
});
