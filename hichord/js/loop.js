// Loop recorder: records events while active, then plays them back on
// repeat. Uses a Web-Audio lookahead scheduler (short setInterval that
// schedules anything due in the next LOOKAHEAD seconds) rather than relying
// on setTimeout/setInterval timing directly, so playback stays tight even
// under UI jank.

const LOOKAHEAD = 0.1; // seconds
const TICK_MS = 25;

export class LoopRecorder {
  constructor(engine, tempo, metronome) {
    this.engine = engine;
    this.tempo = tempo;
    this.metronome = metronome;
    this.state = 'idle'; // 'idle' | 'recording' | 'playing'
    // { t: secondsFromLoopStart, type: 'on' | 'off', notes, track: 'main' | 'bass' }
    // Two independent tracks share one event list (ordered by `t`) rather
    // than two separate lists: 'main' is whatever the current playback mode
    // produces (chord/lead, or the arpeggiator's note-by-note stepping),
    // 'bass' is the bass-toggle's low root, which needs its own voice so
    // arpeggio stepping on 'main' never touches it (see input.js's
    // refreshSound) -- "don't arpeggiate the bass note".
    this.events = [];
    this.loopLength = 0;
    this.voice = null; // engine voice preset in effect when this recording was made
    this._recordStart = 0;
    this._timer = null;
    this._loopStartCtxTime = 0;
    this._nextEventIndex = 0;
    this._iteration = 0;
    this._lastOnShift = { main: 0, bass: 0 }; // quantize shift applied to each track's most recent 'on', carried onto its own 'off' -- see recordEvent()
  }

  startRecording() {
    this._stopScheduler();
    this.engine.unlock();
    // Don't leave the old loop's last chord (or bass note) ringing forever, released in *its* voice.
    this.engine.stopChord('loop', undefined, this.voice);
    this.engine.stopChord('loop-bass', undefined, this.voice);
    this.events = [];
    this.state = 'recording';
    this._recordStart = this.engine.ctx.currentTime;
    this._lastOnShift = { main: 0, bass: 0 };
    this.voice = this.engine.voice; // pin to what's selected now -- cycling voices later reshapes only live playing, not this loop
  }

  recordEvent(type, notes, track = 'main') {
    if (this.state !== 'recording') return;
    // `notes` is always the *complete* set sounding at this instant, not a
    // delta, so playback can run each event through the same playChord()
    // reconciliation live play does (see audio.js) -- a pitch shared between
    // one event and the next just keeps sounding across them instead of
    // retriggering.
    const raw = this.engine.ctx.currentTime - this._recordStart;
    let t;
    if (type === 'on') {
      // Quantize the onset itself -- position on the grid is what playing
      // "in time" means.
      t = this.tempo.quantize(raw);
      this._lastOnShift[track] = t - raw;
    } else {
      // Leave the *release* unquantized: duration is feel, not a grid
      // position, and quantizing on/off independently could round a short
      // note's release down onto the same instant as its onset, silencing
      // it. Instead carry the onset's shift over so the note keeps its
      // actual held length. Clamp to this track's own previous event so a
      // note shorter than the shift itself can't invert into a negative
      // duration.
      const prevOfTrack = this._lastEventOfTrack(track);
      t = Math.max(raw + this._lastOnShift[track], prevOfTrack ? prevOfTrack.t : 0);
    }
    // Two events can legitimately land on the same instant; keep both rather
    // than collapsing the collision, since collapsing through an
    // intermediate 'off' could erase a chord that really was played
    // (on(A), off, on(B) -> just on(B)).
    this.events.push({ t, type, notes, track });
  }

  /** Most recently pushed event belonging to `track`, or undefined if none yet. */
  _lastEventOfTrack(track) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].track === track) return this.events[i];
    }
    return undefined;
  }

  stopRecording() {
    if (this.state !== 'recording') return;
    if (this.events.length === 0) {
      this.state = 'idle';
      return;
    }
    const rawLength = this.engine.ctx.currentTime - this._recordStart;
    // Snap to the *nearest* beat (the shared Tempo's bpm, see tempo.js), not
    // always up: rounding up would tack on up to a beat of dead air at the
    // tail on every recording, and since that overshoot is the loop length
    // itself, it'd compound on every repeat. Rounding down instead just clips
    // whatever's still sounding at the boundary a little early, generally
    // inaudible by then.
    const beats = Math.max(1, Math.round(rawLength / this.tempo.beatSeconds));
    this.loopLength = beats * this.tempo.beatSeconds;
    // Clamp any event past the (now-rounded) loop length, or it -- and the
    // next iteration's events -- would fire out of order.
    this.events = this.events.map((ev) => (ev.t > this.loopLength ? { ...ev, t: this.loopLength } : ev));
    // A chord (or bass note) still held when recording stopped has no
    // matching 'off' on its own track; force one per track at the loop
    // boundary so playback cuts it cleanly before repeating instead of
    // holding it continuously. The two tracks can each be mid-'on'
    // independently (e.g. bass toggled off moments before Space was
    // released), so this is checked per track, not just the last event
    // overall.
    for (const track of ['main', 'bass']) {
      const last = this._lastEventOfTrack(track);
      if (last && last.type === 'on') {
        this.events.push({ t: this.loopLength, type: 'off', notes: null, track });
      }
    }
    this.state = 'playing';
    this._startScheduler();
  }

  /** Stop looping playback, keeping the recorded events (state goes back to 'idle', not dropped). */
  stopPlaying() {
    this._stopScheduler();
    this.engine.stopChord('loop', undefined, this.voice);
    this.engine.stopChord('loop-bass', undefined, this.voice);
    if (this.state === 'playing') this.state = 'idle';
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
    // If the click is on, beat-match playback to its grid; otherwise
    // beat-match to right now.
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
  // rather than deferring the call itself with setTimeout, whose fire time
  // is only as precise as the JS event loop -- that lateness would land
  // directly on the note's actual start/stop time, audible as drift.
  _fireEvent(ev, when) {
    const voiceId = ev.track === 'bass' ? 'loop-bass' : 'loop';
    if (ev.type === 'on') this.engine.playChord(voiceId, ev.notes, when, this.voice);
    else this.engine.stopChord(voiceId, when, this.voice);
  }
}
