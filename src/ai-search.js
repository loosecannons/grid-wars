// Bounded-lookahead AI (levels 2-5). A literal full N-turn minimax is infeasible
// here (each faction moves many units, each with many move+attack options), so
// this searches a PRUNED, abstract model: one unit's action per ply, a small
// beam of the best candidate actions, alpha-beta, and a hard node budget. It
// guides which move/target the real (greedy) AI commits to — the actual action
// is still executed and re-validated on the live engine, so the game stays exact.
//
// The model deliberately approximates: positions, HP, kills, reachability over
// real terrain, and core pressure — the dominant tactical signals. It ignores
// facing/focus/walls/slides/conquest nuance (the live execution handles those).
import { hexDistance } from './hex.js';
import { UNIT_TYPES } from './constants.js';

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const TYPE_VALUE = { core: 1000, reco: 14, tank: 11, jet: 8, cycle: 5 };

// search breadth/depth per AI level (1 = no search; handled by the greedy AI)
const PLAN = {
  2: { depth: 2, beam: 6, budget: 4000 },
  3: { depth: 3, beam: 6, budget: 9000 },
  4: { depth: 4, beam: 5, budget: 16000 },
  5: { depth: 5, beam: 5, budget: 26000 },
};

// Snapshot the live game into a cheap, mutable model.
function snapshot(game) {
  const cells = game.cells;
  const units = [];
  for (const u of game.units) {
    if (!u.alive) continue;
    const d = UNIT_TYPES[u.type];
    units.push({
      id: u.id, side: u.side, type: u.type, q: u.q, r: u.r,
      hp: u.hp, maxHp: u.maxHp, move: d.move, range: d.range, dmg: d.dmg, fly: d.fly,
    });
  }
  return {
    units,
    radius: game.config.radius,
    terr: (q, r) => { const c = cells.get(q + ',' + r); return c ? c.terrain : null; },
    hostile: (a, b) => game.isHostile(a, b),
  };
}

function clone(s) {
  return { units: s.units.map((u) => ({ ...u })), radius: s.radius, terr: s.terr, hostile: s.hostile };
}

// BFS reachable cells (incl. staying put) within a unit's move, over real
// terrain, blocked by other units; rough terrain costs 2 and bars ground units.
function reachable(state, unit) {
  const occ = new Set();
  for (const u of state.units) if (u.id !== unit.id) occ.add(u.q + ',' + u.r);
  const startK = unit.q + ',' + unit.r;
  const dist = new Map([[startK, 0]]);
  const frontier = [{ q: unit.q, r: unit.r, c: 0 }];
  while (frontier.length) {
    let bi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i].c < frontier[bi].c) bi = i;
    const cur = frontier.splice(bi, 1)[0];
    if (cur.c >= unit.move) continue;
    for (const [dq, dr] of DIRS) {
      const nq = cur.q + dq, nr = cur.r + dr, nk = nq + ',' + nr;
      const t = state.terr(nq, nr);
      if (t == null || occ.has(nk)) continue;
      const rough = t === 'hole' || t === 'high';
      if (rough && !unit.fly) continue;
      const nc = cur.c + (rough ? 2 : 1);
      if (nc > unit.move) continue;
      if (!dist.has(nk) || nc < dist.get(nk)) { dist.set(nk, nc); frontier.push({ q: nq, r: nr, c: nc }); }
    }
  }
  const out = [];
  for (const [k, c] of dist) { const [q, r] = k.split(',').map(Number); out.push({ q, r, cost: c }); }
  return out;
}

function enemyTargetsFrom(state, unit, q, r) {
  const res = [];
  for (const e of state.units) {
    if (!state.hostile(unit.side, e.side)) continue;
    if (hexDistance({ q, r }, e) <= unit.range) res.push(e);
  }
  return res;
}

