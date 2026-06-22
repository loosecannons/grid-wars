// Multiplayer sync over the dumb WebSocket relay in server.js.
//
// Model: event lockstep on a deterministic engine. Every client runs the
// same seeded simulation; only ACTIONS travel the wire. The host browser
// is authoritative: it runs the AI factions and assigns joining players
// to unclaimed human factions. Spectators receive everything, send nothing.

export class Net {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.ws = null;
    this.isHost = false;
    this.myId = null;
    this.room = null;
    this.assignments = {};   // factionIndex -> clientId ('host' = the host)
    this._queue = [];
    this._processing = false;
    this._turnEndResolve = null;
    this._welcomeResolve = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(proto + location.host);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error('no relay')); this._onLinkLost(); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        this._onMessage(m);
      };
      ws.onclose = () => {
        if (this.room) this.ui.addChat('SYSTEM', '#e8f6ff', 'LINK TO THE GRID LOST.', false);
        this._onLinkLost();
      };
    });
  }

  // The relay link is gone — settle anything awaiting it (a pending join, the
  // turn-end wait) so the client surfaces the loss instead of hanging forever.
  _onLinkLost() {
    this._resolveWelcome(null);
    if (this.game && this.game.config) this.game.over = true;
    this._resolveTurnEnd();
  }

  _resolveWelcome(val) {
    if (this._welcomeTimer) { clearTimeout(this._welcomeTimer); this._welcomeTimer = null; }
    if (this._welcomeResolve) { this._welcomeResolve(val); this._welcomeResolve = null; }
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  cast(d) { this._send({ t: 'cast', d }); }
  to(target, d) { this._send({ t: 'to', target, d }); }

  // ---------- host ----------

  async host() {
    await this.connect();
    return new Promise((resolve) => {
      this._createdResolve = resolve;
      this._send({ t: 'create' });
    });
  }

  // ---------- joiner / spectator ----------

  async join(room, role) {
    this.role = role;
    await this.connect();
    this._send({ t: 'join', room, role });
    return new Promise((resolve) => {
      this._welcomeResolve = resolve;
      // never hang on a blank screen if the relay drops silently before 'welcome'
      this._welcomeTimer = setTimeout(() => this._resolveWelcome(null), 8000);
    });
  }

  // ---------- messages ----------

  _onMessage(m) {
    if (m.t === 'created') {
      this.isHost = true;
      this.myId = m.id;
      this.room = m.room;
      this.assignments = {};
      if (this._createdResolve) this._createdResolve(m.room);

    } else if (m.t === 'joined') {
      this.myId = m.id;
      this.room = m.room;

    } else if (m.t === 'err') {
      this.ui.addChat('SYSTEM', '#ff5544', m.m, false);
      this._resolveWelcome(null);

    } else if (m.t === 'peer') {
      if (!this.isHost) return;
      if (this.game.config) this._hostWelcome(m.id, m.role);
      else this._lobbyWelcome(m.id, m.role);

    } else if (m.t === 'left') {
      const f = Object.keys(this.assignments).find((k) => this.assignments[k] === m.id);
      if (f !== undefined) {
        delete this.assignments[f];
        if (this.isHost) this.cast({ k: 'assign', map: this.assignments });
        this.ui.addChat('SYSTEM', '#e8f6ff',
          'A PLAYER LEFT — THE HOST CONTROLS THEIR PROGRAMS.', false);
      }
      // if the host was parked waiting on the player who just vanished, end
      // their turn so the game keeps moving — and advance the other clients too
      if (this.isHost && this._turnEndResolve && m.id === this._awaitClient) {
        this.emitAdvance();
        this._resolveTurnEnd();
      }
      if (this.onRoster) this.onRoster();

    } else if (m.t === 'host-left') {
      this.ui.addChat('SYSTEM', '#ff5544', 'THE HOST LEFT THE GRID.', false);
      // the authoritative simulation is gone — stop cleanly instead of freezing
      // on a wait that can never complete
      if (this.game) this.game.over = true;
      this.ui.showBanner('THE HOST LEFT THE GRID', '#ff5544', 2600);
      this._resolveTurnEnd();
      if (this.onRoster) this.onRoster();

    } else if (m.t === 'msg') {
      this._onData(m.from, m.d, m.host === true);
    }
  }

  // Pre-game lobby: hand the newcomer a slot (or spectator seat) and the
  // combatant roster — the actual game starts for everyone at once.
  _lobbyWelcome(peerId, role) {
    const cfg = this.lobbyConfig;
    if (!cfg) return;
    if (role === 'play') {
      const firstHuman = cfg.configs.findIndex((c) => c.controller !== 'ai');
      const free = cfg.configs.findIndex((c, i) =>
        c.controller !== 'ai' && i !== firstHuman &&
        this.assignments[i] === undefined);
      if (free >= 0) {
        this.assignments[free] = peerId;
        this.cast({ k: 'assign', map: this.assignments });
      } else {
        role = 'watch';
      }
    }
    this.to(peerId, {
      k: 'welcome',
      lobby: true,
      sizeKey: cfg.sizeKey,
      configs: cfg.configs,
      assignments: this.assignments,
      you: role === 'play'
        ? Object.keys(this.assignments).find((k) => this.assignments[k] === peerId)
        : null,
    });
    if (this.onRoster) this.onRoster();
  }

  // Host launches the game for the whole room — same seed everywhere.
  startNetGame(seed) {
    const cfg = this.lobbyConfig;
    if (!cfg) return;
    this.cast({
      k: 'start',
      cfg: {
        sizeKey: cfg.sizeKey,
        seed,
        configs: cfg.configs,
        opts: cfg.opts || {}, // turn mode (simultaneous / per-unit initiative)
        assignments: this.assignments,
      },
    });
  }

  // Host: hand a snapshot (and, for players, a faction) to whoever arrives.
  _hostWelcome(peerId, role) {
    const g = this.game;
    const ready = () => {
      if (role === 'play') {
        const free = g.factions.findIndex((f, i) =>
          f.controller === 'human' && !f.eliminated &&
          this.assignments[i] === undefined && i !== this._hostFaction());
        if (free >= 0) {
          this.assignments[free] = peerId;
          this.cast({ k: 'assign', map: this.assignments });
          this.ui.addChat('SYSTEM', g.factions[free].css,
            g.factions[free].name + ' IS NOW PLAYER-CONTROLLED.', false);
        } else {
          role = 'watch';
        }
      }
      this.to(peerId, {
        k: 'welcome',
        snapshot: g.serialize(),
        assignments: this.assignments,
        you: role === 'play'
          ? Object.keys(this.assignments).find((k) => this.assignments[k] === peerId)
          : null,
      });
    };
    // never snapshot mid-animation, and never hand over a faction whose
    // turn is currently being played by the host — wait for it to end
    const claimTargetActive = () => {
      if (role !== 'play' || g.over) return false;
      const i = g.factions.findIndex((f, idx) =>
        f.controller === 'human' && !f.eliminated &&
        this.assignments[idx] === undefined && idx !== this._hostFaction());
      return i >= 0 && i === g.current;
    };
    const wait = () => ((g.busy || claimTargetActive()) && !g.over
      ? setTimeout(wait, 400) : ready());
    wait();
  }

  _hostFaction() {
    return this.game.factions.findIndex((f) => f.controller === 'human');
  }

  _onData(from, d, fromHost) {
    if (!d || typeof d !== 'object' || typeof d.k !== 'string') return;
    // Enforce the "host authoritative" model the relay can't: room-control
    // messages are honoured only from the host, and action/advance events only
    // from the host or an assigned player — a spectator can't hijack or desync.
    if (d.k === 'welcome' || d.k === 'assign' || d.k === 'start') {
      if (!fromHost) return;
    } else if (d.k === 'act' || d.k === 'adv') {
      const isPlayer = Object.values(this.assignments).includes(from);
      if (!fromHost && !isPlayer) return;
    }

    if (d.k === 'welcome') {
      this.assignments = d.assignments || {};
      if (d.you != null) this.myFaction = Number(d.you);
      this._resolveWelcome(d);

    } else if (d.k === 'assign') {
      this.assignments = d.map || {};
      if (this.onRoster) this.onRoster();

    } else if (d.k === 'start') {
      this.assignments = (d.cfg && d.cfg.assignments) || this.assignments;
      if (this.onStart) this.onStart(d.cfg);

    } else if (d.k === 'chat') {
      this.ui.addChat(d.name, d.css, d.text);

    } else if (d.k === 'bark') {
      // AI transmissions float above the speaking faction's core on every
      // client. `false` = display/speak only, don't echo it back out.
      this.game.coreBark(d.side, d.text, false);

    } else if (d.k === 'act' || d.k === 'adv') {
      this._queue.push(d);
      this._pump();
    }
  }

  // The joiner sets this once its restored game is ready to replay events;
  // anything that arrived in between stays queued.
  setReady() {
    this.ready = true;
    this._pump();
  }

  // Sequential replay of remote actions through the shared game engine.
  async _pump() {
    if (this._processing) return;
    if (!this.ready && !this.isHost) return;
    this._processing = true;
    while (this._queue.length) {
      const d = this._queue.shift();
      if (d.k === 'act') {
        try { await this.game.applyNetEvent(d.ev); }
        catch (e) { console.error('net apply failed', d.ev, e); }
      } else if (d.k === 'adv') {
        this._resolveTurnEnd();
      }
    }
    this._processing = false;
  }

  _resolveTurnEnd() {
    if (!this._turnEndResolve) return;
    const r = this._turnEndResolve;
    this._turnEndResolve = null;
    this._awaitClient = null;
    r();
  }

  // The turn driver parks here while someone else (remote player or the host's
  // AI) plays out their turn. `side` is the faction being awaited — the host
  // notes whose client that is so a mid-turn disconnect can unblock this wait
  // instead of freezing the game.
  waitTurnEnd(side) {
    this._awaitClient = (this.isHost && side != null) ? this.assignments[side] : null;
    return new Promise((res) => { this._turnEndResolve = res; });
  }

  // ---------- outgoing game hooks ----------

  emitAction(ev) { this.cast({ k: 'act', ev }); }
  emitAdvance() { this.cast({ k: 'adv' }); }
  emitChat(name, css, text) { this.cast({ k: 'chat', name, css, text }); }
  emitBark(side, text) { this.cast({ k: 'bark', side, text }); }

  ownsFaction(i) {
    if (this.isHost) return this.assignments[i] === undefined;
    return this.assignments[i] === this.myId;
  }

  inviteUrls() {
    const base = location.origin + location.pathname;
    return {
      join: base + '?join=' + this.room,
      watch: base + '?watch=' + this.room,
    };
  }
}
