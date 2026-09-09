// DOM rendering only: reads state handed to it by input.js and updates the
// static markup already in index.html (no DOM construction here, so the
// visual layout lives entirely in HTML/CSS where it's easy to tweak).

import { VARIANTS, NEUTRAL_VARIANT, variantChordName, chordDisplayName } from './theory.js';
import { midiName } from './audio.js';
import { CHORD_KEYS, VARIANT_KEYS } from './input.js';

const MODE_LABELS = { chord: 'Chord', bass: 'Bass', arpeggio: 'Arpeggio', lead: 'Lead' };

export function renderUI({
  key,
  voice,
  mode,
  heldBases,
  soundingBases,
  pendingBases,
  heldVariant,
  lockedModifier,
  keyOctaveShift,
  keyInversion,
  globalOctaveShift,
  loopState,
  bpm,
  quantizeDivision,
  clickEnabled,
  playingNotes,
}) {
  const physicalVariantId = heldVariant ? VARIANT_KEYS[heldVariant] : null;

  document.querySelectorAll('[data-base]').forEach((el) => {
    const code = el.dataset.base;
    const degreeIndex = CHORD_KEYS.findIndex((k) => k.code === code);
    // What's actually shaping this specific button's sound right now: the
    // physically-held variant overrides everything (same precedence
    // currentSound() in input.js uses live), otherwise this key's own
    // chord-lock if it has one, otherwise the plain diatonic triad.
    const effectiveVariant = physicalVariantId || lockedModifier[code] || NEUTRAL_VARIANT;
    const octaveShift = globalOctaveShift + (keyOctaveShift[code] || 0);
    const inversionIndex = keyInversion[code] || 0;
    const nameEl = el.querySelector('.chord-name');
    if (nameEl) nameEl.textContent = chordDisplayName(key.pc, degreeIndex, effectiveVariant, { inversionIndex, octaveShift });
    // 'active' means actually sounding; a chord key held only to silently
    // target it for an octave adjustment (see input.js's pressBase) gets
    // 'targeting' instead, so it reads as held without implying sound.
    el.classList.toggle('active', soundingBases.includes(code));
    el.classList.toggle('targeting', pendingBases.includes(code));
    el.classList.toggle('locked', code in lockedModifier);
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
    const variantId = VARIANT_KEYS[code];
    const moodEl = el.querySelector('.variant-mood');
    if (moodEl) moodEl.textContent = VARIANTS[variantId].mood; // fixed per grid position, never changes with held state
    const nameEl = el.querySelector('.variant-name');
    if (nameEl) {
      nameEl.textContent =
        singleDegreeIndex === null ? VARIANTS[variantId].label : variantChordName(key.pc, singleDegreeIndex, variantId);
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

  const octaveLabel = document.querySelector('[data-display="octave"]');
  if (octaveLabel) octaveLabel.textContent = globalOctaveShift > 0 ? `+${globalOctaveShift}` : `${globalOctaveShift}`;

  const modeLabel = document.querySelector('[data-display="mode"]');
  if (modeLabel) modeLabel.textContent = MODE_LABELS[mode];

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
