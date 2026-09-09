// Wires keyboard + on-screen (pointer) input to the theory/audio/loop modules,
// and keeps the UI in sync. This is the only module that holds mutable state.
// Also the sole owner of physical-key <-> abstract-id mappings (CHORD_KEYS,
// VARIANT_KEYS/VARIANT_GRID below): keycodes are an input concern, not a
// music-theory one, so theory.js never sees them.

import { CIRCLE_OF_FIFTHS, NEUTRAL_VARIANT } from './theory.js';
import { AudioEngine, buildChord } from './audio.js';
import { LoopRecorder } from './loop.js';
import { Metronome } from './metronome.js';
import { Tempo } from './tempo.js';
import { Arpeggiator } from './arpeggiator.js';
import { renderUI } from './ui.js';

// The 7 chord buttons, in the physical left-to-right order given in the
// top-level README ("JIKOLP; produce chords ... in that order, starting with
// the root"), mapped by index onto theory.js's DEGREES.
export const CHORD_KEYS = [
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyI', label: 'I' },
  { code: 'KeyK', label: 'K' },
  { code: 'KeyO', label: 'O' },
  { code: 'KeyL', label: 'L' },
  { code: 'KeyP', label: 'P' },
  { code: 'Semicolon', label: ';' },
];

// The 3x3 chord-variant grid (README: "QWE-ASD-ZXC provide chord variants
// while held, in order: augmented, Mm flip, dom7, dim, neutral, M7, 6sus2,
// sus4, 9"), each physical key mapped onto one of theory.js's VARIANTS ids.
export const VARIANT_KEYS = {
  KeyQ: 'aug', KeyW: 'mmFlip', KeyE: 'dom7',
  KeyA: 'dim', KeyS: 'neutral', KeyD: 'm7',
  KeyZ: 'sixSus2', KeyX: 'sus4', KeyC: 'ninth',
};

// Row-major layout of the grid above, for building/testing the on-screen 3x3
// UI -- mirrors the real HiChord's 3x3 joystick directions (Q=up-left,
// S=center, C=down-right, etc.), the tie-breaker used for anything the
// top-level README's spec left unspecified.
export const VARIANT_GRID = [
  ['KeyQ', 'KeyW', 'KeyE'],
  ['KeyA', 'KeyS', 'KeyD'],
  ['KeyZ', 'KeyX', 'KeyC'],
];

// The two octave-shift keys and the delta each applies -- see the "Octave
// shift" section below for the three different things pressing one can do.
const OCTAVE_KEYS = { BracketLeft: -1, BracketRight: 1 };
// Bounds a shift can reasonably reach before it stops being a useful register
// (global and per-key shifts are clamped independently, so a key already
// pushed to an extreme can still be pulled back the other way by the global
// register moving opposite it).
const OCTAVE_MIN = -3;
const OCTAVE_MAX = 3;

// Playback modes (Backquote cycles these -- see "Playback mode" below).
// 'chord' is the original, only behavior; the rest are additive.
const MODES = ['chord', 'bass', 'arpeggio', 'lead'];

export const engine = new AudioEngine();
// Shared by the loop recorder (loop-length rounding, note quantizing) and
// the metronome click (beat timing) -- see tempo.js.
export const tempo = new Tempo();
export const metronome = new Metronome(engine, tempo);
// Takes metronome too, so it can phase-lock loop playback to a running
// click instead of an arbitrary real moment -- see loop.js's _startScheduler().
export const recorder = new LoopRecorder(engine, tempo, metronome);
const arpeggiator = new Arpeggiator(engine, tempo, recorder);

