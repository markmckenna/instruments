// DOM rendering only: reads state handed to it by input.js and updates the
// static markup already in index.html (no DOM construction here, so the
// visual layout lives entirely in HTML/CSS where it's easy to tweak).

import { CHORD_KEYS, DEGREES, chordRootName } from './theory.js';

// Exported so tests can derive an expected chord-name label from the same
// single source of truth this module renders from, instead of a copy.
export const QUALITY_SUFFIX = { maj: '', min: 'm', dim: '°' };

export function renderUI({ key, voice, heldBases, heldVariant, loopState }) {
  document.querySelectorAll('[data-base]').forEach((el) => {
    const code = el.dataset.base;
    const degreeIndex = CHORD_KEYS.findIndex((k) => k.code === code);
    const degree = DEGREES[degreeIndex];
    const name = chordRootName(key.pc, degreeIndex) + QUALITY_SUFFIX[degree.quality];
    const nameEl = el.querySelector('.chord-name');
    if (nameEl) nameEl.textContent = name;
    el.classList.toggle('active', heldBases.includes(code));
  });

  document.querySelectorAll('[data-variant]').forEach((el) => {
    el.classList.toggle('active', el.dataset.variant === heldVariant);
  });

  const keyLabel = document.querySelector('[data-display="key"]');
  if (keyLabel) keyLabel.textContent = key.name;

  const voiceLabel = document.querySelector('[data-display="voice"]');
  if (voiceLabel) voiceLabel.textContent = voice.name;

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
}
