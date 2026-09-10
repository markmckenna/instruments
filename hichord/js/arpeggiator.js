// Drives the "arpeggio" playback mode (see input.js): sequences a held
// chord's notes one at a time on voice id 'live' instead of sounding them
// together. Reuses AudioEngine.playChord()'s own exact-pitch reconciliation
// to step from one note to the next -- calling it every step with a single
// different note releases the previous one and attacks the new one with the
// normal per-voice envelope, so no separate on/off bookkeeping is needed
// here. Each step also runs through recorder.recordEvent() exactly like
// live chord/variant changes already do, so recording while arpeggiating
// captures the actual note-by-note pattern into the loop, not the merged
// chord -- no special-casing needed in loop.js for that.
//
// A plain poll loop (not the lookahead-scheduled pattern loop.js/
// metronome.js use for sample-accurate *playback*) is enough here: like live
// keyboard input, an arpeggio is generated live, not replayed, so it's held
// to the same timing precision live playing already has.
const TICK_MS = 20;

export class Arpeggiator {
  constructor(engine, tempo, recorder) {
    this.engine = engine;
    this.tempo = tempo;
    this.recorder = recorder;
    this._timer = null;
    this._index = -1;
    this._getNotes = null;
    this._nextStepAt = 0; // ctx time of the next due step
  }

  get running() {
    return this._timer !== null;
  }

  /** Start (or, if already running, just retarget) sequencing whatever `getNotes()` currently returns. */
  start(getNotes) {
    this._getNotes = getNotes;
    if (this._timer) return;
    this.engine.unlock(); // ensures ctx exists -- see AudioEngine.unlock
    this._index = -1;
    this._nextStepAt = this.engine.ctx.currentTime;
    this._timer = setInterval(() => this._poll(), TICK_MS);
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
    this._getNotes = null;
    this.engine.stopChord('live');
    this.recorder.recordEvent('off', null);
  }

  _poll() {
    if (this.engine.ctx.currentTime < this._nextStepAt) return;
    this._step();
    // README: cycle rate is 16th notes at the current bpm -- a quarter of a
    // beat -- read fresh every step (not cached at start()) so a BPM change
    // mid-arpeggio retimes it immediately, same as the metronome click does
    // (see metronome.js's own _tick()).
    this._nextStepAt += this.tempo.beatSeconds / 4;
  }

  _step() {
    const notes = this._getNotes();
    if (!notes.length) return; // nothing held right now -- hold position, resume once something's held again
    this._index = (this._index + 1) % notes.length;
    const note = notes[this._index];
    this.engine.playChord('live', [note]);
    // exactTime: this step's timing is already exact (see loop.js's
    // recordEvent), so recording it doesn't need -- and shouldn't get --
    // the human-timing quantize snap.
    this.recorder.recordEvent('on', [note], 'main', { exactTime: true });
  }
}
