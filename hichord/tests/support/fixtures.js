// Shared Playwright fixtures for HiChord's integration tests.
//
// Every test gets a `page` that:
//   - fails the test if the app logged any console error or uncaught
//     exception (a page that "looks right" but is quietly erroring is a bug)
//   - has a Web Audio probe installed before the app's own scripts run, so
//     tests can assert on what the audio engine actually did (which
//     oscillators started/stopped, and at what frequencies) instead of only
//     on DOM state. This is what makes these *integration* tests rather
//     than DOM smoke tests -- they exercise the real audio.js/theory.js/
//     input.js/loop.js code paths end to end in a real browser.
import { test as base, expect } from '@playwright/test';

// Runs inside the page, before HiChord's own scripts. Wraps the handful of
// Web Audio calls the app actually makes so every start/stop is logged to
// window.__audioEvents, in order, without changing what they actually do.
function installAudioProbe() {
  window.__audioEvents = [];
  // Rounded to hundredths of a Hz to match support/expected-audio.js -- see
  // the comment there for why (Node's V8 vs. Chromium's V8 disagree on
  // Math.pow by a few ULPs, which is not otherwise worth chasing).
  const round = (freq) => Math.round(freq * 100) / 100;

  const OrigCtx = window.AudioContext || window.webkitAudioContext;
  function ProbedAudioContext(...args) {
    const ctx = new OrigCtx(...args);
    window.__audioContext = ctx; // exposed in case a future test wants ctx.state directly
    return ctx;
  }
  ProbedAudioContext.prototype = OrigCtx.prototype;
  window.AudioContext = ProbedAudioContext;
  window.webkitAudioContext = ProbedAudioContext;

  const origStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
    window.__audioEvents.push({ type: 'start', freq: round(this.frequency.value) });
    return origStart.apply(this, args);
  };

  const origStop = OscillatorNode.prototype.stop;
  OscillatorNode.prototype.stop = function (...args) {
    window.__audioEvents.push({ type: 'stop', freq: round(this.frequency.value) });
    return origStop.apply(this, args);
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(new Error(msg.text()));
    });

    await page.addInitScript(installAudioProbe);
    await page.goto('/');

    await use(page);

    expect(errors.map((e) => e.message)).toEqual([]);
  },
});

export { expect };

/** Current length of the audio event log -- pass to audioEventsSince() to read only what happens next. */
export async function markAudio(page) {
  return page.evaluate(() => window.__audioEvents.length);
}

/** Every probe event (start/stop) recorded since `mark`, in order. */
export async function audioEventsSince(page, mark) {
  return page.evaluate((from) => window.__audioEvents.slice(from), mark);
}