// Candidate single-unit actions for whichever team is to move, pruned to `beam`
// by an immediate heuristic. `friendlyOfAi(side)` decides team membership.
function genActions(state, friendlyOfAi, wantFriendly, beam) {
  const enemies = state.units.filter((u) => (friendlyOfAi(u.side) !== wantFriendly));
  if (!enemies.length) return [];
  const acts = [];
  for (const unit of state.units) {
    if (unit.type === 'core' || unit.range === 0) continue;
    if (friendlyOfAi(unit.side) !== wantFriendly) continue;
    const cells = reachable(state, unit);
    let bestAdv = null, bestAdvScore = -1e9;
    for (const c of cells) {
      for (const t of enemyTargetsFrom(state, unit, c.q, c.r)) {
        let sc = unit.dmg + (t.hp <= unit.dmg ? 50 : 0) + (t.type === 'core' ? 20 : 0)
          + (t.maxHp - t.hp) * 0.3 - c.cost * 0.1;
        acts.push({ unitId: unit.id, q: c.q, r: c.r, targetId: t.id, score: sc });
      }
      const dmin = Math.min(...enemies.map((e) => hexDistance(c, e)));
      const adv = -dmin - c.cost * 0.05;
      if (adv > bestAdvScore) { bestAdvScore = adv; bestAdv = { unitId: unit.id, q: c.q, r: c.r, targetId: null, score: adv * 0.4 }; }
    }
    if (bestAdv) acts.push(bestAdv);
  }
  acts.sort((a, b) => b.score - a.score);
  return acts.slice(0, beam);
}

export function applyAction(state, act) {
  const ns = clone(state);
  const u = ns.units.find((x) => x.id === act.unitId);
  if (!u) return ns;
  u.q = act.q; u.r = act.r;
  if (act.targetId != null) {
    const t = ns.units.find((x) => x.id === act.targetId);
    if (t) { t.hp -= u.dmg; if (t.hp <= 0) ns.units = ns.units.filter((x) => x.id !== t.id); }
  }
  return ns;
}

// Static value of a position from the AI team's perspective.
function evaluate(state, friendlyOfAi) {
  let score = 0;
  const cores = state.units.filter((u) => u.type === 'core');
  let myCore = false, foeCore = false;
  for (const u of state.units) {
    const mine = friendlyOfAi(u.side);
    const v = (TYPE_VALUE[u.type] || 5) + u.hp;
    score += mine ? v : -v;
    if (u.type === 'core') { if (mine) myCore = true; else foeCore = true; }
    else {
      for (const core of cores) {
        if (state.hostile(u.side, core.side) && hexDistance(u, core) <= 3) {
          const pressure = (4 - hexDistance(u, core)) * 1.5;
          score += (friendlyOfAi(u.side) ? pressure : -pressure);
        }
      }
    }
  }
  if (!myCore) score -= 5000;   // losing your core is losing
  if (!foeCore) score += 5000;  // taking theirs is winning
  return score;
}

// Minimax (alpha-beta) on the abstract model: AI team maximises, enemies minimise.
function search(state, friendlyOfAi, maximizing, depth, alpha, beta, beam, ctx) {
  if (depth === 0 || ctx.nodes >= ctx.budget) return evaluate(state, friendlyOfAi);
  const acts = genActions(state, friendlyOfAi, maximizing, beam);
  if (!acts.length) return evaluate(state, friendlyOfAi);
  let best = maximizing ? -Infinity : Infinity;
  for (const a of acts) {
    ctx.nodes++;
    const v = search(applyAction(state, a), friendlyOfAi, !maximizing, depth - 1, alpha, beta, beam, ctx);
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (beta <= alpha || ctx.nodes >= ctx.budget) break;
  }
  return best;
}

// Score how good a position is for `side` AFTER it commits `action`, by looking
// ahead `level` plies (opponent best reply, our follow-up, ...). Returns a number
// — higher is better for `side`. Used to re-rank a unit's candidate actions.
export function lookaheadValue(game, side, modelAction, level) {
  const plan = PLAN[level] || PLAN[5];
  const friendlyOfAi = (s) => !game.isHostile(side, s);
  const root = snapshot(game);
  const after = modelAction ? applyAction(root, modelAction) : root;
  const ctx = { nodes: 0, budget: plan.budget };
  // it's the enemy's move next (we just acted)
  return search(after, friendlyOfAi, false, plan.depth - 1, -Infinity, Infinity, plan.beam, ctx);
}

export { snapshot };
