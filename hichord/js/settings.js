// Cross-session preferences (key/voice/bpm/quantize/octave/mode/bass),
// persisted in a cookie so they survive a reload. Deliberately not the same
// thing as the rest of input.js's state -- that also covers per-key
// inversion/octave/lock and the loop, which are performance state scoped to
// a single sitting, not a preference to carry forward.

const COOKIE_NAME = 'hichord-settings';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

// input.js is also imported directly under plain Node by a few tests (for
// its exported constants, not its behavior -- see initInput's own module
// comment), so both functions below need to stay no-ops there rather than
// throw on a missing `document`.

export function saveSettings(settings) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(settings))}; max-age=${COOKIE_MAX_AGE}; path=/; samesite=lax`;
}

/** Whatever was last saved, or {} if there's nothing (or it's unreadable). */
export function loadSettings() {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  if (!match) return {};
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return {};
  }
}
