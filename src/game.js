import * as THREE from 'three';
import {
  key, parseKey, hexToWorld, hexDistance, generateMap, reachable, pathTo,
  cellsInRange, DIRS, reachableCycle, reachableJet, cyclePath, dirFromVector, turnDelta,
} from './hex.js';
import {
  UNIT_TYPES, SIZES, CHEAPEST_UNIT_COST, COLOR_PALETTE, buildFormation, rotate60, applyUnitRules, TUNABLE_UNITS,
} from './constants.js';
import {
  buildUnitMesh, buildCore, buildTile, buildTileField, buildHighlight, buildHighTile,
  buildHoleTile, buildHealTile, buildFacingWedge, makeHealthBar, buildUnitProxy,
} from './models.js';
import { aiTakeTurn, aiUnitAct, aiProduce } from './ai.js';

const HEALTHBAR_Y = { cycle: 1.15, tank: 1.25, reco: 2.6, jet: 1.55, core: 2.6 };
const r3 = (x) => Math.round(x * 1000) / 1000; // compact floats for serialized geometry
const FLY_HEIGHT = 0.85;
const FLY_HIGH = 1.75;      // raised recognizer altitude
const FLY_TOP = 2.85;       // top-level recognizer flight (over units, exposed)
const FLY_CRIPPLED = 0.47;
const ALT_ORDER = ['normal', 'high', 'top']; // recognizer flight levels, low→high
// light jets add a vulnerable GROUND level below their flight levels — they're
// only out of light-cycle reach while airborne (and lay deadly walls grounded)
const JET_ALT_ORDER = ['ground', 'normal', 'high', 'top'];
const JET_BASEY = { ground: 0, normal: FLY_HEIGHT, high: FLY_HIGH, top: FLY_TOP };
const TOP_DMG_BONUS = 2;    // extra damage a top-level recognizer suffers per hit
const RECO_COLLIDE_DMG = 3; // crash damage to both when a reco drops onto a unit
const OVERDRIVE_SPEED = 6;  // a cycle at this velocity is flat out — strikes hit +1
const MOMENTUM_SPEED = 5;   // FAST cycles can't stop — if not moved, they coast on
const PORTAL_DROP_DMG = 4;  // a portal drop slams the unit on the landing hex
const PORTAL_SELF_DMG = 2;  // …and rattles the cycle that came through
const BARREL_ROLL_HEXES = 4; // a jet flying this many hexes straight does a 360° roll
const TURRET_BUDGET = Math.PI / 3; // a tank may slew its turret up to 60° per turn
const TURRET_STEP = Math.PI / 6;   // 30° per button press (capped by the budget)
const TURRET_ARC = Math.PI / 3;    // turret fires within 60° of where it points
const TERRAIN_Y = { normal: 0, high: 0.8, hole: -0.15, heal: 0 };
const ROUGH_COST = 2;       // recognizer cost to enter a pit or plateau hex
const WRECK_TURNS = 3;      // game cycles until derez wreckage vanishes
const CRIPPLED_AT = 0.5;    // below this health recognizers fly low & can't climb

let nextUnitId = 1;

const isRough = (terrain) => terrain === 'high' || terrain === 'hole';

const INITIATIVE_IDLE_BONUS = 0.7; // sitting a round out biases you toward going first next round

// AI transmissions, in the spirit of the 1982 film. Hostile AIs talk like
// the MCP; AIs allied with a human player talk like Tron.
const BARKS = {
  hit: ['YES.', 'ACKNOWLEDGED.', 'TARGET STRUCK.'],
  kill: ['DEREZZED.', 'END OF LINE.', 'DE-RESOLUTION COMPLETE.'],
  deflect: ['NO.', 'INEFFECTIVE, PROGRAM.'],
  loss: ['NO.', 'UNIT LOST.', 'REROUTING.'],
  conquestStart: ['YOUR CORE WILL BE MINE.', 'SUBMIT, PROGRAM.'],
  conquestDone: ['THIS CORE IS MINE NOW.', 'YOUR CORE SERVES ME.'],
  eliminated: ['END OF LINE...'],
  greet: ['GREETINGS, PROGRAM.', 'ALL PROGRAMS SERVE THE MCP.',
    'I WILL HAVE TO PUT YOU ON THE GAME GRID.'],
};

const BARKS_ALLY = {
  hit: ['FOR THE USERS.', 'AFFIRMATIVE.', 'THAT IS HOW IT IS DONE.'],
  kill: ['DEREZZED. FOR THE USERS.', 'ANOTHER ONE DOWN, USER.', 'IT IS DONE.'],
  deflect: ['STILL STANDING.', 'HOLD THE LINE.'],
  loss: ['UNIT DOWN. KEEP FIGHTING.', 'I BELIEVE IN THE USERS.'],
  conquestStart: ['THIS CORE BELONGS TO THE USERS.', 'I AM FREEING THIS CORE.'],
  conquestDone: ['CORE LIBERATED.', 'IT SERVES THE USERS NOW.'],
  eliminated: ['I FOUGHT FOR THE USERS...'],
  greet: ['I FIGHT FOR THE USERS.', 'GREETINGS, PROGRAMS.', 'WITH YOU, USER.'],
};

export class Game {
  constructor(scene, fx, audio, ui) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.ui = ui;

    this.config = null;
    this.cells = null;
    this.units = [];
    this.factions = [];             // {id,name,color,css,controller,energy,score,eliminated,isAI}
    this.current = 0;               // index of the acting faction
    this.turnCount = 0;
    this.tileGroups = new Map();    // key -> tile group
    this.highlights = new Map();    // key -> highlight mesh
    this.healMats = [];             // pulsing heal-pad materials
    this.healStreams = [];          // rising heal-pad particle streams
    this.pickMeshes = [];           // raycast targets
    this._lodFar = false;           // LOD: true when units render as cheap blips

    this.simultaneous = false;      // WeGo mode: plan, then resolve all at once
    this.planning = null;           // faction id currently planning (sim mode)
    this.orders = new Map();        // unitId -> { dest, path, attackId }
    this.ghostGroup = null;         // planned-order markers

    this.selected = null;
    this.reachMap = null;           // reach result for selected unit
    this.destsMap = null;           // valid destinations for selected unit
    this.riskySet = null;           // cycle dests only reachable through a wall
    this.getPath = null;            // path builder for the selected unit
    this.trails = [];               // active light walls: { side, owner, cells:Set, walls:[] }

