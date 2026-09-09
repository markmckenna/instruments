// Optional practice click track: one low "tick" per beat (see
// AudioEngine.playClick) at the shared Tempo's current bpm, independent of
// loop recording/playback -- lets you find/hold a tempo before or while you
// record, rather than only being able to judge it after the fact from how a
// loop plays back. Same "look a little ahead, then let the real audio clock
// trigger it" scheduling pattern as LoopRecorder (see loop.js) -- kept as its
// own small scheduler rather than sharing one, since a free-running click
// (just "fire the next beat") is simpler than replaying a recorded event
// list with wraparound.
const LOOKAHEAD = 0.1; // seconds
const TICK_MS = 25;

export class Metronome {
  constructor(engine, tempo) {
    this.engine = engine;
    this.tempo = tempo;
    this.enabled = false;
    this._timer = null;
    this._startCtxTime = 0;
    this._nextBeat = 0;
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
    return this.enabled;
  }

  enable() {
    if (this.enabled) return;
    this.engine.unlock(); // ensures ctx exists even if nothing has sounded yet (see AudioEngine.unlock)
    this.enabled = true;
    this._startCtxTime = this.engine.ctx.currentTime;
    this._nextBeat = 0;
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  disable() {
    this.enabled = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * The click's own beat-grid time nearest to `ctxTime`. Lets another
   * scheduler (LoopRecorder, when starting playback) phase-align its own
   * start to the click instead of anchoring to an arbitrary real moment
   * (whenever a key happened to be released) that drifts independently of
   * it -- see loop.js's _startScheduler().
   */
  nearestBeatTime(ctxTime) {
    const beatsSinceStart = (ctxTime - this._startCtxTime) / this.tempo.beatSeconds;
    return this._startCtxTime + Math.round(beatsSinceStart) * this.tempo.beatSeconds;
  }

  _tick() {
    const ctxNow = this.engine.ctx.currentTime;
    const horizon = ctxNow + LOOKAHEAD - this._startCtxTime;
    // Bounded by construction: the beat counter only advances when the beat
    // it points at is due, and we stop as soon as the next one isn't yet.
    while (this._nextBeat * this.tempo.beatSeconds <= horizon) {
      this.engine.playClick(this._startCtxTime + this._nextBeat * this.tempo.beatSeconds);
      this._nextBeat += 1;
    }
  }
}
