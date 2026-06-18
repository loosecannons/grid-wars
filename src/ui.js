import { UNIT_TYPES, SIZES, COLOR_PALETTE, UNIT_DEFAULTS, TUNABLE_UNITS, TUNABLE_STATS } from './constants.js';
import { CAMPAIGNS } from './campaigns.js';
import { UnitPreview } from './preview3d.js';

export class UI {
  constructor() {
    this.preview = new UnitPreview(document.getElementById('unit-preview'));
    this.targetPreview = new UnitPreview(document.getElementById('target-preview'), 202, 120);
    this.turnLabel = document.getElementById('turn-label');
    this.turnCount = document.getElementById('turn-count');
    this.energyEl = document.getElementById('energy');
    this.banner = document.getElementById('banner');
    this.card = document.getElementById('unit-card');
    this.buildMenu = document.getElementById('build-menu');
    this.turretControls = document.getElementById('turret-controls');
    this.altControls = document.getElementById('alt-controls');
    this.endTurnBtn = document.getElementById('btn-endturn');
    this.undoBtn = document.getElementById('btn-undo');
    this.muteBtn = document.getElementById('btn-sound');
    this.gameover = document.getElementById('gameover');
    this.targetCard = document.getElementById('target-card');
    this.pushBtn = document.getElementById('btn-push');
    this.conquerBtn = document.getElementById('btn-conquer');
    this._bannerTimer = null;
    this._onBuild = null;
    this._onTurret = null;
    this._onAltitude = null;
    this._onPush = null;
    this._onConquer = null;
    this.pushBtn.addEventListener('click', () => { if (this._onPush) this._onPush(); });
    this.conquerBtn.addEventListener('click', () => { if (this._onConquer) this._onConquer(); });

    // chat & voice
    this._onChat = null;
    this.voiceOn = localStorage.getItem('gw-voice') === '1';
    const voiceBtn = document.getElementById('btn-voice');
    voiceBtn.textContent = 'VOICE: ' + (this.voiceOn ? 'ON' : 'OFF');
    voiceBtn.addEventListener('click', () => {
      this.voiceOn = !this.voiceOn;
      try { localStorage.setItem('gw-voice', this.voiceOn ? '1' : '0'); } catch (e) { /* ignore */ }
      voiceBtn.textContent = 'VOICE: ' + (this.voiceOn ? 'ON' : 'OFF');
      if (!this.voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
    });
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation(); // don't trigger game keybinds while typing
      if (ev.key === 'Enter' && chatInput.value.trim()) {
        if (this._onChat) this._onChat(chatInput.value.trim());
        chatInput.value = '';
      }
    });

    // collapsible chat (state persists)
    const chatEl = document.getElementById('chat');
    const chatToggle = document.getElementById('btn-chat-toggle');
    const applyChatMin = (min) => {
      chatEl.classList.toggle('min', min);
      chatToggle.textContent = min ? '+' : '—';
    };
    applyChatMin(localStorage.getItem('gw-chat-min') === '1');
    chatToggle.addEventListener('click', () => {
      const min = !chatEl.classList.contains('min');
      applyChatMin(min);
      try { localStorage.setItem('gw-chat-min', min ? '1' : '0'); } catch (e) { /* ignore */ }
    });

    // grouped game menu (restart / quit / sound)
    const menuBtn = document.getElementById('btn-menu');
    const menuPanel = document.getElementById('menu-panel');
    menuBtn.addEventListener('click', () => menuPanel.classList.toggle('open'));

