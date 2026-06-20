// GRID WARS map editor — a 2D, top-down hex grid you paint terrain onto and
// place cores/units for each faction. Produces the same `customMap` object the
// engine consumes (terrain[] + placements[] + faction setup), which can be
// saved to the backend and played like any other grid.
import { SIZES, COLOR_PALETTE } from './constants.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const S = 16;                 // hex centre-to-vertex, in SVG units
const SQ3 = Math.sqrt(3);

// editable sizes only — hand-placing thousands of hexes isn't practical, so the
// giant grids stay procedural
const EDITABLE = ['S', 'M', 'L', 'XL'];

const TERRAIN_TOOLS = [
  { id: 'normal', label: 'CLEAR', kind: 'terrain' },
  { id: 'hole', label: 'PIT', kind: 'terrain' },
  { id: 'high', label: 'PLATEAU', kind: 'terrain' },
  { id: 'heal', label: 'HEAL PAD', kind: 'terrain' },
];
const UNIT_TOOLS = [
  { id: 'core', label: 'CORE', kind: 'unit', glyph: '◆' },
  { id: 'cycle', label: 'CYCLE', kind: 'unit', glyph: 'C' },
  { id: 'tank', label: 'TANK', kind: 'unit', glyph: 'T' },
  { id: 'reco', label: 'RECO', kind: 'unit', glyph: 'R' },
  { id: 'jet', label: 'JET', kind: 'unit', glyph: 'J' },
];
const UNIT_GLYPH = { core: '◆', cycle: 'C', tank: 'T', reco: 'R', jet: 'J' };

const TERRAIN_FILL = {
  normal: '#0b1c27', hole: '#020a10', high: '#1d3a4d', heal: '#0c3a26',
};

export class MapEditor {
  constructor(container, opts = {}) {
    this.root = container;
    this.opts = opts;
    this.sizeKey = 'M';
    this.tool = { id: 'high', kind: 'terrain' };
    this.activeFaction = 0;
    this.terrain = new Map();   // "q,r" -> 'hole'|'high'|'heal'
    this.units = new Map();     // "q,r" -> { side, type }
    this.hexEls = new Map();    // "q,r" -> <polygon>
    // default: 2 factions, slot 0 human, rest MCP, each its own team
    this.factions = [
      { color: 0, controller: 'human', team: 1 },
      { color: 1, controller: 'ai', team: 2 },
    ];
    this._painting = false;
    this._build();
  }

