// Loop recorder: hold Tab to record, release to snap the loop length to the
// nearest beat at 120bpm and start looping it. Uses a standard Web-Audio
// lookahead scheduler (short setInterval that schedules anything due in the
// next LOOKAHEAD seconds) rather than relying on setTimeout/setInterval
// timing directly, so playback stays tight even under UI jank.

const BPM = 120;
const BEAT_SECONDS = 60 / BPM;
const LOOKAHEAD = 0.1; // seconds
const TICK_MS = 25;

export class LoopRecorder {
  constructor(engine) {
    this.engine = engine;
    this.state = 'idle'; // 'idle' | 'recording' | 'playing'
    this.events = []; // { t: secondsFromLoopStart, type: 'on' | 'off', notes }
    this.loopLength = 0;
    this._recordStart = 0;
    this._timer = null;
    this._loopStartCtxTime = 0;
    this._nextEventIndex = 0;
    this._iteration = 0;
  }

  startRecording() {
    this._stopScheduler();
    this.engine.unlock(); // idempotent; ensures ctx exists even if nothing has sounded yet
    this.events = [];
    this.state = 'recording';
    this._recordStart = this.engine.ctx.currentTime;
  }

  recordEvent(type, notes) {
    if (this.state !== 'recording') return;
    this.events.push({ t: this.engine.ctx.currentTime - this._recordStart, type, notes });
  }

  stopRecording() {
    if (this.state !== 'recording') return;
    const rawLength = this.engine.ctx.currentTime - this._recordStart;
    const beats = Math.max(1, Math.round(rawLength / BEAT_SECONDS));
    this.loopLength = beats * BEAT_SECONDS;
    if (this.events.length === 0) {
      this.state = 'idle';
      return;
    }
    this.state = 'playing';
    this._startScheduler();
  }

  /** Stop looping playback (keeps the recorded events, use clear() to drop them). */
  stopPlaying() {
    this._stopScheduler();
    if (this.state === 'playing') this.state = 'idle';
  }

  clear() {
    this._stopScheduler();
    this.state = 'idle';
    this.events = [];
    this.loopLength = 0;
  }

  _stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _startScheduler() {
    if (this.events.length === 0 || this.loopLength <= 0) {
      this.state = 'idle';
      return;
    }
    this._loopStartCtxTime = this.engine.ctx.currentTime;
    this._iteration = 0;
    this._nextEventIndex = 0;
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  _tick() {
    if (this.events.length === 0) {
      this._stopScheduler();
      this.state = 'idle';
      return;
    }
    const ctxNow = this.engine.ctx.currentTime;
    const horizon = ctxNow + LOOKAHEAD - this._loopStartCtxTime;
    // Bounded by construction: each pass either fires a due event (advancing
    // _nextEventIndex) or advances to the next loop iteration, and we stop
    // as soon as the next event is beyond the lookahead horizon.
    while (this.events.length > 0) {
      if (this._nextEventIndex >= this.events.length) {
        this._nextEventIndex = 0;
        this._iteration += 1;
      }
      const ev = this.events[this._nextEventIndex];
      const absOffset = this._iteration * this.loopLength + ev.t;
      if (absOffset > horizon) break;
      this._fireEvent(ev, this._loopStartCtxTime + absOffset);
      this._nextEventIndex += 1;
    }
  }

  _fireEvent(ev, when) {
    const ctx = this.engine.ctx;
    const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
    setTimeout(() => {
      if (this.state !== 'playing') return; // loop was cleared/stopped after this was scheduled
      if (ev.type === 'on') this.engine.playChord(ev.notes);
      else this.engine.stopChord();
    }, delayMs);
  }
}
