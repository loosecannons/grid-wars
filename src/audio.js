// All sound effects are synthesized with the Web Audio API — no samples needed.
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._noiseBuf = null;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
    this._startAmbience();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  get _t() { return this.ctx.currentTime; }

  _noise() {
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate * 2;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    return src;
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  _gain(v = 0, out) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(out || this.master);
    return g;
  }

  _startAmbience() {
    // Low electronic hum of the Grid
    const g = this._gain(0.035);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 180;
    lp.connect(g);
    for (const f of [54, 54.7, 108.3]) {
      const o = this._osc('sawtooth', f);
      const og = this.ctx.createGain();
      og.gain.value = f > 100 ? 0.25 : 1;
      o.connect(og); og.connect(lp);
      o.start();
    }
  }

  // Small random detune so repeated sounds never play twice the same.
  _v(f) { return f * (0.93 + Math.random() * 0.14); }

  blip(base = 920) {
    if (!this.ctx) return;
    const t = this._t;
    const g = this._gain();
    const f0 = this._v(base);
    const o = this._osc('square', f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.setValueAtTime(f0 * 1.5, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g);
    o.start(t); o.stop(t + 0.13);
  }

  uiDeny() {
    if (!this.ctx) return;
    const t = this._t;
    const g = this._gain();
    const o = this._osc('square', 220);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.15);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g);
    o.start(t); o.stop(t + 0.18);
  }

  // Battle-damaged units sound rough: pitch drops with lost structure and
  // below half health a sputtering crackle joins in.
  _sputter(t, dur, health) {
    if (health >= 0.5) return;
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.5;
    const g = this._gain();
    g.gain.value = 0;
    const lfo = this._osc('square', 14 + health * 12);
    const depth = this.ctx.createGain();
    depth.gain.value = 0.05;
    lfo.connect(depth); depth.connect(g.gain);
    n.connect(bp); bp.connect(g);
    n.start(t); n.stop(t + dur);
    lfo.start(t); lfo.stop(t + dur);
  }

  // Engine for a move of `dur` seconds — each unit type has its own voice:
  // cycles whine, tanks rumble, recognizers drone in airy chorus.
  engine(dur, health = 1, kind = 'cycle') {
    if (!this.ctx) return;
    const t = this._t;
    const p = (0.7 + 0.3 * health) * (0.95 + Math.random() * 0.1);
    const g = this._gain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.connect(g);

    const env = (peak) => {
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.08);
      g.gain.setValueAtTime(peak, t + Math.max(0.1, dur - 0.15));
      g.gain.linearRampToValueAtTime(0, t + dur);
    };

    if (kind === 'tank') {
      lp.frequency.value = 380 * p;
      const o = this._osc('square', 58 * p);
      o.frequency.exponentialRampToValueAtTime(105 * p, t + dur * 0.5);
      o.frequency.exponentialRampToValueAtTime(62 * p, t + dur);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
      const sub = this._osc('sine', 41 * p);
      const sg = this._gain();
      sg.gain.setValueAtTime(0.12, t);
      sg.gain.linearRampToValueAtTime(0, t + dur);
      sub.connect(sg);
      sub.start(t); sub.stop(t + dur + 0.05);
      env(0.16);
    } else if (kind === 'reco') {
      // a deep, heavy drone — these are big, slow machines
      lp.frequency.value = 320 * p;
      for (const detune of [1, 1.012]) {
        const o = this._osc('triangle', 78 * p * detune);
        o.frequency.exponentialRampToValueAtTime(116 * p * detune, t + dur * 0.5);
        o.frequency.exponentialRampToValueAtTime(88 * p * detune, t + dur);
        o.connect(lp);
        o.start(t); o.stop(t + dur + 0.05);
      }
      const sub = this._osc('sine', 39 * p); // low body weight
      const sg = this._gain();
      sg.gain.setValueAtTime(0.08, t);
      sg.gain.linearRampToValueAtTime(0, t + dur);
      sub.connect(sg);
      sub.start(t); sub.stop(t + dur + 0.05);
      env(0.12);
    } else if (kind === 'jet') {
      // a fast, airy jet whoosh — bright whine with a doppler-ish sweep
      lp.frequency.value = 2600 * p;
      const o = this._osc('sawtooth', 520 * p);
      o.frequency.setValueAtTime(420 * p, t);
      o.frequency.exponentialRampToValueAtTime(1150 * p, t + dur * 0.45);
      o.frequency.exponentialRampToValueAtTime(700 * p, t + dur);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
      const n = this._noise();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1900 * p; bp.Q.value = 0.8;
      const ng = this._gain();
      ng.gain.setValueAtTime(0.0, t);
      ng.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(bp); bp.connect(ng);
      n.start(t); n.stop(t + dur + 0.05);
      env(0.1);
    } else { // light cycle — the classic rising whine
      lp.frequency.value = 1100 * p;
      const o = this._osc('sawtooth', 130 * p);
      o.frequency.setValueAtTime(130 * p, t);
      o.frequency.exponentialRampToValueAtTime(520 * p, t + dur * 0.4);
      o.frequency.exponentialRampToValueAtTime(190 * p, t + dur);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
      env(0.14);
    }
    this._sputter(t, dur, health);
  }

  // Tank ram — heavy mechanical thud.
  // Low mechanical whir of a turret traversing.
  servo() {
    if (!this.ctx) return;
    const t = this._t;
    const g = this._gain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    lp.connect(g);
    const o = this._osc('sawtooth', this._v(78));
    o.frequency.setValueAtTime(72, t);
    o.frequency.linearRampToValueAtTime(116, t + 0.1);
    o.frequency.linearRampToValueAtTime(70, t + 0.2);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.03);
    g.gain.linearRampToValueAtTime(0.0, t + 0.22);
    o.connect(lp);
    o.start(t); o.stop(t + 0.24);
    // faint geartrain rattle
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 3;
    const ng = this._gain();
    ng.gain.setValueAtTime(0.028, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(bp); bp.connect(ng);
    n.start(t); n.stop(t + 0.22);
  }

  // Tesla-coil crackle for the perimeter pylon arcs — bright, brief, distant.
  zap() {
    if (!this.ctx) return;
    const t = this._t;
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    bp.Q.value = 1.4;
    const g = this._gain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(bp); bp.connect(g);
    n.start(t); n.stop(t + 0.22);
    // a thin high zing on top
    const o = this._osc('square', this._v(1900));
    o.frequency.exponentialRampToValueAtTime(620, t + 0.16);
    const og = this._gain();
    og.gain.setValueAtTime(0.018, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(og);
    o.start(t); o.stop(t + 0.18);
  }

  ram() {
    if (!this.ctx) return;
    const t = this._t;
    const o = this._osc('sine', this._v(110));
    o.frequency.exponentialRampToValueAtTime(28, t + 0.25);
    const g = this._gain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    o.start(t); o.stop(t + 0.32);
    const n = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600;
    const ng = this._gain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(lp); lp.connect(ng);
    n.start(t); n.stop(t + 0.22);
  }

  // Core conquest channel — eerie rising pulse.
  conquest() {
    if (!this.ctx) return;
    const t = this._t;
    for (let i = 0; i < 5; i++) {
      const o = this._osc('square', this._v(220 * Math.pow(1.25, i)));
      const g = this._gain();
      const st = t + i * 0.14;
      g.gain.setValueAtTime(0.001, st);
      g.gain.exponentialRampToValueAtTime(0.1, st + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.16);
      o.connect(g);
      o.start(st); o.stop(st + 0.18);
    }
  }

  laser(health = 1) {
    if (!this.ctx) return;
    const t = this._t;
    const p = (0.7 + 0.3 * health) * (0.93 + Math.random() * 0.14);
    const g = this._gain();
    const o = this._osc('sawtooth', 1500 * p);
    o.frequency.exponentialRampToValueAtTime(170 * p, t + 0.32);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g);
    o.start(t); o.stop(t + 0.4);
    // crackle
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600 * p; bp.Q.value = 2;
    const ng = this._gain();
    ng.gain.setValueAtTime(0.07, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(bp); bp.connect(ng);
    n.start(t); n.stop(t + 0.32);
    this._sputter(t, 0.4, health);
  }

  rocketLaunch(health = 1) {
    if (!this.ctx) return;
    const t = this._t;
    const p = (0.7 + 0.3 * health) * (0.93 + Math.random() * 0.14);
    const n = this._noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(350 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2400 * p, t + 0.5);
    const g = this._gain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(bp); bp.connect(g);
    n.start(t); n.stop(t + 0.62);
    const o = this._osc('sawtooth', 210 * p);
    o.frequency.exponentialRampToValueAtTime(90 * p, t + 0.5);
    const og = this._gain();
    og.gain.setValueAtTime(0.08, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og);
    o.start(t); o.stop(t + 0.52);
    this._sputter(t, 0.6, health);
  }

  dash(health = 1) {
    if (!this.ctx) return;
    const t = this._t;
    const p = (0.7 + 0.3 * health) * (0.93 + Math.random() * 0.14);
    const g = this._gain();
    const o = this._osc('sawtooth', 280 * p);
    o.frequency.exponentialRampToValueAtTime(950 * p, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(420 * p, t + 0.4);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g);
    o.start(t); o.stop(t + 0.45);
    this._sputter(t, 0.45, health);
  }

  // Gentle repair shimmer.
  heal() {
    if (!this.ctx) return;
    const t = this._t;
    [523, 659, 784].forEach((f, i) => {
      const o = this._osc('sine', f);
      const g = this._gain();
      const st = t + i * 0.09;
      g.gain.setValueAtTime(0.06, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.25);
      o.connect(g);
      o.start(st); o.stop(st + 0.27);
    });
  }

  // A tank crunching through a light wall.
  wallBreak() {
    if (!this.ctx) return;
    const t = this._t;
    const n = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 0.32);
    const g = this._gain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(lp); lp.connect(g);
    n.start(t); n.stop(t + 0.36);
    const o = this._osc('square', 75);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = this._gain();
    og.gain.setValueAtTime(0.12, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(og);
    o.start(t); o.stop(t + 0.24);
  }

  explosion(scale = 1) {
    if (!this.ctx) return;
    const t = this._t;
    const dur = 0.9 + 0.4 * scale;
    const n = this._noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 * Math.min(scale, 1.6), t);
    lp.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = this._gain();
    g.gain.setValueAtTime(Math.min(0.5, 0.3 * scale + 0.15), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(lp); lp.connect(g);
    n.start(t); n.stop(t + dur + 0.05);
    // sub thump
    const o = this._osc('sine', 95);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.5);
    const og = this._gain();
    og.gain.setValueAtTime(0.4 * Math.min(scale, 1.4), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(og);
    o.start(t); o.stop(t + 0.6);
  }

  derez() {
    if (!this.ctx) return;
    const t = this._t;
    const steps = [1318, 988, 659, 440, 293, 196];
    steps.forEach((f, i) => {
      const o = this._osc('square', f);
      const g = this._gain();
      const st = t + i * 0.065;
      g.gain.setValueAtTime(0.09, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.07);
      o.connect(g);
      o.start(st); o.stop(st + 0.08);
    });
    const n = this._noise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = this._gain();
    ng.gain.setValueAtTime(0.05, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(hp); hp.connect(ng);
    n.start(t); n.stop(t + 0.46);
  }

  // Falling into a pit — long descending whine.
  fall() {
    if (!this.ctx) return;
    const t = this._t;
    const g = this._gain();
    const o = this._osc('sawtooth', 640);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.55);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    o.start(t); o.stop(t + 0.62);
  }

  // Reverse-derez shimmer for a freshly constructed unit.
  materialize() {
    if (!this.ctx) return;
    const t = this._t;
    [196, 293, 440, 659, 988].forEach((f, i) => {
      const o = this._osc('square', f);
      const g = this._gain();
      const st = t + i * 0.06;
      g.gain.setValueAtTime(0.07, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.09);
      o.connect(g);
      o.start(st); o.stop(st + 0.1);
    });
    const n = this._noise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = this._gain();
    ng.gain.setValueAtTime(0.001, t);
    ng.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(hp); hp.connect(ng);
    n.start(t); n.stop(t + 0.52);
  }

  // ---------- music: random analog-synth cues à la Wendy Carlos ----------

  // A synth voice: detuned saws through a lowpass, with envelope.
  _voice(freq, start, dur, { type = 'sawtooth', gain = 0.04, attack = 0.08,
    filter = 900, detune = 0.4, sweepTo = null, out = null } = {}) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(filter, start);
    if (sweepTo) lp.frequency.exponentialRampToValueAtTime(sweepTo, start + dur * 0.8);
    const g = this._gain(0, out);
    g.gain.setValueAtTime(0.001, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.setValueAtTime(gain, start + Math.max(attack, dur - 0.5));
    g.gain.linearRampToValueAtTime(0.001, start + dur);
    lp.connect(g);
    for (const d of [-detune, detune]) {
      const o = this._osc(type, freq);
      o.detune.value = d * 8;
      o.connect(lp);
      o.start(start); o.stop(start + dur + 0.05);
    }
  }

  // ---------- start-screen theme ----------
  // An ORIGINAL heroic synth piece in the spirit of Wendy Carlos's TRON score
  // (analog brass lead, pedal drone, burbling square arpeggios) — a homage,
  // not a reproduction of the actual theme. Loops while the menus are up.
  startMenuTheme() {
    if (!this.ctx || this._menuOn) return;
    this._menuOn = true;
    if (!this.menuGain) {
      this.menuGain = this.ctx.createGain();
      this.menuGain.gain.value = 0;
      this.menuGain.connect(this.master);
    }
    this.menuGain.gain.cancelScheduledValues(this._t);
    this.menuGain.gain.setTargetAtTime(0.9, this._t, 0.5); // fade in
    const loop = () => {
      if (!this._menuOn) return;
      const dur = this._scheduleMenuTheme();
      this._menuTimer = setTimeout(loop, dur * 1000);
    };
    loop();
  }

  stopMenuTheme() {
    this._menuOn = false;
    clearTimeout(this._menuTimer);
    if (this.menuGain) this.menuGain.gain.setTargetAtTime(0, this._t, 0.3);
  }

  // Schedules one ~21s pass of the theme; returns its length in seconds.
  _scheduleMenuTheme() {
    const out = this.menuGain;
    const t = this._t + 0.08;
    const beat = 0.63;              // ~95 bpm
    const bars = 8;
    const root = 130.81;           // C3
    const st = (s) => root * Math.pow(2, s / 12);
    // i – i – VI – VII – i – i – iv – V  (a noble C-minor progression)
    const chordRoot = [0, 0, 8, 10, 0, 0, 5, 7];

    // low pedal: root two octaves down + its fifth, one chord per bar
    for (let b = 0; b < bars; b++) {
      const bt = t + b * 4 * beat;
      const r = chordRoot[b];
      this._voice(st(r - 24), bt, 4 * beat + 0.12,
        { type: 'sawtooth', gain: 0.05, attack: 0.08, filter: 230, detune: 0.3, out });
      this._voice(st(r - 12 + 7), bt, 4 * beat + 0.12,
        { gain: 0.02, attack: 0.5, filter: 300, out });
    }

    // burbling eighth-note arpeggios under it (root–fifth–octave–fifth)
    for (let b = 0; b < bars; b++) {
      const r = chordRoot[b];
      const arp = [r, r + 7, r + 12, r + 7];
      for (let i = 0; i < 8; i++) {
        const nt = t + (b * 4 + i * 0.5) * beat;
        this._voice(st(arp[i % 4]), nt, beat * 0.46,
          { type: 'square', gain: 0.017, attack: 0.01, filter: 1100, detune: 0.1, out });
      }
    }

    // original brass lead, doubled an octave up [semitone from C3, beat, length]
    const mel = [
      [12, 0, 2], [19, 2, 1], [20, 3, 1], [19, 4, 2], [15, 6, 2],
      [17, 8, 2], [19, 10, 1], [20, 11, 1], [24, 12, 3], [22, 15, 1],
      [20, 16, 2], [24, 18, 2], [27, 20, 3], [26, 23, 1],
      [24, 24, 2], [22, 26, 1], [20, 27, 1], [19, 28, 4],
    ];
    for (const [s, bs, l] of mel) {
      const nt = t + bs * beat, d = l * beat + 0.12;
      this._voice(st(s), nt, d,
        { type: 'sawtooth', gain: 0.05, attack: 0.06, filter: 480, sweepTo: 2000, detune: 0.6, out });
      this._voice(st(s + 12), nt, d,
        { type: 'sawtooth', gain: 0.022, attack: 0.06, filter: 850, detune: 0.4, out });
    }

    return bars * 4 * beat;
  }

  // Begin dropping occasional cues at random intervals.
  startMusic() {
    if (this._musicOn || !this.ctx) return;
    this._musicOn = true;
    const loop = () => {
      this._playCue();
      this._musicTimer = setTimeout(loop, 16000 + Math.random() * 26000);
    };
    this._musicTimer = setTimeout(loop, 3000 + Math.random() * 5000);
  }

  _playCue() {
    if (!this.ctx) return;
    const t = this._t + 0.05;
    const roots = [87.31, 98, 110, 130.81, 146.83]; // F2 G2 A2 C3 D3
    const root = roots[Math.floor(Math.random() * roots.length)];
    const st = (s) => root * Math.pow(2, s / 12); // semitone helper
    const minorScale = [0, 2, 3, 5, 7, 8, 10, 12];
    const kind = Math.floor(Math.random() * 7);
    if (kind === 4) { this._titleCue(); return; }
    if (kind === 5) { this._anthemCue(); return; }
    if (kind === 6) { this._chromaticCue(); return; }

    if (kind === 0) {
      // dark sustained pad: stacked minor chord, slow bloom
      for (const [s, oct] of [[0, 0], [3, 0], [7, 0], [10, 0], [0, 1]]) {
        this._voice(st(s) * (oct ? 2 : 1), t, 5.5,
          { gain: 0.022, attack: 1.6, filter: 620 });
      }
    } else if (kind === 1) {
      // arpeggio run, square with a ghost echo — very Carlos
      let degree = 0;
      for (let i = 0; i < 11; i++) {
        degree = Math.max(0, Math.min(7,
          degree + (Math.random() < 0.6 ? 1 : -2)));
        const f = st(minorScale[degree]) * 2;
        const nt = t + i * 0.17;
        this._voice(f, nt, 0.22, { type: 'square', gain: 0.035, attack: 0.01, filter: 1600, detune: 0.1 });
        this._voice(f, nt + 0.21, 0.18, { type: 'square', gain: 0.014, attack: 0.01, filter: 1100, detune: 0.1 });
      }
    } else if (kind === 2) {
      // brass swell: root + octave + fifth, crescendo with opening filter
      for (const s of [0, 7, 12]) {
        this._voice(st(s), t, 3.4,
          { gain: 0.03, attack: 1.9, filter: 320, sweepTo: 2100 });
      }
    } else {
      // low ostinato pattern, twice through
      const pattern = [0, 0, 12, 0, 10, 0, 7, 3];
      for (let rep = 0; rep < 2; rep++) {
        pattern.forEach((s, i) => {
          this._voice(st(s) / 2, t + (rep * pattern.length + i) * 0.19, 0.2,
            { type: 'square', gain: 0.04, attack: 0.01, filter: 480, detune: 0.15 });
        });
      }
    }
  }

  // An approximation of the opening four bars of the TRON main title:
  // a stately minor brass line rising to the fifth and settling home,
  // over a low pedal fifth and Carlos's burbling square arpeggios.
  _titleCue() {
    const t = this._t + 0.05;
    const beat = 0.62; // ~97 bpm
    const root = 130.81; // C3
    const st = (s) => root * Math.pow(2, s / 12);
    // [semitones, start beat, length in beats] — 16 beats = 4 bars of 4/4
    const melody = [
      [0, 0, 2], [3, 2, 1], [5, 3, 1],  // C   Eb F
      [7, 4, 4],                         // G   (held)
      [5, 8, 2], [3, 10, 1], [2, 11, 1], // F   Eb D
      [0, 12, 4],                        // C   (held)
    ];
    for (const [s, b, l] of melody) {
      this._voice(st(s) * 2, t + b * beat, l * beat + 0.1,
        { gain: 0.045, attack: 0.07, filter: 520, sweepTo: 1900, detune: 0.5 });
      this._voice(st(s), t + b * beat, l * beat + 0.1,
        { gain: 0.028, attack: 0.07, filter: 700, detune: 0.3 });
    }
    // pedal fifth holding under the whole phrase
    this._voice(st(0) / 2, t, 16 * beat, { gain: 0.022, attack: 1.4, filter: 300 });
    this._voice(st(7) / 2, t, 16 * beat, { gain: 0.016, attack: 1.4, filter: 300 });
    // eighth-note arpeggio burbling underneath
    const arp = [0, 7, 12, 15];
    for (let i = 0; i < 32; i++) {
      this._voice(st(arp[i % 4]), t + i * beat * 0.5, beat * 0.42,
        { type: 'square', gain: 0.011, attack: 0.01, filter: 950, detune: 0.1 });
    }
  }

  // A second phrase in the spirit of Carlos's TRON "Anthem": a noble line that
  // climbs through the minor scale to the octave and falls back home, sung by a
  // double-detuned brass voice over a held open-fifth drone.
  _anthemCue() {
    const t = this._t + 0.05;
    const beat = 0.66;
    const root = 110; // A2
    const st = (s) => root * Math.pow(2, s / 12);
    // [semitone, startBeat, lenBeats]
    const melody = [
      [7, 0, 1.5], [8, 1.5, 0.5], [10, 2, 2],   // E  F  G (held)
      [12, 4, 1.5], [10, 5.5, 0.5], [8, 6, 1], [7, 7, 1], // A  G  F  E
      [3, 8, 2], [5, 10, 1], [7, 11, 1],         // C  D  E
      [0, 12, 4],                                 // A (home, held)
    ];
    for (const [s, b, l] of melody) {
      this._voice(st(s) * 2, t + b * beat, l * beat + 0.12,
        { gain: 0.04, attack: 0.12, filter: 480, sweepTo: 1700, detune: 0.6 });
      this._voice(st(s), t + b * beat, l * beat + 0.12,
        { gain: 0.024, attack: 0.12, filter: 640, detune: 0.35 });
    }
    this._voice(st(0) / 2, t, 16 * beat, { gain: 0.02, attack: 1.8, filter: 280 });
    this._voice(st(7) / 2, t, 16 * beat, { gain: 0.015, attack: 1.8, filter: 280 });
  }

  // A taut, descending chromatic figure — the unease Carlos threads under the
  // MCP's scenes — over a pulsing low pedal.
  _chromaticCue() {
    const t = this._t + 0.05;
    const beat = 0.34;
    const root = 98; // G2
    const st = (s) => root * Math.pow(2, s / 12);
    const line = [12, 11, 10, 9, 8, 7, 6, 5, 7, 5, 3, 0]; // chromatic fall, then settle
    line.forEach((s, i) => {
      const nt = t + i * beat;
      this._voice(st(s) * 2, nt, beat * 1.1,
        { type: 'sawtooth', gain: 0.03, attack: 0.02, filter: 1300, detune: 0.25 });
    });
    // pulsing pedal underneath
    for (let i = 0; i < 12; i++) {
      this._voice(st(0) / 2, t + i * beat, beat * 0.7,
        { type: 'square', gain: 0.03, attack: 0.01, filter: 360, detune: 0.1 });
    }
  }

  chime(kind) {
    if (!this.ctx) return;
    const t = this._t;
    const seqs = {
      turn: [392, 523],
      enemyTurn: [523, 392],
      win: [523, 659, 784, 1046, 1318],
      lose: [392, 330, 262, 196, 131],
    };
    const seq = seqs[kind] || seqs.turn;
    seq.forEach((f, i) => {
      const o = this._osc('sine', f);
      const g = this._gain();
      const st = t + i * 0.13;
      g.gain.setValueAtTime(0.12, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.3);
      o.connect(g);
      o.start(st); o.stop(st + 0.32);
    });
  }
}
