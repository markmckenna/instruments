// Loop recorder: hold Space to record, release to snap the loop length to
// the nearest beat (at the shared Tempo's bpm, see tempo.js) and start
// looping it. Uses a standard Web-Audio lookahead scheduler (short
// setInterval that schedules anything due in the next LOOKAHEAD seconds)
// rather than relying on setTimeout/setInterval timing directly, so
// playback stays tight even under UI jank.

const LOOKAHEAD = 0.1; // seconds
const TICK_MS = 25;

export class LoopRecorder {
  constructor(engine, tempo, metronome) {
    this.engine = engine;
    this.tempo = tempo;
    this.metronome = metronome;
    this.state = 'idle'; // 'idle' | 'recording' | 'playing'
    this.events = []; // { t: secondsFromLoopStart, type: 'on' | 'off', notes }
    this.loopLength = 0;
    this.voice = null; // the engine voice preset in effect when this recording was made -- see startRecording()
    this._recordStart = 0;
    this._timer = null;
    this._loopStartCtxTime = 0;
    this._nextEventIndex = 0;
    this._iteration = 0;
  }

  startRecording() {
    this._stopScheduler();
    this.engine.unlock(); // ensures ctx exists even if nothing has sounded yet (see AudioEngine.unlock)
    this.engine.stopChord('loop', undefined, this.voice); // don't leave whatever the old loop last triggered ringing forever, released in *its* voice
    this.events = [];
    this.state = 'recording';
    this._recordStart = this.engine.ctx.currentTime;
    // Pin this recording to whatever voice is selected right now, so cycling
    // voices later (while this loop plays, or before the next one) reshapes
    // only live playing -- the loop keeps sounding the way it was recorded.
    this.voice = this.engine.voice;
  }

  recordEvent(type, notes) {
    if (this.state !== 'recording') return;
    // `notes` is always the *complete* set sounding at this instant (input.js's
    // refreshSound() passes currentSound()'s full merged list), not a delta --
    // so on playback, each event can go through the same playChord()
    // reconciliation live play does (see audio.js), and a pitch shared between
    // one event and the next just keeps sounding across them instead of
    // retriggering. Playback reproduces live play's per-note independence
    // rather than approximating it.
    const raw = this.engine.ctx.currentTime - this._recordStart;
    // Quantize to the shared Tempo's grid (default: nearest 32nd note) --
    // "just on loops": this only ever touches what gets *recorded*, so live
    // play is never snapped, only what a loop plays back. Two events can
    // legitimately land on the same quantized instant (playing faster than
    // the grid resolves, or a coarse grid, e.g. 1/4); keep every event
    // rather than collapsing same-instant collisions, since collapsing
    // through an intermediate 'off' can erase a chord that really was
    // played (on(A), off, on(B) -> just on(B)). A same-instant attack+
    // release pair is harmless (mathematically silent), which is a far
    // smaller cost than ever losing a note outright.
    this.events.push({ t: this.tempo.quantize(raw), type, notes });
  }

  stopRecording() {
    if (this.state !== 'recording') return;
    if (this.events.length === 0) {
      this.state = 'idle';
      return;
    }
    const rawLength = this.engine.ctx.currentTime - this._recordStart;
    // Snap to the *nearest* beat, even if that rounds shorter than what was
    // actually played. Rounding up unconditionally would tack on up to
    // almost a full beat of dead air at the loop's tail on every recording,
    // and since that overshoot is *the loop length itself*, it compounds on
    // every repeat -- the loop would drift further behind an external tempo
    // the longer it played. Rounding down instead just clips whatever's
    // still sounding at the boundary a little early (at most a quarter
    // beat) -- generally well after its attack/decay has settled into a
    // steady sustain by then, so it's inaudible.
    const beats = Math.max(1, Math.round(rawLength / this.tempo.beatSeconds));
    this.loopLength = beats * this.tempo.beatSeconds;
    // No event may land beyond the loop it's meant to play within, or it
    // (and the next iteration's events) would fire out of order. Clamp
    // first, then decide below (using the now-clamped last event) whether a
    // synthetic release is still needed.
    this.events = this.events.map((ev) => (ev.t > this.loopLength ? { ...ev, t: this.loopLength } : ev));
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
    this.engine.stopChord('loop', undefined, this.voice); // see startRecording() above
    if (this.state === 'playing') this.state = 'idle';
  }

  clear() {
    this._stopScheduler();
    this.engine.stopChord('loop', undefined, this.voice); // see startRecording() above
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
    const now = this.engine.ctx.currentTime;
    // If the click is running, phase-lock playback to *its* beat grid
    // instead of anchoring to this exact real moment (whenever the record
    // key happened to be released). loopLength is always a whole number of
    // beats (see stopRecording), so once this one anchor point lands on the
    // click's grid, every later iteration (an integer number of beats
    // further on) automatically stays on it too -- otherwise the loop's own
    // phase is essentially random relative to the click, and drifts further
    // out of sync with it the longer you played before releasing, even
    // though the click and the loop's *internal* timing were each correct
    // on their own.
    this._loopStartCtxTime = this.metronome.enabled ? this.metronome.nearestBeatTime(now) : now;
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
    if (ev.type === 'on') this.engine.playChord('loop', ev.notes, when, this.voice);
    else this.engine.stopChord('loop', when, this.voice);
  }
}
