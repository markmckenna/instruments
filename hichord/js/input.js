// Wires keyboard + on-screen (pointer) input to the theory/audio/loop modules,
// and keeps the UI in sync. This is the only module that holds mutable state.

import { CHORD_KEYS, VARIANTS, CIRCLE_OF_FIFTHS, buildChord } from './theory.js';
import { AudioEngine } from './audio.js';
import { LoopRecorder } from './loop.js';
import { Metronome } from './metronome.js';
import { Tempo } from './tempo.js';
import { renderUI } from './ui.js';

export const engine = new AudioEngine();
// Shared by the loop recorder (loop-length rounding, note quantizing) and
// the metronome click (beat timing) -- see tempo.js.
export const tempo = new Tempo();
export const recorder = new LoopRecorder(engine, tempo);
export const metronome = new Metronome(engine, tempo);

const state = {
  keyIndex: 0, // index into CIRCLE_OF_FIFTHS
};

// Chord buttons are polyphonic: any number can be held at once and all sound
// together (see currentSound() below), so this is a plain membership list,
// not a stack. The variant/joystick control is still a stack (only one
// variant shapes the sound at a time, matching the real device's single
// joystick), so that if you're holding two variant keys at once, releasing
// the most recent one falls back to whichever is still physically held,
// instead of going silent.
let heldBases = [];
let heldVariantStack = [];

const BASE_CODES = new Set(CHORD_KEYS.map((k) => k.code));
const VARIANT_CODES = new Set(Object.keys(VARIANTS));

// Combines every currently-held chord button into one sound: all of them are
// built with whatever variant is currently held (there's only one variant
// control, so it shapes all held chords uniformly) and their notes merged
// into a single deduped list. Holding just one button behaves exactly as
// before; holding several overlays them into one richer chord.
function currentSound() {
  if (heldBases.length === 0) return null;
  const variantCode = heldVariantStack.length ? heldVariantStack[heldVariantStack.length - 1] : 'KeyS';
  const degreeIndices = heldBases.map((code) => CHORD_KEYS.findIndex((k) => k.code === code));
  const noteSet = new Set();
  degreeIndices.forEach((degreeIndex) => {
    buildChord(CIRCLE_OF_FIFTHS[state.keyIndex].pc, degreeIndex, variantCode).forEach((n) => noteSet.add(n));
  });
  return { notes: Array.from(noteSet).sort((a, b) => a - b), degreeIndices, variantCode };
}

// Live playing and loop playback are independent engine voices ('live' and
// 'loop' respectively, see loop.js) so one doesn't cut the other off --
// holding a chord while a loop is playing mixes both instead of stealing the
// loop's sound.
function refreshSound() {
  const sound = currentSound();
  if (sound) {
    engine.playChord('live', sound.notes);
    recorder.recordEvent('on', sound.notes);
  } else {
    engine.stopChord('live');
    recorder.recordEvent('off', null);
  }
  updateUI();
}

export function updateUI() {
  renderUI({
    key: CIRCLE_OF_FIFTHS[state.keyIndex],
    voice: engine.voice,
    heldBases,
    heldVariant: heldVariantStack[heldVariantStack.length - 1] || null,
    loopState: recorder.state,
    bpm: tempo.bpm,
    quantizeDivision: tempo.quantizeDivision,
    clickEnabled: metronome.enabled,
  });
}

function pressBase(code) {
  if (heldBases.includes(code)) return; // ignore key-repeat / duplicate pointer
  heldBases.push(code);
  refreshSound();
}
function releaseBase(code) {
  const idx = heldBases.indexOf(code);
  if (idx === -1) return;
  heldBases.splice(idx, 1);
  refreshSound();
}
function pressVariant(code) {
  if (heldVariantStack.includes(code)) return;
  heldVariantStack.push(code);
  if (heldBases.length) refreshSound();
  else updateUI();
}
function releaseVariant(code) {
  const idx = heldVariantStack.indexOf(code);
  if (idx === -1) return;
  heldVariantStack.splice(idx, 1);
  if (heldBases.length) refreshSound();
  else updateUI();
}

function changeKey(delta) {
  state.keyIndex = (state.keyIndex + delta + CIRCLE_OF_FIFTHS.length) % CIRCLE_OF_FIFTHS.length;
  if (heldBases.length) refreshSound();
  else updateUI();
}
function changeVoice(delta) {
  engine.cycleVoice(delta);
  updateUI();
}
function changeBpm(delta) {
  tempo.setBpm(tempo.bpm + delta);
  updateUI();
}
function changeQuantize(delta) {
  if (delta > 0) tempo.doubleQuantize();
  else tempo.halveQuantize();
  updateUI();
}
function toggleClick() {
  metronome.toggle();
  updateUI();
}

function toggleRecord(down) {
  if (down) {
    if (recorder.state !== 'recording') {
      recorder.startRecording();
      const sound = currentSound(); // capture whatever's already sounding as t=0
      if (sound) recorder.recordEvent('on', sound.notes);
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
    case 'Space': e.preventDefault(); toggleRecord(true); break;
  }
});

window.addEventListener('keyup', (e) => {
  if (BASE_CODES.has(e.code)) { e.preventDefault(); releaseBase(e.code); return; }
  if (VARIANT_CODES.has(e.code)) { e.preventDefault(); releaseVariant(e.code); return; }
  if (e.code === 'Space') { e.preventDefault(); toggleRecord(false); }
});

// Safety valve: if the tab/window loses focus mid-hold (alt-tab, notification,
// browser chrome), release everything so no note or recording gets stuck on.
window.addEventListener('blur', panic);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) panic();
});
function panic() {
  heldBases = [];
  heldVariantStack = [];
  engine.stopChord('live');
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
  root.querySelector('[data-action="bpm-down"]').addEventListener('click', () => changeBpm(-1));
  root.querySelector('[data-action="bpm-up"]').addEventListener('click', () => changeBpm(1));
  root.querySelector('[data-action="quantize-down"]').addEventListener('click', () => changeQuantize(-1));
  root.querySelector('[data-action="quantize-up"]').addEventListener('click', () => changeQuantize(1));
  root.querySelector('[data-action="click-toggle"]').addEventListener('click', () => toggleClick());
  bindPress(root.querySelector('[data-action="record"]'), () => toggleRecord(true), () => toggleRecord(false));
  root.querySelector('[data-action="clear-loop"]').addEventListener('click', () => {
    recorder.clear();
    updateUI();
  });
}
