// DOM rendering only: reads state handed to it by input.js and updates the
// static markup already in index.html (no DOM construction here, so the
// visual layout lives entirely in HTML/CSS where it's easy to tweak).

import { CHORD_KEYS, VARIANTS, variantChordName, midiName } from './theory.js';

export function renderUI({ key, voice, heldBases, heldVariant, loopState, bpm, quantizeDivision, clickEnabled, playingNotes }) {
  // Whatever's actually shaping the sound right now -- the held variant if
  // one is, otherwise the neutral center one -- same resolution currentSound()
  // uses in input.js. variantChordName('KeyS', ...) reduces to the plain
  // diatonic triad name, so this one path covers "nothing held" too.
  const effectiveVariant = heldVariant || 'KeyS';

  document.querySelectorAll('[data-base]').forEach((el) => {
    const code = el.dataset.base;
    const degreeIndex = CHORD_KEYS.findIndex((k) => k.code === code);
    const nameEl = el.querySelector('.chord-name');
    if (nameEl) nameEl.textContent = variantChordName(key.pc, degreeIndex, effectiveVariant);
    el.classList.toggle('active', heldBases.includes(code));
  });

  // Variant buttons normally show their own static description (what the
  // grid position *is*); while exactly one chord button is held, they show
  // what each variant would actually *do* to it instead -- a real chord
  // name, not a static label. Ambiguous with zero or several chords held
  // (which one's quality would even apply?), so those fall back to static.
  const singleDegreeIndex =
    heldBases.length === 1 ? CHORD_KEYS.findIndex((k) => k.code === heldBases[0]) : null;
  document.querySelectorAll('[data-variant]').forEach((el) => {
    const code = el.dataset.variant;
    const nameEl = el.querySelector('.variant-name');
    if (nameEl) {
      nameEl.textContent =
        singleDegreeIndex === null ? VARIANTS[code].label : variantChordName(key.pc, singleDegreeIndex, code);
    }
    el.classList.toggle('active', code === heldVariant);
  });

  const keyLabel = document.querySelector('[data-display="key"]');
  if (keyLabel) keyLabel.textContent = key.name;

  const voiceLabel = document.querySelector('[data-display="voice"]');
  if (voiceLabel) voiceLabel.textContent = voice.name;

  const bpmLabel = document.querySelector('[data-display="bpm"]');
  if (bpmLabel) bpmLabel.textContent = bpm;

  const quantizeLabel = document.querySelector('[data-display="quantize"]');
  if (quantizeLabel) quantizeLabel.textContent = `1/${quantizeDivision}`;

  const clickBtn = document.querySelector('[data-action="click-toggle"]');
  if (clickBtn) clickBtn.classList.toggle('active', clickEnabled);

  const recordBtn = document.querySelector('[data-action="record"]');
  if (recordBtn) {
    recordBtn.classList.toggle('recording', loopState === 'recording');
    recordBtn.classList.toggle('playing', loopState === 'playing');
  }

  const loopLabel = document.querySelector('[data-display="loop"]');
  if (loopLabel) {
    loopLabel.textContent =
      loopState === 'recording' ? 'Recording…' : loopState === 'playing' ? 'Looping' : 'No loop';
  }

  // Diagnostic: the actual MIDI notes sounding on the 'live' voice right
  // now, named out -- lets you check what's really playing against what you
  // expect to hear, not just trust the chord-button label.
  const playingLabel = document.querySelector('[data-display="playing-notes"]');
  if (playingLabel) {
    playingLabel.textContent = playingNotes && playingNotes.length ? playingNotes.map(midiName).join(' ') : '—';
  }
}