    this.busy = false;
    this.over = false;
    this.cycleNum = 1;
    this.onFocus = null;
    this._hoverTile = null;
    this._v1 = new THREE.Vector3();
  }

  // ---------- setup ----------

  // Snapshot of everything needed to resume this game in a fresh page.
  serialize() {
    return {
      v: 1,
      sizeKey: this.sizeKey,
      seed: this.seed,
      configs: this.factionConfigs,
      mods: this.mods || null,
      mission: this.mission || null,
      current: this.current,
      turnCount: this.turnCount,
      cycleNum: this.cycleNum,
      nextUnitId, // ids must line up across network clients
      randState: this._randA,          // exact RNG position
      order: this.order,               // this round's initiative order
      orderIdx: this.orderIdx,
      simultaneous: this.simultaneous,
      perUnitInit: this.perUnitInit,
      buildable: this.buildable,        // map-restricted unit types
      rules: this.rules || null,        // custom unit stats / build credits
      unitOrder: this._unitOrder,       // per-unit-initiative round state
      unitIdx: this._unitIdx,
      factions: this.factions.map((f) => ({
        energy: f.energy, score: f.score, eliminated: f.eliminated,
        acted: !!f.acted,
      })),
      units: this.units.filter((u) => u.alive).map((u) => {
        // preserve which way each unit is FACING — movement direction, turret
        // arc and velocity are all read off the mesh's heading, so a resumed or
        // newly-joined client must rebuild it (else everything snaps back to the
        // spawn orientation, facing the Grid centre)
        let face = null;
        if (u.type !== 'core') {
          const d = u.mesh.getWorldDirection(this._v1);
          face = [Math.round(d.x * 1e4) / 1e4, Math.round(d.z * 1e4) / 1e4];
        }
        return {
          id: u.id, side: u.side, type: u.type, q: u.q, r: u.r, hp: u.hp,
          movesLeft: u.movesLeft, attacked: u.attacked,
          postAttackMoved: u.postAttackMoved,
          turretAngle: u.turretAngle, altitude: u.altitude,
          speed: u.speed || 1,
          coreId: u.coreId,
          conquest: u.conquest || null,
          focusHits: u.focusHits || 0, // focus-fire bonus is mid-round state
          face, heading: u.heading != null ? u.heading : null,
        };
      }),
      // light walls still standing — cycle walls and jet ribbons. `path` is the
      // ordered collision cells; jets also carry `allCells` to rebuild the ribbon.
      trails: this.trails.map((t) => t.alt != null
        ? { jet: true, side: t.side, owner: t.owner, alt: t.alt, grounded: !!t.grounded,
            path: t.path.slice(), allCells: t.allCells.map((c) => [c.q, c.r]) }
        // cycle walls also carry each ribbon's exact build (control points etc.)
        // so the curve is reproduced faithfully, not just laid through cell centres
        : { side: t.side, owner: t.owner, path: t.path.slice(),
            walls: t.walls.map((w) => w._build).filter(Boolean) }),
    };
  }

  // Animation pace: deliberate on small maps, quickening a little each cycle.
  // The very large maps run faster so their long turns don't drag — EPIC most
  // of all, since it has ~4x the ground to cover.
  _animSpeed() {
    const cyc = (this.cycleNum - 1) * 0.03;
    if (this.sizeKey === 'MANIC') return Math.min(2.8, 1.9 + cyc);
    if (this.sizeKey === 'EPIC') return Math.min(2.2, 1.5 + cyc);
    if (this.sizeKey === 'XXL') return Math.min(1.6, 1.05 + cyc);
    return Math.min(1.25, 0.8 + cyc);
  }

  // configs: [{ name, color: palette index, controller: 'human'|'ai', team }]
  // mods (campaign missions): { world: {income, obstacles, heals}, armies: {i: army},
  //   buildable: [unit types this map allows] }
  // restore: a serialize() snapshot — resumes that game instead of starting fresh
  init(sizeKey, seed, configs, mods = null, restore = null, gameOpts = {}) {
    this.sizeKey = sizeKey;
    this.seed = seed;
    this.factionConfigs = configs;
    this.mods = mods;
    // a custom map (from the editor, or a saved procedural grid) supplies explicit
    // terrain + unit placements instead of the procedural formation/obstacle gen
    this.customMap = restore ? null : ((gameOpts && gameOpts.customMap) || null);
    // a map may restrict which unit types can be built (null = all four)
    this.buildable = restore ? (restore.buildable || null)
      : (mods && mods.buildable) || null;
    const rep = gameOpts && gameOpts.replay; // a replay carries its own mode
    this.simultaneous = restore ? !!restore.simultaneous
      : rep ? !!rep.simultaneous : !!gameOpts.simultaneous;
    // per-unit initiative: individual units act one at a time across all
    // factions, ordered by their own initiative roll
    this.perUnitInit = restore ? !!restore.perUnitInit
      : rep ? !!rep.perUnitInit : !!gameOpts.perUnitInit;
    // optional custom rules (unit stats + build credits) chosen pre-game; carried
    // through restore/replay/net so every client tunes identically. Applied by
    // mutating the shared UNIT_TYPES (reset to stock first, so a default game
    // after a custom one is clean) before any unit is spawned.
    this.rules = restore ? (restore.rules || null)
      : rep ? (rep.rules || null) : (gameOpts.rules || null);
    applyUnitRules(this.rules && this.rules.units);
    this.planning = null;
    this.orders = new Map();
    // deterministic RNG with externally-visible state so a snapshot (multiplayer
    // join / session resume) can carry the exact RNG position and stay in sync
    this._randA = seed | 0;
    this.rand = () => {
      const a = (this._randA + 0x6D2B79F5) | 0;
      this._randA = a;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    this.config = Object.assign({}, SIZES[sizeKey], (mods && mods.world) || {});
    // custom build credits (energy income per turn) override the map default
    if (this.rules && this.rules.income != null) this.config.income = this.rules.income;
    this.fx.speed = this._animSpeed(); // deliberate, but quicker on the huge maps

    this.factions = configs.map((c, i) => {
      const pal = COLOR_PALETTE[c.color % COLOR_PALETTE.length];
      return {
        id: i,
        name: (c.name || 'PROGRAM ' + (i + 1)).toUpperCase().slice(0, 12),
        color: pal.color,
        css: pal.css,
        controller: c.controller === 'ai' ? 'ai'
          : c.controller === 'neutral' ? 'neutral' : 'human',
        isAI: c.controller === 'ai',
        // a NEUTRAL faction never takes a turn — it just holds an idle core (a
        // capture-the-flag objective) until a cycle conquers it
        neutral: c.controller === 'neutral',
        team: c.team || i + 1,   // same team = allies who win together
        energy: this.config.income,
        score: 0,
        eliminated: false,
        acted: false,   // did this faction do anything in the current round?
      };
    });
    this.pushMode = false;
    this._undoStack = [];   // clean unit moves that can still be taken back
    this._combatSeq = 0;    // bumped on any damage — used to detect a fought move
    this.portals = [];      // cracked boundary portals (easter egg, runtime only)

    // plan formations (rotated onto each faction's edge) before terrain,
    // so obstacles keep clear of every spawn zone — missions may give
    // each faction a custom army
    const N = this.factions.length;
    let plans = [];
    if (this.customMap) {
      // explicit placements straight from the saved map (cores included)
      plans = (this.customMap.placements || [])
        .filter((p) => this.factions[p.side] && UNIT_TYPES[p.type])
        .map((p) => ({ side: p.side, type: p.type, q: p.q, r: p.r }));
    } else {
      // real (non-neutral) factions get an edge formation, spread evenly around
      // the Grid; a neutral faction's flag-core sits dead centre
      const realIdx = configs.map((c, i) => i).filter((i) => configs[i].controller !== 'neutral');
      const M = Math.max(1, realIdx.length);
      for (let i = 0; i < N; i++) {
        const army = (mods && mods.armies && mods.armies[i]) || this.config.army;
        if (configs[i].controller === 'neutral') {
          plans.push({ side: i, type: 'core', q: 0, r: 0 });
          let gi = 0; // idle guards ringed around the central core
          for (const t of ['cycle', 'tank', 'reco', 'jet']) {
            for (let c = 0; c < (army[t] || 0); c++) {
              const dist = 1 + Math.floor(gi / 6);
              const d = DIRS[gi % 6];
              plans.push({ side: i, type: t, q: d[0] * dist, r: d[1] * dist });
              gi++;
            }
          }
          continue;
        }
        const base = buildFormation(this.config.radius, army);
        const k = Math.round((realIdx.indexOf(i) * 6) / M) % 6;
        for (const u of base) {
          const p = rotate60(u.q, u.r, k);
          plans.push({ side: i, type: u.type, q: p.q, r: p.r });
        }
      }
    }

    this.buildMap(plans);

    if (restore) {
      // resume: rebuild every surviving unit exactly as it was
      for (const s of restore.units) {
        const u = this.spawn(s.side, s.type, s.q, s.r, s.id);
        u.hp = s.hp;
        u.bar.update(Math.max(0, u.hp / u.maxHp));
        u.movesLeft = s.movesLeft;
        u.attacked = s.attacked;
        u.postAttackMoved = s.postAttackMoved;
        u.turretAngle = s.turretAngle || 0;
        if (u.mesh.userData.turret) u.mesh.userData.turret.rotation.y = u.turretAngle;
        u.altitude = s.altitude || 'normal';
        u.speed = s.speed || 1;
        u.coreId = s.coreId != null ? s.coreId : null;
        if (s.conquest) u.conquest = s.conquest;
        u.focusHits = s.focusHits || 0; // restore mid-round focus-fire bonus
        if (s.heading != null) u.heading = s.heading;
        // restore the saved facing (spawn faced the Grid centre) — the turret is
        // a child so its local angle, set above, rides along with the hull
        if (s.face) {
          u.mesh.lookAt(
            u.mesh.position.x + s.face[0], u.mesh.position.y, u.mesh.position.z + s.face[1]);
        }
        if (u.type === 'reco') {
          u.baseY = this.recoBaseY(u);
          const cell = this.cellOf(u);
          u.mesh.position.y = u.baseY + TERRAIN_Y[cell.terrain];
        }
        if (this.isDone(u)) this.setDim(u, true);
      }
      // rebuild any light walls that were still standing (deadly obstacles, so
      // they must come back for a resumed game or a newly-joined client to match)
      if (restore.trails) {
        for (const ts of restore.trails) {
          if (ts.jet) {
            const allCells = (ts.allCells || []).map(([q, r]) => ({ q, r }));
            const tr = {
              side: ts.side, owner: ts.owner, alt: ts.alt, grounded: !!ts.grounded,
              color: this.factions[ts.side] ? this.factions[ts.side].color : 0xffffff,
              allCells, cells: new Set(ts.path), path: ts.path.slice(),
              walls: [], revealStart: 0,
              lastCell: allCells.length ? { ...allCells[allCells.length - 1] } : null,
            };
            if (allCells.length >= 1) this._rebuildJetRibbons(tr);
            this.trails.push(tr);
          } else {
            const tr = { side: ts.side, owner: ts.owner, cells: new Set(ts.path), path: ts.path.slice(), walls: [] };
            if (ts.walls && ts.walls.length) {
              const color = this.factions[ts.side] ? this.factions[ts.side].color : 0xffffff;
              for (const b of ts.walls) {
                const vpts = b.pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
                const input = b.type === 'curve'
                  ? new THREE.CatmullRomCurve3(vpts, false, 'catmullrom', 0.55) : vpts;
                const ribbon = this.fx.trailRibbon(input, color, b.samples, b.tStart, b.wave || 0);
                ribbon.reveal(b.reveal != null ? b.reveal : 1);
                ribbon._build = b; // keep so a re-save stays faithful
                tr.walls.push(ribbon);
              }
            } else {
              this._rebuildCycleWall(tr); // legacy snapshot with no curve data
            }
            this.trails.push(tr);
          }
        }
      }
      restore.factions.forEach((s, i) => {
        if (!this.factions[i]) return;
        this.factions[i].energy = s.energy;
        this.factions[i].score = s.score;
        this.factions[i].eliminated = s.eliminated;
        this.factions[i].acted = !!s.acted;
      });
      // resume the exact RNG position and initiative order from the snapshot
      if (restore.randState != null) this._randA = restore.randState | 0;
      if (restore.nextUnitId) nextUnitId = restore.nextUnitId;
      this.order = restore.order
        || this.factions.filter((f) => !f.eliminated).map((f) => f.id);
      this.orderIdx = restore.orderIdx || 0;
      this.current = restore.current != null ? restore.current : this.order[this.orderIdx];
      this.turnCount = restore.turnCount;
      this.cycleNum = restore.cycleNum;
      // per-unit-initiative round state resumes mid-round (no fresh bookkeeping)
      this._unitOrder = restore.unitOrder || [];
      this._unitIdx = restore.unitIdx || 0;
      this._activeUnit = null;
      this.fx.speed = this._animSpeed();
      this._skipBookkeeping = true; // the snapshot was taken post-bookkeeping
    } else {
      for (const p of plans) {
        let { q, r } = p;
        const cell = this.cells.get(key(q, r));
        if (this.customMap) {
          // honour the editor's exact placement; only skip the impossible
          // (off-grid, on a pit/plateau, or a hex already taken)
          if (!cell || cell.terrain === 'hole' || cell.terrain === 'high' || this.unitAt(q, r)) continue;
          this.spawn(p.side, p.type, q, r);
          continue;
        }
        if (!cell || cell.terrain !== 'normal' || this.unitAt(q, r)) {
          // crowded small maps: search wide so no unit is ever dropped
          const alt = cellsInRange(this.cells, q, r, 6)
            .filter((c) => c.terrain === 'normal' && !this.unitAt(c.q, c.r))
            .sort((a, b) => hexDistance({ q, r }, a) - hexDistance({ q, r }, b))[0];
          if (!alt) continue;
          q = alt.q; r = alt.r;
        }
        this.spawn(p.side, p.type, q, r);
      }

      // every starting unit belongs to its faction's (single) home core
      for (const fac of this.factions) {
        const homeCore = this.coreOf(fac.id);
        if (!homeCore) continue;
        for (const u of this.aliveUnits(fac.id)) {
          if (u.type !== 'core') u.coreId = homeCore.id;
        }
      }

      // round 1 initiative is a uniform random order (all idle to start)
      this.turnCount = 0;
      this.cycleNum = 1;
      this.order = this._buildOrder();
      this.orderIdx = 0;
      this.current = this.order[0];
      // per-unit-initiative state — the first round is set up by unitLoop()
      this._unitOrder = [];
      this._unitIdx = 0;
      this._activeUnit = null;
      if (this.perUnitInit) this.cycleNum = 0; // _startUnitRound() bumps it to 1
    }
    // ----- replay: record this game, or play one back -----
    this.replaying = !!(gameOpts && gameOpts.replay);
    this.replay = this.replaying ? gameOpts.replay : null;
    this._evIdx = 0;
    this._replayPaused = false;
    this._fast = this.replaying && gameOpts.seek > 0;
    this._fastTarget = gameOpts.seek || 0;
    // record every action stream (all modes — the replay carries the mode so
    // it knows which loop to drive)
    this.recording = (!restore && !this.replaying) ? {
      sizeKey: this.sizeKey, seed: this.seed, configs: this.factionConfigs,
      mods: this.mods || null, mission: this.mission || null,
      simultaneous: this.simultaneous, perUnitInit: this.perUnitInit,
      rules: this.rules || null,
      events: [], markers: [], over: false,
    } : null;

    this.ui.setScore(0);
    if (!this.replaying) this.ui.showBanner('ENTER THE GRID', '#2bd9ff', 1800);
    this.audio.chime('turn');
    this.audio.startMusic();
    const begin = () => {
      if (restore) this._restoreFlourish(); // "powering up" shimmer for a resumed/joined grid
      return this.replaying ? this.replayLoop() : this.runTurns();
    };
    setTimeout(begin, this.replaying ? 200 : 1600);
  }

  buildMap(spawnPlans) {
    const R = this.config.radius;
    this.cells = generateMap(R);
    for (const cell of this.cells.values()) cell.terrain = 'normal';

    if (this.customMap) {
      // explicit terrain — no procedural obstacles/heals
      for (const t of this.customMap.terrain || []) {
        const cell = this.cells.get(key(t.q, t.r));
        if (cell && (t.type === 'hole' || t.type === 'high' || t.type === 'heal')) {
          cell.terrain = t.type;
        }
      }
      this._renderTiles();
      return;
    }

    const spawnKeys = spawnPlans.map((p) => ({ q: p.q, r: p.r }));
    const nearSpawn = (c) => spawnKeys.some((s) => hexDistance(c, s) < 3);

    // pits and plateaus across the midfield, sometimes growing a neighbour
    const zone = [...this.cells.values()].filter((c) => !nearSpawn(c));
    let placed = 0;
    let guard = 900;
    while (placed < this.config.obstacles && zone.length && guard-- > 0) {
      const cell = zone.splice(Math.floor(this.rand() * zone.length), 1)[0];
      if (cell.terrain !== 'normal') continue;
      const t = this.rand() < 0.45 ? 'hole' : 'high';
      cell.terrain = t;
      placed++;
      if (placed < this.config.obstacles && this.rand() < 0.5) {
        const ns = DIRS
          .map(([dq, dr]) => this.cells.get(key(cell.q + dq, cell.r + dr)))
          .filter((n) => n && n.terrain === 'normal' && !nearSpawn(n));
        if (ns.length) {
          ns[Math.floor(this.rand() * ns.length)].terrain = t;
          placed++;
        }
      }
    }

    // healing pads on open ground
    let heals = this.config.heals || 0;
    const hzone = [...this.cells.values()]
      .filter((c) => c.terrain === 'normal' && !nearSpawn(c));
    while (heals > 0 && hzone.length) {
      const cell = hzone.splice(Math.floor(this.rand() * hzone.length), 1)[0];
      cell.terrain = 'heal';
      heals--;
    }

    this._renderTiles();
  }

  // Build the tile meshes for the current `this.cells` terrain. Shared by the
  // procedural and custom-map paths.
  _renderTiles() {
    // flat (normal) cells — the overwhelming majority — render as ONE instanced
    // shader mesh; only the few special tiles stay as individual meshes
    const flatPositions = [];
    for (const cell of this.cells.values()) {
      const { x, z } = hexToWorld(cell.q, cell.r);
      const ck = key(cell.q, cell.r);
      if (cell.terrain === 'normal') {
        flatPositions.push({ x, z, key: ck });
      } else {
        const tile = cell.terrain === 'high' ? buildHighTile()
          : cell.terrain === 'hole' ? buildHoleTile()
          : buildHealTile();
        tile.position.set(x, 0, z);
        tile.userData.cellKey = ck;
        tile.userData.tileMesh.userData.cellKey = ck;
        this.scene.add(tile);
        this.tileGroups.set(ck, tile);
        this.pickMeshes.push(tile.userData.tileMesh);
        if (tile.userData.healMat) this.healMats.push(tile.userData.healMat);
        if (tile.userData.healStream) this.healStreams.push(tile.userData.healStream);
      }

      const hl = buildHighlight();
      hl.position.set(x, TERRAIN_Y[cell.terrain] + 0.04, z);
      // a highlight never moves (only its visibility/colour changes) — compute
      // its world matrix once and keep it out of the per-frame matrix walk
      hl.matrixAutoUpdate = false; hl.updateMatrix(); hl.matrixWorld.copy(hl.matrix);
      hl.matrixWorldAutoUpdate = false;
      this.scene.add(hl);
      this.highlights.set(ck, hl);
    }
    this.tileField = buildTileField(flatPositions);
    this.tileField.matrixAutoUpdate = false; this.tileField.updateMatrix();
    this.tileField.matrixWorld.copy(this.tileField.matrix);
    this.tileField.matrixWorldAutoUpdate = false; // spans the whole grid, never moves
    this.scene.add(this.tileField);
    this.pickMeshes.push(this.tileField);
  }

  // LOD: swap ONE unit between its full model and a single bright blip (a no-op
  // if it's already at that level, so it's cheap to call every frame).
  _applyUnitLOD(u, far) {
    const lod = u.mesh.userData.lod;
    if (!lod || lod.far === far) return;
    lod.far = far;
    for (const p of lod.parts) {
      p.visible = !far;
      // hidden detail needn't be walked while far — the unit re-forces it on the
      // frames it actually moves, so it snaps back correctly when it returns
      p.matrixWorldAutoUpdate = !far;
    }
    lod.proxy.visible = far;
  }

  // Per-unit LOD by TRUE distance to the camera: units near the viewer keep full
  // detail while distant ones drop to blips. Keyed off each unit's own distance
  // (not the orbit target), so zooming or panning to any cluster on a huge map
  // details exactly what you move close to. `nearDist` = the distance at which a
  // unit is the threshold pixel-height on screen.
  updateLOD(camPos, nearDist) {
    for (const u of this.units) {
      if (!u.alive) continue;
      this._applyUnitLOD(u, camPos.distanceTo(u.mesh.position) > nearDist);
    }
  }

  // Force a single detail level on every unit — the classic ortho view (one
  // global zoom) and the spawn-time default. Keeps _lodFar in step for newborns.
  setDetailLevel(far) {
    far = !!far;
    this._lodFar = far;
    for (const u of this.units) if (u.alive) this._applyUnitLOD(u, far);
  }

  // Export the current board (terrain + live unit placements + faction setup) as
  // a custom-map object the backend can store and `customMap` can replay.
  exportMap(name) {
    const terrain = [];
    for (const cell of this.cells.values()) {
      if (cell.terrain && cell.terrain !== 'normal') {
        terrain.push({ q: cell.q, r: cell.r, type: cell.terrain });
      }
    }
    const placements = this.units.filter((u) => u.alive)
      .map((u) => ({ side: u.side, type: u.type, q: u.q, r: u.r }));
    const factions = (this.factionConfigs || []).map((c) => ({
      color: c.color, controller: c.controller, team: c.team,
    }));
    return {
      v: 1, name: name || 'GRID', sizeKey: this.sizeKey, radius: this.config.radius,
      income: this.config.income, factions, terrain, placements,
    };
  }

  spawn(side, type, q, r, forcedId = null) {
    const def = UNIT_TYPES[type];
    const f = this.factions[side];
    const mesh = type === 'core'
      ? buildCore(f.color, f.isAI)
      : buildUnitMesh(type, f.color);
    const lodParts = mesh.children.slice(); // the full model — hidden in LOD-far mode

    const { x, z } = hexToWorld(q, r);
    const baseY = def.fly ? FLY_HEIGHT : 0;
    mesh.position.set(x, baseY, z);
    let wedgeMat = null;
    if (type !== 'core') {
      mesh.lookAt(0, baseY, 0); // face the centre of the Grid
      const wedge = buildFacingWedge(f.color, 0.06 - baseY);
      wedgeMat = wedge.material;
      mesh.add(wedge);
    }
    this.scene.add(mesh);

    // pulsing ground ring marking units that can still act this turn
    let readyRing = null;
    if (type !== 'core') {
      readyRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.028, 8, 28),
        new THREE.MeshBasicMaterial({
          color: 0xeafcff, transparent: true, opacity: 0.3, depthWrite: false,
        })
      );
      readyRing.rotation.x = Math.PI / 2;
      readyRing.position.y = 0.05 - baseY;
      readyRing.visible = false;
      mesh.add(readyRing);
    }

    const bar = makeHealthBar(f.css, HEALTHBAR_Y[type]);
    mesh.add(bar.sprite);

    const unit = {
      id: forcedId != null ? forcedId : nextUnitId++,
      side, type, q, r,
      hp: def.hp, maxHp: def.hp,
      movesLeft: def.move,
      attacked: false,
      postAttackMoved: false,
      turretAngle: 0,        // tanks: hull-relative turret heading
      altitude: 'normal',    // recognizers: 'normal' | 'high'
      speed: 1,              // cycles: persistent velocity (1 slow .. 3 fast)
      focusHits: 0,          // attacks received this turn (focus-fire bonus)
      coreId: null,          // the core that spawned it — defects when conquered
      mesh, bar, baseY, readyRing, wedgeMat,
      alive: true,
    };
    // LOD: a cheap faction blip swapped in for the full model when zoomed out.
    // Added before the unitId traverse so it stays a valid pick target far out.
    const lodProxy = buildUnitProxy(type, f.color);
    lodProxy.visible = this._lodFar;
    mesh.add(lodProxy);
    if (this._lodFar) for (const p of lodParts) { p.visible = false; p.matrixWorldAutoUpdate = false; }
    mesh.userData.lod = { parts: lodParts, proxy: lodProxy, far: this._lodFar };
    mesh.traverse((o) => { o.userData.unitId = unit.id; });
    this.units.push(unit);
    this.pickMeshes.push(mesh);
    return unit;
  }

  // ---------- queries ----------

  cellOf(unit) { return this.cells.get(key(unit.q, unit.r)); }

  unitAt(q, r) {
    return this.units.find((u) => u.alive && u.q === q && u.r === r);
  }

  unitById(id) {
    return this.units.find((u) => u.id === id);
  }

  aliveUnits(side) {
    return this.units.filter((u) => u.alive && (side === undefined || u.side === side));
  }

  teamOf(side) { return this.factions[side].team; }

  isHostile(a, b) { return this.teamOf(a) !== this.teamOf(b); }

  hostileUnits(side) {
    return this.units.filter((u) => u.alive && this.isHostile(u.side, side));
  }

  coreOf(side) {
    return this.units.find((u) => u.alive && u.side === side && u.type === 'core');
  }

  factionOf(unit) { return this.factions[unit.side]; }

  // An AI faction sometimes comments on events — chat line + optional voice.
  // AIs on a team with a human speak like Tron, not like the MCP.
  alliedWithHuman(side) {
    const team = this.factions[side].team;
    return this.factions.some(
      (f) => f.team === team && f.controller === 'human' && !f.eliminated);
  }

  sayChance(side, kind, p) {
    const f = this.factions[side];
    if (!f || !f.isAI || Math.random() >= p) return;
    const set = this.alliedWithHuman(side) ? BARKS_ALLY : BARKS;
    const lines = set[kind] || BARKS[kind];
    this.coreBark(side, lines[Math.floor(Math.random() * lines.length)]);
  }

  // AI transmissions surface as fading text above the faction's own core
  // (the transmissions chat is reserved for human players). VOICE still
  // speaks them aloud when the player has it enabled. In a networked game the
  // bark is broadcast so every client shows it above their own copy of the
  // core; `broadcast = false` is used when applying a bark received off the
  // wire, to avoid echoing it back out.
  coreBark(side, text, broadcast = true) {
    const f = this.factions && this.factions[side];
    if (!f) return;
    const anchor = this.coreOf(side)
      || this.units.find((u) => u.alive && u.side === side && u.mesh);
    if (anchor && anchor.mesh) {
      const pos = anchor.mesh.position.clone();
      pos.y += 3.4;
      this.fx.bark(pos, text, f.css);
    }
    this.ui.speak(text);
    if (broadcast && this.net) this.net.emitBark(side, text);
  }

  // A human player (or spectator) transmits a chat line.
  playerChat(text) {
    let name = 'OBSERVER', css = '#e8f6ff';
    if (this.net && !this.net.isHost) {
      const mf = this.net.myFaction;
      if (mf != null && this.factions[mf]) {
        name = this.factions[mf].name;
        css = this.factions[mf].css;
      }
    } else {
      const sender = this.isMyTurn()
        ? this.factions[this.current]
        : this.factions.find((f) => f.controller === 'human');
      if (sender) { name = sender.name; css = sender.css; }
    }
    this.ui.addChat(name, css, text, false);
    if (this.net) this.net.emitChat(name, css, text);
  }

  isHumanTurn() {
    return !this.over && this.factions.length > 0 &&
      this.factions[this.current].controller === 'human';
  }

  // In a networked game a faction belongs to a specific client.
  ownsFaction(i) {
    return this.net ? this.net.ownsFaction(i) : true;
  }

  // May THIS client interact right now? Control is decided once at the
  // START of each turn — a faction claimed mid-turn changes hands only
  // from its next turn, so an in-progress hotseat turn can always finish.
  isMyTurn() {
    if (this.simultaneous) {
      return !this.over && this.planning != null
        && !this.factions[this.planning].eliminated;
    }
    if (!this.isHumanTurn()) return false;
    return this._turnLocal === undefined
      ? this.ownsFaction(this.current)
      : this._turnLocal;
  }

  emitNet(ev) {
    if (this.net) this.net.emitAction(ev);
    if (this.recording) this.recording.events.push(ev);
  }

  // a tick on the replay timeline at the current point in the action stream
  _recMark(label, color) {
    if (this.recording) {
      this.recording.markers.push({ i: this.recording.events.length, label, color });
    }
  }

  // Replay an action that another client performed (sequential, awaited).
  async applyNetEvent(ev) {
    const u = ev.u != null ? this.unitById(ev.u) : null;
    switch (ev.a) {
      case 'move': {
        if (!u || !u.alive) return;
        const { dests, getPath } = this.validDestinations(u);
        if (!dests.has(ev.dest)) return;
        await this.moveUnit(u, getPath(ev.dest), dests.get(ev.dest).cost);
        if (!u.alive) return;
        if (u.attacked) u.postAttackMoved = true;
        if (this.isDone(u)) this.setDim(u, true);
        return;
      }
      case 'aimove':
        if (!u || !u.alive) return;
        await this.moveUnit(u, ev.path, ev.cost);
        return;
      case 'factionorders': // simultaneous mode: a faction's committed orders
        for (const o of ev.list) {
          const path = (o.path || []).map(([q, r]) => ({ q, r }));
          this.orders.set(o.u, {
            dest: path.length ? key(path[path.length - 1].q, path[path.length - 1].r) : null,
            path, attackId: o.atk != null ? o.atk : null,
          });
        }
        return;
      case 'attack': {
        const t = this.unitById(ev.t);
        if (u && t && u.alive && t.alive) await this.attack(u, t);
        return;
      }
      case 'push': {
        const t = this.unitById(ev.t);
        if (u && t && u.alive && t.alive) await this.pushAttack(u, t);
        return;
      }
      case 'conq':
        if (u && u.alive) await this.conquestAttack(u);
        return;
      case 'build':
        this.build(ev.side, ev.type, ev.core != null ? this.unitById(ev.core) : null);
        return;
      case 'turret':
        if (u && u.alive) {
          u.turretAngle = ev.angle;
          const tr = u.mesh.userData.turret;
          if (tr) {
            const s = tr.rotation.y;
            this.fx.tween(0.2, (k) => { tr.rotation.y = s + (ev.angle - s) * k; });
          }
        }
        return;
      case 'alt':
        if (u && u.alive) {
          u.altitude = ev.alt;
          u.baseY = this.recoBaseY(u);
          const cell = this.cellOf(u);
          const dy = u.baseY + TERRAIN_Y[cell.terrain];
          const fy = u.mesh.position.y;
          this.fx.tween(0.4, (k) => { u.mesh.position.y = fy + (dy - fy) * k; });
        }
        return;
      default:
        return;
    }
  }

  isCrippled(unit) {
    return unit.type === 'reco' && unit.hp / unit.maxHp < CRIPPLED_AT;
  }

  // The flight-level order for a unit type (jets have an extra ground level).
  altOrder(unit) {
    return unit.type === 'jet' ? JET_ALT_ORDER : ALT_ORDER;
  }

  recoBaseY(unit) {
    if (unit.type === 'jet') return JET_BASEY[unit.altitude] != null ? JET_BASEY[unit.altitude] : FLY_HEIGHT;
    if (this.isCrippled(unit)) return FLY_CRIPPLED;
    if (unit.altitude === 'top') return FLY_TOP;
    return unit.altitude === 'high' ? FLY_HIGH : FLY_HEIGHT;
  }

  // Flight level as an index into the unit's altitude order.
  altLevel(unit) {
    const i = this.altOrder(unit).indexOf(unit.altitude);
    return i < 0 ? (unit.type === 'jet' ? 1 : 0) : i; // jets default to 'normal'
  }

  // Out of a light cycle's reach: a recognizer flying high/top, or a jet that
  // is airborne at all (jets are only vulnerable to cycles on the ground).
  recoRaised(unit) {
    if (unit.type === 'jet') return unit.altitude !== 'ground';
    return unit.type === 'reco'
      && (unit.altitude === 'high' || unit.altitude === 'top');
  }

  // Is a flying unit currently sitting on the ground (jet that's been forced down)?
  isGrounded(unit) {
    return unit.type === 'jet' && unit.altitude === 'ground';
  }

  // Occupancy band on a hex: only a top-level recognizer sits in the 'top'
  // band (it can share a hex with whatever is on the ground beneath it).
  altBand(unit) {
    return (unit.type === 'reco' && unit.altitude === 'top') ? 'top' : 'ground';
  }

  unitsAt(q, r) {
    return this.units.filter((u) => u.alive && u.q === q && u.r === r);
  }

  // A non-flying (ground-band) occupant on a hex — the thing a top-level
  // recognizer would be hovering directly above.
  groundOccupantAt(q, r, exceptId = null) {
    return this.units.find((u) => u.alive && u.q === q && u.r === r
      && u.id !== exceptId && this.altBand(u) === 'ground');
  }

  // Can `unit` finish a move on this hex? Cores block everything; otherwise a
  // unit may share a hex only with something in a different flight band (a
  // top-level recognizer over a ground unit, or vice-versa).
  canLandOn(unit, q, r) {
    const myBand = this.altBand(unit);
    for (const o of this.unitsAt(q, r)) {
      if (o.id === unit.id) continue;
      if (o.type === 'core') return false;
      if (this.altBand(o) === myBand) return false;
    }
    return true;
  }

  // A tank rocks on its suspension when hit — a quick tilt on a random
  // horizontal axis that oscillates and settles back to level.
  _tankRecoil(unit) {
    if (unit._recoiling) return; // don't stack overlapping rocks (focus fire)
    unit._recoiling = true;
    const base = unit.mesh.quaternion.clone();
    const ax = new THREE.Vector3(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
    if (ax.lengthSq() < 1e-3) ax.set(1, 0, 0);
    ax.normalize();
    const amp = 0.26;
    const q = new THREE.Quaternion();
    this.fx.tween(0.5, (k) => {
      const ang = amp * Math.sin(k * Math.PI * 3) * (1 - k); // decaying rock
      q.setFromAxisAngle(ax, ang);
      unit.mesh.quaternion.copy(base).multiply(q);
    }, () => {
      unit.mesh.quaternion.copy(base);
      unit._recoiling = false;
    });
  }

  // Knock a recognizer down one flight level (a crippling hit drops it all the
  // way to low). Animates the descent. Returns true if it fell out of 'top'.
  _lowerRecoAltitude(unit) {
    const flyer = unit.type === 'reco' || unit.type === 'jet';
    if (!flyer || this.altLevel(unit) <= 0) return false;
    const wasTop = unit.altitude === 'top';
    const order = this.altOrder(unit);
    const crippled = this.isCrippled(unit); // reco-only
    unit.altitude = crippled ? 'normal' : order[this.altLevel(unit) - 1];
    unit.baseY = this.recoBaseY(unit);
    const cell = this.cellOf(unit);
    const destY = unit.baseY + TERRAIN_Y[cell.terrain];
    const fromY = unit.mesh.position.y;
    this.fx.tween(0.6, (k) => { unit.mesh.position.y = fromY + (destY - fromY) * k; });
    const tp = unit.mesh.position.clone();
    tp.y += 2.4;
    const grounded = unit.altitude === 'ground';
    this.fx.floatText(tp,
      grounded ? 'FORCED DOWN' : crippled ? 'ENGINES FAILING' : 'ALTITUDE LOST',
      '#ff8866');
    return wasTop;
  }

  // Is there an active enemy-team light wall on this cell (deadly to cycles)?
  // The altitude band a wall lives in: cycle walls (no .alt) and grounded jet
  // walls sit on the floor ('ground'); airborne jet walls live at the altitude
  // they were laid ('normal' / 'high' / 'top').
  _trailBand(t) {
    return t.alt != null ? t.alt : 'ground';
  }

  // Ground walls only — used by cycles (deadly) and tanks (break). Airborne jet
  // walls are excluded so they never affect anything on the floor.
  hostileTrailAt(side, q, r) {
    const k = key(q, r);
    return this.trails.some((t) =>
      this._trailBand(t) === 'ground' && this.isHostile(t.side, side) && t.cells.has(k));
  }

  // Cycles can never cross their own team's (ground) walls (allies included).
  friendlyTrailAt(side, q, r) {
    const k = key(q, r);
    return this.trails.some((t) =>
      this._trailBand(t) === 'ground' && !this.isHostile(t.side, side) && t.cells.has(k));
  }

  // A hostile jet wall sitting in this hex at the flier's own altitude — deadly
  // to a jet that flies into it (a unit never collides with its own wall).
  _hostileJetWallAtCell(unit, q, r) {
    const k = key(q, r);
    return this.trails.some((t) =>
      t.alt != null && t.alt === unit.altitude && t.owner !== unit.id &&
      this.isHostile(t.side, unit.side) && t.cells.has(k));
  }

  // How many DISTINCT enemy jet walls (at this flier's altitude) a path would
  // cut — used by the AI to value a recognizer's wall-shearing runs.
  jetWallsCutByPath(unit, path) {
    const cut = new Set();
    for (const s of path) {
      const k = key(s.q, s.r);
      for (const t of this.trails) {
        if (t.alt != null && t.alt === unit.altitude &&
            this.isHostile(t.side, unit.side) && t.cells.has(k)) cut.add(t);
      }
    }
    return cut.size;
  }


  clearTrails(side) {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      if (this.trails[i].side !== side) continue;
      for (const w of this.trails[i].walls) this.fx.fadeWall(w);
      this.trails.splice(i, 1);
    }
  }

  // A derezzed cycle's walls collapse with it, immediately.
  clearTrailsOfOwner(unitId) {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      if (this.trails[i].owner !== unitId) continue;
      for (const w of this.trails[i].walls) this.fx.fadeWall(w);
      this.trails.splice(i, 1);
    }
  }

  // Per-unit movement cost of entering a cell (Infinity = impassable).
  costFor(unit, opts = {}) {
    if (UNIT_TYPES[unit.type].fly) {
      const crippled = this.isCrippled(unit);
      // a jet flying through a hostile jet wall (at its altitude) derezzes, so
      // route AROUND them when asked — the AI sets avoidTrails, making the walls
      // impassable to it; the player passes no flag and keeps the reach (and the
      // option to fly through and die). Recognizers ignore this — they shear the
      // walls apart rather than dying on them.
      const dodgeWalls = !!opts.avoidTrails && unit.type === 'jet';
      return (q, r) => {
        const cell = this.cells.get(key(q, r));
        if (!cell) return Infinity;
        if (cell.terrain === 'high' && crippled) return Infinity;
        if (dodgeWalls && this._hostileJetWallAtCell(unit, q, r)) return Infinity;
        const occ = this.unitsAt(q, r).filter((o) => o.id !== unit.id);
        if (occ.length) {
          if (occ.some((o) => o.type === 'core')) return Infinity; // never over a core
          return ROUGH_COST;                // recognizers glide over other units
        }
        return isRough(cell.terrain) ? ROUGH_COST : 1;
      };
    }
    const isCycle = unit.type === 'cycle';
    return (q, r) => {
      const cell = this.cells.get(key(q, r));
      if (!cell || isRough(cell.terrain)) return Infinity;
      // a lone top-level recognizer overhead doesn't block the ground
      if (this.groundOccupantAt(q, r, unit.id)) return Infinity;
      if (isCycle) {
        if (this.friendlyTrailAt(unit.side, q, r)) return Infinity;
        if (opts.avoidTrails && this.hostileTrailAt(unit.side, q, r)) return Infinity;
      }
      return 1;
    };
  }

  canMoveNow(u) {
    if (u.type === 'core' || u.movesLeft <= 0) return false;
    if (u.attacked && (u.type !== 'cycle' || u.postAttackMoved)) return false;
    return true;
  }

  isDone(u) {
    return u.attacked && !this.canMoveNow(u);
  }

  validDestinations(unit, opts = {}) {
    let reach, getPath;
    const risky = new Set();
    if (unit.type === 'cycle') {
      // two-pass search: prefer routes that avoid enemy walls entirely;
      // only fall back to wall-crossing paths when no safe route exists
      const fw = unit.mesh.getWorldDirection(this._v1);
      const dir = dirFromVector(fw.x, fw.z);
      const v0 = unit.speed || 1;
      const safe = reachableCycle(
        this.cells, this.costFor(unit, { avoidTrails: true }),
        unit, dir, unit.movesLeft, v0
      );
      let danger = null;
      if (!opts.avoidTrails) {
        danger = reachableCycle(
          this.cells, this.costFor(unit, {}), unit, dir, unit.movesLeft, v0
        );
      }
      reach = new Map();
      if (danger) {
        for (const [k, v] of danger.cellBest) reach.set(k, { cost: v.cost });
      }
      for (const [k, v] of safe.cellBest) reach.set(k, { cost: v.cost }); // safe wins
      for (const k of reach.keys()) {
        if (!safe.cellBest.has(k)) risky.add(k);
      }
      getPath = (k) => safe.cellBest.has(k)
        ? cyclePath(safe, k)
        : cyclePath(danger, k);
    } else if (unit.type === 'jet') {
      // jets fly with a turning circle — heading-aware search so they sweep in
      // wide arcs instead of pivoting freely like a recognizer
      const fw = unit.mesh.getWorldDirection(this._v1);
      const dir = dirFromVector(fw.x, fw.z);
      const r = reachableJet(this.cells, this.costFor(unit, opts), unit, dir, unit.movesLeft);
      reach = new Map();
      for (const [k, v] of r.cellBest) reach.set(k, { cost: v.cost });
      getPath = (k) => cyclePath(r, k);
    } else {
      const r = reachable(this.cells, this.costFor(unit, opts), unit, unit.movesLeft);
      reach = r;
      getPath = (k) => pathTo(r, k).map(parseKey);
    }
    const dests = new Map();
    for (const [k, info] of reach) {
      if (info.cost === 0) continue;
      const cell = this.cells.get(k);
      if (!this.canLandOn(unit, cell.q, cell.r)) continue;
      dests.set(k, info);
    }
    if (unit.type === 'cycle') {
      // drop looping paths that would cross the wall being laid right now
      for (const k of [...dests.keys()]) {
        const seen = new Set([key(unit.q, unit.r)]);
        let crossesSelf = false;
        for (const c of getPath(k)) {
          const ck = key(c.q, c.r);
          if (seen.has(ck)) { crossesSelf = true; break; }
          seen.add(ck);
        }
        if (crossesSelf) dests.delete(k);
      }
    }
    return { reach, dests, getPath, risky };
  }

  // Tanks fire within a 60° arc of where the turret currently points; raised
  // recognizers see further but can't be touched by light cycles. `freeTurret`
  // widens the arc to ±120° — the 60° firing cone plus the 60° the turret can
  // still slew this turn — for planning a move that ends with a shot.
  targetsInRange(unit, fromQ = unit.q, fromR = unit.r, opts = {}) {
    const def = UNIT_TYPES[unit.type];
    if (!def.range) return [];
    let range = def.range;
    if (unit.type === 'reco') range += this.altLevel(unit); // high +1, top +2
    let f = null;          // firing-arc centre direction (tank turret / jet nose)
    let threshold = 0.5;   // cos of the half-arc angle
    if (unit.type === 'tank') {
      if (opts.facing) {
        f = { x: opts.facing.x, z: opts.facing.z };
      } else {
        const fw = unit.mesh.getWorldDirection(this._v1);
        const l = Math.hypot(fw.x, fw.z) || 1;
        f = { x: fw.x / l, z: fw.z / l };
      }
      const a = unit.turretAngle || 0; // arc tracks the turret's current facing
      f = {
        x: f.x * Math.cos(a) + f.z * Math.sin(a),
        z: f.z * Math.cos(a) - f.x * Math.sin(a),
      };
      threshold = opts.freeTurret ? -0.5 : 0.5; // cos(120°) vs cos(60°)
    } else if (unit.type === 'jet') {
      // a jet can only fire into the arc ahead of its nose — it never turns to
      // shoot. Facing comes from a planned move's heading, else its current nose.
      const src = opts.facing || unit.mesh.getWorldDirection(this._v1);
      const l = Math.hypot(src.x, src.z) || 1;
      f = { x: src.x / l, z: src.z / l };
      threshold = 0.45; // ~±63°: the three hexes ahead, not the sides or rear
    }
    const from = hexToWorld(fromQ, fromR);
    return this.units.filter((t) => {
      if (!t.alive || !this.isHostile(t.side, unit.side)) return false;
      if (hexDistance({ q: fromQ, r: fromR }, t) > range) return false;
      // a neutral flag-core can't be shot down — only captured by conquest
      if (t.type === 'core' && this.factions[t.side].neutral) return false;
      // a raised recognizer (high or top) is out of a light cycle's reach
      if (unit.type === 'cycle' && this.recoRaised(t)) return false;
      if (f) { // tank turret arc or jet forward arc
        const dx = t.mesh.position.x - from.x;
        const dz = t.mesh.position.z - from.z;
        const len = Math.hypot(dx, dz) || 1;
        if ((dx * f.x + dz * f.z) / len < threshold) return false; // outside arc
      }
      return true;
    });
  }

  // Directional damage: hits into a unit's rear arc are +50%, hits
  // against its front arc are deflected to 75%. Cores have no facing.
  damageMultiplier(fromX, fromZ, target) {
    if (target.type === 'core') return { mult: 1, label: null };
    const facing = target.mesh.getWorldDirection(this._v1);
    facing.y = 0;
    facing.normalize();
    let dx = target.mesh.position.x - fromX;
    let dz = target.mesh.position.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const dot = dx * facing.x + dz * facing.z;
    if (dot > 0.5) return { mult: 1.5, label: 'REAR STRIKE' };
    if (dot < -0.5) return { mult: 0.75, label: 'DEFLECTED' };
    return { mult: 1, label: null };
  }

  // Hull-relative angle (radians) from a tank to a target, for turret aiming.
  turretAngleTo(unit, target) {
    unit.mesh.updateMatrixWorld();
    const lp = unit.mesh.worldToLocal(target.mesh.position.clone());
    return Math.atan2(lp.x, lp.z);
  }

  // The turret angle this tank's turret started the turn at — it may swing up
  // to ±TURRET_BUDGET from there, freely back and forth, before settling.
  turretStartOf(unit) {
    return unit.turretStart == null ? (unit.turretAngle || 0) : unit.turretStart;
  }

  // Shortest signed offset of the turret from its turn-start angle (radians).
  turretOffset(unit) {
    const s = this.turretStartOf(unit);
    return Math.atan2(Math.sin((unit.turretAngle || 0) - s),
      Math.cos((unit.turretAngle || 0) - s));
  }

  // Clamp an absolute turret angle into this turn's reachable window
  // (turn-start ±TURRET_BUDGET) and return the normalised result.
  _clampTurret(unit, angle) {
    const s = this.turretStartOf(unit);
    let off = Math.atan2(Math.sin(angle - s), Math.cos(angle - s)); // shortest way round
    off = Math.max(-TURRET_BUDGET, Math.min(TURRET_BUDGET, off));
    return Math.atan2(Math.sin(s + off), Math.cos(s + off));
  }

  // Swivel a tank's turret toward a target, as far as this turn's ±60° reach
  // allows. No fixed hull arc — over several turns it can come all the way
  // around. Returns the angle actually applied.
  aimTurretAt(unit, target) {
    if (unit.type !== 'tank') return 0;
    const cur = unit.turretAngle || 0;
    const next = this._clampTurret(unit, this.turretAngleTo(unit, target));
    unit.turretAngle = next;
    return Math.atan2(Math.sin(next - cur), Math.cos(next - cur));
  }

  // Player turret control: 30° per press, adjustable back and forth, but only
  // out to ±60° from where the turret started the turn. No hull arc — keep
  // turning across turns to bring it all the way around.
  playerRotateTurret(dir) {
    if (this.busy || this.over || !this.isMyTurn()) return;
    const u = this.selected;
    if (!u || u.type !== 'tank' || u.side !== this.current || u.attacked) return;
    const cur = u.turretAngle || 0;
    const next = this._clampTurret(u, cur + dir * TURRET_STEP);
    if (Math.abs(Math.atan2(Math.sin(next - cur), Math.cos(next - cur))) < 1e-4) {
      this.audio.uiDeny(); return; // already at this turn's limit in that direction
    }
    u.turretAngle = next;
    this.emitNet({ a: 'turret', u: u.id, angle: next });
    this.audio.servo();
    const turret = u.mesh.userData.turret;
    const startAng = turret.rotation.y;
    this.fx.tween(0.2, (k) => {
      turret.rotation.y = startAng + (next - startAng) * k;
    });
    this.refreshHighlights();
    this.ui.showUnit(u, this);
  }

  // Player altitude control for recognizers. Three flight levels (normal →
  // high → top); a unit may climb or dive only one level per turn. High and top
  // are out of light-cycle reach; top sees +2 hexes and flies over other units,
  // but takes +2 damage per hit, can't repair, and drops a level when struck.
  playerSetAltitude(dir) {
    if (this.busy || this.over || !this.isMyTurn()) return;
    const u = this.selected;
    const flyer = u && (u.type === 'reco' || u.type === 'jet');
    if (!flyer || u.side !== this.current || u.attacked) return;
    if (this.isCrippled(u)) { this.audio.uiDeny(); return; }
    if (u.altStepUsed) { this.audio.uiDeny(); return; } // one level per turn
    const order = this.altOrder(u);
    const lvl = this.altLevel(u);
    const next = Math.max(0, Math.min(order.length - 1, lvl + (dir > 0 ? 1 : -1)));
    if (next === lvl) { this.audio.uiDeny(); return; }
    this.applyAltitude(u, order[next]);
    this.audio.blip();
    this.refreshHighlights(); // range and cycle-immunity changed
    this.ui.showUnit(u, this);
  }

  // Set a recognizer's flight level, animate the climb/dive, sync over the net,
  // and spend its one altitude change for the turn. Returns the descent tween.
  applyAltitude(unit, alt) {
    unit.altitude = alt;
    unit.altStepUsed = true;
    unit.baseY = this.recoBaseY(unit);
    this.emitNet({ a: 'alt', u: unit.id, alt });
    const cell = this.cellOf(unit);
    const destY = unit.baseY + TERRAIN_Y[cell.terrain];
    const fromY = unit.mesh.position.y;
    return this.fx.tween(0.4, (k) => {
      unit.mesh.position.y = fromY + (destY - fromY) * k;
    });
  }

  // AI helper: nudge a recognizer one flight level toward `desiredLevel`,
  // honouring the once-per-turn limit. Returns the animation promise or null.
  aiStepAltitude(unit, desiredLevel) {
    if (unit.type !== 'reco' || unit.attacked || unit.altStepUsed) return null;
    if (this.isCrippled(unit)) return null;
    const cur = this.altLevel(unit);
    const want = Math.max(0, Math.min(ALT_ORDER.length - 1, desiredLevel));
    if (want === cur) return null;
    const next = cur + (want > cur ? 1 : -1);
    return this.applyAltitude(unit, ALT_ORDER[next]);
  }

  // ---------- unit production ----------

  findSpawnCell(core) {
    const ring = cellsInRange(this.cells, core.q, core.r, 2)
      .filter((c) => c.terrain === 'normal' && !this.unitAt(c.q, c.r))
      .sort((a, b) => hexDistance(core, a) - hexDistance(core, b));
    return ring[0] || null;
  }

  // Builds at `core` (the selected one); falls back to the faction's first.
  build(side, type, core = null) {
    const def = UNIT_TYPES[type];
    const f = this.factions[side];
    // test cost presence explicitly: a house-rule cost of 0 is valid (the RULES
    // editor allows it) and must still build — `!def.cost` would reject it forever
    if (!def || def.cost == null || f.energy < def.cost) return null;
    if (this.buildable && !this.buildable.includes(type)) return null; // map-restricted
    if (!core || !core.alive || core.side !== side) core = this.coreOf(side);
    if (!core) return null;
    const spot = this.findSpawnCell(core);
    if (!spot) return null;

    f.energy -= def.cost;
    this.markActed(side);
    if (this._aiNet) this.emitNet({ a: 'build', side, type, core: core.id });
    const unit = this.spawn(side, type, spot.q, spot.r);
    unit.coreId = core.id; // belongs to the core that built it
    unit.movesLeft = 0;
    unit.attacked = true; // ready next turn
    this.setDim(unit, true);

    const orig = unit.mesh.scale.x;
    unit.mesh.scale.setScalar(0.01);
    this.fx.materialize(unit.mesh.position.clone().setY(0), f.color);
    this.fx.tween(0.6, (k) => {
      unit.mesh.scale.setScalar(orig * Math.max(0.05, Math.ceil(k * 6) / 6));
    });

    if (side === this.current) this.ui.setEnergy(f.energy, f.css);
    return unit;
  }

  playerBuild(type) {
    if (this.busy || this.over || !this.isMyTurn()) return;
    if (!this.selected || this.selected.type !== 'core'
        || this.selected.side !== this.current) return;
    const core = this.selected;
    const unit = this.build(this.current, type, core);
    if (!unit) {
      this.audio.uiDeny();
      return;
    }
    this.emitNet({ a: 'build', side: this.current, type, core: core.id });
    this.audio.blip();
    this.ui.refreshBuildMenu(this.factions[this.current].energy, this.buildable);
    this.maybeAutoEnd();
  }

  // ---------- selection & highlights ----------

  clearHighlights() {
    for (const hl of this.highlights.values()) hl.visible = false;
  }

  refreshHighlights() {
    this.clearHighlights();
    const u = this.selected;
    if (!u) {
      this.reachMap = null; this.destsMap = null;
      this.getPath = null; this.riskySet = null;
      return;
    }

    if (this.canMoveNow(u) && u.side === this.current) {
      const { reach, dests, getPath, risky } = this.validDestinations(u);
      this.reachMap = reach;
      this.destsMap = dests;
      this.getPath = getPath;
      this.riskySet = risky;
      const def = UNIT_TYPES[u.type];
      const fullSpeed = u.type === 'cycle' && u.movesLeft === def.move;
      for (const [k, info] of dests) {
        const hl = this.highlights.get(k);
        if (risky.has(k)) {
          // only reachable by driving through an enemy wall — deadly
          hl.material.color.setHex(0xff8822);
          hl.material.opacity = 0.38;
        } else if (fullSpeed && info.cost >= def.move) {
          const pred = this.predictSlide(u, this.getPath(k));
          if (pred.dies) {
            hl.material.color.setHex(0xff2222);
            hl.material.opacity = 0.45;
          } else {
            hl.material.color.setHex(0xbef7ff);
            hl.material.opacity = 0.3;
          }
        } else {
          hl.material.color.setHex(0x2bd9ff);
          hl.material.opacity = 0.22;
        }
        hl.visible = true;
      }
    } else {
      this.reachMap = null; this.destsMap = null;
      this.getPath = null; this.riskySet = null;
    }

    if (!u.attacked && u.side === this.current) {
      for (const t of this.targetsInRange(u)) {
        const hl = this.highlights.get(key(t.q, t.r));
        hl.material.color.setHex(0xff3322);
        hl.material.opacity = 0.4;
        hl.visible = true;
      }
    }

    const own = this.highlights.get(key(u.q, u.r));
    own.material.color.setHex(0xffffff);
    own.material.opacity = 0.3;
    own.visible = true;
  }

  select(unit) {
    this._clearArmed(); // drop any pending touch-confirm preview
    this.selected = unit;
    this.pushMode = false;
    this.ui.hideTarget();
    this.ui.showUnit(unit, this);
    if (this.simultaneous && this.planning != null) this.refreshPlanHighlights(unit);
    else this.refreshHighlights();
    const showBuild = !!unit && unit.type === 'core'
      && unit.side === this.current && this.isMyTurn() && !this.over;
    this.ui.showBuildMenu(showBuild,
      showBuild ? this.factions[this.current].energy : 0, this.buildable);
    if (unit) {
      // every unit announces itself with its own pitch
      const pitch = { cycle: 1150, tank: 560, reco: 840, core: 420 }[unit.type] || 920;
      this.audio.blip(pitch);
    }
  }

  // ---------- input (called from main.js) ----------

  onPick(hit, touch = false) {
    if (this.busy || this.over || !this.config) return;
    if (this.simultaneous) { if (this.planning != null) this.onPickPlan(hit); return; }
    if (!this.isMyTurn()) return;
    this.audio.init();

    if (hit && hit.unitId != null) {
      const unit = this.unitById(hit.unitId);
      if (!unit || !unit.alive) return;
      if (unit.side === this.current) {
        // per-unit initiative: you command only the active unit; the core is
        // still selectable to build, and other friendlies are inspect-only
        if (this.perUnitInit && unit.type !== 'core' && unit !== this._activeUnit) {
          this.ui.showUnit(unit, this);
          this.audio.uiDeny();
        } else {
          this.select(unit === this.selected ? null : unit);
        }
      } else {
        const u = this.selected;
        if (u && this.pushMode && !u.attacked && this.pushTargets(u).includes(unit)) {
          if (this._armTouch(touch, 'push:' + unit.id, () => {
            const p = this.predictPush(u, unit);
            const dmg = p.type === 'slam' ? 2
              : (p.type === 'pushed' || p.type === 'ownwall') ? 1 : unit.hp;
            this.ui.showTarget(unit, this, { push: true, pushText: p.text, dmg });
            this.ui.showBanner('TAP AGAIN TO PUSH', this.factions[u.side].css, 1300);
          })) return;
          this.emitNet({ a: 'push', u: u.id, t: unit.id });
          this.playerPush(u, unit);
          return;
        }
        if (u && !u.attacked && this.targetsInRange(u).includes(unit)) {
          if (this._armTouch(touch, 'atk:' + unit.id, () => {
            this.ui.showTarget(unit, this, this.predictAttack(u, unit));
            this.ui.showBanner('TAP AGAIN TO STRIKE', this.factions[u.side].css, 1300);
          })) return;
          this.emitNet({ a: 'attack', u: u.id, t: unit.id });
          this.playerAttack(u, unit);
        } else {
          this._clearArmed();
          this.ui.showUnit(unit, this);
          if (u) this.audio.uiDeny();
        }
      }
      return;
    }

    if (hit && hit.cellKey) {
      const u = this.selected;
      if (u && this.destsMap && this.destsMap.has(hit.cellKey)) {
        if (this._armTouch(touch, 'move:' + hit.cellKey, () => {
          this._setPendingCell(hit.cellKey);
          this.ui.showBanner('TAP AGAIN TO MOVE', this.factions[u.side].css, 1300);
        })) return;
        this.emitNet({ a: 'move', u: u.id, dest: hit.cellKey });
        this.playerMove(u, hit.cellKey);
        return;
      }
    }
    this.select(null);
  }

  // ---------- touch confirm ----------
  // Touchscreens have no hover, so the damage/destination preview that a mouse
  // gets for free would never show. Instead, on touch the FIRST tap on an action
  // ARMS it (shows the preview + a hint) and waits; a SECOND tap on the SAME
  // action confirms it. Desktop (touch=false) always acts immediately.
  // Returns true when the caller should wait (just armed), false to execute now.
  _armTouch(touch, key, preview) {
    if (!touch) return false;
    if (this._armedKey === key) { this._clearArmed(); return false; } // confirm
    this._clearArmed();
    this._armedKey = key;
    this.audio.blip(520);
    preview();
    return true;
  }

  _clearArmed() {
    if (!this._armedKey) return;
    this._armedKey = null;
    this._clearPendingCell();
    this.ui.hideTarget();
  }

  // amber glow on the hex a touch player has armed to move into
  _setPendingCell(cellKey) {
    this._clearPendingCell();
    const tile = this.tileGroups.get(cellKey);
    const mesh = tile && tile.userData.tileMesh;
    if (mesh && mesh.material.emissive !== undefined) {
      this._pendTile = mesh; mesh.material.emissiveIntensity = 1.0;
    } else if (this.tileField) {
      const idx = this.tileField.userData.keyToIndex.get(cellKey);
      if (idx != null) { this._pendIdx = idx; this._setFieldTint(idx, 0.22, 0.16, 0.02); }
    }
  }

  _clearPendingCell() {
    if (this._pendTile) { this._pendTile.material.emissiveIntensity = 0.35; this._pendTile = null; }
    if (this._pendIdx != null) { this._setFieldTint(this._pendIdx, 0, 0, 0); this._pendIdx = null; }
  }

  // brighten a flat (instanced) tile by index — used for the hover glow
  _setFieldTint(idx, r, g, b) {
    const a = this.tileField && this.tileField.userData.tintAttr;
    if (!a || idx == null || idx < 0) return;
    a.setXYZ(idx, r, g, b);
    a.needsUpdate = true;
  }

  onHover(hit) {
    if (this._hoverTile) {
      this._hoverTile.material.emissiveIntensity = 0.35;
      this._hoverTile = null;
    }
    if (this._hoverFieldIdx != null) {
      this._setFieldTint(this._hoverFieldIdx, 0, 0, 0); // clear previous hover
      this._hoverFieldIdx = null;
    }
    if (this.busy || this.over || !this.config) return false;
    if (hit && hit.cellKey) {
      const tile = this.tileGroups.get(hit.cellKey);
      const mesh = tile && tile.userData.tileMesh;
      if (mesh && mesh.material.emissive !== undefined) {
        this._hoverTile = mesh;
        this._hoverTile.material.emissiveIntensity = 1.0;
      } else if (this.tileField) {
        const idx = this.tileField.userData.keyToIndex.get(hit.cellKey);
        if (idx != null) { this._hoverFieldIdx = idx; this._setFieldTint(idx, 0.04, 0.18, 0.22); }
      }
    }

    // target card: hovering a hittable enemy previews the hit's effect
    let shown = false;
    if (hit && hit.unitId != null && this.isMyTurn()) {
      const t = this.unitById(hit.unitId);
      const u = this.selected;
      if (t && t.alive && u && u.alive && !u.attacked &&
          this.isHostile(t.side, u.side)) {
        if (this.pushMode && this.pushTargets(u).includes(t)) {
          const p = this.predictPush(u, t);
          const dmg = p.type === 'slam' ? 2
            : (p.type === 'pushed' || p.type === 'ownwall') ? 1 : t.hp;
          this.ui.showTarget(t, this, { push: true, pushText: p.text, dmg });
          shown = true;
        } else if (this.targetsInRange(u).includes(t)) {
          this.ui.showTarget(t, this, this.predictAttack(u, t));
          shown = true;
        }
      }
    }
    if (!shown) this.ui.hideTarget();

    return !!(hit && (hit.unitId != null ||
      (hit.cellKey && this.destsMap && this.destsMap.has(hit.cellKey))));
  }

  // The exact damage an attack would do right now (shared with attack()).
  predictAttack(attacker, target) {
    const def = UNIT_TYPES[attacker.type];
    const { mult, label } = this.damageMultiplier(
      attacker.mesh.position.x, attacker.mesh.position.z, target
    );
    let altMult = 1;
    const labels = [];
    if (label) labels.push(label);
    if (def.attack === 'rocket' && target.type === 'reco' && target.altitude === 'high') {
      altMult = 1.5;
      labels.push('FLAK');
    }
    const focus = target.focusHits || 0;
    if (focus > 0) labels.push('FOCUS x' + (focus + 1));
    // a top-level recognizer is fully exposed: every hit lands +2
    let topBonus = 0;
    if (target.type === 'reco' && target.altitude === 'top') {
      topBonus = TOP_DMG_BONUS;
      labels.push('EXPOSED +' + TOP_DMG_BONUS);
    }
    // a light cycle striking while flat out (overdrive) rams home +1
    let overdriveBonus = 0;
    if (attacker.type === 'cycle' && (attacker.speed || 1) >= OVERDRIVE_SPEED) {
      overdriveBonus = 1;
      labels.push('OVERDRIVE +1');
    }
    const dmg = Math.max(1,
      Math.round(def.dmg * mult * altMult * (1 + 0.25 * focus)) + topBonus + overdriveBonus);
    return {
      dmg, labels, mult, altMult, focus, topBonus, overdriveBonus,
      lethal: dmg >= target.hp,
      remaining: Math.max(0, target.hp - dmg),
    };
  }

  async playerMove(unit, destKey) {
    this.busy = true;
    this._refreshUndoUI(); // disable UNDO while the move animates
    this.clearHighlights();
    const cost = this.destsMap.get(destKey).cost;
    const path = this.getPath(destKey);
    // snapshot pre-move state so a clean move can be taken back (sequential only)
    const undo = (this._undoAvailable() && !unit.attacked) ? this._captureUndo(unit) : null;
    const combatBefore = this._combatSeq;
    await this.moveUnit(unit, path, cost);
    this.busy = false;
    if (this.over) return;
    if (!unit.alive) {
      this.select(null);
      this.maybeAutoEnd();
      return;
    }
    if (unit.attacked) unit.postAttackMoved = true;
    // only a clean move — unit unharmed and no fight triggered along the way —
    // is undoable; if combat fired during the move the stack is already cleared
    if (undo && this._combatSeq === combatBefore) this._undoStack.push(undo);
    this._refreshUndoUI();
    if (this.isDone(unit)) this.setDim(unit, true);
    this.select(unit);
    this.maybeAutoEnd();
  }

  // ---------- take back a move ----------
  // A player may undo a unit's MOVE, but only a "clean" one: the unit is still
  // alive, has not attacked, and no unit anywhere was damaged or destroyed (any
  // combat clears the whole stack). Each clean move pushes a memento; UNDO pops
  // and reverses it — restoring position, velocity/heading/altitude and removing
  // the light walls it laid. Offered in sequential play only (in WeGo you simply
  // re-plan, and per-unit initiative auto-passes each unit).
  _undoAvailable() {
    return !this.simultaneous && !this.perUnitInit;
  }

  _canUndo() {
    return this._undoAvailable() && !this.busy && !this.over &&
      this.isMyTurn() && this._undoStack && this._undoStack.length > 0;
  }

  _refreshUndoUI() {
    if (this.ui && this.ui.updateUndo) this.ui.updateUndo(this._undoAvailable(), this._canUndo());
  }

  // wiped the instant any combat happens, and at every turn boundary
  invalidateUndo() {
    this._combatSeq = (this._combatSeq || 0) + 1;
    if (this._undoStack && this._undoStack.length) {
      this._undoStack.length = 0;
      this._refreshUndoUI();
    }
  }

  // snapshot everything a move mutates, BEFORE it runs
  _captureUndo(unit) {
    const jt = unit._jetTrail || null;
    return {
      unitId: unit.id,
      q: unit.q, r: unit.r,
      heading: unit.heading,
      movesLeft: unit.movesLeft,
      speed: unit.speed,
      altitude: unit.altitude,
      hasFlown: unit.hasFlown,
      attacked: unit.attacked,
      postAttackMoved: unit.postAttackMoved,
      pos: unit.mesh.position.clone(),
      quat: unit.mesh.quaternion.clone(),
      trailsLen: this.trails.length,
      jetTrail: jt,
      jetAllCells: jt ? jt.allCells.slice() : null,
      jetCells: jt ? new Set(jt.cells) : null,
      jetPath: jt ? jt.path.slice() : null,
      jetLastCell: jt && jt.lastCell ? { q: jt.lastCell.q, r: jt.lastCell.r } : null,
      jetRevealStart: jt ? jt.revealStart : 0,
    };
  }

  undoLastMove() {
    if (!this._canUndo()) { this.audio.uiDeny(); return; }
    clearTimeout(this._autoEndTimer); // abort any pending "no actions left" auto-end
    const e = this._undoStack.pop();
    const unit = this.unitById(e.unitId);
    if (!unit || !unit.alive) { this._refreshUndoUI(); return; }

    // 1) take back the light walls this move created
    const jt = e.jetTrail;
    if (unit.type === 'jet' && jt && unit._jetTrail === jt && this.trails.includes(jt)) {
      // the move EXTENDED an existing ribbon — roll its path back and rebuild
      jt.allCells = e.jetAllCells;
      jt.cells = e.jetCells;
      jt.path = e.jetPath;
      jt.lastCell = e.jetLastCell;
      jt.revealStart = e.jetRevealStart;
      this._rebuildJetRibbons(jt);
    }
    // drop any trail OBJECTS added during the move (a cycle wall, or a fresh jet
    // ribbon) and fade their walls
    for (let i = this.trails.length - 1; i >= e.trailsLen; i--) {
      for (const w of this.trails[i].walls) this.fx.fadeWall(w);
      this.trails.splice(i, 1);
    }
    if (unit.type === 'jet' && unit._jetTrail !== e.jetTrail) {
      unit._jetTrail = e.jetTrail; // restore pointer if a fresh ribbon was dropped
    }

    // 2) restore the unit itself
    unit.q = e.q; unit.r = e.r;
    unit.heading = e.heading;
    unit.movesLeft = e.movesLeft;
    unit.speed = e.speed;
    unit.altitude = e.altitude;
    unit.hasFlown = e.hasFlown;
    unit.attacked = e.attacked;
    unit.postAttackMoved = e.postAttackMoved;
    unit.mesh.position.copy(e.pos);
    unit.mesh.quaternion.copy(e.quat);
    if (unit.type === 'reco') unit.baseY = this.recoBaseY(unit);
    if (unit._wobBase) unit._wobBase.copy(unit.mesh.quaternion);

    this.audio.blip(420);
    this.setDim(unit, this.isDone(unit));
    this.select(unit);
    if (this.onFocus) this.onFocus(unit);
    this._refreshUndoUI();
  }

  async playerAttack(unit, target) {
    this.busy = true;
    this.invalidateUndo(); // attacking ends the take-back window for this turn
    this.clearHighlights();
    await this.attack(unit, target);
    this.busy = false;
    if (this.over) return;
    if (this.canMoveNow(unit)) {
      this.select(unit); // light cycle hit & run
    } else {
      this.select(null);
      this.ui.showUnit(null);
    }
    this.maybeAutoEnd();
  }

  // ---------- actions (shared by player & AI) ----------

  // What a cycle's velocity will be after riding this path: straights
  // accelerate, hard turns brake — and a SHORT move always slows you down.
  _endSpeed(unit, path) {
    if (!path.length) return unit.speed || 1;
    const fw = unit.mesh.getWorldDirection(this._v1);
    let d = dirFromVector(fw.x, fw.z);
    let v = unit.speed || 1;
    let prev = { q: unit.q, r: unit.r };
    for (const c of path) {
      const nd = DIRS.findIndex(([dq, dr]) =>
        prev.q + dq === c.q && prev.r + dr === c.r);
      if (nd >= 0) {
        const turn = turnDelta(d, nd);
        v = turn === 0 ? Math.min(6, v + 1) : turn === 1 ? v : 1;
        d = nd;
      }
      prev = c;
    }
    // short moves brake: speed can never exceed twice the distance ridden
    return Math.max(1, Math.min(v, path.length * 2, 6));
  }

  async moveUnit(unit, path, cost = path.length) {
    if (!path.length) return;
    // a jet that flies through a HOSTILE jet wall at its own altitude derezzes
    // on contact — clip the path to that hex so it flies into the wall and dies
    // there (recognizers instead break jet walls; see _moveStandard)
    let jetWallDeath = false;
    if (unit.type === 'jet') {
      for (let i = 0; i < path.length; i++) {
        if (this._hostileJetWallAtCell(unit, path[i].q, path[i].r)) {
          path = path.slice(0, i + 1);
          cost = Math.min(cost, path.length);
          jetWallDeath = true;
          break;
        }
      }
    }
    this.markActed(unit.side);
    // host mirrors its AI's actions to networked clients for replay
    if (this._aiNet) this.emitNet({ a: 'aimove', u: unit.id, path, cost });
    const def = UNIT_TYPES[unit.type];
    const isCycle = unit.type === 'cycle';
    const endSpeed = isCycle ? this._endSpeed(unit, path) : 0;
    const overdrive = isCycle && unit.movesLeft === def.move && cost >= def.move;
    const start = { q: unit.q, r: unit.r };
    // remember the heading this move ends on (for momentum-coasting next turn),
    // and note that an airborne jet has built up flight momentum
    const lastStep = path[path.length - 1];
    const prevStep = path.length > 1 ? path[path.length - 2] : start;
    const hd = DIRS.findIndex(([dq, dr]) =>
      prevStep.q + dq === lastStep.q && prevStep.r + dr === lastStep.r);
    if (hd >= 0) unit.heading = hd;
    if (unit.type === 'jet' && !this.isGrounded(unit)) unit.hasFlown = true;
    unit.movesLeft = Math.max(0, unit.movesLeft - cost);
    this.audio.engine((isCycle ? 0.1 : 0.18) * path.length + 0.1,
      unit.hp / unit.maxHp, unit.type);
    const f = this.factionOf(unit);

    const trail = isCycle
      ? { side: unit.side, owner: unit.id, cells: new Set(), path: [], walls: [] }
      : null;
    if (trail) this.trails.push(trail);

    // light jets stream two short walls off their wingtips. Grounded, those
    // walls are real — deadly to enemy cycles and breakable by tanks (so they
    // join this.trails); airborne, they're a cosmetic contrail at wing height.
    // jet walls linger like cycle walls until this faction's next turn. They
    // accumulate across moves into one smooth ribbon; grounded they're armed
    // (deadly to enemy cycles, breakable by tanks), airborne they're an inert
    // contrail. _extendJetWalls registers/updates the trail in this.trails.
    const isJet = unit.type === 'jet';
    let jetWalls = null;
    if (isJet) {
      jetWalls = this._extendJetWalls(unit, path, f.color, this.isGrounded(unit));
    }

    if (isCycle) {
      const died = await this._driveCycle(unit, path, trail, f.color);
      if (died) return;
      unit.speed = endSpeed; // velocity carries over to the next turn
    } else if (isJet) {
      await this._flyJet(unit, path, jetWalls);
    } else {
      await this._moveStandard(unit, path);
    }

    if (jetWallDeath && unit.alive) {
      const pos = unit.mesh.position.clone(); pos.y += 1.0;
      this.fx.floatText(pos, 'WALL COLLISION', '#ff5544');
      await this.applyDamage(unit, unit.hp);
      return;
    }

    if (overdrive && unit.alive) {
      await this._overdriveSlide(unit, path, start, trail);
      if (unit.alive) unit.speed = 6; // an overdrive slide is flat out
    }
  }

  // Turn a polyline of waypoints into a smooth path: straight runs joined by
  // quadratic-Bézier fillets at each corner. The fillet is tangent to both
  // legs (C1-continuous), so there is no kink where a straight meets a turn —
  // the radius is clamped to fit the shorter adjacent leg.
  _roundedPath(points, radius) {
    const path = new THREE.CurvePath();
    const n = points.length;
    if (n < 3) {
      path.add(new THREE.LineCurve3(points[0].clone(), points[n - 1].clone()));
      return path;
    }
    let cursor = points[0].clone();
    for (let i = 1; i < n - 1; i++) {
      const cur = points[i];
      const inDir = cur.clone().sub(points[i - 1]);
      const inLen = inDir.length(); inDir.normalize();
      const outDir = points[i + 1].clone().sub(cur);
      const outLen = outDir.length(); outDir.normalize();
      const cross = inDir.x * outDir.z - inDir.z * outDir.x;
      if (Math.abs(cross) < 1e-4) continue; // collinear — the straight covers it
      const r = Math.min(radius, inLen * 0.5, outLen * 0.5);
      const a = cur.clone().addScaledVector(inDir, -r); // fillet entry on the in-leg
      const b = cur.clone().addScaledVector(outDir, r); // fillet exit on the out-leg
      if (a.distanceToSquared(cursor) > 1e-8) {
        path.add(new THREE.LineCurve3(cursor.clone(), a.clone()));
      }
      path.add(new THREE.QuadraticBezierCurve3(a.clone(), cur.clone(), b.clone()));
      cursor = b.clone();
    }
    path.add(new THREE.LineCurve3(cursor.clone(), points[n - 1].clone()));
    return path;
  }

  // Build or extend a jet's wingtip walls. Rather than laying a fresh, disjoint
  // ribbon per move, a jet accumulates EVERY cell it flies this turn (at one
  // altitude) and the wall is rebuilt as ONE rounded-Bézier ribbon over the
  // whole flown path — so a former move boundary becomes an interior filleted
  // corner and the join curves smoothly instead of kinking when the player
  // stops and picks a new target hex. A fresh segment starts only when the jet
  // teleports, changes altitude, or its wall is cut by a tank.
  _extendJetWalls(unit, path, color, grounded) {
    const startCell = { q: unit.q, r: unit.r };
    let tr = unit._jetTrail;
    const continues = tr && !tr.broken && tr.alt === unit.altitude &&
      this.trails.includes(tr) && tr.lastCell &&
      tr.lastCell.q === startCell.q && tr.lastCell.r === startCell.r;
    if (!continues) {
      tr = {
        side: unit.side, owner: unit.id, alt: unit.altitude, grounded, color,
        allCells: [startCell], cells: new Set(), path: [], walls: [], revealStart: 0,
      };
      tr.cells.add(key(startCell.q, startCell.r));
      tr.path.push(key(startCell.q, startCell.r));
      unit._jetTrail = tr;
      this.trails.push(tr);
    }
    const spansBefore = tr.allCells.length - 1;
    for (const s of path) tr.allCells.push({ q: s.q, r: s.r });
    tr.lastCell = { q: path[path.length - 1].q, r: path[path.length - 1].r };
    const spansAfter = tr.allCells.length - 1;
    tr.revealStart = spansAfter > 0 ? spansBefore / spansAfter : 0;
    this._rebuildJetRibbons(tr);
    return tr;
  }

  // Per-cell barrel-roll angle along a flown path: every straight run of at
  // least BARREL_ROLL_HEXES hexes earns a full 360°, eased in and out over the
  // run (smootherstep) so it starts and ends level. Angles accumulate (never
  // unwind) so the helix stays continuous across consecutive rolls.
  _jetRollProfile(cells) {
    const n = cells.length;
    const roll = new Array(n).fill(0);
    if (n < BARREL_ROLL_HEXES + 1) return roll;
    const dirOf = (a, b) => DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
    const d = [];
    for (let k = 0; k < n - 1; k++) d.push(dirOf(cells[k], cells[k + 1]));
    const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const TWO_PI = Math.PI * 2;
    let acc = 0, k = 0;
    while (k < d.length) {
      let j = k;
      while (j + 1 < d.length && d[j + 1] === d[k]) j++;
      const segLen = j - k + 1; // straight segments k..j (same direction)
      if (d[k] >= 0 && segLen >= BARREL_ROLL_HEXES) {
        const c0 = k, span = (j + 1) - c0; // cells c0 .. j+1
        for (let c = c0 + 1; c <= j + 1; c++) {
          roll[c] = acc + TWO_PI * smoother((c - c0) / span);
        }
        acc += TWO_PI;
      } else {
        for (let c = k + 1; c <= j + 1; c++) roll[c] = acc;
      }
      k = j + 1;
    }
    return roll;
  }

  // Regenerate a jet trail's two wingtip ribbons over its full accumulated path
  // as smooth rounded-Bézier offsets. The already-flown stretch is revealed at
  // once; _flyJet draws the freshly-added stretch in as the jet flies it.
  // Airborne, the wingtips spiral around the flight axis through a barrel roll,
  // so the two walls twist into a double helix; grounded, they stay upright.
  _rebuildJetRibbons(tr) {
    for (const w of tr.walls) { this.scene.remove(w.mesh); w.geo.dispose(); w.mat.dispose(); }
    tr.walls.length = 0;
    const WING = 0.7; // half wingspan in world units
    const center = tr.allCells.map((c) => {
      const { x, z } = hexToWorld(c.q, c.r);
      return new THREE.Vector3(x, 0, z);
    });
    const curve = this._roundedPath(center, 0.9); // Bézier-rounded corners
    const nCells = center.length;
    const N = Math.max(16, (nCells - 1) * 14); // dense samples
    // a grounded jet can't barrel roll — only airborne walls twist
    const rollAt = tr.grounded ? null : this._jetRollProfile(tr.allCells);
    tr.rollAt = rollAt;
    let centerY, halfH; // wall vertical centre and half-height
    if (tr.grounded) { centerY = 0.21; halfH = 0.19; } // floor wall: 0.02 .. 0.40
    else {
      const b = JET_BASEY[tr.alt] != null ? JET_BASEY[tr.alt] : FLY_HEIGHT;
      centerY = b + 0.18; halfH = 0.08; // thin wing-height streak
    }
    const bottomL = [], topL = [], bottomR = [], topR = [];
    const p = new THREE.Vector3(), tan = new THREE.Vector3();
    const Pv = new THREE.Vector3(), Up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
    const q = new THREE.Quaternion(), radial = new THREE.Vector3(), hdir = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      curve.getPoint(u, p);
      curve.getTangent(u, tan); tan.y = 0;
      const len = Math.hypot(tan.x, tan.z) || 1;
      tan.x /= len; tan.z /= len;
      Pv.set(-tan.z, 0, tan.x); // horizontal wing direction (perpendicular)
      // barrel-roll angle here, interpolated from the per-cell profile
      let theta = 0;
      if (rollAt) {
        const f = u * (nCells - 1);
        const a = Math.max(0, Math.min(nCells - 1, Math.floor(f)));
        const c = Math.min(nCells - 1, a + 1);
        theta = rollAt[a] + (rollAt[c] - rollAt[a]) * (f - a);
      }
      axis.set(tan.x, 0, tan.z); // roll around the flight (forward) axis
      q.setFromAxisAngle(axis, theta);
      radial.copy(Pv).applyQuaternion(q); // wing offset, rolled
      hdir.copy(Up).applyQuaternion(q);   // wall "up", rolled with it
      const lx = p.x + radial.x * WING, ly = centerY + radial.y * WING, lz = p.z + radial.z * WING;
      bottomL.push(new THREE.Vector3(lx - hdir.x * halfH, ly - hdir.y * halfH, lz - hdir.z * halfH));
      topL.push(new THREE.Vector3(lx + hdir.x * halfH, ly + hdir.y * halfH, lz + hdir.z * halfH));
      const rx = p.x - radial.x * WING, ry = centerY - radial.y * WING, rz = p.z - radial.z * WING;
      bottomR.push(new THREE.Vector3(rx - hdir.x * halfH, ry - hdir.y * halfH, rz - hdir.z * halfH));
      topR.push(new THREE.Vector3(rx + hdir.x * halfH, ry + hdir.y * halfH, rz + hdir.z * halfH));
    }
    const ribL = this.fx.ribbonEdges(bottomL, topL, tr.color);
    const ribR = this.fx.ribbonEdges(bottomR, topR, tr.color);
    ribL.reveal(tr.revealStart); ribR.reveal(tr.revealStart);
    tr.walls.push(ribL, ribR);
  }

  // No live combat particles survive into a snapshot — they're sub-second and
  // the game only ever saves at rest — and the standing systems (heal-pad motes,
  // ambient field) rebuild with the map. So as an approximation we replay a
  // brief "powering up" shimmer so a resumed or joined grid feels alive on
  // arrival rather than snapping into place. Cheap and capped for the big maps.
  _restoreFlourish() {
    let budget = 80;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (budget-- <= 0) break;
      const f = this.factions[u.side];
      const col = f ? f.color : 0x2bd9ff;
      const p = u.mesh.position.clone();
      if (u.type === 'core') {
        this.fx.ring(p.clone().setY(0.05), col, 1.8, 0.7);
      } else {
        this.fx.burst({ pos: p.setY(p.y + 0.1), count: 8, color: col,
          speed: 1.0, life: 0.6, gravity: -1.2, size: 0.08 });
      }
    }
  }

  // Rebuild a cycle wall's ribbon from its collision cells — used when resuming
  // a saved game or restoring a snapshot on a freshly-joined client. The exact
  // entry curve (which depended on the live bike position) isn't recorded, so
  // the wall is laid straight through the cell centres; the collision cells are
  // identical, only the cosmetic curve differs slightly.
  _rebuildCycleWall(tr) {
    if (!tr.path || !tr.path.length) return;
    const pts = tr.path.map((k) => {
      const { q, r } = parseKey(k);
      const { x, z } = hexToWorld(q, r);
      return new THREE.Vector3(x, 0, z);
    });
    if (pts.length === 1) pts.unshift(pts[0].clone().add(new THREE.Vector3(0.001, 0, 0)));
    const color = this.factions[tr.side] ? this.factions[tr.side].color : 0xffffff;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.55);
    const ribbon = this.fx.trailRibbon(curve, color, pts.length * 10, 0, 0);
    ribbon.reveal(1);
    tr.walls.push(ribbon);
  }

  // A light jet flies in one continuous sweep along a smooth curve through its
  // whole path — never stopping to pivot. It banks into the turns by curvature
  // (rolling toward the inside of the arc, anticipating the bend ahead) and
  // levels out as it straightens, so banking left and right feels fluid.
  async _flyJet(unit, path, jetWalls) {
    const segs = path.length;
    const fw = unit.mesh.getWorldDirection(new THREE.Vector3());
    fw.y = 0; fw.normalize();
    const startXZ = unit.mesh.position.clone().setY(0);
    // phantom lead-in carries the jet's current heading into the curve
    const pts = [startXZ.clone().addScaledVector(fw, -0.9), startXZ];
    const cellY = [unit.mesh.position.y];
    const hops = [0];
    const lowFlight = this.altLevel(unit) <= 1; // ground/normal skim over units
    for (const s of path) {
      const { x, z } = hexToWorld(s.q, s.r);
      pts.push(new THREE.Vector3(x, 0, z));
      const cell = this.cells.get(key(s.q, s.r));
      const occ = this.unitAt(s.q, s.r);
      const hop = !lowFlight ? 0
        : occ ? (occ.type === 'reco' ? 1.4 : 0.9)
        : isRough(cell.terrain) ? 0.4 : 0;
      cellY.push(unit.baseY + TERRAIN_Y[cell.terrain]);
      hops.push(hop);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const spans = pts.length - 1;
    const t0 = 1 / spans; // skip the phantom lead-in span
    const tAt = (u) => t0 + u * (1 - t0);
    // altitude + hop arc as a function of flight progress u in [0,1]
    const yAt = (u) => {
      const f = Math.max(0, Math.min(segs - 1e-4, u * segs));
      const i = Math.min(segs - 1, Math.floor(f));
      const local = f - i;
      const base = cellY[i] + (cellY[i + 1] - cellY[i]) * local;
      return base + Math.sin(local * Math.PI) * hops[i + 1];
    };
    if (!this._qBank) this._qBank = new THREE.Quaternion();
    if (!this._fwdAxis) this._fwdAxis = new THREE.Vector3(0, 0, 1);
    const tan = new THREE.Vector3(), tan2 = new THREE.Vector3(), look = new THREE.Vector3();
    const cap = 0.5, gain = 1.35; // bank ceiling and how hard it leans into turns
    const rs = jetWalls.revealStart || 0; // wall already drawn up to here
    // barrel-roll angle for this move, read from the trail's per-cell profile so
    // the jet spins in lockstep with its helixing wingtip walls
    const barrelBase = jetWalls.allCells.length - segs - 1; // this move's start cell
    const barrelAt = (u) => {
      const arr = jetWalls.rollAt;
      if (!arr || !arr.length) return 0;
      const f = barrelBase + u * segs;
      const a = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
      const b = Math.min(arr.length - 1, a + 1);
      return arr[a] + (arr[b] - arr[a]) * (f - a);
    };
    let roll = 0, lastCell = 0, levelQ = null;
    await this.fx.tween(Math.max(0.2, segs * 0.15), (k) => {
      const u = k;
      curve.getPoint(tAt(u), unit.mesh.position);
      unit.mesh.position.y = yAt(u);
      curve.getTangent(tAt(u), tan).setY(0).normalize();
      curve.getTangent(tAt(Math.min(1, u + 0.1)), tan2).setY(0).normalize();
      look.copy(unit.mesh.position).add(tan);
      unit.mesh.lookAt(look.x, unit.mesh.position.y, look.z);
      levelQ = unit.mesh.quaternion.clone();
      // bank toward the inside of the bend just ahead, easing in smoothly
      let d = Math.atan2(tan2.x, tan2.z) - Math.atan2(tan.x, tan.z);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const target = Math.max(-cap, Math.min(cap, d * gain));
      roll += (target - roll) * 0.2;
      // total roll = banking into turns + the barrel roll on long straights
      this._qBank.setFromAxisAngle(this._fwdAxis, roll + barrelAt(u));
      unit.mesh.quaternion.multiply(this._qBank);
      // advance the logical cell + stream the wingtip walls as the jet passes
      const reached = Math.min(segs, Math.floor(u * segs + 0.5));
      for (let c = lastCell; c < reached; c++) {
        unit.q = path[c].q; unit.r = path[c].r;
        // record collision cells for ALL jet walls now (grounded ones bite
        // cycles, airborne ones bite enemy jets at the same altitude)
        jetWalls.cells.add(key(path[c].q, path[c].r));
        jetWalls.path.push(key(path[c].q, path[c].r));
      }
      lastCell = Math.max(lastCell, reached);
      for (const w of jetWalls.walls) w.reveal(rs + u * (1 - rs));
    });
    // snap onto the final cell, finish the walls, and roll level
    unit.q = path[segs - 1].q; unit.r = path[segs - 1].r;
    for (let c = lastCell; c < segs; c++) {
      jetWalls.cells.add(key(path[c].q, path[c].r));
      jetWalls.path.push(key(path[c].q, path[c].r));
    }
    for (const w of jetWalls.walls) w.reveal(1);
    if (!levelQ) {
      curve.getTangent(tAt(1), tan).setY(0).normalize();
      look.copy(unit.mesh.position).add(tan);
      unit.mesh.lookAt(look.x, unit.mesh.position.y, look.z);
      levelQ = unit.mesh.quaternion.clone();
    }
    const barrelEnd = barrelAt(1); // a completed roll lands on a multiple of 2π (level)
    if (Math.abs(roll) > 0.01) {
      const r0 = roll;
      await this.fx.tween(0.28, (k) => {
        const r = r0 * (1 - k * k * (3 - 2 * k)); // ease only the bank out
        this._qBank.setFromAxisAngle(this._fwdAxis, r + barrelEnd);
        unit.mesh.quaternion.copy(levelQ).multiply(this._qBank);
      });
    }
    this._qBank.setFromAxisAngle(this._fwdAxis, barrelEnd);
    unit.mesh.quaternion.copy(levelQ).multiply(this._qBank);
  }

  // Light cycles run along a smooth Catmull-Rom curve through their path,
  // extruding the light-wall ribbon close behind them. A phantom lead-in
  // point behind the bike carries its previous heading into the curve, so
  // walls from consecutive moves join without a kink.
  async _driveCycle(unit, path, trail, color) {
    const fw = unit.mesh.getWorldDirection(new THREE.Vector3());
    fw.y = 0;
    fw.normalize();
    const startP = unit.mesh.position.clone().setY(0);
    const pts = [startP.clone().addScaledVector(fw, -0.9), startP];
    for (const s of path) {
      const { x, z } = hexToWorld(s.q, s.r);
      pts.push(new THREE.Vector3(x, 0, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.55);
    const spans = pts.length - 1;
    const t0 = 1 / spans; // skip the phantom lead-in span
    const tAt = (u) => t0 + u * (1 - t0);
    const wave = this._wallWave(unit);
    const ribbon = this.fx.trailRibbon(curve, color, pts.length * 10, t0, wave);
    // remember exactly how this ribbon was built so a resumed/joined game can
    // rebuild the identical curve (not a straight-through-centres approximation)
    ribbon._build = { type: 'curve', pts: pts.map((p) => [r3(p.x), r3(p.z)]),
      samples: pts.length * 10, tStart: t0, wave, reveal: 0 };
    trail.walls.push(ribbon);
    const segs = path.length;
    const look = new THREE.Vector3();
    let completed = 0;
    for (let i = 0; i < segs; i++) {
      // safety halt: never drive into a friendly wall (including the one
      // this cycle is laying right now)
      if (this.friendlyTrailAt(unit.side, path[i].q, path[i].r)) break;
      const k0 = i / segs, k1 = (i + 1) / segs;
      await this.fx.tween(0.1, (k) => {
        const u = k0 + (k1 - k0) * k;
        curve.getPoint(tAt(u), unit.mesh.position);
        curve.getTangent(tAt(u), look).add(unit.mesh.position);
        unit.mesh.lookAt(look.x, unit.mesh.position.y, look.z);
        ribbon.reveal(u - 0.7 / segs);
        if (unit.mesh.userData.wheels) {
          for (const w of unit.mesh.userData.wheels) w.rotation.x += 0.5;
        }
      });
      trail.cells.add(key(unit.q, unit.r)); // the cell just vacated
      trail.path.push(key(unit.q, unit.r)); // ordered: start .. (cycle end)
      unit.q = path[i].q; unit.r = path[i].r;
      completed = i + 1;

      if (this.hostileTrailAt(unit.side, unit.q, unit.r)) {
        const pos = unit.mesh.position.clone();
        pos.y += 1.4;
        this.fx.floatText(pos, 'WALL COLLISION', '#ff5544');
        await this.applyDamage(unit, unit.hp);
        return true;
      }
    }
    // close the wall up to the bike, but only over segments actually driven
    ribbon.reveal(completed / segs);
    ribbon._build.reveal = completed / segs;
    return false;
  }

  async _moveStandard(unit, path) {
    const isFly = UNIT_TYPES[unit.type].fly;
    const isTank = unit.type === 'tank';
    const turret = isTank ? unit.mesh.userData.turret : null;
    // a tank's turret keeps its world aim as the hull turns — capture a far
    // point along the turret's current heading and re-lock onto it each step
    let aimPoint = null;
    if (turret) {
      turret.updateMatrixWorld();
      aimPoint = turret.localToWorld(new THREE.Vector3(0, 0, 1000));
    }
    const holdTurret = () => {
      if (!turret) return;
      unit.mesh.updateMatrixWorld();
      const lp = unit.mesh.worldToLocal(aimPoint.clone());
      const ang = Math.atan2(lp.x, lp.z); // turret stays locked on its world aim
      turret.rotation.y = ang;
      unit.turretAngle = ang;
    };
    // recognizers bank gently into turns: the lean eases in along a smootherstep
    // (bezier-like) curve and carries smoothly from one step to the next, then
    // levels out at the end — soft and unhurried rather than a sharp flick.
    let bankRoll = 0, lastFaceQ = null;
    const smoother = (k) => k * k * k * (k * (k * 6 - 15) + 10);
    const nimble = unit.type === 'jet'; // light jets are quick & bank hard
    for (const step of path) {
      const { x, z } = hexToWorld(step.q, step.r);
      const cell = this.cells.get(key(step.q, step.r));
      const destY = unit.baseY + TERRAIN_Y[cell.terrain];
      const dest = new THREE.Vector3(x, destY, z);
      // recognizers physically hop over units and raised terrain
      const jumped = isFly && this.unitAt(step.q, step.r);
      const hop = !isFly ? 0
        : jumped ? (jumped.type === 'reco' ? 1.7 : 1.1)
        : isRough(cell.terrain) ? 0.5 : 0.12;
      // recognizers lumber; light jets streak across the Grid
      const segDur = !isFly ? 0.16
        : nimble ? (hop > 0.5 ? 0.24 : 0.12)
          : (hop > 0.5 ? 0.52 : 0.34);
      let faceQ = null, targetLean = 0; // recognizer banking through the turn
      if (isTank) {
        // a tank pivots on the spot to face its new heading before rolling off,
        // tracks grinding round — the turret holds its aim through the turn
        const cur = unit.mesh.quaternion.clone();
        unit.mesh.lookAt(dest.x, unit.mesh.position.y, dest.z);
        const tgt = unit.mesh.quaternion.clone();
        unit.mesh.quaternion.copy(cur);
        const turn = cur.angleTo(tgt);
        if (turn > 0.12) {
          this.audio.servo();
          await this.fx.tween(0.12 + turn / Math.PI * 0.26, (k) => {
            const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
            unit.mesh.quaternion.slerpQuaternions(cur, tgt, e);
            holdTurret();
          });
        }
        unit.mesh.quaternion.copy(tgt);
      } else if (isFly) {
        // a recognizer turns to face its heading FIRST — a slow pivot, banking
        // gently into the turn — then flies straight and levels back out
        if (!this._qBank) this._qBank = new THREE.Quaternion();
        if (!this._fwdAxis) this._fwdAxis = new THREE.Vector3(0, 0, 1);
        const curQ = unit.mesh.quaternion.clone();
        const prevFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(curQ);
        unit.mesh.lookAt(dest.x, unit.mesh.position.y, dest.z);
        faceQ = unit.mesh.quaternion.clone();
        lastFaceQ = faceQ;
        const newFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(faceQ);
        const cross = prevFwd.z * newFwd.x - prevFwd.x * newFwd.z;
        const dot = Math.max(-1, Math.min(1, prevFwd.x * newFwd.x + prevFwd.z * newFwd.z));
        const leanCap = nimble ? 0.42 : 0.12; // jets bank hard into their turns
        targetLean = Math.max(-leanCap, Math.min(leanCap,
          Math.atan2(cross, dot) * (nimble ? 0.3 : 0.11)));
        const turn = curQ.angleTo(faceQ);
        if (turn > 0.1) {
          unit.mesh.quaternion.copy(curQ);
          const pivotStart = bankRoll;
          await this.fx.tween((nimble ? 0.08 : 0.16) + turn / Math.PI * (nimble ? 0.14 : 0.3), (k) => {
            const e = smoother(k);
            unit.mesh.quaternion.slerpQuaternions(curQ, faceQ, e);
            bankRoll = pivotStart + (targetLean - pivotStart) * e;
            this._qBank.setFromAxisAngle(this._fwdAxis, bankRoll);
            unit.mesh.quaternion.multiply(this._qBank);
          });
        }
      } else {
        unit.mesh.lookAt(dest.x, unit.mesh.position.y, dest.z);
      }
      holdTurret();
      const from = unit.mesh.position.clone();
      const startRoll = bankRoll;
      await this.fx.tween(segDur, (k) => {
        unit.mesh.position.lerpVectors(from, dest, k);
        unit.mesh.position.y += Math.sin(k * Math.PI) * hop;
        if (faceQ) { // fly straight, easing the bank smoothly back to level
          bankRoll = startRoll * (1 - smoother(k));
          this._qBank.setFromAxisAngle(this._fwdAxis, bankRoll);
          unit.mesh.quaternion.copy(faceQ).multiply(this._qBank);
        }
      });
      unit.q = step.q; unit.r = step.r;
      // tanks plow through ground walls; recognizers shear through jet walls at
      // their own altitude — both demolish what they pass through
      if (isTank) this.breachWalls(step.q, step.r);
      else if (unit.type === 'reco') this._recoShearJetWalls(step.q, step.r, unit);
    }
    // settle the recognizer back to level once it has arrived
    if (isFly && lastFaceQ && Math.abs(bankRoll) > 0.005) {
      const startRoll = bankRoll;
      await this.fx.tween(0.45, (k) => {
        const r = startRoll * (1 - smoother(k));
        this._qBank.setFromAxisAngle(this._fwdAxis, r);
        unit.mesh.quaternion.copy(lastFaceQ).multiply(this._qBank);
      });
      unit.mesh.quaternion.copy(lastFaceQ);
    }
    // re-anchor the turret's per-turn slew window to where it ended up
    if (isTank) unit.turretStart = unit.turretAngle || 0;
  }

  // Demolish walls in this hex at a given altitude band: tanks break ground
  // walls (default), recognizers break jet walls at their own flight altitude.
  breachWalls(q, r, band = 'ground') {
    const k = key(q, r);
    let hit = false;
    const { x, z } = hexToWorld(q, r);
    for (const t of this.trails) {
      if (this._trailBand(t) !== band) continue;
      if (!t.cells.has(k)) continue;
      hit = true;
      t.broken = true; // a cut jet wall must not rebuild — start a fresh segment
      // a cycle lays its wall start -> end, so it sits at the END of t.path.
      // cutting the wall severs everything from the breach back toward the
      // start (the stretch no longer connected to the cycle) — remove it all.
      let removed = [k];
      if (t.path && t.path.length) {
        const idx = t.path.indexOf(k);
        if (idx >= 0) {
          removed = t.path.slice(0, idx + 1);     // breach + cells toward the start
          t.path = t.path.slice(idx + 1);          // keep the cycle-connected tail
        }
      }
      for (const rk of removed) {
        t.cells.delete(rk);
        const c = parseKey(rk);
        const wp = hexToWorld(c.q, c.r);
        for (const w of t.walls) if (w.cutAt) w.cutAt(wp, 1.3);
      }
    }
    if (hit) {
      this.audio.wallBreak();
      const pos = new THREE.Vector3(x, 0.35, z);
      this.fx.burst({ pos, count: 35, color: 0xffffff, speed: 3, life: 0.5, size: 0.12, gravity: 4 });
      this.fx.floatText(new THREE.Vector3(x, 1.4, z), 'WALL BREACHED', '#cfeaff');
      this.fx.shake(0.12);
    }
  }

  // A recognizer flying through a jet wall at its own altitude shears the whole
  // ribbon apart (jet walls are one continuous per-turn ribbon, not a severable
  // segment chain like cycle walls — so the cleanest break is to destroy it).
  _recoShearJetWalls(q, r, unit) {
    const k = key(q, r);
    let hit = false;
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      if (t.alt == null || t.alt !== unit.altitude) continue; // jet walls at this band
      if (!t.cells.has(k)) continue;
      hit = true;
      for (const w of t.walls) this.fx.fadeWall(w);
      this.trails.splice(i, 1); // the owning jet's _jetTrail no longer in this.trails → starts fresh
    }
    if (hit) {
      this.audio.wallBreak();
      const y = (JET_BASEY[unit.altitude] != null ? JET_BASEY[unit.altitude] : FLY_HEIGHT);
      const { x, z } = hexToWorld(q, r);
      this.fx.burst({ pos: new THREE.Vector3(x, y + 0.3, z), count: 28, color: 0xffffff, speed: 3, life: 0.5, size: 0.11, gravity: 1.5 });
      this.fx.floatText(new THREE.Vector3(x, y + 1.0, z), 'WALL SHEARED', '#cfeaff');
    }
  }

  // What happens after this move if the unit slides 2 hexes straight on?
  predictSlide(unit, path, start = { q: unit.q, r: unit.r }) {
    const out = { dies: false, cause: null, cells: [], dirWorld: null };
    if (!path.length) return out;
    const last = path[path.length - 1];
    const prev = path.length > 1 ? path[path.length - 2] : start;
    const dq = last.q - prev.q, dr = last.r - prev.r;
    if (!dq && !dr) return out;
    const w = hexToWorld(dq, dr);
    const len = Math.hypot(w.x, w.z) || 1;
    out.dirWorld = new THREE.Vector3(w.x / len, 0, w.z / len);
    let q = last.q, r = last.r;
    for (let i = 0; i < 2; i++) {
      q += dq; r += dr;
      const cell = this.cells.get(key(q, r));
      if (!cell) {
        out.dies = true; out.cause = 'edge';
        out.edgeAt = { q, r };                       // off-grid hole coordinate
        out.edgeFrom = { q: q - dq, r: r - dr };     // last on-grid cell
        return out;
      }
      if (cell.terrain === 'hole') {
        out.cells.push({ q, r });
        out.dies = true; out.cause = 'hole';
        return out;
      }
      if (cell.terrain === 'high' || this.groundOccupantAt(q, r, unit.id)) return out; // halted
      if (unit.type === 'cycle' && this.friendlyTrailAt(unit.side, q, r)) return out;
      if (unit.type === 'cycle' && this.hostileTrailAt(unit.side, q, r)) {
        out.cells.push({ q, r });
        out.dies = true; out.cause = 'wall';
        return out;
      }
      out.cells.push({ q, r });
    }
    return out;
  }

  async _overdriveSlide(unit, path, start, trail) {
    const pred = this.predictSlide(unit, path, start);
    if (!pred.cells.length && pred.cause !== 'edge') return;
    const f = this.factionOf(unit);
    const tp = unit.mesh.position.clone();
    tp.y += 1.3;
    this.fx.floatText(tp, 'OVERDRIVE', '#c2fbff');
    this.audio.engine(0.12 * (pred.cells.length + 1) + 0.25, unit.hp / unit.maxHp);

    for (const c of pred.cells) {
      const cell = this.cells.get(key(c.q, c.r));
      const { x, z } = hexToWorld(c.q, c.r);
      const from = unit.mesh.position.clone();
      const dest = new THREE.Vector3(x, unit.baseY, z);
      unit.mesh.lookAt(dest.x, unit.mesh.position.y, dest.z);
      if (trail) { trail.cells.add(key(unit.q, unit.r)); trail.path.push(key(unit.q, unit.r)); }
      await this.fx.tween(0.09, (k) => {
        unit.mesh.position.lerpVectors(from, dest, k);
        if (unit.mesh.userData.wheels) {
          for (const w of unit.mesh.userData.wheels) w.rotation.x += 0.5;
        }
      });
      if (trail) {
        const owave = this._wallWave(unit);
        const piece = this.fx.trailRibbon(
          [from.clone().setY(0), dest.clone().setY(0)], f.color, 8, 0, owave);
        piece.reveal(1);
        piece._build = { type: 'points', pts: [[r3(from.x), r3(from.z)], [r3(dest.x), r3(dest.z)]],
          samples: 8, tStart: 0, wave: owave, reveal: 1 };
        trail.walls.push(piece);
      }
      unit.q = c.q; unit.r = c.r;

      if (cell.terrain === 'hole') {
        await this._fallIntoPit(unit);
        return;
      }
      if (unit.type === 'cycle' && this.hostileTrailAt(unit.side, c.q, c.r)) {
        const pos = unit.mesh.position.clone();
        pos.y += 1.4;
        this.fx.floatText(pos, 'WALL COLLISION', '#ff5544');
        await this.applyDamage(unit, unit.hp);
        return;
      }
    }

    if (pred.cause === 'edge') {
      const from = unit.mesh.position.clone();
      const dest = from.clone().addScaledVector(pred.dirWorld, 0.95);
      await this.fx.tween(0.09, (k) => {
        unit.mesh.position.lerpVectors(from, dest, k);
      });
      await this._hitBoundary(unit, pred.edgeAt, pred.edgeFrom);
    }
  }

  // ---------- easter egg: cracked-boundary portals ----------
  // A light cycle flung off the Grid at speed cracks the boundary wall. The
  // first impact at a spot derezzes the rider but leaves a glowing PORTAL; later
  // cycles that drive into that spot warp instead of dying — dropped in the
  // middle (surviving only on a clear hex, slamming whatever is there, flyers
  // included) or, if several portals exist, possibly out of another one.
  _portalAt(q, r) { return this.portals.find((p) => p.q === q && p.r === r); }

  async _hitBoundary(unit, off, edge) {
    const existing = off && this._portalAt(off.q, off.r);
    if (existing) { await this._enterPortal(unit, existing); return; }
    if (off) this._createPortal(off.q, off.r, edge ? edge.q : unit.q, edge ? edge.r : unit.r);
    await this.applyDamage(unit, unit.hp);
  }

  // A portal isn't a glowing ring — it's a barely-there fracture in the floor,
  // a few jagged hairline cracks radiating from where the cycle struck the
  // boundary. Easy to miss unless you're looking.
  _createPortal(offQ, offR, edgeQ, edgeR) {
    // The Grid is ringed by an INVISIBLE boundary wall. A cycle slamming it leaves
    // a crack on that wall — a vertical fracture standing up off the floor, like
    // cracked glass. The wall itself stays invisible; only the crack shows, and
    // nothing touches the floor.
    const e = hexToWorld(edgeQ, edgeR);
    const o = hexToWorld(offQ, offR);
    const bx = e.x * 0.5 + o.x * 0.5, bz = e.z * 0.5 + o.z * 0.5; // impact point on the wall
    const H = 0.75;                                               // up the wall, clear of the floor
    const B = new THREE.Vector3(bx, H, bz);

    // wall basis: inward normal (toward the Grid centre), a horizontal tangent
    // along the wall, world up. The fissure's depth recedes OUTWARD into the
    // wall so you see into it from inside the arena.
    const inward = new THREE.Vector3(-bx, 0, -bz);
    if (inward.lengthSq() < 1e-6) inward.set(0, 0, -1);
    inward.normalize();
    const tan = new THREE.Vector3(inward.z, 0, -inward.x);
    const out = inward.clone().multiplyScalar(-1);
    // local (u = along wall, v = up, d = depth into wall) → world, kept off the floor
    const W = (u, vv, d) => new THREE.Vector3(
      B.x + tan.x * u + out.x * d,
      Math.max(0.07, H + vv),
      B.z + tan.z * u + out.z * d);

    // Draw the crack in the same WIREFRAME style as the hex grid: thin glowing
    // cyan lines (the exact hex-edge colour, which blooms), radiating from the
    // impact point like a struck pane. Thin ribbons, not 1px lines, so they hold
    // up at gameplay zoom.
    const pos = [];
    const HW = 0.014; // half-width of a fracture line — thin & crisp, like a tile edge
    const v = (p) => { pos.push(p.x, p.y, p.z); };
    const ribbon = (sl, sr, el, er) => { v(sl); v(sr); v(er); v(sl); v(er); v(el); };
    const branches = 5 + Math.floor(this.rand() * 4);
    for (let b = 0; b < branches; b++) {
      let ang = (b / branches) * Math.PI * 2 + (this.rand() - 0.5) * 0.5;
      let pu = 0, pv = 0, pw = HW;
      const segs = 2 + Math.floor(this.rand() * 3);
      for (let s = 0; s < segs; s++) {
        ang += (this.rand() - 0.5) * 1.0;                 // sharp, angular turns
        const len = 0.18 + this.rand() * 0.34;
        const nu = pu + Math.cos(ang) * len, nv = pv + Math.sin(ang) * len;
        const nw = Math.max(0.007, pw * 0.9);             // barely taper — keep an even, crisp line
        const ex = -Math.sin(ang), ey = Math.cos(ang);    // perpendicular in the wall plane
        ribbon(
          W(pu + ex * pw, pv + ey * pw, 0), W(pu - ex * pw, pv - ey * pw, 0),
          W(nu + ex * nw, nv + ey * nw, 0), W(nu - ex * nw, nv - ey * nw, 0));
        pu = nu; pv = nv; pw = nw;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({ color: 0x176f86, side: THREE.DoubleSide }); // hex-edge cyan
    const crack = new THREE.Mesh(geo, mat);   // vertices are already world-space
    this.scene.add(crack);
    this.portals.push({ q: offQ, r: offR, edgeQ, edgeR, mesh: crack, center: B.clone() });

    // the impact is quiet: a few cyan sparks off the wall, a soft knock
    this.fx.burst({ pos: B.clone(), count: 10, color: 0x39c6e6,
      speed: 1.6, life: 0.6, size: 0.05, gravity: 4, spread: 0.6 });
    this.fx.shake(0.08);
    this.audio.blip();
  }

  _setCellPos(unit) {
    const { x, z } = hexToWorld(unit.q, unit.r);
    const cell = this.cellOf(unit);
    unit.mesh.position.set(x, (unit.baseY || 0) + TERRAIN_Y[cell ? cell.terrain : 'normal'], z);
  }

  async _enterPortal(unit, portal) {
    // ride into the cracked wall and vanish
    const into = portal.center.clone(); into.y = unit.baseY || 0;
    const from = unit.mesh.position.clone();
    unit.mesh.lookAt(into.x, unit.mesh.position.y, into.z);
    await this.fx.tween(0.12, (k) => unit.mesh.position.lerpVectors(from, into, k));
    this.fx.flash(portal.center.clone(), 0xffffff, 12, 0.3, 8);
    this.fx.burst({ pos: portal.center.clone(), count: 20, color: 0x9fe9ff, speed: 4, life: 0.5, size: 0.1 });
    unit.speed = 1; // the warp bleeds off all velocity

    // destination: another portal (if several), else the middle of the Grid
    const others = this.portals.filter((p) => p !== portal);
    let target, emergePortal = null;
    if (others.length && this.rand() < 0.5) {
      emergePortal = others[Math.floor(this.rand() * others.length)];
      target = { q: emergePortal.edgeQ, r: emergePortal.edgeR };
    } else {
      const cluster = [{ q: 0, r: 0 }].concat(DIRS.map(([dq, dr]) => ({ q: dq, r: dr })));
      target = cluster[Math.floor(this.rand() * cluster.length)];
    }
    unit.q = target.q; unit.r = target.r;
    const cell = this.cells.get(key(target.q, target.r));

    if (emergePortal) {
      // streak back out of the partner portal
      const out = emergePortal.center.clone(); out.y = unit.baseY || 0;
      unit.mesh.position.copy(out);
      this.fx.flash(emergePortal.center.clone(), 0xffffff, 10, 0.3, 8);
      this._setCellPos(unit);
    } else {
      // drop from the sky onto the centre
      const { x, z } = hexToWorld(target.q, target.r);
      unit.mesh.position.set(x, (unit.baseY || 0) + 9, z);
      const groundY = (unit.baseY || 0) + (cell ? TERRAIN_Y[cell.terrain] : 0);
      await this.fx.tween(0.32, (k) => { unit.mesh.position.y = (unit.baseY || 0) + 9 - k * (9 - (groundY - (unit.baseY || 0))); });
      this.fx.shake(0.25);
    }

    // a pit / plateau / off-grid landing is not survivable
    if (!cell || cell.terrain === 'hole' || cell.terrain === 'high') {
      this.fx.floatText(unit.mesh.position.clone().setY(1.4), 'PORTAL — DEREZ', '#ff5544');
      await this.applyDamage(unit, unit.hp);
      return;
    }

    // slam whatever is on the landing hex — even a flying unit
    const occ = this.unitAt(target.q, target.r);
    this.fx.floatText(unit.mesh.position.clone().setY(1.4), 'PORTAL DROP', '#c2fbff');
    this.fx.explosion(unit.mesh.position.clone().setY(0.5), this.factionOf(unit).color, 0.7);
    if (occ && occ !== unit) await this.applyDamage(occ, PORTAL_DROP_DMG, unit.side);
    if (unit.alive) await this.applyDamage(unit, PORTAL_SELF_DMG);

    // can't share a hex: if something survived under it, hop to the nearest clear
    // cell — or derez if the centre is jammed solid
    if (unit.alive) {
      const clash = this.units.find((u) => u !== unit && u.alive && u.q === unit.q && u.r === unit.r);
      if (clash) {
        const alt = cellsInRange(this.cells, unit.q, unit.r, 2)
          .filter((c) => c.terrain === 'normal' && !this.unitAt(c.q, c.r))
          .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
        if (alt) { unit.q = alt.q; unit.r = alt.r; this._setCellPos(unit); }
        else await this.applyDamage(unit, unit.hp);
      }
    }
  }

  async _fallIntoPit(unit, killerSide = null) {
    this.audio.fall();
    const orig = unit.mesh.scale.x;
    const baseY = unit.mesh.position.y;
    await this.fx.tween(0.55, (k) => {
      unit.mesh.position.y = baseY - k * 1.5;
      unit.mesh.rotation.x += 0.05;
      unit.mesh.scale.setScalar(orig * (1 - k * 0.45));
    });
    const pos = unit.mesh.position.clone();
    pos.y += 1.6;
    this.fx.floatText(pos, 'DEREZZED', '#ff5544');
    await this.applyDamage(unit, unit.hp, killerSide);
  }

  // ---------- momentum: fast units can't stop ----------

  // A unit carrying real velocity that the commander leaves unmoved this turn —
  // a FAST light cycle, or an airborne jet that has built up flight momentum.
  hasMomentum(unit) {
    if (!unit.alive || unit.type === 'core') return false;
    if (unit.type === 'cycle') return (unit.speed || 1) >= MOMENTUM_SPEED;
    if (unit.type === 'jet') return !this.isGrounded(unit) && !!unit.hasFlown;
    return false;
  }

  // The hex direction a unit is heading (its last travelled direction; falls
  // back to its facing). Used to coast it straight on.
  facingDir(unit) {
    if (unit.heading != null) return unit.heading;
    const fw = unit.mesh.getWorldDirection(this._v1);
    return dirFromVector(fw.x, fw.z);
  }

  // At a faction's turn end, any of its fast units the commander didn't move
  // coast one hex straight on their own — into a wall, pit, or off the Grid if
  // that is what lies ahead. Deterministic (derived from unit state), so it
  // reproduces exactly in replay and across net clients without being recorded.
  async _coastMomentum(sideId) {
    if (this.simultaneous) return;
    for (const u of this.aliveUnits(sideId)) {
      if (!u.alive || u.type === 'core') continue;
      if (u.movesLeft < UNIT_TYPES[u.type].move) continue; // already moved this turn
      if (!this.hasMomentum(u)) continue;
      await this._forcedCoast(u);
      if (this.over) return;
    }
  }

  async _forcedCoast(unit) {
    const dir = this.facingDir(unit);
    const nq = unit.q + DIRS[dir][0], nr = unit.r + DIRS[dir][1];
    const cell = this.cells.get(key(nq, nr));
    const isFly = UNIT_TYPES[unit.type].fly;
    this.fx.floatText(
      unit.mesh.position.clone().setY((unit.baseY || 0) + 1.3), 'MOMENTUM', '#c2fbff');

    // classify what drifting one hex straight on leads to
    let fatal = null; // null = clear; else 'edge' | 'pit' | 'wall' | 'crash'
    if (!cell) fatal = 'edge';
    else if (isFly) fatal = null; // a flying jet glides over anything on the Grid
    else if (cell.terrain === 'hole') fatal = 'pit';
    else if (cell.terrain === 'high' || this.groundOccupantAt(nq, nr, unit.id) ||
             this.friendlyTrailAt(unit.side, nq, nr)) fatal = 'crash';
    else if (this.hostileTrailAt(unit.side, nq, nr)) fatal = 'wall';

    if (fatal === null) {
      // clear ahead — a real one-hex move (cycles lay wall & keep their speed)
      return this.moveUnit(unit, [{ q: nq, r: nr }], 1);
    }
    if (fatal === 'crash') { // can't enter, can't stop — ploughs in and derezzes
      await this._coastLurch(unit, dir, 0.42);
      this.fx.floatText(
        unit.mesh.position.clone().setY((unit.baseY || 0) + 1.4), 'COLLISION', '#ff5544');
      return this.applyDamage(unit, unit.hp);
    }
    if (fatal === 'edge') { // sails off the Grid boundary — crack it / portal
      await this._coastLurch(unit, dir, 0.95);
      return this._hitBoundary(unit, { q: nq, r: nr }, { q: unit.q, r: unit.r });
    }
    // pit or hostile wall — ride fully onto the cell, then derez
    await this._coastLurch(unit, dir, 1, nq, nr);
    if (fatal === 'pit') return this._fallIntoPit(unit);
    this.fx.floatText(
      unit.mesh.position.clone().setY(1.4), 'WALL COLLISION', '#ff5544');
    return this.applyDamage(unit, unit.hp);
  }

  // Slide a coasting unit forward — fully onto (nq,nr), or `frac` of a hex when
  // it is ramming into something it can't enter.
  async _coastLurch(unit, dir, frac, nq = null, nr = null) {
    const from = unit.mesh.position.clone();
    let dest;
    if (nq != null) {
      const { x, z } = hexToWorld(nq, nr);
      dest = new THREE.Vector3(x, unit.baseY || 0, z);
    } else {
      const w = hexToWorld(DIRS[dir][0], DIRS[dir][1]);
      const len = Math.hypot(w.x, w.z) || 1;
      dest = from.clone().add(new THREE.Vector3(w.x / len, 0, w.z / len).multiplyScalar(frac));
    }
    unit.mesh.lookAt(dest.x, unit.mesh.position.y, dest.z);
    this.audio.engine(0.2, unit.hp / unit.maxHp, unit.type);
    await this.fx.tween(0.14, (k) => {
      const e = frac < 1 ? Math.sin(k * Math.PI / 2) : k; // a ram eases into the wall
      unit.mesh.position.lerpVectors(from, dest, e);
      if (unit.mesh.userData.wheels) {
        for (const w of unit.mesh.userData.wheels) w.rotation.x += 0.5;
      }
    });
    if (nq != null) { unit.q = nq; unit.r = nr; }
  }

  // ---------- special attacks: tank ram & core conquest ----------

  // Adjacent enemy-team cycles a tank could ram (no turret arc — it's physical).
  pushTargets(tank) {
    if (tank.type !== 'tank') return [];
    return this.units.filter((t) =>
      t.alive && t.type === 'cycle' && this.isHostile(t.side, tank.side) &&
      hexDistance(tank, t) === 1);
  }

  predictPush(tank, cyc, from = { q: tank.q, r: tank.r }) {
    const dq = cyc.q - from.q, dr = cyc.r - from.r;
    const q = cyc.q + dq, r = cyc.r + dr;
    const cell = this.cells.get(key(q, r));
    if (!cell) return { type: 'edge', q, r, text: 'OFF THE GRID — DEREZ' };
    if (cell.terrain === 'hole') return { type: 'hole', q, r, text: 'INTO THE PIT — DEREZ' };
    // an enemy-team wall derezzes the cycle; its OWN wall just shatters,
    // dealing normal damage and clearing the wall segment
    if (this.hostileTrailAt(cyc.side, q, r)) {
      return { type: 'wall', q, r, text: 'INTO A WALL — DEREZ' };
    }
    if (this.friendlyTrailAt(cyc.side, q, r)) {
      return { type: 'ownwall', q, r, text: 'INTO OWN WALL — 1 DAMAGE, WALL CLEARED' };
    }
    if (cell.terrain === 'high' || this.groundOccupantAt(q, r, cyc.id)) {
      return { type: 'slam', q, r, text: 'SLAMMED — 2 DAMAGE' };
    }
    return { type: 'pushed', q, r, text: 'SHOVED BACK — 1 DAMAGE' };
  }

  async pushAttack(tank, cyc) {
    this.markActed(tank.side);
    if (this._aiNet) this.emitNet({ a: 'push', u: tank.id, t: cyc.id });
    const pred = this.predictPush(tank, cyc);
    tank.attacked = true;
    if (this.isDone(tank)) this.setDim(tank, true);
    this.audio.ram();

    // tank lunges at the cycle and recoils
    const home = tank.mesh.position.clone();
    const at = cyc.mesh.position.clone().setY(home.y);
    const lunge = home.clone().lerp(at, 0.45);
    tank.mesh.lookAt(at.x, home.y, at.z);
    await this.fx.tween(0.16, (k) => tank.mesh.position.lerpVectors(home, lunge, k));
    this.fx.burst({
      pos: cyc.mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0)),
      count: 30, color: 0xffffff, speed: 3.5, life: 0.4, size: 0.12,
    });
    this.fx.shake(0.2);
    this.fx.tween(0.18, (k) => tank.mesh.position.lerpVectors(lunge, home, k));

    // the cycle is flung one hex onward
    const { x, z } = hexToWorld(pred.q, pred.r);
    const from = cyc.mesh.position.clone();
    const dest = new THREE.Vector3(x, cyc.baseY, z);
    const tp = cyc.mesh.position.clone();
    tp.y += 1.4;
    if (pred.type === 'slam') {
      const mid = from.clone().lerp(dest, 0.4);
      await this.fx.tween(0.12, (k) => cyc.mesh.position.lerpVectors(from, mid, k));
      await this.fx.tween(0.12, (k) => cyc.mesh.position.lerpVectors(mid, from, k));
      this.fx.floatText(tp, 'SLAMMED', '#ff8866');
      await this.applyDamage(cyc, 2, tank.side);
    } else if (pred.type === 'edge') {
      await this.fx.tween(0.14, (k) => cyc.mesh.position.lerpVectors(from, dest, k));
      this.fx.floatText(tp, 'GRID BOUNDARY', '#ff5544');
      this.fx.ring(dest.clone(), 0xffffff, 2.0, 0.4);
      await this.applyDamage(cyc, cyc.hp, tank.side);
    } else {
      await this.fx.tween(0.14, (k) => cyc.mesh.position.lerpVectors(from, dest, k));
      cyc.q = pred.q; cyc.r = pred.r;
      if (pred.type === 'hole') {
        await this._fallIntoPit(cyc, tank.side);
      } else if (pred.type === 'wall') {
        this.fx.floatText(tp, 'WALL COLLISION', '#ff5544');
        await this.applyDamage(cyc, cyc.hp, tank.side);
      } else if (pred.type === 'ownwall') {
        // crashed through its own wall: it shatters and the cycle survives
        this.breachWalls(pred.q, pred.r);
        await this.applyDamage(cyc, 1, tank.side);
      } else {
        this.fx.floatText(tp, 'RAMMED', '#cfeaff');
        await this.applyDamage(cyc, 1, tank.side);
      }
    }
  }

  playerTogglePush() {
    if (this.busy || this.over || !this.isMyTurn()) return;
    const u = this.selected;
    if (!u || u.type !== 'tank' || u.side !== this.current || u.attacked) return;
    if (!this.pushTargets(u).length) { this.audio.uiDeny(); return; }
    this.pushMode = !this.pushMode;
    this.audio.blip(560);
    this.ui.showUnit(u, this);
    this.refreshHighlights();
  }

  async playerPush(tank, cyc) {
    this.busy = true;
    this.invalidateUndo();
    this.pushMode = false;
    this.clearHighlights();
    this.ui.hideTarget();
    await this.pushAttack(tank, cyc);
    this.busy = false;
    if (this.over) return;
    this.select(null);
    this.ui.updateScorecard(this);
    this.maybeAutoEnd();
  }

  // The enemy-team core adjacent to a cycle, if any — conquest candidate.
  conquerableCore(cyc) {
    if (cyc.type !== 'cycle') return null;
    return this.units.find((t) =>
      t.alive && t.type === 'core' && this.isHostile(t.side, cyc.side) &&
      hexDistance(cyc, t) === 1) || null;
  }

  // Channel a conquest: two special attacks on consecutive own turns flip
  // the core — and its entire army — to the conqueror's colours.
  async conquestAttack(cyc) {
    const core = this.conquerableCore(cyc);
    if (!core) return;
    this.markActed(cyc.side);
    if (this._aiNet) this.emitNet({ a: 'conq', u: cyc.id });
    cyc.attacked = true;
    if (this.isDone(cyc)) this.setDim(cyc, true);
    const f = this.factionOf(cyc);
    this.audio.conquest();
    const from = cyc.mesh.position.clone();
    from.y += 0.5;
    const to = core.mesh.position.clone();
    to.y += 1.2;
    await this.fx.laserBeam(from, to, f.color, 1);
    this.fx.ring(core.mesh.position.clone(), f.color, 2.0, 0.7);

    // progress only carries if the SAME light cycle continues the channel
    const prog = core.conquest && core.conquest.byCycle === cyc.id
      ? core.conquest.count : 0;
    if (prog + 1 >= 2) {
      core.conquest = null;
      await this.conquerCore(core, cyc.side);
    } else {
      core.conquest = { byCycle: cyc.id, by: cyc.side, count: prog + 1, fresh: true };
      const tp = core.mesh.position.clone();
      tp.y += 3;
      this.fx.floatText(tp, 'CONQUEST 1/2', f.css);
      this.ui.showBanner('CONQUEST INITIATED', f.css, 1400);
      this.sayChance(cyc.side, 'conquestStart', 0.8);
    }
  }

  // A conquering light cycle was destroyed: the core repels the takeover
  // and any progress it had channelled resets to zero.
  breakConquestBy(cycleId) {
    for (const core of this.units) {
      if (!core.alive || core.type !== 'core' || !core.conquest) continue;
      if (core.conquest.byCycle !== cycleId) continue;
      core.conquest = null;
      const cf = this.factionOf(core);
      const pos = core.mesh.position.clone();
      this.fx.ring(pos.clone(), cf.color, 3.0, 0.7);
      this.fx.flash(pos.clone().setY(pos.y + 1.0), cf.color, 8, 0.5, 12);
      const tp = pos.clone();
      tp.y += 3;
      this.fx.floatText(tp, 'CORE DEFENDED', cf.css);
      this.ui.showBanner('CONQUEST BROKEN', cf.css, 1400);
      this.audio.conquest();
    }
  }

  playerConquer() {
    if (this.busy || this.over || !this.isMyTurn()) return;
    const u = this.selected;
    if (!u || u.type !== 'cycle' || u.side !== this.current || u.attacked) return;
    if (!this.conquerableCore(u)) { this.audio.uiDeny(); return; }
    this.invalidateUndo();
    this.emitNet({ a: 'conq', u: u.id });
    (async () => {
      this.busy = true;
      this.clearHighlights();
      await this.conquestAttack(u);
      this.busy = false;
      if (this.over) return;
      this.select(this.canMoveNow(u) ? u : null);
      this.ui.updateScorecard(this);
      this.maybeAutoEnd();
    })();
  }

  // Free a dead/replaced unit mesh's GPU resources. Removing it from the scene
  // does NOT release geometry/material/texture memory — that must be disposed
  // explicitly or every kill leaks (~40 unique objects for a light cycle).
  // Safe because unit meshes share no module-level geometries/materials.
  _disposeMesh(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const mat of mats) {
        if (mat.map) mat.map.dispose(); // e.g. the health-bar CanvasTexture
        mat.dispose();
      }
    });
  }

  recolorUnit(u, f) {
    for (const m of u.mesh.userData.glowMats || []) {
      m.userData.baseColor = f.color;
    }
    this.setDim(u, this.isDone(u));
    if (u.wedgeMat) u.wedgeMat.color.setHex(f.color);
    // rebuild the health bar in the new colour — dispose the old sprite's
    // material + CanvasTexture first or each conquest leaks them
    u.mesh.remove(u.bar.sprite);
    if (u.bar.sprite.material.map) u.bar.sprite.material.map.dispose();
    u.bar.sprite.material.dispose();
    u.bar = makeHealthBar(f.css, HEALTHBAR_Y[u.type]);
    u.mesh.add(u.bar.sprite);
    u.bar.update(Math.max(0, u.hp / u.maxHp));
    this.fx.materialize(
      u.mesh.position.clone().setY(u.mesh.position.y - u.baseY), f.color);
  }

  // Conquest captures THIS core and the units it spawned (not any OTHER cores
  // the faction holds, nor their units). The core and its troops flip to the
  // conqueror, who from now on collects the core's per-round credits. A
  // faction is only defeated once every one of its cores is gone.
  async conquerCore(core, winnerId) {
    const loserId = core.side;
    const winner = this.factions[winnerId];
    this.ui.showBanner(winner.name + ' CAPTURES A CORE', winner.css, 2200);
    this._recMark(winner.name + ' SEIZES A CORE', winner.css);
    this.audio.chime('win');
    core.side = winnerId;
    core.conquest = null;
    core.mesh.traverse((o) => { o.userData.unitId = core.id; });
    this.recolorUnit(core, winner);
    this.flickerCoreNetwork(core); // the seized network glitches as it changes hands

    // units this core spawned defect with it
    const troops = this.units.filter((u) =>
      u.alive && u.type !== 'core' && u.side === loserId && u.coreId === core.id);
    for (const u of troops) {
      u.side = winnerId;
      u.attacked = true;          // can't act until the conqueror's next turn
      u.movesLeft = 0;
      u.postAttackMoved = true;
      if (u.type === 'cycle' || u.type === 'jet') this.clearTrailsOfOwner(u.id);
      this.recolorUnit(u, winner);
      await this.fx.wait(0.1);
    }

    winner.score += 300 + troops.length * 20;
    this.sayChance(winnerId, 'conquestDone', 0.9);
    await this.fx.wait(0.3);
    this.ui.updateScorecard(this);
    // the loser may now hold no cores at all — checkVictory derezzes them
    this.checkVictory();
  }

  async attack(unit, target) {
    this.markActed(unit.side);
    if (this._aiNet) this.emitNet({ a: 'attack', u: unit.id, t: target.id });
    const def = UNIT_TYPES[unit.type];
    const f = this.factionOf(unit);
    unit.attacked = true;
    if (this.isDone(unit)) this.setDim(unit, true);

    // resolve the hit before anyone turns or moves — same math the
    // target card showed the player
    const pred = this.predictAttack(unit, target);
    // both combatants on screen: source card left, target card beside it
    this.ui.showUnit(unit, this);
    this.ui.showTarget(target, this, pred);

    const targetPos = target.mesh.position.clone();
    targetPos.y += target.type === 'reco' ? 1.0 : 0.45;
    if (unit.type === 'tank' && unit.mesh.userData.turret) {
      // the hull stays put — only the turret swivels onto the target
      // a valid target is already inside the firing arc; lock straight onto it
      const ang = this.turretAngleTo(unit, target);
      unit.turretAngle = ang;
      const turret = unit.mesh.userData.turret;
      const startAng = turret.rotation.y;
      this.audio.blip();
      await this.fx.tween(0.3, (k) => {
        turret.rotation.y = startAng + (ang - startAng) * k;
      });
    } else if (unit.type === 'jet') {
      // jets only ever target what is already in their forward arc, so there is
      // no turn-to-shoot — the nose laser fires straight onto the target ahead
    } else if (def.fly) {
      // a recognizer swings around to face its target before firing — a slow,
      // weighty turn with a touch of bank, like its movement
      const cur = unit.mesh.quaternion.clone();
      unit.mesh.lookAt(targetPos.x, unit.mesh.position.y, targetPos.z);
      const tgt = unit.mesh.quaternion.clone();
      const turn = cur.angleTo(tgt);
      if (turn > 0.05) {
        const pf = new THREE.Vector3(0, 0, 1).applyQuaternion(cur);
        const nf = new THREE.Vector3(0, 0, 1).applyQuaternion(tgt);
        const bank = Math.max(-0.14, Math.min(0.14,
          Math.atan2(pf.z * nf.x - pf.x * nf.z,
            Math.max(-1, Math.min(1, pf.x * nf.x + pf.z * nf.z))) * 0.12));
        if (!this._qBank) this._qBank = new THREE.Quaternion();
        if (!this._fwdAxis) this._fwdAxis = new THREE.Vector3(0, 0, 1);
        const sm = (k) => k * k * k * (k * (k * 6 - 15) + 10);
        unit.mesh.quaternion.copy(cur);
        await this.fx.tween(0.2 + turn / Math.PI * 0.34, (k) => {
          unit.mesh.quaternion.slerpQuaternions(cur, tgt, sm(k));
          this._qBank.setFromAxisAngle(this._fwdAxis, bank * Math.sin(k * Math.PI));
          unit.mesh.quaternion.multiply(this._qBank);
        });
      }
      unit.mesh.quaternion.copy(tgt);
    } else {
      unit.mesh.lookAt(targetPos.x, unit.mesh.position.y, targetPos.z);
    }

    const health = Math.max(0.1, unit.hp / unit.maxHp);
    if (def.attack === 'laser') {
      const from = unit.mesh.localToWorld(
        unit.mesh.userData.headLocal.clone()
      );
      await this.fx.laserBeam(from, targetPos, f.color, health);
      this.fx.explosion(targetPos, f.color, 0.7);
      await this.fx.wait(0.3);
    } else if (def.attack === 'rocket') {
      const from = unit.mesh.userData.turret.localToWorld(
        unit.mesh.userData.muzzleLocal.clone()
      );
      this.fx.flash(from, f.color, 5, 0.2, 5);
      await this.fx.rocket(from, targetPos, f.color, health);
      this.fx.explosion(targetPos, f.color, 1.3);
      await this.fx.wait(0.45);
    } else { // dash — light cycle melee strike
      const home = unit.mesh.position.clone();
      const strike = targetPos.clone();
      strike.y = unit.baseY;
      const dir = new THREE.Vector3().subVectors(home, strike).normalize().multiplyScalar(0.55);
      strike.add(dir);
      this.audio.engine(0.5, health, 'cycle');
      let prev = home.clone();
      await this.fx.tween(0.22, (k) => {
        unit.mesh.position.lerpVectors(home, strike, k);
        this.fx.trailWall(prev, unit.mesh.position.clone(), f.color);
        prev = unit.mesh.position.clone();
      });
      this.fx.slash(targetPos, f.color, health);
      this.fx.explosion(targetPos, f.color, 0.55);
      await this.fx.tween(0.25, (k) => {
        unit.mesh.position.lerpVectors(strike, home, k);
      });
    }

    const dmg = pred.dmg;
    target.focusHits = pred.focus + 1;
    let text = '-' + dmg;
    if (pred.labels.length) text += '  ' + pred.labels.join('  ');
    const textPos = target.mesh.position.clone();
    textPos.y += HEALTHBAR_Y[target.type] + 0.25;
    const textColor = pred.focus > 0 ? '#ffd24a'
      : pred.mult > 1 || pred.altMult > 1 ? '#ff5544'
      : pred.mult < 1 ? '#9ab4c4' : '#ffffff';
    this.fx.floatText(textPos, text, textColor);

    const targetSide = target.side; // may change if a core defects later
    await this.applyDamage(target, dmg, unit.side);
    // linger on the result so the player can read the damage, then clear the
    // target card (a lethal hit runs its own in-card derez + hold instead)
    if (target.alive) this.ui.showTarget(target, this, null);
    setTimeout(() => this.ui.hideTargetIf(target), 2800);

    // MCP table talk
    if (!target.alive) {
      this.sayChance(unit.side, 'kill', 0.5);
      const tf = this.factions[targetSide];
      if (tf && !tf.eliminated) this.sayChance(targetSide, 'loss', 0.3);
    } else if (pred.mult > 1) {
      this.sayChance(unit.side, 'hit', 0.3);
    } else if (pred.mult < 1) {
      this.sayChance(targetSide, 'deflect', 0.3);
    }
  }

  // A core and every program it spawned share a link — when the core is struck
  // or seized, that whole network glitches, flickering off and on for a moment.
  flickerCoreNetwork(core) {
    if (core._flickering) return; // don't stack overlapping glitches
    const meshes = this.units
      .filter((u) => u.alive && (u.id === core.id || u.coreId === core.id))
      .map((u) => u.mesh);
    if (!meshes.length) return;
    core._flickering = true;
    const FLICKS = 8;
    this.fx.tween(0.55, (k) => {
      const on = Math.floor(k * FLICKS) % 2 === 0;
      for (const m of meshes) m.visible = on;
    }, () => {
      for (const m of meshes) m.visible = true;
      core._flickering = false;
    });
  }

  async applyDamage(target, dmg, killerSide = null) {
    this.invalidateUndo(); // a fight happened — no move may be taken back across it
    target.hp -= dmg;
    target.bar.update(Math.max(0, target.hp / target.maxHp));
    if (this.ui.shownUnit === target) {
      this.ui.showUnit(target, this);
      this.ui.preview.hit(); // visible hit reaction in the unit card
    }
    if (target.hp > 0 && target.type === 'tank') this._tankRecoil(target);
    // a struck core sends a glitch rippling through its connected programs
    if (target.hp > 0 && target.type === 'core') this.flickerCoreNetwork(target);

    // Any hit knocks a recognizer down a flight level; dropping out of the top
    // level onto a unit it was hovering over makes both of them crash.
    if (target.hp > 0 && (target.type === 'reco' || target.type === 'jet')
        && this.altLevel(target) > 0) {
      const wasTop = this._lowerRecoAltitude(target);
      if (wasTop) {
        const under = this.groundOccupantAt(target.q, target.r, target.id);
        if (under) {
          this.fx.floatText(
            target.mesh.position.clone().setY(target.baseY + 1.4), 'COLLISION', '#ffb347');
          this.fx.explosion(
            under.mesh.position.clone().setY(0.6), this.factionOf(under).color, 0.8);
          target.hp -= RECO_COLLIDE_DMG; // folded into the death check below
          target.bar.update(Math.max(0, target.hp / target.maxHp));
          if (this.ui.shownUnit === target) this.ui.showUnit(target, this);
          await this.applyDamage(under, RECO_COLLIDE_DMG, killerSide);
        }
      }
    }

    if (target.hp <= 0) {
      target.alive = false;
      this.ui.explodeTargetIf(target);
      if (target.type === 'core') this._recMark('CORE DESTROYED', this.factionOf(target).css);
      if (target.type === 'jet') this.clearTrailsOfOwner(target.id);
      if (target.type === 'cycle') {
        this.clearTrailsOfOwner(target.id);
        this.breakConquestBy(target.id);
      }
      if (killerSide != null && killerSide !== target.side) {
        const killer = this.factions[killerSide];
        killer.score += (UNIT_TYPES[target.type].cost || 20) * 10;
        if (killerSide === this.current) this.ui.setScore(killer.score);
      }
      this.ui.updateScorecard(this);
      const idx = this.pickMeshes.indexOf(target.mesh);
      if (idx >= 0) this.pickMeshes.splice(idx, 1);
      const f = this.factionOf(target);
      const pos = target.mesh.position.clone();
      pos.y += 0.4;
      // explosion magnitude scales with the unit's physical size
      const box = new THREE.Box3().setFromObject(target.mesh);
      const diag = box.getSize(this._v1).length();
      const scale = Math.min(2.4, Math.max(0.7, diag * 0.55));
      const derezDone = this.fx.derez(target.mesh, f.color);
      this.scene.remove(target.mesh);
      this._disposeMesh(target.mesh); // derez built its own voxels; the hull is free to dispose
      this.fx.explosion(pos, f.color, scale);
      await derezDone;
      this.checkVictory();
    }
  }

  setDim(unit, dim) {
    for (const m of unit.mesh.userData.glowMats || []) {
      const base = new THREE.Color(m.userData.baseColor);
      if (dim) base.multiplyScalar(0.3);
      m.color.copy(base);
    }
  }

  // ---------- healing ----------

  // At the start of a faction's turn: a unit standing on a healing pad (it has
  // been there a full round) is restored COMPLETELY; otherwise a unit that did
  // nothing last turn self-repairs +1.
  healPhase(side) {
    let any = false;
    for (const u of this.aliveUnits(side)) {
      // structure repair doesn't work at the top level — too high, fully exposed
      if (u.type === 'reco' && u.altitude === 'top') continue;
      const def = UNIT_TYPES[u.type];
      const cell = this.cellOf(u);
      const onPad = cell && cell.terrain === 'heal';
      let target = u.hp;
      if (onPad) {
        target = u.maxHp; // full restore after a round on the pad
      } else if (!u.attacked && (def.move === 0 || u.movesLeft === def.move)) {
        target = Math.min(u.maxHp, u.hp + 1); // idle self-repair
      }
      if (target <= u.hp) continue;
      const healed = target - u.hp;
      u.hp = target;
      u.bar.update(u.hp / u.maxHp);
      any = true;
      const pos = u.mesh.position.clone();
      pos.y += HEALTHBAR_Y[u.type] + 0.2;
      this.fx.floatText(pos, onPad ? 'RESTORED' : '+' + healed, '#7dffc8');
      this.fx.burst({
        pos: u.mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0)),
        count: onPad ? 28 : 14, color: 0x7dffc8,
        speed: 1, life: 0.7, gravity: -1.6, size: 0.09,
      });
      // a repaired recognizer regains lift
      if (u.type === 'reco' && !this.isCrippled(u) && u.baseY < FLY_HEIGHT * 0.8) {
        u.altitude = 'normal';
        u.baseY = FLY_HEIGHT;
        const cell2 = this.cellOf(u);
        const destY = u.baseY + TERRAIN_Y[cell2.terrain];
        const fromY = u.mesh.position.y;
        this.fx.tween(0.6, (k) => {
          u.mesh.position.y = fromY + (destY - fromY) * k;
        });
        this.fx.floatText(pos.clone().add(new THREE.Vector3(0, 0.5, 0)),
          'ENGINES RESTORED', '#7dffc8');
      }
    }
    if (any) this.audio.heal();
  }

  // ---------- turn flow ----------

  factionDefeated(f) {
    // a neutral flag-faction just idles with its core — it's only "defeated"
    // (and derezzed) when that core is actually destroyed or conquered away
    if (f.neutral) return !this.coreOf(f.id);
    if (!this.coreOf(f.id)) return true;
    const hasMobile = this.aliveUnits(f.id).some((u) => u.type !== 'core');
    return !hasMobile && f.energy < this.cheapestCost();
  }

  // Cheapest buildable unit right now — computed live so custom RULES costs (and
  // map build restrictions) are honoured, not the module-load default.
  cheapestCost() {
    const types = this.buildable || TUNABLE_UNITS;
    let min = Infinity;
    for (const t of types) {
      const c = UNIT_TYPES[t] && UNIT_TYPES[t].cost;
      if (c > 0 && c < min) min = c;
    }
    return min === Infinity ? CHEAPEST_UNIT_COST : min;
  }

  checkVictory() {
    if (this.over) return;
    for (const f of this.factions) {
      if (!f.eliminated && this.factionDefeated(f)) this.eliminateFaction(f);
    }
    // a TEAM wins together once every rival team's cores have fallen — neutral
    // flag-factions don't count toward the active sides
    const activeTeams = new Set(
      this.factions.filter((f) => !f.eliminated && !f.neutral).map((f) => f.team)
    );
    if (activeTeams.size <= 1) {
      this.endGame(this.factions.filter((f) => !f.eliminated));
    }
  }

  // A fallen faction derezzes completely — core first, always on screen.
  eliminateFaction(f) {
    f.eliminated = true;
    this.clearTrails(f.id);
    this.ui.updateScorecard(this);
    this.ui.showBanner(f.name + ' DEREZZED', f.css, 2000);
    this._recMark(f.name + ' DEREZZED', f.css);
    if (f.isAI) {
      const set = this.alliedWithHuman(f.id) ? BARKS_ALLY : BARKS;
      this.coreBark(f.id, set.eliminated[0]);
    }
    const remaining = this.aliveUnits(f.id)
      .sort((a, b) => (a.type === 'core' ? -1 : 1) - (b.type === 'core' ? -1 : 1));
    (async () => {
      for (const u of remaining) {
        if (!u.alive) continue;
        u.alive = false;
        if (u.type === 'cycle') {
          this.clearTrailsOfOwner(u.id);
          this.breakConquestBy(u.id);
        }
        const idx = this.pickMeshes.indexOf(u.mesh);
        if (idx >= 0) this.pickMeshes.splice(idx, 1);
        const pos = u.mesh.position.clone();
        pos.y += 0.4;
        const box = new THREE.Box3().setFromObject(u.mesh);
        const diag = box.getSize(new THREE.Vector3()).length();
        this.fx.derez(u.mesh, f.color);
        this.scene.remove(u.mesh);
        this._disposeMesh(u.mesh);
        this.fx.explosion(pos, f.color, Math.min(2.4, Math.max(0.7, diag * 0.55)));
        await this.fx.wait(0.22);
      }
    })();
  }

  endGame(winners) {
    this.over = true;
    if (this.recording) {
      const w = (winners && winners[0]) || null;
      this._recMark(w ? w.name + ' WINS' : 'GAME OVER', w ? w.css : '#ffffff');
      this.recording.over = true;
      this.recording.winner = w ? w.name : null;
    }
    if (this.replaying) return; // replayLoop notices over=true and ends cleanly
    this.busy = true;
    this.select(null);
    this.clearHighlights();
    this.ui.setEndTurnEnabled(false);
    this.ui.updateScorecard(this);
    const humanWinners = (winners || []).filter((w) => w.controller === 'human');
    this.audio.chime(humanWinners.length ? 'win' : 'lose');

    let hs = null;
    if (humanWinners.length) {
      const top = humanWinners.sort((a, b) => b.score - a.score)[0];
      top.score += Math.max(100, 600 - this.cycleNum * 10);
      const storeKey = 'gridwars-hs-' + this.sizeKey;
      let list = [];
      try {
        list = JSON.parse(localStorage.getItem(storeKey) || '[]')
          .map((e) => (typeof e === 'number' ? { score: e, name: '---' } : e));
      } catch (e) { /* fresh */ }
      const prevBest = list.length ? Math.max(...list.map((e) => e.score)) : 0;
      const isNew = top.score > prevBest;
      list.push({ score: top.score, name: top.name });
      list.sort((a, b) => b.score - a.score);
      list = list.slice(0, 5);
      try { localStorage.setItem(storeKey, JSON.stringify(list)); } catch (e) { /* ignore */ }
      hs = { score: top.score, best: Math.max(prevBest, top.score), isNew, list };
    }
    if (this.onMissionEnd) this.onMissionEnd(humanWinners.length > 0);
    if (this.onGameOver) this.onGameOver(); // finished games leave the session list
    setTimeout(() => this.ui.showGameOver(winners, hs), 1800);
  }

  // Per-faction round-start bookkeeping: walls expire, idle/pad healing,
  // conquest lapse, unit reset, per-core income.
  _factionRoundSetup(f) {
    this.clearTrails(f.id);
    this.healPhase(f.id);
    for (const c of this.units) {
      if (c.alive && c.type === 'core' && c.conquest && c.conquest.by === f.id) {
        if (c.conquest.fresh) c.conquest.fresh = false;
        else c.conquest = null;
      }
    }
    for (const u of this.units) u.focusHits = 0;
    for (const u of this.aliveUnits(f.id)) {
      if (u.type === 'cycle' && !u.attacked && u.movesLeft === UNIT_TYPES.cycle.move) {
        u.speed = 1;
      }
      u.movesLeft = UNIT_TYPES[u.type].move;
      u.attacked = false;
      u.postAttackMoved = false;
      u.altStepUsed = false;
      u._jetTrail = null; // last turn's wingtip walls expired — start a fresh ribbon
      u.turretStart = u.turretAngle || 0; // turret may swing ±60° from here this turn
      this.setDim(u, false);
    }
    const cores = this.aliveUnits(f.id).filter((u) => u.type === 'core').length;
    f.energy += this.config.income * cores;
  }

  // ===================== per-unit initiative mode =====================
  // Every unit (across all factions) acts once per round in its own initiative
  // order. When the local player's unit comes up we pause and hand them that
  // single unit, like a one-unit faction turn; AI units act on their own.

  // Initiative order for a round: faster units (by move rating) tend to act
  // first, with a small random roll for variety. Rolled fresh each round.
  _buildUnitOrder() {
    // seeded RNG so replay and net clients reproduce the exact same order
    return this.units
      .filter((u) => u.alive && u.type !== 'core' && !this.factions[u.side].neutral)
      .map((u) => ({ id: u.id, roll: (UNIT_TYPES[u.type].move || 1) + this.rand() * 1.5 }))
      .sort((a, b) => (b.roll - a.roll) || (a.id - b.id))
      .map((r) => r.id);
  }

  // Does this unit still have a move or an attack available?
  _unitHasActions(u) {
    if (!u || !u.alive || u.type === 'core') return false;
    if (!u.attacked &&
        this.targetsInRange(u, u.q, u.r, { freeTurret: u.type === 'tank' }).length) return true;
    return this.canMoveNow(u) && this.validDestinations(u).dests.size > 0;
  }

  // Forced-momentum coast for a single unit (per-unit end-of-activation).
  async _coastUnit(u) {
    if (this.simultaneous || !u || !u.alive || u.type === 'core') return;
    if (u.movesLeft < UNIT_TYPES[u.type].move) return; // it moved this activation
    if (!this.hasMomentum(u)) return;
    await this._forcedCoast(u);
  }

  // Mark the end of one activation (or the round's production phase). Records a
  // boundary into the stream and, online, signals the watching clients.
  _emitUnitEnd() {
    if (this.recording) this.recording.events.push({ a: 'endturn' });
    if (this.net) this.net.emitAdvance();
  }

  async unitLoop() {
    while (!this.over) {
      if (this._unitIdx >= this._unitOrder.length) {
        // ---- new round: bookkeeping for all factions, then AI reinforcements ----
        for (const f of this.factions) if (!f.eliminated) this._factionRoundSetup(f);
        this.cycleNum++;
        this.fx.ageRemains(WRECK_TURNS);
        this._unitOrder = this._buildUnitOrder();
        this._unitIdx = 0;
        for (const f of this.factions) f.acted = false;
        const hostSide = !this.net || this.net.isHost;
        if (hostSide) {
          this._aiNet = !!this.net || !!this.recording; // stream/record the builds
          for (const f of this.factions) {
            if (this.over) break;
            if (!f.eliminated && f.controller === 'ai') await aiProduce(this, f.id);
          }
          this._aiNet = false;
          this._emitUnitEnd();           // close the production phase
        } else if (this.net) {
          await this.net.waitTurnEnd();  // clients receive the host's reinforcements
        }
        if (this.over) return;
        this.ui.updateScorecard(this);
      }
      const u = this.unitById(this._unitOrder[this._unitIdx]);
      if (!u || !u.alive || u.type === 'core') { this._unitIdx++; continue; }
      this.current = u.side;
      this._activeUnit = u;
      const f = this.factions[u.side];
      this._turnLocal = f.controller === 'human' && this.ownsFaction(f.id);
      this.busy = true;
      this.ui.setTurn(f, this.cycleNum, this._turnLocal, u);
      this.ui.setEnergy(f.energy, f.css);
      this.ui.setScore(f.score);
      this.ui.updateScorecard(this);
      this.checkVictory();
      if (this.over) return;
      if (this.onAutosave) this.onAutosave();

      if (this._turnLocal) {
        // hand this one unit to the player; the loop resumes from endPlayerTurn()
        this.busy = false;
        this.select(u);
        if (this.onFocus) this.onFocus(u);
        this.ui.endTurnBtn.textContent = 'END UNIT';
        this.ui.setEndTurnEnabled(true);
        this.ui.showBanner(f.name + ' · ' + u.type.toUpperCase(), f.css, 800);
        this.audio.chime('turn');
        this.maybeAutoEnd();
        return;
      }
      this.select(null);
      this.ui.setEndTurnEnabled(false);
      this.ui.showBanner(f.name + ' · ' + u.type.toUpperCase(), f.css, 600);
      this.audio.chime('enemyTurn');
      const localAI = f.controller === 'ai' && (!this.net || this.net.isHost);
      if (localAI) {
        // this client drives the unit — its actions stream/record out
        await this.fx.wait(0.45);
        this._aiNet = !!this.net || !!this.recording;
        await aiUnitAct(this, u);
        this._aiNet = false;
        if (this.over) return;
        await this._coastUnit(u);
        this._emitUnitEnd();
      } else if (this.net) {
        // a remote unit (or the host's AI seen from a client) — replay its stream
        await this.net.waitTurnEnd(u.side);
        if (this.over) return;
        await this._coastUnit(u); // deterministic — matches the acting client
      }
      this._unitIdx++;
    }
  }

  // Drives the turn rotation; pauses while a human faction acts.
  async runTurns() {
    if (this.simultaneous) return this.simLoop();
    if (this.perUnitInit) return this.unitLoop();
    while (!this.over) {
      const f = this.factions[this.current];
      if (f.eliminated) { this._advance(); continue; }

      // turn bookkeeping for the acting faction (skipped once when resuming
      // a saved session — the snapshot was taken after bookkeeping ran)
      this.busy = true;
      if (this._skipBookkeeping) {
        this._skipBookkeeping = false;
      } else {
        this._factionRoundSetup(f);
      }
      // decide control of this turn up front so the UI can announce it
      this._turnLocal = f.controller === 'human' && this.ownsFaction(f.id);
      this.ui.setTurn(f, this.cycleNum, this._turnLocal);
      this.ui.setEnergy(f.energy, f.css);
      this.ui.setScore(f.score);
      this.ui.updateScorecard(this);
      this.ui.showBanner(this._turnLocal ? 'YOUR TURN' : f.name + ' TURN', f.css);
      this.audio.chime(f.controller === 'human' ? 'turn' : 'enemyTurn');
      this.sayChance(f.id, 'greet', 0.1);
      this.checkVictory();
      if (this.over) return;
      if (this.onAutosave) this.onAutosave(); // session snapshot, once per turn
      await this.fx.wait(0.9);

      const myHuman = this._turnLocal;
      const myAI = f.controller === 'ai' && (!this.net || this.net.isHost);
      if (myHuman) {
        this.busy = false;
        this.ui.setEndTurnEnabled(true);
        this._undoStack = []; // fresh turn — nothing to take back yet
        this._refreshUndoUI();
        this.maybeAutoEnd();
        return; // wait for the local human's END TURN
      }
      if (myAI) {
        this._aiNet = !!this.net || !!this.recording; // emit actions to stream
        await aiTakeTurn(this, f.id);
        this._aiNet = false;
        if (this.over) return;
        await this._coastMomentum(f.id); // unmoved fast units coast on
        if (this.over) return;
        if (this.recording) this.recording.events.push({ a: 'endturn' });
        if (this.net) this.net.emitAdvance();
        this._advance();
      } else {
        // a remote player — or the host's AI, seen from a client —
        // plays this turn; their actions stream in and replay here
        this.ui.setEndTurnEnabled(false);
        await this.net.waitTurnEnd(f.id);
        if (this.over) return;
        await this._coastMomentum(f.id); // deterministic — matches the acting client
        if (this.over) return;
        this._advance();
      }
    }
  }

  // Apply recorded events up to the next boundary marker ('endturn' or
  // 'simorders'), honouring pause/fast-forward. Returns the boundary event, or
  // null if the stream ended (or the game ended mid-apply).
  async _replayApplyUntilEndturn() {
    const evs = this.replay.events;
    while (this._evIdx < evs.length) {
      if (this._fast && this._evIdx >= this._fastTarget) {
        this._fast = false;
        this.fx.speed = this._replaySpeed || 1;
      }
      if (!this._fast) await this._replayGate();
      const ev = evs[this._evIdx++];
      if (this.onReplayProgress) this.onReplayProgress(this._evIdx);
      if (ev.a === 'endturn') return ev;
      await this.applyNetEvent(ev); // moves/attacks/builds/factionorders
      if (this.over) return null;
    }
    return null;
  }

  // Replay driver: re-runs the turn loop, but each faction's actions are pulled
  // from the recorded stream instead of the AI/human. The RNG stays in lockstep
  // because only map-gen + initiative consume it — both reproduced exactly.
  async replayLoop() {
    if (this.simultaneous) return this.replaySimLoop();
    if (this.perUnitInit) return this.replayUnitLoop();
    const evs = this.replay.events;
    if (this._fast) this.fx.speed = 140; // fast-forward to a seek target
    while (!this.over && this._evIdx < evs.length) {
      const f = this.factions[this.current];
      if (f.eliminated) { this._advance(); continue; }
      this._factionRoundSetup(f);
      this.ui.setTurn(f, this.cycleNum, false);
      this.ui.setEnergy(f.energy, f.css);
      this.ui.setScore(f.score);
      this.ui.updateScorecard(this);
      this.checkVictory();
      if (this.over) break;
      if (!this._fast) await this.fx.wait(0.3);
      await this._replayApplyUntilEndturn();
      if (this.over) break;
      await this._coastMomentum(this.current); // re-derive the forced coast in lockstep
      if (this.over) break;
      this._advance();
    }
    this._fast = false;
    if (this.onReplayProgress) this.onReplayProgress(this._evIdx);
    if (this.onReplayDone) this.onReplayDone();
  }

  // Replay for per-unit initiative: rebuild the same seeded unit order each
  // round and apply each unit's recorded actions, re-deriving the deterministic
  // momentum coast — exactly mirroring unitLoop().
  async replayUnitLoop() {
    const evs = this.replay.events;
    if (this._fast) this.fx.speed = 140;
    while (!this.over && this._evIdx < evs.length) {
      if (this._unitIdx >= this._unitOrder.length) {
        for (const f of this.factions) if (!f.eliminated) this._factionRoundSetup(f);
        this.cycleNum++;
        this.fx.ageRemains(WRECK_TURNS);
        this._unitOrder = this._buildUnitOrder(); // seeded → identical order
        this._unitIdx = 0;
        for (const f of this.factions) f.acted = false;
        this.ui.updateScorecard(this);
        await this._replayApplyUntilEndturn(); // production phase
        if (this.over) break;
      }
      const u = this.unitById(this._unitOrder[this._unitIdx]);
      if (!u || !u.alive || u.type === 'core') { this._unitIdx++; continue; }
      this.current = u.side;
      this._activeUnit = u;
      const f = this.factions[u.side];
      this.ui.setTurn(f, this.cycleNum, false, u);
      this.ui.setEnergy(f.energy, f.css);
      this.ui.updateScorecard(this);
      if (!this._fast) await this.fx.wait(0.2);
      await this._replayApplyUntilEndturn();
      if (this.over) break;
      await this._coastUnit(u);
      this._unitIdx++;
    }
    this._fast = false;
    if (this.onReplayProgress) this.onReplayProgress(this._evIdx);
    if (this.onReplayDone) this.onReplayDone();
  }

  // Replay for simultaneous (WeGo): apply each round's recorded builds and the
  // per-faction committed orders, then resolve them — resolution is deterministic.
  async replaySimLoop() {
    const evs = this.replay.events;
    if (this._fast) this.fx.speed = 140;
    while (!this.over && this._evIdx < evs.length) {
      for (const f of this.factions) if (!f.eliminated) this._factionRoundSetup(f);
      this.orders = new Map();
      this.ui.setCycle(this.cycleNum);
      this.ui.updateScorecard(this);
      this.checkVictory();
      if (this.over) break;
      if (!this._fast) await this.fx.wait(0.3);
      // apply this round's builds + factionorders (each sets this.orders) up to
      // the 'endturn' resolve marker
      const e = await this._replayApplyUntilEndturn();
      if (this.over) break;
      if (!e) break; // stream ended without a resolve marker
      await this.resolveSim();
      if (this.over) break;
      this.turnCount += this.order.length;
      this.cycleNum++;
      this.fx.ageRemains(WRECK_TURNS);
      this.order = this._buildOrder();
      for (const f of this.factions) f.acted = false;
    }
    this._fast = false;
    if (this.onReplayProgress) this.onReplayProgress(this._evIdx);
    if (this.onReplayDone) this.onReplayDone();
  }

  // Block the replay between actions while paused.
  async _replayGate() {
    while (this._replayPaused && !this.over) await this.fx.wait(0.08);
  }

  // Roll a fresh initiative order for the round. Every surviving faction gets
  // a random roll; one that did NOTHING last round gets a bonus that biases it
  // toward going first. Uses the seeded RNG so all net clients agree.
  _buildOrder() {
    const rolled = this.factions
      .filter((f) => !f.eliminated && !f.neutral) // neutral factions never act
      .map((f) => ({ id: f.id, roll: this.rand() + (f.acted ? 0 : INITIATIVE_IDLE_BONUS) }));
    rolled.sort((a, b) => b.roll - a.roll);
    return rolled.map((r) => r.id);
  }

  // Records that a faction took a meaningful action this round (so it does
  // NOT get the idle initiative bonus next round).
  markActed(side) {
    const f = this.factions[side];
    if (f) f.acted = true;
  }

  _advance() {
    this.turnCount++;
    this.orderIdx++;
    if (this.orderIdx >= this.order.length) {
      // round complete — new random initiative for the next round, biased by
      // who sat the last round out
      this.cycleNum++;
      if (!this.replaying) this.fx.speed = this._animSpeed();
      this.fx.ageRemains(WRECK_TURNS);
      this.order = this._buildOrder();
      for (const f of this.factions) f.acted = false;
      this.orderIdx = 0;
    }
    this.current = this.order.length ? this.order[this.orderIdx] : this.current;
  }

  async endPlayerTurn() {
    if (this.simultaneous) { this.commitPlan(); return; }
    if (this.busy || this.over || !this.config || !this.isMyTurn()) return;
    this.audio.init();
    this.busy = true;
    this.select(null);
    this.clearHighlights();
    this.ui.setEndTurnEnabled(false);
    this._undoStack = [];
    this._refreshUndoUI();
    if (this.perUnitInit) {
      // end this unit's activation and hand off to the next in initiative
      await this._coastUnit(this._activeUnit);
      this._activeUnit = null;
      if (this.over) return;
      this._emitUnitEnd();
      this._unitIdx++;
      this.unitLoop();
      return;
    }
    await this._coastMomentum(this.current); // unmoved fast units coast on
    if (this.over) return;
    if (this.recording) this.recording.events.push({ a: 'endturn' });
    if (this.net) this.net.emitAdvance();
    this._advance();
    this.runTurns();
  }

  // ===================== simultaneous (WeGo) mode =====================
  // Every faction plans orders, then all moves and attacks resolve at once.
  // Simplified vs. sequential play: no velocity/overdrive/hit-and-run, no
  // push/conquest specials, and tank turret arc is ignored.

  async simLoop() {
    while (!this.over) {
      for (const f of this.factions) if (!f.eliminated) this._factionRoundSetup(f);
      this.orders = new Map();
      this.ui.setCycle(this.cycleNum); // sim has no per-faction turn — update here
      this.ui.updateScorecard(this);
      this.checkVictory();
      if (this.over) return;
      this.audio.chime('turn');

      // collect every faction's plan. Each faction's controller plans locally
      // and broadcasts its committed orders; everyone else waits to receive
      // them — so replay and net clients resolve from the identical order set.
      for (const fid of this.order) {
        const f = this.factions[fid];
        if (f.eliminated) continue;
        const localHuman = f.controller === 'human' && this.ownsFaction(fid);
        const localAI = f.controller === 'ai' && (!this.net || this.net.isHost);
        if (localHuman) {
          await this.planHuman(fid);
          this._emitFactionOrders(fid);
        } else if (localAI) {
          this._aiNet = !!this.net || !!this.recording; // builds stream/record
          this.planAI(fid);
          this._aiNet = false;
          this._emitFactionOrders(fid);
        } else if (this.net) {
          await this.net.waitTurnEnd(fid); // a remote faction's orders stream in
        }
        if (this.over) return;
      }

      if (this.recording) this.recording.events.push({ a: 'endturn' }); // resolve marker
      await this.resolveSim();
      if (this.over) return;

      // advance the round
      this.turnCount += this.order.length;
      this.cycleNum++;
      if (!this.replaying) this.fx.speed = this._animSpeed();
      this.fx.ageRemains(WRECK_TURNS);
      this.order = this._buildOrder();
      for (const f of this.factions) f.acted = false;
      if (this.onAutosave) this.onAutosave();
    }
  }

  planHuman(fid) {
    return new Promise((resolve) => {
      const f = this.factions[fid];
      this.planning = fid;
      this.current = fid;
      this.busy = false;
      this.select(null);
      this.ui.setTurn(f, this.cycleNum, true);
      this.ui.setEnergy(f.energy, f.css);
      this.ui.setScore(f.score);
      this.ui.showBanner(f.name + ' — PLAN ORDERS', f.css, 1500);
      this.ui.endTurnBtn.textContent = 'COMMIT';
      this.ui.setEndTurnEnabled(true);
      this._commitResolve = resolve;
    });
  }

  commitPlan() {
    if (!this.simultaneous || this.planning == null || this.busy) return;
    this.audio.init();
    this.audio.chime('enemyTurn');
    this.ui.endTurnBtn.textContent = 'END TURN';
    this.ui.setEndTurnEnabled(false);
    this.select(null);
    this.clearGhosts();
    this.clearHighlights();
    this.busy = true;
    this.planning = null;
    const r = this._commitResolve; this._commitResolve = null;
    if (r) r();
  }

  // Broadcast/record one faction's committed orders so replay and net clients
  // resolve from the identical set. The 'adv' lets waiting clients proceed.
  _emitFactionOrders(fid) {
    if (!this.recording && !this.net) return;
    const list = [];
    for (const u of this.aliveUnits(fid)) {
      const o = this.orders.get(u.id);
      if (!o || (!o.path && o.attackId == null)) continue;
      list.push({
        u: u.id,
        path: (o.path || []).map((c) => [c.q, c.r]),
        atk: o.attackId != null ? o.attackId : null,
      });
    }
    this.emitNet({ a: 'factionorders', list });
    if (this.net) this.net.emitAdvance();
  }

  // The MCP commander, planning orders instead of executing them.
  planAI(fid) {
    const order = { tank: 0, reco: 1, cycle: 2 };
    const troops = this.aliveUnits(fid).filter((u) => u.type !== 'core')
      .sort((a, b) => order[a.type] - order[b.type]);
    let acted = false;
    for (const unit of troops) {
      const def = UNIT_TYPES[unit.type];
      const { dests, getPath } = this.validDestinations(unit, { avoidTrails: true });
      const positions = [{ k: key(unit.q, unit.r), cost: 0, path: [] }];
      for (const [k, info] of dests) positions.push({ k, cost: info.cost, path: getPath(k) });

      let best = null;
      for (const pos of positions) {
        const { q, r } = parseKey(pos.k);
        const w = hexToWorld(q, r);
        for (const t of this.targetsInRange(unit, q, r, { freeTurret: unit.type === 'tank' })) {
          const { mult } = this.damageMultiplier(w.x, w.z, t);
          const dmg = Math.max(1, Math.round(def.dmg * mult));
          let score = dmg + (t.hp <= dmg ? 40 : 0) + (t.type === 'core' ? 10 : 0)
            + (t.maxHp - t.hp) * 0.5 - pos.cost * 0.1;
          if (!best || score > best.score) best = { pos, target: t, score };
        }
      }
      if (best) {
        this.orders.set(unit.id, {
          dest: best.pos.cost > 0 ? best.pos.k : null,
          path: best.pos.path, attackId: best.target.id,
        });
        acted = true;
      } else {
        const enemies = this.hostileUnits(fid);
        const pool = enemies.filter((e) => e.type !== 'core').length
          ? enemies.filter((e) => e.type !== 'core') : enemies;
        if (pool.length) {
          let bestK = null, bestPath = null, bestD = Infinity;
          for (const [k, info] of dests) {
            const c = parseKey(k);
            const d = Math.min(...pool.map((e) => hexDistance(c, e))) + info.cost * 0.01;
            if (d < bestD) { bestD = d; bestK = k; bestPath = getPath(k); }
          }
          const here = Math.min(...pool.map((e) => hexDistance(unit, e)));
          if (bestK && bestD < here) {
            this.orders.set(unit.id, { dest: bestK, path: bestPath, attackId: null });
            acted = true;
          }
        }
      }
    }
    // spend some energy on reinforcements (respecting any map restriction)
    const f = this.factions[fid];
    const can = (t) => !this.buildable || this.buildable.includes(t);
    for (let b = 0; b < 2; b++) {
      let type = null;
      if (can('reco') && f.energy >= UNIT_TYPES.reco.cost && Math.random() < 0.4) type = 'reco';
      else if (can('jet') && f.energy >= UNIT_TYPES.jet.cost && Math.random() < 0.4) type = 'jet';
      else if (can('tank') && f.energy >= UNIT_TYPES.tank.cost && Math.random() < 0.6) type = 'tank';
      else if (can('cycle') && f.energy >= UNIT_TYPES.cycle.cost) type = 'cycle';
      if (!type || !this.build(fid, type)) break;
      acted = true;
    }
    if (acted) this.markActed(fid);
  }

  // ----- planning input & ghosts -----

  onPickPlan(hit) {
    this.audio.init();
    if (hit && hit.unitId != null) {
      const unit = this.unitById(hit.unitId);
      if (!unit || !unit.alive) return;
      if (unit.side === this.planning) {
        this.select(unit === this.selected ? null : unit);
      } else {
        const u = this.selected;
        if (u && u.side === this.planning && this._planCanAttack(u, unit.id)) {
          const o = this.orders.get(u.id) || {};
          o.attackId = (o.attackId === unit.id) ? null : unit.id;
          this.orders.set(u.id, o);
          this.markActed(this.planning);
          this.audio.blip(940);
          this.drawGhosts();
          this.ui.showUnit(u, this);
        } else {
          this.ui.showUnit(unit, this);
          if (u) this.audio.uiDeny();
        }
      }
      return;
    }
    if (hit && hit.cellKey) {
      const u = this.selected;
      if (u && u.side === this.planning && this.destsMap && this.destsMap.has(hit.cellKey)) {
        const o = this.orders.get(u.id) || {};
        o.dest = hit.cellKey;
        o.path = this.getPath(hit.cellKey);
        // drop an attack order no longer reachable from the new destination
        if (o.attackId != null && !this._planCanAttack(u, o.attackId)) o.attackId = null;
        this.orders.set(u.id, o);
        this.markActed(this.planning);
        this.audio.blip(620);
        this.refreshPlanHighlights(u);
        this.drawGhosts();
        return;
      }
    }
    this.select(null);
  }

  _planCanAttack(u, targetId) {
    const t = this.unitById(targetId);
    if (!t || !t.alive || !this.isHostile(t.side, u.side)) return false;
    const o = this.orders.get(u.id);
    let q = u.q, r = u.r;
    if (o && o.dest) { const p = parseKey(o.dest); q = p.q; r = p.r; }
    return this.targetsInRange(u, q, r, { freeTurret: u.type === 'tank' }).includes(t);
  }

  refreshPlanHighlights(u) {
    this.clearHighlights();
    this.destsMap = null; this.getPath = null;
    if (!u || u.side !== this.planning || u.type === 'core') return;
    const { dests, getPath } = this.validDestinations(u, { avoidTrails: true });
    this.destsMap = dests; this.getPath = getPath;
    for (const k of dests.keys()) {
      const hl = this.highlights.get(k);
      hl.material.color.setHex(0x2bd9ff); hl.material.opacity = 0.16; hl.visible = true;
    }
    const o = this.orders.get(u.id);
    let fq = u.q, fr = u.r;
    if (o && o.dest) {
      const p = parseKey(o.dest); fq = p.q; fr = p.r;
      const hl = this.highlights.get(o.dest);
      if (hl) { hl.material.color.setHex(0xffffff); hl.material.opacity = 0.5; hl.visible = true; }
    }
    for (const t of this.targetsInRange(u, fq, fr, { freeTurret: u.type === 'tank' })) {
      const hl = this.highlights.get(key(t.q, t.r));
      if (hl) { hl.material.color.setHex(0xff3322); hl.material.opacity = 0.4; hl.visible = true; }
    }
    const own = this.highlights.get(key(u.q, u.r));
    if (own) { own.material.color.setHex(0x88ccff); own.material.opacity = 0.3; own.visible = true; }
  }

  clearGhosts() {
    if (!this.ghostGroup) return;
    for (const m of [...this.ghostGroup.children]) {
      this.ghostGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    }
  }

  drawGhosts() {
    if (!this.ghostGroup) { this.ghostGroup = new THREE.Group(); this.scene.add(this.ghostGroup); }
    this.clearGhosts();
    if (this.planning == null) return;
    for (const u of this.aliveUnits(this.planning)) {
      const o = this.orders.get(u.id);
      if (!o) continue;
      const f = this.factionOf(u);
      let aq = u.q, ar = u.r;
      if (o.dest) {
        const p = parseKey(o.dest); aq = p.q; ar = p.r;
        const w = hexToWorld(aq, ar);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.45, 0.045, 8, 24),
          new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.rotation.x = Math.PI / 2; ring.position.set(w.x, 0.12, w.z);
        this.ghostGroup.add(ring);
        this._ghostLine(hexToWorld(u.q, u.r), w, f.color, 0.35);
      }
      if (o.attackId != null) {
        const t = this.unitById(o.attackId);
        if (t && t.alive) this._ghostLine(hexToWorld(aq, ar), hexToWorld(t.q, t.r), 0xff4433, 0.6);
      }
    }
  }

  _ghostLine(a, b, color, opacity) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, len),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set((a.x + b.x) / 2, 0.2, (a.z + b.z) / 2);
    m.lookAt(b.x, 0.2, b.z);
    this.ghostGroup.add(m);
  }

  // ----- simultaneous resolution -----

  // Run fn on each item staggered by `step` seconds, so the animations ripple
  // out in a chain (explosions popping like firecrackers) rather than all at
  // once. Still resolves when every item has finished.
  _chain(items, step, fn) {
    return Promise.all(items.map((it, i) =>
      this.fx.wait(i * step).then(() => fn(it, i))));
  }

  async resolveSim() {
    this.busy = true;
    this.select(null);
    this.clearGhosts();
    this.clearHighlights();
    this.ui.showBanner('EXECUTING ORDERS', '#bfe9ff', 1300);
    await this.fx.wait(0.5);

    // 1) resolve destinations with collision avoidance (initiative priority)
    const claimed = new Map(); // final cell -> unitId
    for (const u of this.aliveUnits()) claimed.set(key(u.q, u.r), u.id);
    const movers = [];
    const moverUnits = [];
    for (const fid of this.order) {
      for (const u of this.aliveUnits(fid)) {
        const o = this.orders.get(u.id);
        if (o && o.path && o.path.length) moverUnits.push(u);
      }
    }
    for (const u of moverUnits) {
      const o = this.orders.get(u.id);
      claimed.delete(key(u.q, u.r)); // vacate the start cell
      let take = null;
      for (let i = o.path.length - 1; i >= 0; i--) {
        const ck = key(o.path[i].q, o.path[i].r);
        if (!claimed.has(ck)) { take = i; break; }
      }
      if (take != null) {
        const fp = o.path.slice(0, take + 1);
        claimed.set(key(fp[fp.length - 1].q, fp[fp.length - 1].r), u.id);
        movers.push({ unit: u, path: fp });
      } else {
        claimed.set(key(u.q, u.r), u.id); // nowhere to go, stay
      }
    }

    // 2) move units out in a quick ripple
    if (movers.length) this.audio.engine(1.0, 1, 'cycle');
    const moveStep = Math.min(0.07, 1.0 / Math.max(1, movers.length));
    await this._chain(movers, moveStep, (m) => this._simMove(m.unit, m.path));

    // 3) compute all attacks from final positions, then apply damage together
    const dmg = new Map(); // targetId -> { total, top:{side,dmg} }
    const visuals = [];
    for (const fid of this.order) {
      for (const u of this.aliveUnits(fid)) {
        const o = this.orders.get(u.id);
        if (!o || o.attackId == null) continue;
        const t = this.unitById(o.attackId);
        if (!t || !t.alive || !this._simInRange(u, t)) continue;
        const { mult, label } = this.damageMultiplier(
          u.mesh.position.x, u.mesh.position.z, t);
        const topBonus = (t.type === 'reco' && t.altitude === 'top') ? TOP_DMG_BONUS : 0;
        const d = Math.max(1, Math.round(UNIT_TYPES[u.type].dmg * mult) + topBonus);
        const rec = dmg.get(t.id) || { total: 0, top: { side: u.side, dmg: 0 } };
        rec.total += d;
        if (d > rec.top.dmg) rec.top = { side: u.side, dmg: d };
        dmg.set(t.id, rec);
        visuals.push({ u, t, d, label, mult });
      }
    }
    // fire the attacks in a chain — explosions cascade like firecrackers
    const atkStep = Math.min(0.2, 2.4 / Math.max(1, visuals.length));
    await this._chain(visuals, atkStep, (v) => this._simAttackVisual(v));

    // damage is still resolved as a batch (so mutual kills happen), but the
    // structure loss and the derez explosions ripple out one after another
    const dead = [];
    for (const [tid, rec] of dmg) {
      const t = this.unitById(tid);
      if (!t || !t.alive) continue;
      t.hp -= rec.total;
      t.bar.update(Math.max(0, t.hp / t.maxHp));
      if (t.hp <= 0) dead.push({ t, killer: rec.top.side });
      else this._lowerRecoAltitude(t); // struck recognizers drop a level
    }
    const derezStep = Math.min(0.28, 2.0 / Math.max(1, dead.length));
    await this._chain(dead, derezStep, ({ t, killer }) => this._simDerez(t, killer));
    this.ui.updateScorecard(this);
    this.checkVictory();
  }

  async _simMove(unit, path) {
    if (!path.length) return;
    const f = this.factionOf(unit);

    // Cycles lay a single smooth CatmullRom wall through the WHOLE path and drive
    // along it — exactly like sequential _driveCycle — instead of a string of
    // straight per-step segments (which is why sim-mode walls used to be straight).
    if (unit.type === 'cycle') {
      const trail = { side: unit.side, owner: unit.id, cells: new Set(), path: [], walls: [] };
      this.trails.push(trail);
      const fw = unit.mesh.getWorldDirection(new THREE.Vector3());
      fw.y = 0; fw.normalize();
      const startP = unit.mesh.position.clone().setY(0);
      const pts = [startP.clone().addScaledVector(fw, -0.9), startP]; // phantom lead-in for a natural first corner
      for (const s of path) { const { x, z } = hexToWorld(s.q, s.r); pts.push(new THREE.Vector3(x, 0, z)); }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.55);
      const spans = pts.length - 1;
      const t0 = 1 / spans; // skip the phantom lead-in span
      const tAt = (u) => t0 + u * (1 - t0);
      const wave = this._wallWave(unit);
      const ribbon = this.fx.trailRibbon(curve, f.color, pts.length * 10, t0, wave);
      ribbon._build = { type: 'curve', pts: pts.map((p) => [r3(p.x), r3(p.z)]),
        samples: pts.length * 10, tStart: t0, wave, reveal: 0 };
      trail.walls.push(ribbon);
      const segs = path.length;
      const look = new THREE.Vector3();
      for (let i = 0; i < segs; i++) {
        const k0 = i / segs, k1 = (i + 1) / segs;
        await this.fx.tween(0.12, (k) => {
          const u = k0 + (k1 - k0) * k;
          curve.getPoint(tAt(u), unit.mesh.position);
          curve.getTangent(tAt(u), look).add(unit.mesh.position);
          unit.mesh.lookAt(look.x, unit.mesh.position.y, look.z);
          ribbon.reveal(u - 0.7 / segs);
          if (unit.mesh.userData.wheels) {
            for (const w of unit.mesh.userData.wheels) w.rotation.x += 0.5;
          }
        });
        trail.cells.add(key(unit.q, unit.r)); // the cell just vacated
        trail.path.push(key(unit.q, unit.r));
        unit.q = path[i].q; unit.r = path[i].r;
      }
      ribbon.reveal(1);
      ribbon._build.reveal = 1;
      return;
    }

    // Non-cycles: straight per-step hops (tanks breach walls along the way).
    const isFly = UNIT_TYPES[unit.type].fly;
    for (const step of path) {
      const { x, z } = hexToWorld(step.q, step.r);
      const cell = this.cells.get(key(step.q, step.r));
      const destY = unit.baseY + TERRAIN_Y[cell.terrain];
      const dest = new THREE.Vector3(x, destY, z);
      const hop = isFly ? (isRough(cell.terrain) ? 0.5 : 0.12) : 0;
      unit.mesh.lookAt(dest.x, unit.mesh.position.y, dest.z);
      const from = unit.mesh.position.clone();
      await this.fx.tween(0.16, (k) => {
        unit.mesh.position.lerpVectors(from, dest, k);
        unit.mesh.position.y += Math.sin(k * Math.PI) * hop;
        if (unit.mesh.userData.wheels) {
          for (const w of unit.mesh.userData.wheels) w.rotation.x += 0.5;
        }
      });
      unit.q = step.q; unit.r = step.r;
      if (unit.type === 'tank') this.breachWalls(step.q, step.r);
    }
  }

  _simInRange(u, t) {
    const def = UNIT_TYPES[u.type];
    if (!def.range) return false;
    const range = def.range + (u.type === 'reco' ? this.altLevel(u) : 0);
    if (hexDistance(u, t) > range) return false;
    if (u.type === 'cycle' && this.recoRaised(t)) return false;
    return true; // tank turret arc ignored in simultaneous mode
  }

  async _simAttackVisual({ u, t, d, label, mult }) {
    const def = UNIT_TYPES[u.type];
    const f = this.factionOf(u);
    const targetPos = t.mesh.position.clone();
    targetPos.y += t.type === 'reco' ? 1.0 : 0.45;
    const health = Math.max(0.1, u.hp / u.maxHp);
    if (def.attack === 'rocket' && u.mesh.userData.turret) {
      const ang = this.turretAngleTo(u, t);
      u.mesh.userData.turret.rotation.y = ang;
      u.mesh.updateMatrixWorld();
      const from = u.mesh.userData.turret.localToWorld(u.mesh.userData.muzzleLocal.clone());
      this.fx.flash(from, f.color, 5, 0.2, 5);
      await this.fx.rocket(from, targetPos, f.color, health);
      this.fx.explosion(targetPos, f.color, 1.3);
    } else if (def.attack === 'laser') {
      u.mesh.lookAt(targetPos.x, u.mesh.position.y, targetPos.z);
      const from = u.mesh.localToWorld(u.mesh.userData.headLocal.clone());
      await this.fx.laserBeam(from, targetPos, f.color, health);
      this.fx.explosion(targetPos, f.color, 0.7);
    } else { // cycle dash
      const home = u.mesh.position.clone();
      const strike = targetPos.clone(); strike.y = u.baseY;
      const dir = new THREE.Vector3().subVectors(home, strike).normalize().multiplyScalar(0.55);
      strike.add(dir);
      this.audio.engine(0.4, health, 'cycle');
      await this.fx.tween(0.18, (k) => u.mesh.position.lerpVectors(home, strike, k));
      this.fx.slash(targetPos, f.color, health);
      this.fx.explosion(targetPos, f.color, 0.55);
      await this.fx.tween(0.18, (k) => u.mesh.position.lerpVectors(strike, home, k));
    }
    const tp = t.mesh.position.clone(); tp.y += HEALTHBAR_Y[t.type] + 0.25;
    this.fx.floatText(tp, '-' + d + (label ? '  ' + label : ''),
      mult > 1 ? '#ff5544' : mult < 1 ? '#9ab4c4' : '#ffffff');
  }

  async _simDerez(t, killerSide) {
    t.alive = false;
    this.ui.explodeTargetIf(t);
    if (t.type === 'jet') this.clearTrailsOfOwner(t.id);
    if (t.type === 'cycle') { this.clearTrailsOfOwner(t.id); this.breakConquestBy(t.id); }
    if (killerSide != null && this.isHostile(killerSide, t.side)) {
      const k = this.factions[killerSide];
      k.score += (UNIT_TYPES[t.type].cost || 20) * 10;
    }
    const idx = this.pickMeshes.indexOf(t.mesh);
    if (idx >= 0) this.pickMeshes.splice(idx, 1);
    const f = this.factionOf(t);
    const pos = t.mesh.position.clone(); pos.y += 0.4;
    const box = new THREE.Box3().setFromObject(t.mesh);
    const scale = Math.min(2.4, Math.max(0.7, box.getSize(this._v1).length() * 0.55));
    const done = this.fx.derez(t.mesh, f.color);
    this.scene.remove(t.mesh);
    this._disposeMesh(t.mesh);
    this.fx.explosion(pos, f.color, t.type === 'core' ? 2.2 : scale);
    await done;
  }
  // =================== end simultaneous mode ===================

  playerHasActions() {
    const f = this.factions[this.current];
    const core = this.coreOf(f.id);
    if (core && f.energy >= this.cheapestCost() && this.findSpawnCell(core)) {
      return true;
    }
    for (const u of this.aliveUnits(f.id)) {
      if (u.type === 'core') continue;
      if (!u.attacked && this.targetsInRange(u, u.q, u.r,
          { freeTurret: u.type === 'tank' }).length) return true;
      if (this.canMoveNow(u) && this.validDestinations(u).dests.size) return true;
    }
    return false;
  }

  maybeAutoEnd() {
    if (this.simultaneous) return; // commit is always manual in WeGo mode
    if (this.busy || this.over || !this.isMyTurn()) return;
    if (this.perUnitInit) {
      // the active unit auto-passes once it has no move or attack left
      const u = this._activeUnit;
      if (u && u.alive && !this._unitHasActions(u)) {
        setTimeout(() => this.endPlayerTurn(), 750);
      }
      return;
    }
    if (this.playerHasActions()) return;
    this.ui.showBanner('NO ACTIONS LEFT', this.factions[this.current].css, 1000);
    // cancellable: an UNDO during this window restores actions and aborts it
    clearTimeout(this._autoEndTimer);
    this._autoEndTimer = setTimeout(() => {
      if (this.playerHasActions()) return; // an undo gave actions back
      this.endPlayerTurn();
    }, 1100);
  }

  selectNextReady() {
    if (this.busy || this.over || !this.config || !this.isMyTurn()) return;
    if (this.perUnitInit) { if (this._activeUnit) this.select(this._activeUnit); return; }
    this.audio.init();
    const ready = this.aliveUnits(this.current)
      .filter((u) => u.type !== 'core' && !this.isDone(u));
    if (!ready.length) { this.audio.uiDeny(); return; }
    const idx = ready.indexOf(this.selected);
    const next = ready[(idx + 1) % ready.length];
    this.select(next);
    if (this.onFocus) this.onFocus(next);
  }

  // ---------- per-frame idle animation ----------

  // How much side-to-side ripple a cycle bakes into the wall it's laying —
  // none at full structure, more as it takes damage.
  _wallWave(unit) {
    const dmg = unit && unit.hp < unit.maxHp ? 1 - unit.hp / unit.maxHp : 0;
    return dmg > 0 ? 0.16 * dmg : 0;
  }

  // Roll a unit a little around its own forward axis to show a damage shudder.
  // Done with quaternions on top of a stored rest pose — setting `.rotation.z`
  // directly is unsafe because lookAt can leave a gimbal-flipped Euler
  // (e.g. (−π, yaw, −π)), so overwriting z would flip the whole model.
  _damageWobble(u, amp, freq, t) {
    if (!u._wobBase) u._wobBase = new THREE.Quaternion();
    // while anything is animating (moves, attacks) the live orientation is the
    // true rest pose — capture it and don't fight the motion
    if (this.busy || amp <= 0) { u._wobBase.copy(u.mesh.quaternion); return; }
    if (!this._qRoll) this._qRoll = new THREE.Quaternion();
    if (!this._fwdAxis) this._fwdAxis = new THREE.Vector3(0, 0, 1);
    this._qRoll.setFromAxisAngle(this._fwdAxis, Math.sin(t * freq + u.id * 2.1) * amp);
    u.mesh.quaternion.copy(u._wobBase).multiply(this._qRoll);
  }

  updateIdle(t) {
    const dt = this._lastIdleT != null ? Math.min(0.05, t - this._lastIdleT) : 0.016;
    this._lastIdleT = t;
    const ringsOn = this.isMyTurn() && !this.busy && !this.over;
    for (const u of this.units) {
      if (!u.alive) continue;
      const ud = u.mesh.userData;
      if (u.type === 'core') u.mesh.rotation.y = t * 0.18; // cores rotate slowly
      if (ud.inner) { // recognizer hover bob — slow, heavy float
        ud.inner.position.y = Math.sin(t * 1.1 + u.id) * 0.08;
        if (ud.head) ud.head.rotation.y = t * 0.8;
        this._damageWobble(u, this.isCrippled(u) ? 0.08 : 0, 4.6, t);
      }
      // a damaged light cycle sways gently — heavier as its structure fails
      if (u.type === 'cycle') {
        const dmg = u.hp < u.maxHp ? 1 - u.hp / u.maxHp : 0;
        this._damageWobble(u, 0.09 * dmg, 6, t);
      }
      if (ud.spin) ud.spin.rotation.y = t * 0.4; // MCP drum
      if (ud.beam) { // I/O tower beam pulse
        ud.beam.material.opacity = 0.25 + Math.sin(t * 2.2) * 0.12;
      }
      if (u.readyRing) {
        u.readyRing.visible = ringsOn && u.side === this.current && !this.isDone(u);
        if (u.readyRing.visible) {
          u.readyRing.material.opacity = 0.18 + 0.15 * (1 + Math.sin(t * 3.2 + u.id)) / 2;
        }
      }
    }
    for (const m of this.healMats) {
      m.opacity = 0.45 + Math.sin(t * 2.6) * 0.25;
    }
    // drift the heal-pad motes slowly upward, recycling at the top
    for (const s of this.healStreams) {
      const arr = s.geo.attributes.position.array;
      for (let i = 0; i < s.count; i++) {
        arr[i * 3 + 1] += s.speeds[i] * dt;
        if (arr[i * 3 + 1] > s.height) {
          arr[i * 3 + 1] = 0;
          arr[i * 3] = (Math.random() - 0.5) * 1.1;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 1.1;
        }
      }
      s.geo.attributes.position.needsUpdate = true;
    }
  }
}
