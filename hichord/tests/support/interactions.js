// Drives HiChord's controls via real input (a real mouse pointer for
// on-screen buttons, real keyboard events for physical keys) instead of
// synthetic PointerEvents. input.js's bindPress() calls
// `el.setPointerCapture(e.pointerId)` unguarded, which throws if the
// pointerId doesn't belong to an actual active pointer -- a fabricated
// pointerId trips that. Holding two chord buttons "at once" for a polyphony
// test is done by combining one real mouse hold with one real keyboard hold,
// which is also a more faithful stand-in for two simultaneous touches than
// any single input device could give us alone.

export async function holdButtonByMouse(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

export async function releaseMouse(page) {
  await page.mouse.up();
}

export async function holdKey(page, key) {
  await page.keyboard.down(key);
}

export async function releaseKey(page, key) {
  await page.keyboard.up(key);
}