const state = {
  keyIndex: 0, // index into CIRCLE_OF_FIFTHS
  modeIndex: 0, // index into MODES
  globalOctaveShift: 0, // whole octaves, applies on top of every key's own shift below
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

// Per-chord-key state -- keyed by the same `code` CHORD_KEYS/heldBases use.
// Each persists independently of whether that key is currently held, like a
// setting on the button itself, until something changes it again.
let keyOctaveShift = {}; // code -> whole octaves (default 0)
let keyInversion = {}; // code -> raw, ever-incrementing counter (see theory.js's invertOffsets for why raw)
let lockedModifier = {}; // code -> a VARIANTS id, or absent for no lock

// Octave-shift-key hold tracking -- see "Octave shift" below.
let heldOctaveKeys = []; // codes currently held (BracketLeft/BracketRight)
let octaveKeyTargetedChord = {}; // code -> true once this hold has already shifted a chord (live or silently), so its own release doesn't *also* shift the global register
let pendingOctaveTargets = new Set(); // base codes pressed while an octave key is held: suppressed from sounding until released (see pressBase)

const BASE_CODES = new Set(CHORD_KEYS.map((k) => k.code));
const VARIANT_CODES = new Set(Object.keys(VARIANT_KEYS));

function clampOctave(v) {
  return Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, v));
}

// Combines every currently-*sounding* chord button (i.e. held but not
// currently a silent octave-adjust target, see pressBase) into one sound.
// Unlike before, each key resolves its own variant/octave/inversion rather
// than sharing one uniform variant -- a chord-lock (see toggleLock) can now
// give different held keys different shapes at once, and a physically-held
// variant still overrides every key's shape live, lock or no lock, same
// precedence the joystick already had over everything else.
function currentSound() {
  const mode = MODES[state.modeIndex];
  const heldVariantCode = heldVariantStack[heldVariantStack.length - 1];
  const physicalVariantId = heldVariantCode ? VARIANT_KEYS[heldVariantCode] : null;
  const soundingBases = heldBases.filter((code) => !pendingOctaveTargets.has(code));
  if (soundingBases.length === 0) return null;
  const noteSet = new Set();
  soundingBases.forEach((code) => {
    const degreeIndex = CHORD_KEYS.findIndex((k) => k.code === code);
    const variantId = physicalVariantId || lockedModifier[code] || NEUTRAL_VARIANT;
    const octaveShift = clampOctave(state.globalOctaveShift + (keyOctaveShift[code] || 0));
    const inversionIndex = keyInversion[code] || 0;
    buildChord(CIRCLE_OF_FIFTHS[state.keyIndex].pc, degreeIndex, variantId, { octaveShift, inversionIndex, mode }).forEach(
      (n) => noteSet.add(n),
    );
  });
  return { notes: Array.from(noteSet).sort((a, b) => a - b) };
}

// Live playing and loop playback are independent engine voices ('live' and
// 'loop' respectively, see loop.js) so one doesn't cut the other off --
// holding a chord while a loop is playing mixes both instead of stealing the
// loop's sound.
function refreshSound() {
  const sound = currentSound();
  if (MODES[state.modeIndex] === 'arpeggio' && sound) {
    // Delegate entirely to the arpeggiator -- it drives engine.playChord and
    // recorder.recordEvent itself, one note at a time, on its own schedule.
    arpeggiator.start(() => currentSound()?.notes || []);
  } else {
    arpeggiator.stop();
    if (sound) {
      engine.playChord('live', sound.notes);
      recorder.recordEvent('on', sound.notes);
    } else {
      engine.stopChord('live');
      recorder.recordEvent('off', null);
    }
  }
  updateUI();
}

export function updateUI() {
  const sound = currentSound();
  renderUI({
    key: CIRCLE_OF_FIFTHS[state.keyIndex],
    voice: engine.voice,
    mode: MODES[state.modeIndex],
    heldBases, // all physically-held codes (incl. silent octave targets), for the variant-grid relabeling
    soundingBases: heldBases.filter((code) => !pendingOctaveTargets.has(code)),
    pendingBases: Array.from(pendingOctaveTargets),
    heldVariant: heldVariantStack[heldVariantStack.length - 1] || null,
    lockedModifier,
    keyOctaveShift,
    keyInversion,
    globalOctaveShift: state.globalOctaveShift,
    loopState: recorder.state,
    bpm: tempo.bpm,
    quantizeDivision: tempo.quantizeDivision,
    clickEnabled: metronome.enabled,
    playingNotes: sound ? sound.notes : [],
  });
}

