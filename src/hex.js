// Axial hex coordinates, pointy-top orientation.
export const HEX_SIZE = 1.0;

export const DIRS = [
  [1, 0], [1, -1], [0, -1],
  [-1, 0], [-1, 1], [0, 1],
];

export function key(q, r) {
  return q + ',' + r;
}

export function hexToWorld(q, r) {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    z: HEX_SIZE * 1.5 * r,
  };
}

export function hexDistance(a, b) {
  return (
    Math.abs(a.q - b.q) +
    Math.abs(a.r - b.r) +
    Math.abs(a.q + a.r - b.q - b.r)
  ) / 2;
}

// Generate a hex-shaped map of given radius. Cells: { q, r, blocked }
export function generateMap(radius) {
  const cells = new Map();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      cells.set(key(q, r), { q, r, blocked: false });
    }
  }
  return cells;
}

export function cellsInRange(cells, q, r, range) {
  const out = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) > range) continue;
      if (dq === 0 && dr === 0) continue;
      const k = key(q + dq, r + dr);
      if (cells.has(k)) out.push(cells.get(k));
    }
  }
  return out;
}

// Dijkstra flood-fill of reachable cells within movePts movement points.
// costFn(q, r) returns the cost of ENTERING a cell, or Infinity if impassable
// (rough terrain like pits and plateaus costs flying units 2 instead of 1).
// Returns Map of key -> { cost, prev } (includes the start at cost 0).
export function reachable(cells, costFn, start, movePts) {
  const startKey = key(start.q, start.r);
  const visited = new Map([[startKey, { cost: 0, prev: null }]]);
  const frontier = [{ q: start.q, r: start.r, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    const curKey = key(cur.q, cur.r);
    if (cur.cost > visited.get(curKey).cost) continue; // stale entry
    for (const [dq, dr] of DIRS) {
      const nq = cur.q + dq, nr = cur.r + dr;
      if (!cells.has(key(nq, nr))) continue;
      const step = costFn(nq, nr);
      if (!isFinite(step)) continue;
      const nc = cur.cost + step;
      if (nc > movePts) continue;
      const k = key(nq, nr);
      const seen = visited.get(k);
      if (seen && seen.cost <= nc) continue;
      visited.set(k, { cost: nc, prev: curKey });
      frontier.push({ q: nq, r: nr, cost: nc });
    }
  }
  return visited;
}

// Reconstruct a path (list of "q,r" keys, start excluded) from a reachable() map.
export function pathTo(reachMap, destKey) {
  const path = [];
  let k = destKey;
  while (k && reachMap.get(k).prev !== null) {
    path.unshift(k);
    k = reachMap.get(k).prev;
  }
  return path;
}

export function parseKey(k) {
  const [q, r] = k.split(',').map(Number);
  return { q, r };
}

// ---------- direction helpers (for light cycle momentum) ----------

// World-space direction vector of each hex direction.
export const DIR_VECTORS = DIRS.map(([dq, dr]) => {
  const x = Math.sqrt(3) * (dq + dr / 2);
  const z = 1.5 * dr;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
});

// Index of the hex direction closest to a world-space vector.
export function dirFromVector(dx, dz) {
  let bestI = 0, bestDot = -Infinity;
  DIR_VECTORS.forEach((v, i) => {
    const dot = dx * v.x + dz * v.z;
    if (dot > bestDot) { bestDot = dot; bestI = i; }
  });
  return bestI;
}

// Angular difference between two direction indices: 0 (straight) .. 3 (reversal).
export function turnDelta(a, b) {
  const d = Math.abs(a - b) % 6;
  return d > 3 ? 6 - d : d;
}

// Light cycles carry velocity BETWEEN turns. Internal scale 1..6
// (1-2 SLOW, 3-4 CRUISE, 5-6 FAST). Straight steps accelerate +1; gentle
// 60° turns hold speed but are impossible at FAST (v>4); extreme 120°
// curves (cost +1) demand SLOW (v<=2) and brake hard; reversing is never
// possible. The search runs over (cell, heading, velocity) states.
export function reachableCycle(cells, costFn, start, startDir, movePts, startV = 1) {
  const states = new Map();   // "q,r,dir,v" -> { cost, prev, q, r }
  const cellBest = new Map(); // "q,r"       -> { cost, sk } cheapest state per cell
  const sk0 = `${start.q},${start.r},${startDir},${startV}`;
  states.set(sk0, { cost: 0, prev: null, q: start.q, r: start.r });
  const frontier = [{
    sk: sk0, q: start.q, r: start.r, d: startDir, v: startV, cost: 0,
  }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    if (cur.cost > states.get(cur.sk).cost) continue;
    for (let nd = 0; nd < 6; nd++) {
      const turn = turnDelta(cur.d, nd);
      if (turn >= 3) continue;                 // no U-turns, ever
      if (turn === 2 && cur.v > 2) continue;   // extreme curves need SLOW
      if (turn === 1 && cur.v > 4) continue;   // no turning at all when FAST
      const tCost = turn === 2 ? 1 : 0;
      const nq = cur.q + DIRS[nd][0], nr = cur.r + DIRS[nd][1];
      if (!cells.has(key(nq, nr))) continue;
      const step = costFn(nq, nr);
      if (!isFinite(step)) continue;
      const nc = cur.cost + step + tCost;
      if (nc > movePts) continue;
      // straights accelerate, gentle turns hold speed, hard turns brake
      const nv = turn === 0 ? Math.min(6, cur.v + 1) : turn === 1 ? cur.v : 1;
      const sk = `${nq},${nr},${nd},${nv}`;
      const seen = states.get(sk);
      if (seen && seen.cost <= nc) continue;
      states.set(sk, { cost: nc, prev: cur.sk, q: nq, r: nr });
      frontier.push({ sk, q: nq, r: nr, d: nd, v: nv, cost: nc });
      const ck = key(nq, nr);
      const cb = cellBest.get(ck);
      if (!cb || nc < cb.cost) cellBest.set(ck, { cost: nc, sk });
    }
  }
  return { states, cellBest };
}

// Light jets streak across the Grid and can't pivot on a dime: each cell they
// may hold heading or bank 60° to an adjacent direction, but never swing 120°+
// (a hairpin) and never bank two cells running — they must fly at least one
// cell straight between banks. That floors their turning radius, so they sweep
// in wide arcs instead of zig-zagging. Search over (cell, heading, sinceTurn).
export function reachableJet(cells, costFn, start, startDir, movePts) {
  const STRAIGHT_BETWEEN = 1; // cells flown straight between successive banks
  const states = new Map();   // "q,r,dir,s" -> { cost, prev, q, r }
  const cellBest = new Map(); // "q,r"        -> { cost, sk }
  const sk0 = `${start.q},${start.r},${startDir},${STRAIGHT_BETWEEN}`;
  states.set(sk0, { cost: 0, prev: null, q: start.q, r: start.r });
  const frontier = [{
    sk: sk0, q: start.q, r: start.r, d: startDir, s: STRAIGHT_BETWEEN, cost: 0,
  }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    if (cur.cost > states.get(cur.sk).cost) continue;
    for (let nd = 0; nd < 6; nd++) {
      const turn = turnDelta(cur.d, nd);
      if (turn >= 2) continue;                          // no 120°+ hairpins or reversals
      if (turn === 1 && cur.s < STRAIGHT_BETWEEN) continue; // a straight run is owed first
      const nq = cur.q + DIRS[nd][0], nr = cur.r + DIRS[nd][1];
      if (!cells.has(key(nq, nr))) continue;
      const step = costFn(nq, nr);
      if (!isFinite(step)) continue;
      const nc = cur.cost + step;
      if (nc > movePts) continue;
      const ns = turn === 0 ? Math.min(STRAIGHT_BETWEEN, cur.s + 1) : 0;
      const sk = `${nq},${nr},${nd},${ns}`;
      const seen = states.get(sk);
      if (seen && seen.cost <= nc) continue;
      states.set(sk, { cost: nc, prev: cur.sk, q: nq, r: nr });
      frontier.push({ sk, q: nq, r: nr, d: nd, s: ns, cost: nc });
      const ck = key(nq, nr);
      const cb = cellBest.get(ck);
      if (!cb || nc < cb.cost) cellBest.set(ck, { cost: nc, sk });
    }
  }
  return { states, cellBest };
}

// Path of {q,r} cells (start excluded) to a destination from reachableCycle().
export function cyclePath(result, destKey) {
  const cb = result.cellBest.get(destKey);
  if (!cb) return [];
  const path = [];
  let sk = cb.sk;
  while (sk) {
    const st = result.states.get(sk);
    if (st.prev === null) break;
    path.unshift({ q: st.q, r: st.r });
    sk = st.prev;
  }
  return path;
}
