import { initPointerControls, updateUI } from './input.js';

document.addEventListener('DOMContentLoaded', () => {
  initPointerControls(document);
  updateUI();
});
