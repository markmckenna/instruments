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
    this.engine.stopChord('loop'); // don't leave whatever the old loop last triggered ringing forever
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
    if (this.events.length === 0) {
      this.state = 'idle';
      return;
    }
    // Snap to the *nearest* beat rather than always rounding up: rounding up
    // unconditionally tacks on up to almost a full beat of dead air at the
    // loop's tail on every recording, which is what made played-back loops
    // feel like they drift behind an external tempo. Nearest still can't go
    // below rawLength, though -- event timestamps are offsets from recording
    // start up to rawLength, so a shorter loop length would make an event's
    // own timestamp exceed the loop it's supposed to play within, throwing
    // off every subsequent iteration's timing.
    const nearestBeats = Math.round(rawLength / BEAT_SECONDS);
    const beats = Math.max(1, nearestBeats * BEAT_SECONDS >= rawLength ? nearestBeats : nearestBeats + 1);
    this.loopLength = beats * BEAT_SECONDS;
    // If recording stopped while a chord was still held, its 'on' event has
    // no matching 'off' -- without this, every loop iteration would fire
    // that same 'on' again while its notes are already sounding from the
    // previous iteration (playChord() leaves already-sounding notes alone,
    // see audio.js), so they'd never actually get released -- one continuous
    // note rather than a loop. Force a release right at the loop boundary so
    // playback always cleanly cuts the note before repeating.
    if (this.events[this.events.length - 1].type === 'on') {
      this.events.push({ t: this.loopLength, type: 'off', notes: null });
    }
    this.state = 'playing';
    this._startScheduler();
  }

  /** Stop looping playback (keeps the recorded events, use clear() to drop them). */
  stopPlaying() {
    this._stopScheduler();
    this.engine.stopChord('loop'); // release whatever the loop last triggered, don't let it ring forever
    if (this.state === 'playing') this.state = 'idle';
  }

  clear() {
    this._stopScheduler();
    this.engine.stopChord('loop'); // same as stopPlaying(): don't leave the last-triggered note stuck sounding
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

  // Schedules straight onto the audio clock via AudioEngine's `when` param
  // (osc.start(when), gain ramps from `when`) rather than deferring the call
  // itself with setTimeout: setTimeout's fire time is only as precise as the
  // JS event loop, which routinely lands tens of milliseconds late under any
  // contention, and that lateness would land directly on every note's actual
  // start/stop time -- audible as loop playback that drifts behind tempo.
  // Scheduling ahead (within LOOKAHEAD) and letting Web Audio's own clock
  // trigger the note is what "the standard lookahead pattern" actually means.
  _fireEvent(ev, when) {
    if (ev.type === 'on') this.engine.playChord('loop', ev.notes, when);
    else this.engine.stopChord('loop', when);
  }
}