    for (const btn of this.buildMenu.querySelectorAll('button[data-build]')) {
      const def = UNIT_TYPES[btn.dataset.build];
      btn.textContent = def.name + ' — ' + def.cost + '⚡';
      btn.addEventListener('click', () => {
        if (this._onBuild) this._onBuild(btn.dataset.build);
      });
    }
    for (const btn of this.turretControls.querySelectorAll('button[data-turret]')) {
      btn.addEventListener('click', () => {
        if (this._onTurret) this._onTurret(Number(btn.dataset.turret));
      });
    }
    for (const btn of this.altControls.querySelectorAll('button[data-alt]')) {
      btn.addEventListener('click', () => {
        if (this._onAltitude) this._onAltitude(Number(btn.dataset.alt));
      });
    }
  }

  onBuild(cb) { this._onBuild = cb; }
  onTurret(cb) { this._onTurret = cb; }
  onAltitude(cb) { this._onAltitude = cb; }
  onPush(cb) { this._onPush = cb; }
  onConquer(cb) { this._onConquer = cb; }
  onChat(cb) { this._onChat = cb; }

  // ---------- chat & synthetic voice ----------

  addChat(name, css, text, speak = true) {
    const log = document.getElementById('chat-log');
    const row = document.createElement('div');
    row.className = 'msg';
    row.style.color = css;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = name + ' › ';
    row.appendChild(who);
    row.appendChild(document.createTextNode(text));
    log.appendChild(row);
    while (log.children.length > 50) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if (speak) this.speak(text);
  }

  speak(text) {
    if (!this.voiceOn || !window.speechSynthesis) return;
    if (window.speechSynthesis.pending) return; // don't pile up a backlog
    if (this._enVoice === undefined) {
      const pick = () => {
        const vs = window.speechSynthesis.getVoices();
        this._enVoice = vs.find((v) => /^en[-_](US|GB)/i.test(v.lang))
          || vs.find((v) => v.lang && v.lang.toLowerCase().startsWith('en'))
          || null;
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
    const u = new SpeechSynthesisUtterance(text.toLowerCase());
    u.lang = 'en-US'; // transmissions are in English, whatever the OS locale
    if (this._enVoice) u.voice = this._enVoice;
    u.pitch = 0.45;  // flat, machine-like — as close to a vocoder as we get
    u.rate = 0.92;
    u.volume = 0.9;
    window.speechSynthesis.speak(u);
  }

  // ---------- start flow: size, then faction setup ----------

  // Animated screen switch. If another menu overlay is currently up, it plays
  // its fly-out (rushes toward the viewer + fades) first, then we hide it and
  // reveal the target — which runs its own fly-in. Sequencing the two is what
  // makes it read as "zoom through, then switch" instead of an in-place bounce.
  // With no current overlay (first load, or coming from a game) it shows at once.
  revealScreen(id) {
    // Direction is set transiently by back/quit handlers via this._navBack;
    // forward (into deeper screens) is the default. Consume it once.
    const back = !!this._navBack;
    this._navBack = false;
    const MENUS = ['startmenu', 'setupmenu', 'campaignmenu', 'briefing', 'lobby', 'replaysmenu', 'rulesmenu'];
    const exitClass = back ? 'exiting-back' : 'exiting';
    const target = document.getElementById(id);
    const current = MENUS
      .map((m) => document.getElementById(m))
      .find((el) => el && el !== target && el.style.display === 'flex'
        && !el.classList.contains('exiting') && !el.classList.contains('exiting-back'));
    // Re-rendering a screen that's already shown (e.g. deleting a saved game
    // refreshes the start menu's list) must not replay the fly-through.
    if (!current && target.style.display === 'flex') return;
    const inClass = back ? 'rev-in' : 'fly-in';
    const reveal = () => {
      target.classList.remove('fly-in', 'rev-in');
      target.classList.add(inClass);
      target.style.display = 'flex';
      let cleared = false;
      const clr = () => {
        if (cleared) return;
        cleared = true;
        target.removeEventListener('animationend', clr);
        target.classList.remove(inClass);
      };
      target.addEventListener('animationend', clr);
      setTimeout(clr, 700);
    };
    if (!current) { reveal(); return; }
    current.classList.add(exitClass);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      current.removeEventListener('animationend', finish);
      current.style.display = 'none';
      current.classList.remove('exiting', 'exiting-back');
      reveal();
    };
    // animationend bubbles from the panels; fall back to a timer just in case.
    current.addEventListener('animationend', finish);
    setTimeout(finish, 520); // ≥ fly-out duration
  }

  showStartMenu(cb, cbCampaign, sessionOpts = null, cbLobby = null) {
    // Retain the launch callbacks across re-entries. Coming back from the
    // campaign/tutorial menu or the BACK button in setup re-shows this menu,
    // and those paths don't carry the full callback set — without this the
    // online lobby (and campaign) options would vanish on the second visit.
    cb = cb || this._startCb;
    cbCampaign = cbCampaign || this._startCampaign;
    sessionOpts = sessionOpts || this._startSessions;
    cbLobby = cbLobby || this._startLobby;
    this._startCb = cb;
    this._startCampaign = cbCampaign;
    this._startSessions = sessionOpts;
    this._startLobby = cbLobby;

    const menu = document.getElementById('startmenu');
    this.revealScreen('startmenu');
    for (const btn of menu.querySelectorAll('button[data-size]')) {
      btn.onclick = () => {
        this.showSetup(btn.dataset.size, cb, cbLobby);
      };
    }
    for (const btn of menu.querySelectorAll('button[data-mode]')) {
      btn.onclick = () => {
        this.showCampaignMenu(btn.dataset.mode, cbCampaign,
          () => { this._navBack = true; this.showStartMenu(); });
      };
    }

    // saved sessions — several games can be in flight at once
    const sp = document.getElementById('sessions-panel');
    sp.innerHTML = '';
    const sessions = (sessionOpts && sessionOpts.sessions) || {};
    const ids = Object.keys(sessions).sort((a, b) => sessions[b].t - sessions[a].t);
    if (ids.length) {
      const title = document.createElement('div');
      title.className = 'sess-title';
      title.textContent = 'ACTIVE GRIDS — RESUME A RUNNING GAME';
      sp.appendChild(title);
      for (const id of ids) {
        const row = document.createElement('div');
        row.className = 'sess-row';
        const resume = document.createElement('button');
        resume.className = 'resume';
        resume.textContent = sessions[id].label || id;
        resume.addEventListener('click', () => {
          menu.style.display = 'none';
          sessionOpts.onResume(id);
        });
        const del = document.createElement('button');
        del.className = 'small del';
        del.textContent = '✕';
        del.addEventListener('click', () => sessionOpts.onDelete(id));
        row.appendChild(resume);
        row.appendChild(del);
        sp.appendChild(row);
      }
    }

    // hall of fame: top scores per map size
    const hp = document.getElementById('hs-panel');
    hp.innerHTML = '';
    for (const sizeKey of Object.keys(SIZES)) {
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem('gridwars-hs-' + sizeKey) || '[]')
          .map((e) => (typeof e === 'number' ? { score: e, name: '---' } : e));
      } catch (e) { /* fresh */ }
      if (!list.length) continue;
      const col = document.createElement('div');
      col.className = 'hs-col';
      const head = document.createElement('div');
      head.className = 'hs-size';
      head.textContent = sizeKey;
      col.appendChild(head);
      for (const e of list.slice(0, 3)) {
        const line = document.createElement('div');
        line.textContent = (e.name || '---') + ' ' + String(e.score).padStart(4, '0');
        col.appendChild(line);
      }
      hp.appendChild(col);
    }
  }

  // Mission select: missions unlock in order as you win them.
  showCampaignMenu(cid, cbLaunch, cbBack) {
    const camp = CAMPAIGNS[cid];
    const menu = document.getElementById('campaignmenu');
    this.revealScreen('campaignmenu');
    document.getElementById('cm-title').textContent = camp.name;
    let progress = 0;
    try {
      progress = (JSON.parse(localStorage.getItem('gw-progress') || '{}'))[cid] || 0;
    } catch (e) { /* fresh */ }
    const list = document.getElementById('cm-missions');
    list.innerHTML = '';
    camp.missions.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.textContent = m.title + (i < progress ? '  ✓' : '');
      btn.disabled = i > progress;
      btn.addEventListener('click', () => {
        this.showBriefing(m, () => cbLaunch(cid, i),
          () => { this._navBack = true; this.showCampaignMenu(cid, cbLaunch, cbBack); });
      });
      list.appendChild(btn);
    });
    document.getElementById('cm-back').onclick = () => {
      cbBack();
    };
  }

  showBriefing(mission, onLaunch, onBack) {
    const el = document.getElementById('briefing');
    this.revealScreen('briefing');
    document.getElementById('br-title').textContent = mission.title;
    document.getElementById('br-lines').innerHTML =
      mission.briefing.map((l) => '<div></div>').join('');
    const divs = document.getElementById('br-lines').children;
    mission.briefing.forEach((l, i) => { divs[i].textContent = l; });
    document.getElementById('br-launch').onclick = () => {
      el.style.display = 'none';
      onLaunch();
    };
    document.getElementById('br-back').onclick = () => {
      if (onBack) onBack();
    };
  }

  // Faction setup: name (the "login"), colour (= side), controller.
  showSetup(sizeKey, cb, cbLobby = null) {
    const cfg = SIZES[sizeKey];
    const menu = document.getElementById('setupmenu');
    const rowsEl = document.getElementById('setup-rows');
    this.revealScreen('setupmenu');
    document.getElementById('setup-sub').textContent =
      cfg.label + ' GRID — UP TO ' + cfg.maxPlayers + ' COMBATANTS';

    let rows;
    try {
      rows = JSON.parse(localStorage.getItem('gw-setup') || 'null');
    } catch (e) { rows = null; }
    if (!Array.isArray(rows) || rows.length < 2) {
      rows = [
        { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
        { name: 'MCP', color: 1, controller: 'ai', team: 2 },
      ];
    }
    rows = rows.slice(0, cfg.maxPlayers);
    rows.forEach((r, i) => { if (!r.team) r.team = i + 1; });

    const render = () => {
      rowsEl.innerHTML = '';
      rows.forEach((row, i) => {
        const div = document.createElement('div');
        div.className = 'setup-row';

        const name = document.createElement('input');
        name.maxLength = 12;
        name.value = row.name;
        name.placeholder = 'NAME';
        name.addEventListener('input', () => { row.name = name.value.toUpperCase(); });
        div.appendChild(name);

        const swatches = document.createElement('div');
        swatches.className = 'swatches';
        COLOR_PALETTE.forEach((c, ci) => {
          const sw = document.createElement('button');
          sw.className = 'swatch' + (row.color === ci ? ' sel' : '');
          sw.style.background = c.css;
          sw.title = c.label;
          sw.addEventListener('click', () => {
            // colours are sides — steal it from whoever had it
            const other = rows.find((r) => r !== row && r.color === ci);
            if (other) other.color = row.color;
            row.color = ci;
            render();
          });
          swatches.appendChild(sw);
        });
        div.appendChild(swatches);

        const ctl = document.createElement('button');
        ctl.className = 'small ctl ' + row.controller;
        ctl.textContent = row.controller === 'ai' ? 'MCP' : 'PLAYER';
        ctl.title = 'Toggle between a human player and an MCP AI';
        ctl.addEventListener('click', () => {
          row.controller = row.controller === 'ai' ? 'human' : 'ai';
          render();
        });
        div.appendChild(ctl);

        // team: factions sharing a team number win together
        const team = document.createElement('button');
        team.className = 'small team';
        team.textContent = 'T' + row.team;
        team.title = 'Team — combatants on the same team are allies and win together';
        team.addEventListener('click', () => {
          row.team = (row.team % Math.min(6, rows.length)) + 1;
          render();
        });
        div.appendChild(team);

        const rm = document.createElement('button');
        rm.className = 'small rm';
        rm.textContent = '✕';
        rm.disabled = rows.length <= 2;
        rm.addEventListener('click', () => { rows.splice(i, 1); render(); });
        div.appendChild(rm);

        rowsEl.appendChild(div);
      });
      document.getElementById('setup-add').disabled = rows.length >= cfg.maxPlayers;
    };
    render();

    const addBtn = document.getElementById('setup-add');
    const startBtn = document.getElementById('setup-start');
    const backBtn = document.getElementById('setup-back');
    addBtn.onclick = () => {
      if (rows.length >= cfg.maxPlayers) return;
      const usedColors = new Set(rows.map((r) => r.color));
      let color = 0;
      while (usedColors.has(color)) color++;
      // a new combatant joins its own team by default (lowest free number)
      const usedTeams = new Set(rows.map((r) => r.team));
      let team = 1;
      while (usedTeams.has(team)) team++;
      rows.push({
        name: 'PROGRAM ' + (rows.length + 1),
        color: color % COLOR_PALETTE.length,
        controller: 'ai',
        team,
      });
      render();
    };
    backBtn.onclick = () => {
      this._navBack = true;
      this.showStartMenu();
    };
    // dedupe colours, default empty names, require at least two teams
    const finalizeRows = () => {
      const used = new Set();
      rows.forEach((r, i) => {
        if (!r.name.trim()) r.name = 'PROGRAM ' + (i + 1);
        while (used.has(r.color)) r.color = (r.color + 1) % COLOR_PALETTE.length;
        used.add(r.color);
      });
      if (new Set(rows.map((r) => r.team)).size < 2) {
        rows[rows.length - 1].team = rows[0].team === 1 ? 2 : 1;
      }
      try { localStorage.setItem('gw-setup', JSON.stringify(rows)); } catch (e) { /* ignore */ }
      return rows.map((r) => ({ ...r }));
    };
    // turn-mode toggle: SEQUENTIAL vs SIMULTANEOUS (WeGo). Simultaneous is
    // a local/hotseat + AI mode, so it hides the online lobby option.
    const lobbyBtn = document.getElementById('setup-lobby');
    const MODES = ['seq', 'sim', 'init'];
    const MODE_LABEL = { seq: 'SEQUENTIAL', sim: 'SIMULTANEOUS', init: 'INITIATIVE' };
    let mode = localStorage.getItem('gw-turnmode') || 'seq';
    if (!MODES.includes(mode)) mode = 'seq';
    const modeBtn = document.getElementById('setup-turnmode');
    const renderMode = () => {
      modeBtn.textContent = MODE_LABEL[mode];
      modeBtn.classList.toggle('sim', mode !== 'seq');
      lobbyBtn.style.display = cbLobby ? 'inline-block' : 'none'; // all modes can go online
    };
    renderMode();
    modeBtn.onclick = () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem('gw-turnmode', mode); } catch (e) { /* ignore */ }
      renderMode();
    };

    // custom game rules (unit stats + build credits) — editable in a sub-screen
    this._gameRules = this._loadGameRules();
    const rulesBtn = document.getElementById('setup-rules');
    const renderRulesBtn = () => {
      const custom = !!this._rulesForStart(this._gameRules, sizeKey);
      rulesBtn.classList.toggle('custom', custom);
      rulesBtn.textContent = custom ? 'GAME RULES *' : 'GAME RULES';
    };
    renderRulesBtn();
    rulesBtn.onclick = () =>
      this.showRules(sizeKey, () => { this.revealScreen('setupmenu'); renderRulesBtn(); });

    const optsFor = () => ({
      simultaneous: mode === 'sim', perUnitInit: mode === 'init',
      rules: this._rulesForStart(this._gameRules, sizeKey),
    });
    startBtn.onclick = () => {
      const configs = finalizeRows();
      menu.style.display = 'none';
      cb(sizeKey, configs, optsFor());
    };
    lobbyBtn.onclick = () => {
      if (!cbLobby) return;
      const configs = finalizeRows();
      cbLobby(sizeKey, configs, optsFor());
    };
  }

  // ---------- custom game rules ----------

  // Load the player's saved rule tweaks, filling any gaps with stock values.
  _loadGameRules() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('gw-rules') || 'null'); } catch (e) { saved = null; }
    const rules = { income: (saved && saved.income != null) ? saved.income : null, units: {} };
    for (const k of TUNABLE_UNITS) {
      rules.units[k] = {};
      for (const s of TUNABLE_STATS) {
        const v = (saved && saved.units && saved.units[k]) ? saved.units[k][s] : undefined;
        rules.units[k][s] = Number.isFinite(v) ? v : UNIT_DEFAULTS[k][s];
      }
    }
    return rules;
  }

  // Reduce to what actually differs from stock for this map — or null if nothing
  // is customised (so the game records "default rules", not a redundant blob).
  _rulesForStart(rules, sizeKey) {
    if (!rules) return null;
    const out = { units: {} };
    let custom = false;
    const mapIncome = SIZES[sizeKey] ? SIZES[sizeKey].income : null;
    if (rules.income != null && rules.income !== mapIncome) { out.income = rules.income; custom = true; }
    for (const k of TUNABLE_UNITS) {
      const u = {};
      let unitCustom = false;
      for (const s of TUNABLE_STATS) {
        if (rules.units[k][s] !== UNIT_DEFAULTS[k][s]) { u[s] = rules.units[k][s]; unitCustom = true; }
      }
      if (unitCustom) { out.units[k] = u; custom = true; }
    }
    return custom ? out : null;
  }

  // The rules editor: a grid of stat inputs per buildable unit + build credits.
  showRules(sizeKey, onDone) {
    const rules = this._gameRules;
    this.revealScreen('rulesmenu');
    const grid = document.getElementById('rules-grid');
    const mapIncome = SIZES[sizeKey] ? SIZES[sizeKey].income : 3;

    const render = () => {
      grid.innerHTML = '';
      // header row
      const head = document.createElement('div');
      head.className = 'rules-row rules-head';
      head.innerHTML = '<span>UNIT</span><span>STRUCTURE</span><span>MOVE</span><span>DAMAGE</span><span>COST</span>';
      grid.appendChild(head);

      for (const k of TUNABLE_UNITS) {
        const row = document.createElement('div');
        row.className = 'rules-row';
        const label = document.createElement('span');
        label.className = 'rules-unit';
        label.textContent = UNIT_TYPES[k].name;
        row.appendChild(label);
        for (const s of TUNABLE_STATS) {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.min = (s === 'hp') ? 1 : 0; inp.step = 1;
          inp.value = rules.units[k][s];
          inp.title = 'stock: ' + UNIT_DEFAULTS[k][s];
          inp.addEventListener('change', () => {
            let v = Math.round(Number(inp.value));
            if (!Number.isFinite(v)) v = UNIT_DEFAULTS[k][s];
            v = Math.max(s === 'hp' ? 1 : 0, v);
            rules.units[k][s] = v; inp.value = v;
            inp.classList.toggle('changed', v !== UNIT_DEFAULTS[k][s]);
          });
          inp.classList.toggle('changed', rules.units[k][s] !== UNIT_DEFAULTS[k][s]);
          row.appendChild(inp);
        }
        grid.appendChild(row);
      }
    };
    render();

    const credits = document.getElementById('rules-credits');
    credits.placeholder = 'AUTO (' + mapIncome + ')';
    credits.value = rules.income != null ? rules.income : '';
    credits.oninput = () => {
      const v = credits.value.trim();
      rules.income = v === '' ? null : Math.max(0, Math.round(Number(v) || 0));
    };

    document.getElementById('rules-reset').onclick = () => {
      rules.income = null;
      for (const k of TUNABLE_UNITS) for (const s of TUNABLE_STATS) rules.units[k][s] = UNIT_DEFAULTS[k][s];
      credits.value = '';
      render();
    };
    document.getElementById('rules-done').onclick = () => {
      try { localStorage.setItem('gw-rules', JSON.stringify(rules)); } catch (e) { /* ignore */ }
      if (onDone) onDone();
    };
  }

  // ---------- lobby & invite dialog ----------

  // mode: 'host' (pre-game, can start) | 'guest' (waiting) | 'ingame' (share)
  showLobby(opts) {
    const el = document.getElementById('lobby');
    this.revealScreen('lobby');
    document.getElementById('lobby-room').textContent = 'GRID ' + opts.room;
    document.getElementById('lobby-status').textContent =
      opts.mode === 'host' ? 'SHARE THE JOIN LINK — START WHEN READY'
      : opts.mode === 'guest' ? 'WAITING FOR THE HOST TO START THE GRID . . .'
      : 'GAME IN PROGRESS — SHARE TO ADD PLAYERS OR SPECTATORS';
    document.getElementById('lobby-join-url').value = opts.urls.join;
    document.getElementById('lobby-watch-url').value = opts.urls.watch;
    for (const btn of el.querySelectorAll('button[data-copy]')) {
      btn.onclick = async () => {
        const input = document.getElementById(btn.dataset.copy);
        input.select();
        try { await navigator.clipboard.writeText(input.value); } catch (e) {
          try { document.execCommand('copy'); } catch (e2) { /* manual copy */ }
        }
        btn.textContent = 'COPIED';
        setTimeout(() => { btn.textContent = 'COPY'; }, 1200);
      };
    }
    const startBtn = document.getElementById('lobby-start');
    startBtn.style.display = opts.mode === 'host' ? 'inline-block' : 'none';
    startBtn.onclick = () => { if (opts.onStart) opts.onStart(); };
    const closeBtn = document.getElementById('lobby-close');
    closeBtn.textContent = opts.mode === 'ingame' ? 'CLOSE' : 'LEAVE';
    closeBtn.onclick = () => {
      if (opts.mode === 'ingame') this.hideLobby();
      else if (opts.onClose) opts.onClose();
      else this.hideLobby();
    };
    if (opts.roster) this.updateLobbyRoster(opts.roster);
  }

  hideLobby() {
    document.getElementById('lobby').style.display = 'none';
  }

  updateLobbyRoster(rows) {
    const el = document.getElementById('lobby-roster');
    el.innerHTML = '';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'lr-row';
      row.style.color = r.css;
      const name = document.createElement('span');
      name.textContent = r.name;
      const st = document.createElement('span');
      st.className = 'st';
      st.textContent = r.status;
      row.appendChild(name);
      row.appendChild(st);
      el.appendChild(row);
    }
  }

  openChat() {
    document.getElementById('chat').classList.remove('min');
    document.getElementById('btn-chat-toggle').textContent = '—';
  }

  // ---------- HUD ----------

  setTurn(faction, cycleNum, mine = false, unit = null) {
    // per-unit-initiative mode names the active unit; otherwise it's a faction turn
    let label = mine ? faction.name + ' — YOUR TURN' : faction.name + ' TURN';
    if (unit) {
      label = mine
        ? faction.name + ' — YOUR ' + unit.type.toUpperCase()
        : faction.name + ' · ' + unit.type.toUpperCase();
    }
    this.turnLabel.textContent = label;
    this.turnLabel.style.color = faction.css;
    this.turnLabel.style.textShadow = '0 0 8px ' + faction.css;
    this.setCycle(cycleNum);
  }

  // The round counter alone — simultaneous mode has no per-faction turn, so it
  // updates this each round (otherwise an all-AI sim game would stay on CYCLE 01).
  setCycle(cycleNum) {
    this.turnCount.textContent = 'CYCLE ' + String(cycleNum).padStart(2, '0');
  }

  setEnergy(n, css) {
    this.energyEl.textContent = '⚡ ' + String(n).padStart(2, '0');
    if (css) this.energyEl.style.color = css;
  }

  setScore(n) {
    document.getElementById('score').textContent =
      'SCORE ' + String(n).padStart(4, '0');
  }

  // Live standings: sorted with the leader (the eventual winner) on top —
  // active factions first, then by score descending.
  updateScorecard(game) {
    const esc = (s) => String(s).replace(/[<>&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const el = document.getElementById('scorecard');
    const ordered = [...game.factions].sort((a, b) =>
      (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0) || b.score - a.score);
    el.innerHTML = ordered.map((f) => {
      const units = game.aliveUnits(f.id).length;
      const cores = game.aliveUnits(f.id).filter((u) => u.type === 'core').length;
      const cur = !f.eliminated && f.id === game.current ? ' sc-cur' : '';
      const dead = f.eliminated ? ' dead' : '';
      return '<div class="sc-row' + dead + cur + '" style="color:' + f.css + '">'
        + '<span class="sc-dot"></span>'
        + '<span class="sc-name">' + esc(f.name) + '</span>'
        + '<span>' + (f.neutral ? '◇' : f.isAI ? 'MCP' : 'P') + '</span>'
        + '<span class="sc-team">T' + f.team + '</span>'
        + '<span>' + String(f.score).padStart(4, '0') + '</span>'
        + '<span>' + cores + '◆ ' + units + '⬡</span>'
        + '</div>';
    }).join('');
    this.updateInitiative(game);
  }

  // Live initiative order across the top (sequential mode only — simultaneous
  // has no turn order). Shows the round's order with the active faction lit.
  updateInitiative(game) {
    const el = document.getElementById('initiative-bar');
    if (!el) return;
    const esc = (s) => String(s).replace(/[<>&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    // per-unit initiative: show the upcoming units, the active one lit
    if (game.perUnitInit && Array.isArray(game._unitOrder)) {
      const chips = [];
      for (let i = game._unitIdx; i < game._unitOrder.length && chips.length < 16; i++) {
        const u = game.unitById(game._unitOrder[i]);
        if (!u || !u.alive || u.type === 'core') continue;
        const f = game.factions[u.side];
        const cur = i === game._unitIdx ? ' cur' : '';
        chips.push('<span class="ord' + cur + '" style="color:' + f.css + '">'
          + esc(u.type.toUpperCase().slice(0, 4)) + '</span>');
      }
      el.innerHTML = chips.length
        ? '<span class="lab">INITIATIVE</span>' + chips.join('<span class="sep">›</span>')
        : '';
      return;
    }
    if (game.simultaneous || !Array.isArray(game.order) || game.order.length < 2) {
      el.innerHTML = '';
      return;
    }
    const parts = game.order
      .filter((id) => !game.factions[id].eliminated)
      .map((id) => {
        const f = game.factions[id];
        const cur = id === game.current ? ' cur' : '';
        return '<span class="ord' + cur + '" style="color:' + f.css + '">'
          + esc(f.name) + '</span>';
      });
    el.innerHTML = '<span class="lab">INITIATIVE</span>'
      + parts.join('<span class="sep">›</span>');
  }

  get shownUnit() { return this._shownUnit || null; }

  // Second card: the unit under the crosshair and what the hit would do.
  showTarget(target, game, pred) {
    this._targetUnit = target;
    const def = UNIT_TYPES[target.type];
    const f = game.factionOf(target);
    this.targetCard.style.display = 'block';
    this.targetCard.style.color = f.css;
    this.targetCard.querySelector('.name').textContent =
      'TARGET: ' + def.name + ' · ' + f.name;

    // 3D model — rebuilt only when the unit or its structure changes, so it
    // keeps rotating on hover and visibly degrades right after a hit lands
    if (this._tpUnit !== target || this._tpHp !== target.hp) {
      const tookDamage = this._tpUnit === target && target.hp < this._tpHp;
      this.targetPreview.show(target, { color: f.color, isAI: f.isAI });
      if (tookDamage) this.targetPreview.hit();
      this._tpUnit = target;
      this._tpHp = target.hp;
    }

    const range = def.range + (target.type === 'reco'
      ? (target.altitude === 'top' ? 2 : target.altitude === 'high' ? 1 : 0) : 0);
    this.targetCard.querySelector('.v-hp').textContent =
      Math.max(0, target.hp) + ' / ' + target.maxHp;
    this.targetCard.querySelector('.v-range').textContent = range || '—';
    this.targetCard.querySelector('.v-dmg').textContent = def.dmg || '—';

    const frac = Math.max(0, target.hp / target.maxHp);
    const lossFrac = pred ? Math.min(frac, (pred.dmg || 0) / target.maxHp) : 0;
    this.targetCard.querySelector('.hp-fill').style.width =
      (100 * (frac - lossFrac)) + '%';
    this.targetCard.querySelector('.hp-loss').style.width = (100 * lossFrac) + '%';
    let text = '';
    if (pred) {
      if (pred.push) {
        text = 'RAM — ' + pred.pushText;
      } else {
        text = 'HIT FOR ' + pred.dmg;
        if (pred.labels.length) text += ' (' + pred.labels.join(', ') + ')';
        text += ' → ' + (pred.lethal ? 'DEREZZED' : pred.remaining + ' / ' + target.maxHp);
      }
    }
    this.targetCard.querySelector('.t-effect').textContent = text;
  }

  hideTarget() {
    this._targetUnit = null;
    this._tpUnit = null;
    this._tpHp = null;
    this.targetPreview.hide();
    this.targetCard.style.display = 'none';
  }

  // Hide the target card only if it is still showing this unit.
  hideTargetIf(unit) {
    if (this._targetUnit === unit) this.hideTarget();
  }

  // The shown target was just destroyed — detonate its model inside the card,
  // then drop the card when the blast ends (instead of snapping it out). If the
  // card isn't on this unit, fall back to the plain hide.
  explodeTargetIf(unit) {
    if (this._targetUnit !== unit) return;
    if (!this.targetPreview.active) { this.hideTarget(); return; }
    this._targetUnit = null;
    this._tpUnit = null;
    this._tpHp = null;
    const eff = this.targetCard.querySelector('.t-effect');
    if (eff) eff.textContent = 'DEREZZED';
    this.targetPreview.explode(() => { this.targetCard.style.display = 'none'; });
  }

  showBanner(text, cssColor, dur = 1400) {
    this.banner.textContent = text;
    this.banner.style.color = cssColor;
    this.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.banner.classList.remove('show'), dur);
  }

  updatePreview(dt) {
    this.preview.update(dt);
    this.targetPreview.update(dt);
  }

  showUnit(unit, game) {
    this._shownUnit = unit || null;
    if (!unit) {
      this._upUnit = null;
      this._upHp = null;
      this.card.style.display = 'none';
      this.preview.hide();
      return;
    }
    const def = UNIT_TYPES[unit.type];
    const f = game.factionOf(unit);
    // rebuild the 3D model only when the unit or its structure changes — so
    // rotating the turret (or moving) doesn't restart the slow spin
    if (this._upUnit !== unit || this._upHp !== unit.hp) {
      this.preview.show(unit, { color: f.color, isAI: f.isAI });
      this._upUnit = unit;
      this._upHp = unit.hp;
    }
    // the model always reflects the current turret aim
    this.preview.setTurret(unit.turretAngle || 0);
    this.card.style.display = 'block';
    this.card.style.color = f.css;
    this.card.style.borderColor = f.css + '55';
    this.card.querySelector('.name').textContent = def.name + ' · ' + f.name;
    this.card.querySelector('.hp-fill').style.width = (100 * unit.hp / unit.maxHp) + '%';
    this.card.querySelector('.v-hp').textContent = unit.hp + ' / ' + unit.maxHp;
    this.card.querySelector('.v-move').textContent = def.move
      ? unit.movesLeft + ' / ' + def.move : '—';
    const altBonus = unit.type === 'reco'
      ? (unit.altitude === 'top' ? 2 : unit.altitude === 'high' ? 1 : 0) : 0;
    const range = def.range + altBonus;
    this.card.querySelector('.v-range').textContent = range || '—';
    this.card.querySelector('.v-dmg').textContent = def.dmg || '—';

    const isMine = unit.side === game.current && game.isMyTurn();
    let status = def.desc;
    if (isMine && unit.type !== 'core') {
      if (game.isDone(unit)) status = 'NO ACTIONS REMAINING';
      else if (unit.type === 'cycle') {
        const v = unit.speed || 1;
        status = 'SPEED ' + (v <= 2 ? 'SLOW' : v <= 4 ? 'CRUISE' : 'FAST');
        if (unit.attacked) status += ' — HIT & RUN';
        else if (v > 4) status += ' — TOO FAST TO TURN, BRAKE WITH A SHORT MOVE';
        else if (unit.movesLeft === def.move) status += ' — OVERDRIVE READY';
      }
      else if (unit.attacked) status = 'HIT & RUN — ' + unit.movesLeft + ' MOVES LEFT';
      else if (unit.movesLeft < def.move) status = 'CAN STILL MOVE / ATTACK';
      else status = 'READY';
      if (unit.type === 'reco' && game.isCrippled(unit)) status += ' — ENGINES FAILING';
      else if (unit.type === 'reco' && unit.altitude === 'top') status += ' — TOP ALTITUDE · EXPOSED';
      else if (unit.type === 'reco' && unit.altitude === 'high') status += ' — HIGH ALTITUDE';
      else if (unit.type === 'jet') {
        status += unit.altitude === 'ground'
          ? ' — GROUNDED · VULNERABLE · WALLS ARMED'
          : ' — AIRBORNE · SAFE FROM CYCLES';
      }
      // a fast unit left unmoved will coast one hex on its own next — warn it
      if (!game.isDone(unit) && unit.movesLeft === def.move && game.hasMomentum(unit)) {
        status += ' · MOVE IT OR IT COASTS ON';
      }
    }
    this.card.querySelector('.status').textContent = status;

    // turret controls for own, still-active tanks
    const showTurret = unit.type === 'tank' && isMine && !unit.attacked && !game.over;
    this.turretControls.style.display = showTurret ? 'flex' : 'none';
    if (showTurret) {
      const deg = Math.round((unit.turretAngle || 0) * 180 / Math.PI);
      const used = Math.round(Math.abs(game.turretOffset(unit)) * 180 / Math.PI);
      this.turretControls.querySelector('.tc-angle').textContent =
        (deg > 0 ? '+' : '') + deg + '°  (' + used + '°/60° this turn)';
    }
    // altitude controls for own, still-active recognizers & light jets
    const showAlt = (unit.type === 'reco' || unit.type === 'jet') && isMine
      && !unit.attacked && !game.isCrippled(unit) && !game.over;
    this.altControls.style.display = showAlt ? 'flex' : 'none';
    if (showAlt) {
      this.altControls.querySelector('.ac-state').textContent =
        unit.altitude === 'top' ? 'TOP' : unit.altitude === 'high' ? 'HIGH'
        : unit.altitude === 'ground' ? 'GROUND' : 'NORMAL';
    }

    // special attacks: tank ram & light-cycle core conquest (sequential only)
    const canPush = isMine && !unit.attacked && !game.over && !game.simultaneous
      && unit.type === 'tank' && game.pushTargets(unit).length > 0;
    this.pushBtn.style.display = canPush ? 'block' : 'none';
    this.pushBtn.classList.toggle('armed', !!game.pushMode);
    const core = isMine && !unit.attacked && !game.over && !game.simultaneous
      && unit.type === 'cycle' ? game.conquerableCore(unit) : null;
    this.conquerBtn.style.display = core ? 'block' : 'none';
    if (core) {
      const prog = core.conquest && core.conquest.byCycle === unit.id
        ? core.conquest.count : 0;
      this.conquerBtn.textContent = 'CONQUER ' + (prog + 1) + '/2';
    }
  }

  showBuildMenu(visible, energy, buildable = null) {
    this.buildMenu.style.display = visible ? 'block' : 'none';
    if (visible) this.refreshBuildMenu(energy, buildable);
  }

  refreshBuildMenu(energy, buildable = null) {
    for (const btn of this.buildMenu.querySelectorAll('button[data-build]')) {
      const allowed = !buildable || buildable.includes(btn.dataset.build);
      btn.style.display = allowed ? '' : 'none'; // hide map-restricted types
      btn.disabled = !allowed || UNIT_TYPES[btn.dataset.build].cost > energy;
    }
  }

  setEndTurnEnabled(on) {
    this.endTurnBtn.disabled = !on;
  }

  // UNDO button: shown only in modes that support move take-backs (sequential),
  // enabled only when there is actually a clean move to reverse.
  updateUndo(visible, enabled) {
    if (!this.undoBtn) return;
    this.undoBtn.style.display = visible ? '' : 'none';
    this.undoBtn.disabled = !enabled;
  }

  // winners: array of allied factions that share the victory
  showGameOver(winners, hs) {
    const title = document.getElementById('go-title');
    const sub = document.getElementById('go-sub');
    if (winners && winners.length) {
      title.textContent = winners.map((w) => w.name).join(' & ')
        + (winners.length > 1 ? ' WIN' : ' WINS');
      title.style.color = winners[0].css;
      sub.textContent = winners.some((w) => w.controller === 'human')
        ? 'GREETINGS, PROGRAM. THE GRID IS FREE.'
        : 'END OF LINE.';
    } else {
      title.textContent = 'MUTUAL DEREZ';
      title.style.color = '#e8f6ff';
      sub.textContent = 'NO PROGRAM SURVIVED THE GRID.';
    }
    const el = document.getElementById('go-score');
    el.innerHTML = '';
    if (hs) {
      const pad = (n) => String(n).padStart(4, '0');
      const add = (cls, text) => {
        const d = document.createElement('div');
        if (cls) d.className = cls;
        d.textContent = text;
        el.appendChild(d);
      };
      add('', 'SCORE ' + pad(hs.score));
      if (hs.isNew) add('new', 'NEW RECORD');
      else add('', 'BEST ' + pad(hs.best));
      const listEl = document.createElement('div');
      listEl.className = 'hs-list';
      hs.list.forEach((e, i) => {
        const line = document.createElement('div');
        line.textContent = (i + 1) + '. ' + (e.name || '---') + ' ' + pad(e.score);
        listEl.appendChild(line);
      });
      el.appendChild(listEl);
    }
    this.gameover.style.display = 'flex';
  }

  hideLoading() {
    const el = document.getElementById('loading');
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 700);
  }
}
