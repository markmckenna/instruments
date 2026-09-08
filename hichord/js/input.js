// Wires keyboard + on-screen (pointer) input to the theory/audio/loop modules,
// and keeps the UI in sync. This is the only module that holds mutable state.

import { CHORD_KEYS, VARIANTS, CIRCLE_OF_FIFTHS, buildChord } from './theory.js';
import { AudioEngine } from './audio.js';
import { LoopRecorder } from './loop.js';
import { renderUI } from './ui.js';

export const engine = new AudioEngine();
export const recorder = new LoopRecorder(engine);

const state = {
  keyIndex: 0, // index into CIRCLE_OF_FIFTHS
};

// Stacks (not single values) so that if you're holding two chord buttons (or
// two variant keys) at once, releasing the most recent one falls back to
// whichever is still physically held, instead of going silent.
let heldBaseStack = [];
let heldVariantStack = [];

const BASE_CODES = new Set(CHORD_KEYS.map((k) => k.code));
const VARIANT_CODES = new Set(Object.keys(VARIANTS));

function currentChord() {
  if (heldBaseStack.length === 0) return null;
  const baseCode = heldBaseStack[heldBaseStack.length - 1];
  const degreeIndex = CHORD_KEYS.findIndex((k) => k.code === baseCode);
  const variantCode = heldVariantStack.length ? heldVariantStack[heldVariantStack.length - 1] : 'KeyS';
  const notes = buildChord(CIRCLE_OF_FIFTHS[state.keyIndex].pc, degreeIndex, variantCode);
  return { notes, degreeIndex, variantCode };
}

function refreshSound() {
  const chord = currentChord();
  if (chord) {
    engine.updateChord(chord.notes);
    recorder.recordEvent('on', chord.notes);
  } else {
    engine.stopChord();
    recorder.recordEvent('off', null);
  }
  updateUI();
}

export function updateUI() {
  const chord = currentChord();
  renderUI({
    key: CIRCLE_OF_FIFTHS[state.keyIndex],
    voice: engine.voice,
    heldBase: heldBaseStack[heldBaseStack.length - 1] || null,
    heldVariant: heldVariantStack[heldVariantStack.length - 1] || null,
    activeDegreeIndex: chord ? chord.degreeIndex : null,
    loopState: recorder.state,
  });
}

function pressBase(code) {
  if (heldBaseStack.includes(code)) return; // ignore key-repeat / duplicate pointer
  heldBaseStack.push(code);
  refreshSound();
}
function releaseBase(code) {
  const idx = heldBaseStack.indexOf(code);
  if (idx === -1) return;
  heldBaseStack.splice(idx, 1);
  refreshSound();
}
function pressVariant(code) {
  if (heldVariantStack.includes(code)) return;
  heldVariantStack.push(code);
  if (heldBaseStack.length) refreshSound();
  else updateUI();
}
function releaseVariant(code) {
  const idx = heldVariantStack.indexOf(code);
  if (idx === -1) return;
  heldVariantStack.splice(idx, 1);
  if (heldBaseStack.length) refreshSound();
  else updateUI();
}

function changeKey(delta) {
  state.keyIndex = (state.keyIndex + delta + CIRCLE_OF_FIFTHS.length) % CIRCLE_OF_FIFTHS.length;
  if (heldBaseStack.length) refreshSound();
  else updateUI();
}
function changeVoice(delta) {
  engine.cycleVoice(delta);
  updateUI();
}

function toggleRecord(down) {
  if (down) {
    if (recorder.state !== 'recording') {
      recorder.startRecording();
      const chord = currentChord(); // capture whatever's already sounding as t=0
      if (chord) recorder.recordEvent('on', chord.notes);
    }
  } else if (recorder.state === 'recording') {
    recorder.stopRecording();
  }
  updateUI();
}

// --- Keyboard ---------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (BASE_CODES.has(e.code)) { e.preventDefault(); pressBase(e.code); return; }
  if (VARIANT_CODES.has(e.code)) { e.preventDefault(); pressVariant(e.code); return; }
  switch (e.code) {
    case 'ArrowLeft': e.preventDefault(); changeKey(-1); break;
    case 'ArrowRight': e.preventDefault(); changeKey(1); break;
    case 'ArrowUp': e.preventDefault(); changeVoice(1); break;
    case 'ArrowDown': e.preventDefault(); changeVoice(-1); break;
    case 'Tab': e.preventDefault(); toggleRecord(true); break;
  }
});

window.addEventListener('keyup', (e) => {
  if (BASE_CODES.has(e.code)) { e.preventDefault(); releaseBase(e.code); return; }
  if (VARIANT_CODES.has(e.code)) { e.preventDefault(); releaseVariant(e.code); return; }
  if (e.code === 'Tab') { e.preventDefault(); toggleRecord(false); }
});

// Safety valve: if the tab/window loses focus mid-hold (alt-tab, notification,
// browser chrome), release everything so no note or recording gets stuck on.
window.addEventListener('blur', panic);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) panic();
});
function panic() {
  heldBaseStack = [];
  heldVariantStack = [];
  engine.stopChord();
  if (recorder.state === 'recording') recorder.stopRecording();
  updateUI();
}

// --- On-screen (pointer) controls --------------------------------------

function bindPress(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    onDown();
  });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

export function initPointerControls(root) {
  root.querySelectorAll('[data-base]').forEach((el) => {
    const code = el.dataset.base;
    bindPress(el, () => pressBase(code), () => releaseBase(code));
  });
  root.querySelectorAll('[data-variant]').forEach((el) => {
    const code = el.dataset.variant;
    bindPress(el, () => pressVariant(code), () => releaseVariant(code));
  });
  root.querySelector('[data-action="key-prev"]').addEventListener('click', () => changeKey(-1));
  root.querySelector('[data-action="key-next"]').addEventListener('click', () => changeKey(1));
  root.querySelector('[data-action="voice-prev"]').addEventListener('click', () => changeVoice(-1));
  root.querySelector('[data-action="voice-next"]').addEventListener('click', () => changeVoice(1));
  bindPress(root.querySelector('[data-action="record"]'), () => toggleRecord(true), () => toggleRecord(false));
  root.querySelector('[data-action="clear-loop"]').addEventListener('click', () => {
    recorder.clear();
    updateUI();
  });
}