  // ---------- DOM ----------
  _build() {
    this.root.innerHTML = '';
    const bar = document.createElement('div');
    bar.id = 'ed-bar';
    bar.innerHTML = `
      <div class="ed-title">MAP EDITOR</div>
      <div class="ed-group"><span class="ed-lab">SIZE</span><span id="ed-sizes"></span></div>
      <div class="ed-group"><span class="ed-lab">TERRAIN</span><span id="ed-terrain"></span></div>
      <div class="ed-group"><span class="ed-lab">PLACE</span><span id="ed-units"></span></div>
      <div class="ed-group"><span class="ed-lab">FACTION</span><span id="ed-factions"></span>
        <button class="small" id="ed-fac-add" title="Add a faction">+</button>
        <button class="small" id="ed-fac-del" title="Remove the last faction">&minus;</button>
        <button class="small" id="ed-fac-ctrl" title="Toggle this faction HUMAN / MCP">HUMAN</button>
      </div>
      <input id="ed-name" maxlength="28" placeholder="MAP NAME">
      <div class="ed-actions">
        <button class="small" id="ed-clear" title="Clear the whole grid">CLEAR</button>
        <button class="small" id="ed-play" title="Test-play this map now">▶ PLAY</button>
        <button class="small" id="ed-save" title="Save this map to the server">SAVE</button>
        <button class="small" id="ed-close">CLOSE</button>
      </div>
      <div id="ed-msg"></div>`;
    this.root.appendChild(bar);

    const stage = document.createElement('div');
    stage.id = 'ed-stage';
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.id = 'ed-svg';
    stage.appendChild(this.svg);
    this.root.appendChild(stage);

    // size buttons
    const sizes = bar.querySelector('#ed-sizes');
    EDITABLE.forEach((k) => {
      const b = document.createElement('button');
      b.className = 'small' + (k === this.sizeKey ? ' on' : '');
      b.textContent = k;
      b.dataset.size = k;
      b.onclick = () => this._setSize(k);
      sizes.appendChild(b);
    });
    // terrain + unit tools
    const mkTool = (host, t) => {
      const b = document.createElement('button');
      b.className = 'small ed-tool';
      b.textContent = t.label;
      b.dataset.tool = t.id;
      b.dataset.kind = t.kind;
      if (t.id === this.tool.id) b.classList.add('on');
      b.onclick = () => this._setTool(t);
      host.appendChild(b);
    };
    TERRAIN_TOOLS.forEach((t) => mkTool(bar.querySelector('#ed-terrain'), t));
    UNIT_TOOLS.forEach((t) => mkTool(bar.querySelector('#ed-units'), t));

    bar.querySelector('#ed-fac-add').onclick = () => this._addFaction();
    bar.querySelector('#ed-fac-del').onclick = () => this._delFaction();
    bar.querySelector('#ed-fac-ctrl').onclick = () => this._toggleController();
    bar.querySelector('#ed-clear').onclick = () => this._clear();
    bar.querySelector('#ed-close').onclick = () => this.opts.onClose && this.opts.onClose();
    bar.querySelector('#ed-play').onclick = () => this._play();
    bar.querySelector('#ed-save').onclick = () => this._save();

    // painting via pointer drag
    this.svg.addEventListener('pointerdown', (e) => {
      const cell = this._cellFromEvent(e);
      if (!cell) return;
      this._painting = true;
      this.svg.setPointerCapture(e.pointerId);
      this._apply(cell.q, cell.r);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!this._painting) return;
      const cell = this._cellFromEvent(e);
      if (cell) this._apply(cell.q, cell.r);
    });
    const stop = () => { this._painting = false; };
    this.svg.addEventListener('pointerup', stop);
    this.svg.addEventListener('pointercancel', stop);