function pressBase(code) {
  if (heldBases.includes(code)) return; // ignore key-repeat / duplicate pointer
  heldBases.push(code);
  if (heldOctaveKeys.length) {
    // An octave-shift key is already held: this press targets `code` for a
    // silent adjustment instead of sounding it (README: "pressing and
    // releasing a chord key while holding the octave shift button") -- see
    // releaseBase for where the actual shift is applied. Also marks every
    // currently-held octave key as having targeted a chord, so its own
    // release won't *also* shift the global register.
    pendingOctaveTargets.add(code);
    heldOctaveKeys.forEach((oc) => { octaveKeyTargetedChord[oc] = true; });
    updateUI();
  } else {
    refreshSound();
  }
}
function releaseBase(code) {
  const idx = heldBases.indexOf(code);
  if (idx === -1) return;
  heldBases.splice(idx, 1);
  if (pendingOctaveTargets.delete(code)) {
    const delta = heldOctaveKeys.reduce((sum, oc) => sum + OCTAVE_KEYS[oc], 0);
    keyOctaveShift[code] = clampOctave((keyOctaveShift[code] || 0) + delta);
    updateUI(); // silent -- this tap never sounded (see pressBase)
  } else {
    refreshSound();
  }
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

// --- Octave shift (BracketLeft = down, BracketRight = up) ----------------
// One key, three different effects depending on what's held when *it* goes
// down vs. what happens while it's held:
//  - a chord key already sounding at that moment: shift that key's pitch
//    immediately, audibly, while it keeps sounding (README: "pressing one
//    while a chord key is depressed").
//  - nothing held yet: this key becomes a modifier for the rest of its hold.
//    Any chord key pressed-and-released while it's held is targeted
//    silently instead of sounding (handled in pressBase/releaseBase above,
//    README: "pressing and releasing a chord key while holding the octave
//    shift button"). If no chord key ever gets targeted during the whole
//    hold, releasing it instead shifts the *global* register (README:
//    "without pressing a chord key").
// All held chord keys are affected, matching the "multiple chords held"
// convention used throughout this module (currentSound() already treats a
// single physical control as shaping whatever's held).
function pressOctaveKey(code) {
  if (heldOctaveKeys.includes(code)) return;
  heldOctaveKeys.push(code);
  octaveKeyTargetedChord[code] = false;
  if (heldBases.length) {
    const delta = OCTAVE_KEYS[code];
    heldBases.forEach((base) => {
      keyOctaveShift[base] = clampOctave((keyOctaveShift[base] || 0) + delta);
    });
    octaveKeyTargetedChord[code] = true;
    refreshSound();
  } else {
    updateUI();
  }
}
function releaseOctaveKey(code) {
  const idx = heldOctaveKeys.indexOf(code);
  if (idx === -1) return;
  heldOctaveKeys.splice(idx, 1);
  const targeted = octaveKeyTargetedChord[code];
  delete octaveKeyTargetedChord[code];
  if (!targeted) state.globalOctaveShift = clampOctave(state.globalOctaveShift + OCTAVE_KEYS[code]);
  if (heldBases.length) refreshSound();
  else updateUI();
}

// --- Inversions (Slash) ---------------------------------------------------
// Cycles every currently-held chord key's inversion by one step. See
// theory.js's invertOffsets for why this just increments a raw counter
// rather than storing/clamping a bounded index here.
function cycleInversion() {
  if (!heldBases.length) return;
  heldBases.forEach((code) => { keyInversion[code] = (keyInversion[code] || 0) + 1; });
  refreshSound();
}

// --- Chord lock (Period) --------------------------------------------------
// Locks whatever variant is currently held to every currently-held chord
// key, so each keeps sounding shaped by it even once the variant key itself
// is released. Pressing it again while holding the same chord key(s) updates
// the lock to whatever variant is held now, or clears it if none is.
function toggleLock() {
  if (!heldBases.length) return;
  const heldVariantCode = heldVariantStack[heldVariantStack.length - 1];
  const variantId = heldVariantCode ? VARIANT_KEYS[heldVariantCode] : null;
  heldBases.forEach((code) => {
    if (variantId) lockedModifier[code] = variantId;
    else delete lockedModifier[code];
  });
  refreshSound();
}

// --- Playback mode (Backquote) --------------------------------------------
function cycleMode() {
  state.modeIndex = (state.modeIndex + 1) % MODES.length;
  refreshSound();
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
// Physical-position based (event.code, not event.key), so the control
// scheme is independent of OS keyboard layout/language and shift/caps
// state, and matches the on-screen layout (described by physical key
// position) rather than characters typed.

/**
 * Wires the keyboard listeners above and the blur/visibility "panic" safety
 * valve. Deferred behind a function (call once, from app.js) rather than run
 * at module load, so this module's plain data and logic (CHORD_KEYS,
 * VARIANT_GRID, currentSound(), etc.) stay safe to import outside a browser
 * page -- e.g. the test suite imports this module directly under Node for
 * its expected-value helpers -- without touching `window`/`document` just by
 * importing it.
 */
export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (BASE_CODES.has(e.code)) { e.preventDefault(); pressBase(e.code); return; }
    if (VARIANT_CODES.has(e.code)) { e.preventDefault(); pressVariant(e.code); return; }
    if (OCTAVE_KEYS[e.code] !== undefined) {
      e.preventDefault();
      // The bracket keys do double duty, shifted: [ ]/octave unshifted (see
      // pressOctaveKey), { }/quantize with Shift held -- same physical keys
      // as their on-screen affordance, no separate binding to remember.
      if (e.shiftKey) changeQuantize(e.code === 'BracketRight' ? 1 : -1);
      else pressOctaveKey(e.code);
      return;
    }
    switch (e.code) {
      case 'ArrowLeft': e.preventDefault(); changeKey(-1); break;
      case 'ArrowRight': e.preventDefault(); changeKey(1); break;
      case 'ArrowUp': e.preventDefault(); changeVoice(1); break;
      case 'ArrowDown': e.preventDefault(); changeVoice(-1); break;
      case 'Minus': e.preventDefault(); changeBpm(-1); break;
      case 'Equal': e.preventDefault(); changeBpm(1); break;
      case 'Slash': e.preventDefault(); cycleInversion(); break;
      case 'Period': e.preventDefault(); toggleLock(); break;
      case 'Backquote': e.preventDefault(); cycleMode(); break;
      // Space, not Tab: Tab can be intercepted by browser/OS focus-cycling
      // accessibility features (e.g. macOS's Full Keyboard Access) before the
      // page ever sees the keydown -- silently breaking recording, not just
      // stealing focus. Space doesn't carry that meaning anywhere on this page.
      case 'Space': e.preventDefault(); toggleRecord(true); break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (BASE_CODES.has(e.code)) { e.preventDefault(); releaseBase(e.code); return; }
    if (VARIANT_CODES.has(e.code)) { e.preventDefault(); releaseVariant(e.code); return; }
    if (OCTAVE_KEYS[e.code] !== undefined) { e.preventDefault(); releaseOctaveKey(e.code); return; }
    if (e.code === 'Space') { e.preventDefault(); toggleRecord(false); }
  });

  // Safety valve: if the tab/window loses focus mid-hold (alt-tab,
  // notification, browser chrome), release everything so no note or
  // recording gets stuck on.
  window.addEventListener('blur', panic);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) panic();
  });
}

function panic() {
  heldBases = [];
  heldVariantStack = [];
  heldOctaveKeys = [];
  octaveKeyTargetedChord = {};
  pendingOctaveTargets = new Set();
  arpeggiator.stop();
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
  root.querySelectorAll('[data-octave]').forEach((el) => {
    const code = el.dataset.octave;
    bindPress(el, () => pressOctaveKey(code), () => releaseOctaveKey(code));
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
  root.querySelector('[data-action="inversion"]').addEventListener('click', () => cycleInversion());
  root.querySelector('[data-action="lock"]').addEventListener('click', () => toggleLock());
  root.querySelector('[data-action="mode-cycle"]').addEventListener('click', () => cycleMode());
  bindPress(root.querySelector('[data-action="record"]'), () => toggleRecord(true), () => toggleRecord(false));
}
