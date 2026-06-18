// Selectable faction colours — picking a colour picks your side.
export const COLOR_PALETTE = [
  { key: 'cyan', label: 'CYAN', color: 0x2bd9ff, css: '#2bd9ff' },
  { key: 'orange', label: 'ORANGE', color: 0xff9024, css: '#ff9024' },
  { key: 'green', label: 'GREEN', color: 0x3dff7c, css: '#3dff7c' },
  { key: 'magenta', label: 'MAGENTA', color: 0xff4bd8, css: '#ff4bd8' },
  { key: 'yellow', label: 'YELLOW', color: 0xffe14b, css: '#ffe14b' },
  { key: 'red', label: 'RED', color: 0xff5544, css: '#ff5544' },
  { key: 'purple', label: 'PURPLE', color: 0x9a6bff, css: '#9a6bff' },
  { key: 'white', label: 'WHITE', color: 0xe8f6ff, css: '#e8f6ff' },
];

export const UNIT_TYPES = {
  cycle: {
    name: 'LIGHT CYCLE',
    hp: 5, move: 4, range: 1, dmg: 3, cost: 4,
    fly: false, attack: 'dash',
    desc: 'Hit & run: may keep moving after striking',
  },
  tank: {
    name: 'BATTLE TANK',
    hp: 9, move: 2, range: 4, dmg: 4, cost: 7,
    fly: false, attack: 'rocket',
    desc: 'Heavy artillery',
  },
  reco: {
    name: 'RECOGNIZER',
    hp: 14, move: 3, range: 2, dmg: 3, cost: 10,
    fly: true, attack: 'laser',
    desc: 'Flying enforcer',
  },
  jet: {
    name: 'LIGHT JET',
    hp: 5, move: 5, range: 2, dmg: 3, cost: 6,
    fly: true, attack: 'laser',
    desc: 'Fast, fragile aerial strafer — glides over units',
  },
  core: {
    name: 'CONTROL CORE',
    hp: 24, move: 0, range: 0, dmg: 0, cost: 0,
    fly: false, attack: null,
    desc: 'Builds units — destroy to win',
  },
};

export const CHEAPEST_UNIT_COST = Math.min(
  ...Object.values(UNIT_TYPES).filter((d) => d.cost > 0).map((d) => d.cost)
);

// The four buildable units the pre-game RULES editor can tune, and which of
// their stats are editable. Pristine defaults are captured once so the editor
// always shows stock values and each game can reset before applying overrides.
export const TUNABLE_UNITS = ['cycle', 'tank', 'reco', 'jet'];
export const TUNABLE_STATS = ['hp', 'move', 'dmg', 'cost'];
export const UNIT_DEFAULTS = {};
for (const k of Object.keys(UNIT_TYPES)) {
  UNIT_DEFAULTS[k] = {};
  for (const s of TUNABLE_STATS) UNIT_DEFAULTS[k][s] = UNIT_TYPES[k][s];
}

// Reset the editable unit stats to stock, then apply any per-type overrides.
// Mutates the shared UNIT_TYPES so every read site picks up the custom values
// with no threading. Called at the start of every game (null = stock rules),
// so a custom match never leaks its values into the next one.
export function applyUnitRules(units) {
  for (const k of Object.keys(UNIT_DEFAULTS)) {
    for (const s of TUNABLE_STATS) UNIT_TYPES[k][s] = UNIT_DEFAULTS[k][s];
  }
  if (!units) return;
  for (const k of TUNABLE_UNITS) {
    const ov = units[k];
    if (!ov) continue;
    for (const s of TUNABLE_STATS) {
      const v = Number(ov[s]);
      if (Number.isFinite(v)) UNIT_TYPES[k][s] = Math.max(s === 'hp' ? 1 : 0, Math.round(v));
    }
  }
}

// Map sizes. `army` is the starting force per faction; `income` is energy per
// turn; `heals` is how many healing pads are scattered across the Grid;
// `maxPlayers` caps factions so spawn zones don't collide.
export const SIZES = {
  S: { label: 'SMALL', radius: 5, obstacles: 8, heals: 2, income: 3, maxPlayers: 3, army: { cycle: 2, tank: 1, reco: 1, jet: 1 } },
  M: { label: 'MEDIUM', radius: 7, obstacles: 15, heals: 3, income: 3, maxPlayers: 4, army: { cycle: 3, tank: 2, reco: 1, jet: 1 } },
  L: { label: 'LARGE', radius: 9, obstacles: 24, heals: 4, income: 4, maxPlayers: 6, army: { cycle: 4, tank: 3, reco: 2, jet: 2 } },
  XL: { label: 'EXTRA LARGE', radius: 12, obstacles: 38, heals: 5, income: 5, maxPlayers: 6, army: { cycle: 6, tank: 4, reco: 3, jet: 2 } },
  XXL: { label: 'GIGANTIC', radius: 18, obstacles: 88, heals: 8, income: 6, maxPlayers: 6, army: { cycle: 8, tank: 6, reco: 4, jet: 3 } },
  EPIC: { label: 'EPIC', radius: 37, obstacles: 360, heals: 16, income: 8, maxPlayers: 6, army: { cycle: 16, tank: 12, reco: 8, jet: 6 } },
  // MANIC: ~4x EPIC's area (radius 75 → 17101 hexes vs EPIC's 4219). Obstacles
  // and heal pads scale with the area; the army doubles EPIC's (the XXL→EPIC
  // step doubled too) so the unit count stays this side of playable.
  MANIC: { label: 'MANIC', radius: 75, obstacles: 1440, heals: 64, income: 10, maxPlayers: 6, army: { cycle: 32, tank: 24, reco: 16, jet: 12 } },
};

// Rotate axial coordinates by k*60° around the map centre — used to place
// each faction's formation on its own edge of the hex map.
export function rotate60(q, r, k) {
  for (let i = 0; i < ((k % 6) + 6) % 6; i++) {
    const nq = -r;
    const nr = q + r;
    q = nq; r = nr;
  }
  return { q, r };
}

// Lay out one faction's starting force along the bottom edge of a map of
// radius R. Core sits centre-bottom, recognizers and tanks beside it,
// cycles one row forward. Other factions get this layout rotated.
export function buildFormation(R, army) {
  const out = [];
  const used = new Set();

  const place = (type, r) => {
    const lo = Math.max(-R, -r - R);
    const hi = Math.min(R, -r + R);
    const c = Math.round(-r / 2);
    for (let i = 0; i <= hi - lo; i++) {
      for (const q of i === 0 ? [c] : [c + i, c - i]) {
        if (q < lo || q > hi) continue;
        const k = q + ',' + r;
        if (used.has(k)) continue;
        used.add(k);
        out.push({ type, q, r });
        return true;
      }
    }
    return false;
  };

  place('core', R);
  for (let i = 0; i < army.reco; i++) place('reco', R) || place('reco', R - 1);
  for (let i = 0; i < (army.jet || 0); i++) place('jet', R - 1) || place('jet', R);
  for (let i = 0; i < army.tank; i++) place('tank', R) || place('tank', R - 1);
  for (let i = 0; i < army.cycle; i++) place('cycle', R - 1) || place('cycle', R - 2);
  return out;
}