    this._renderFactions();
    this._setSize(this.sizeKey);
  }

  // ---------- grid ----------
  _setSize(k) {
    this.sizeKey = k;
    this.root.querySelectorAll('#ed-sizes button').forEach((b) =>
      b.classList.toggle('on', b.dataset.size === k));
    // drop placements that fall outside the new radius
    const R = SIZES[k].radius;
    const inb = (key) => { const [q, r] = key.split(',').map(Number); return Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R; };
    for (const m of [this.terrain, this.units]) for (const key of [...m.keys()]) if (!inb(key)) m.delete(key);
    this._buildGrid();
  }

  _buildGrid() {
    const R = SIZES[this.sizeKey].radius;
    this.hexEls.clear();
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const ext = S * SQ3 * (R + R / 2) + S * 2;
    const extY = S * 1.5 * R + S * 2;
    this.svg.setAttribute('viewBox', `${-ext} ${-extY} ${ext * 2} ${extY * 2}`);

    this.tiles = document.createElementNS(SVGNS, 'g');
    this.markers = document.createElementNS(SVGNS, 'g');
    this.svg.appendChild(this.tiles);
    this.svg.appendChild(this.markers);

    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        if (Math.abs(q + r) > R) continue;
        const { x, y } = this._px(q, r);
        const poly = document.createElementNS(SVGNS, 'polygon');
        poly.setAttribute('points', this._hexPoints(x, y));
        poly.setAttribute('class', 'ed-hex');
        poly.dataset.q = q; poly.dataset.r = r;
        this.tiles.appendChild(poly);
        this.hexEls.set(q + ',' + r, poly);
        this._paintCell(q, r);
      }
    }
  }

  _px(q, r) { return { x: S * SQ3 * (q + r / 2), y: S * 1.5 * r }; }
  _hexPoints(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90);
      pts.push((cx + S * Math.cos(a)).toFixed(1) + ',' + (cy + S * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  _cellFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.dataset || el.dataset.q === undefined) return null;
    return { q: +el.dataset.q, r: +el.dataset.r };
  }

  // ---------- painting ----------
  _apply(q, r) {
    const key = q + ',' + r;
    if (this.tool.kind === 'terrain') {
      if (this.tool.id === 'normal') {
        this.terrain.delete(key);
      } else {
        this.terrain.set(key, this.tool.id);
        if (this.tool.id !== 'heal') this.units.delete(key); // pits/plateaus can't hold units
      }
    } else if (this.tool.kind === 'unit') {
      const t = this.terrain.get(key);
      if (t === 'hole' || t === 'high') return;           // can't stand on pit/plateau
      if (this._unitAt(q, r, this.tool.id, this.activeFaction)) return;
      this.units.set(key, { side: this.activeFaction, type: this.tool.id });
    }
    this._paintCell(q, r);
  }

  _unitAt(q, r, type, side) {
    const u = this.units.get(q + ',' + r);
    return u && u.side === side && u.type === type;
  }

  _paintCell(q, r) {
    const key = q + ',' + r;
    const poly = this.hexEls.get(key);
    if (!poly) return;
    const terr = this.terrain.get(key) || 'normal';
    poly.setAttribute('fill', TERRAIN_FILL[terr]);
    poly.classList.toggle('ed-heal', terr === 'heal');
    // unit marker
    const old = this.markers.querySelector(`[data-mk="${key}"]`);
    if (old) old.remove();
    const u = this.units.get(key);
    if (u) {
      const { x, y } = this._px(q, r);
      const pal = COLOR_PALETTE[(this.factions[u.side] || {}).color % COLOR_PALETTE.length] || COLOR_PALETTE[0];
      const g = document.createElementNS(SVGNS, 'g');
      g.dataset.mk = key;
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', u.type === 'core' ? S * 0.62 : S * 0.5);
      c.setAttribute('fill', pal.css);
      c.setAttribute('opacity', u.type === 'core' ? '0.95' : '0.85');
      c.setAttribute('stroke', '#02080c'); c.setAttribute('stroke-width', '1.5');
      const tx = document.createElementNS(SVGNS, 'text');
      tx.setAttribute('x', x); tx.setAttribute('y', y);
      tx.setAttribute('class', 'ed-mk-text');
      tx.textContent = UNIT_GLYPH[u.type] || '?';
      g.appendChild(c); g.appendChild(tx);
      this.markers.appendChild(g);
    }
  }

  // ---------- tools / factions ----------
  _setTool(t) {
    this.tool = { id: t.id, kind: t.kind };
    this.root.querySelectorAll('.ed-tool').forEach((b) =>
      b.classList.toggle('on', b.dataset.tool === t.id));
  }

  _renderFactions() {
    const host = this.root.querySelector('#ed-factions');
    host.innerHTML = '';
    this.factions.forEach((f, i) => {
      const pal = COLOR_PALETTE[f.color % COLOR_PALETTE.length];
      const b = document.createElement('button');
      b.className = 'ed-fac' + (i === this.activeFaction ? ' on' : '');
      b.style.background = pal.css;
      b.title = pal.label + ' — ' + (f.controller === 'ai' ? 'MCP' : 'HUMAN') + ' (click to select, dbl-click to recolour)';
      b.textContent = f.controller === 'ai' ? 'M' : 'H';
      b.onclick = () => { this.activeFaction = i; this._renderFactions(); };
      b.ondblclick = () => { f.color = (f.color + 1) % COLOR_PALETTE.length; this._recolour(); this._renderFactions(); };
      host.appendChild(b);
    });
    const ctrl = this.root.querySelector('#ed-fac-ctrl');
    const af = this.factions[this.activeFaction];
    if (ctrl && af) ctrl.textContent = af.controller === 'ai' ? 'MCP' : 'HUMAN';
  }

  _recolour() { for (const [key] of this.units) this._paintCell(...key.split(',').map(Number)); }

  _addFaction() {
    const max = SIZES[this.sizeKey].maxPlayers || 6;
    if (this.factions.length >= max) return this._msg('MAX ' + max + ' FACTIONS', true);
    const used = new Set(this.factions.map((f) => f.color));
    let color = 0; while (used.has(color) && color < COLOR_PALETTE.length) color++;
    this.factions.push({ color: color % COLOR_PALETTE.length, controller: 'ai', team: this.factions.length + 1 });
    this.activeFaction = this.factions.length - 1;
    this._renderFactions();
  }
  _delFaction() {
    if (this.factions.length <= 2) return this._msg('MIN 2 FACTIONS', true);
    const idx = this.factions.length - 1;
    for (const [key, u] of [...this.units]) if (u.side === idx) this.units.delete(key);
    this.factions.pop();
    if (this.activeFaction >= this.factions.length) this.activeFaction = this.factions.length - 1;
    this._buildGrid();
    this._renderFactions();
  }
  _toggleController() {
    const f = this.factions[this.activeFaction];
    if (f) { f.controller = f.controller === 'ai' ? 'human' : 'ai'; this._renderFactions(); }
  }

  _clear() {
    this.terrain.clear(); this.units.clear(); this._buildGrid();
    this._msg('GRID CLEARED');
  }

  // ---------- export / validate ----------
  _toMap() {
    const name = (this.root.querySelector('#ed-name').value || '').trim() || 'GRID';
    const terrain = [...this.terrain].map(([key, type]) => {
      const [q, r] = key.split(',').map(Number); return { q, r, type };
    });
    const placements = [...this.units].map(([key, u]) => {
      const [q, r] = key.split(',').map(Number); return { side: u.side, type: u.type, q, r };
    });
    return {
      v: 1, name, sizeKey: this.sizeKey, radius: SIZES[this.sizeKey].radius,
      income: SIZES[this.sizeKey].income,
      factions: this.factions.map((f) => ({ color: f.color, controller: f.controller, team: f.team })),
      terrain, placements,
    };
  }
  _validate(map) {
    // every faction with any units must have a core, and needs at least one core overall
    const coresBySide = {};
    for (const p of map.placements) if (p.type === 'core') coresBySide[p.side] = (coresBySide[p.side] || 0) + 1;
    const sidesWithUnits = new Set(map.placements.map((p) => p.side));
    for (const side of sidesWithUnits) if (!coresBySide[side]) return `FACTION ${side + 1} NEEDS A CORE`;
    const realSides = map.factions.map((f, i) => i).filter((i) => coresBySide[i]);
    if (realSides.length < 2) return 'PLACE A CORE FOR AT LEAST 2 FACTIONS';
    return null;
  }

  _play() {
    const map = this._toMap();
    const err = this._validate(map);
    if (err) return this._msg(err, true);
    if (this.opts.onPlay) this.opts.onPlay(map);
  }
  async _save() {
    const map = this._toMap();
    const err = this._validate(map);
    if (err) return this._msg(err, true);
    if (this.opts.onSave) {
      const ok = await this.opts.onSave(map);
      this._msg(ok ? 'SAVED TO THE GRID' : 'SAVE FAILED', !ok);
    }
  }

  // Load an existing map into the editor for further editing.
  load(map) {
    this.sizeKey = EDITABLE.includes(map.sizeKey) ? map.sizeKey : 'M';
    this.factions = (map.factions || []).map((f, i) => ({
      color: f.color || 0, controller: f.controller || (i === 0 ? 'human' : 'ai'), team: f.team || i + 1,
    }));
    if (this.factions.length < 2) this.factions = [{ color: 0, controller: 'human', team: 1 }, { color: 1, controller: 'ai', team: 2 }];
    this.terrain = new Map((map.terrain || []).map((t) => [t.q + ',' + t.r, t.type]));
    this.units = new Map((map.placements || []).map((p) => [p.q + ',' + p.r, { side: p.side, type: p.type }]));
    this.activeFaction = 0;
    const nameInput = this.root.querySelector('#ed-name');
    if (nameInput) nameInput.value = map.name || '';
    this.root.querySelectorAll('#ed-sizes button').forEach((b) => b.classList.toggle('on', b.dataset.size === this.sizeKey));
    this._renderFactions();
    this._buildGrid();
  }

  _msg(text, bad) {
    const m = this.root.querySelector('#ed-msg');
    if (!m) return;
    m.textContent = text;
    m.style.color = bad ? '#ff5544' : '#3dff7c';
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { m.textContent = ''; }, 2600);
  }
}
