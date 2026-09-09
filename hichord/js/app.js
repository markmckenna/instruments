import { initInput, initPointerControls, updateUI } from './input.js';

document.addEventListener('DOMContentLoaded', () => {
  initInput();
  initPointerControls(document);
  updateUI();
});
