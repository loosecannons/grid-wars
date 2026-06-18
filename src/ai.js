import { key, parseKey, hexDistance, hexToWorld } from './hex.js';
import { UNIT_TYPES } from './constants.js';

// The MCP commander, generalised to any faction:
// 1. every unit evaluates each move+attack combination (kills, wounded targets,
//    rear-strike flanking, focus fire, core pressure) and executes the best one;
// 2. light cycles retreat with leftover movement after striking (hit & run);
// 3. units with no target advance toward the nearest hostile;
// 4. leftover energy goes into new units rezzing in at the core.
export async function aiTakeTurn(game, sideId) {
  // act with heavy hitters first
  const order = { tank: 0, reco: 1, cycle: 2 };
  const troops = game.aliveUnits(sideId)
    .filter((u) => u.type !== 'core')
    .sort((a, b) => order[a.type] - order[b.type]);
  for (const unit of troops) {
    if (game.over) return;
    if (!unit.alive) continue;
    await aiUnitAct(game, unit);
    if (game.over) return;
    await game.fx.wait(0.35);
  }
  await aiProduce(game, sideId);
}

// Act with a single unit: a recognizer first picks a flight level, then the
// unit makes the best move+attack it can, or advances toward the enemy. Shared
// by the faction-turn AI and the per-unit-initiative AI.
export async function aiUnitAct(game, unit) {
    const def = UNIT_TYPES[unit.type];

    // recognizers pick a flight level before plotting a move — climbing changes
    // their range, cycle-immunity and ability to glide over other units
    if (unit.type === 'reco') {
      const want = desiredRecoLevel(game, unit);
      const climb = game.aiStepAltitude(unit, want);
      if (climb) await climb;
    }

    const { dests, getPath } = game.validDestinations(unit, { avoidTrails: true });

    // candidate positions: stay put, or any reachable destination
    const positions = [{ k: key(unit.q, unit.r), cost: 0 }];
    for (const [k, info] of dests) positions.push({ k, cost: info.cost });

    const fullMove = unit.type === 'cycle' && unit.movesLeft === def.move;
    const slideDeath = (k, cost) =>
      fullMove && cost >= def.move && game.predictSlide(unit, getPath(k)).dies;
    // hull facing a tank would have after moving to a candidate position —
    // the turret's limited traverse makes this matter for target selection
    // (tanks aim their turret; jets can only fire into their forward arc, so
    // the heading they would end a move on decides what they could shoot)
    const facingAfter = (k, cost) => {
      if ((unit.type !== 'tank' && unit.type !== 'jet') || cost === 0) return null;
      const p = getPath(k);
      const last = p[p.length - 1];
      const prev = p.length > 1 ? p[p.length - 2] : unit;
      const a = hexToWorld(prev.q, prev.r);
      const b = hexToWorld(last.q, last.r);
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: dx / l, z: dz / l };
    };

    const enemies = game.hostileUnits(unit.side);
    // Offensive value of FLYING a given path (jet-wall play, weights tunable):
    //  • a recognizer shears every enemy jet wall it cuts through;
    //  • a jet drops a deadly wall it can fence an enemy jet in with by skimming
    //    within one hex of it at the same altitude.
    const offenseValue = (k, cost) => {
      if (cost === 0) return 0;
      const p = getPath(k);
      if (unit.type === 'reco') return game.jetWallsCutByPath(unit, p) * 4;
      if (unit.type === 'jet') {
        let fence = 0;
        for (const e of enemies) {
          if (e.type === 'jet' && e.altitude === unit.altitude &&
              p.some((s) => hexDistance(s, e) <= 1)) fence++;
        }
        return fence * 2.5;
      }
      return 0;
    };

    let best = null;
    for (const pos of positions) {
      if (pos.cost > 0 && slideDeath(pos.k, pos.cost)) continue;
      const { q, r } = parseKey(pos.k);
      const w = hexToWorld(q, r);
      const offense = offenseValue(pos.k, pos.cost); // jet-wall play on the way in
      const arcOpts = {
        facing: facingAfter(pos.k, pos.cost),
        freeTurret: unit.type === 'tank', // it will pre-aim the turret
      };
      for (const target of game.targetsInRange(unit, q, r, arcOpts)) {
        const { mult } = game.damageMultiplier(w.x, w.z, target);
        const focus = target.focusHits || 0;
        const dmg = Math.max(1, Math.round(def.dmg * mult * (1 + 0.25 * focus)));
        let score = dmg;
        if (target.hp <= dmg) score += 50;                  // kills are gold
        score += (target.maxHp - target.hp) * 0.6;          // finish the wounded
        score += focus * 1.5;                               // gang up for the bonus
        if (target.type === 'core') score += 10;            // pressure the objective
        if (target.type === 'tank') score += 2;
        score += offense;                                   // shear / fence on the way
        score -= pos.cost * 0.15;                           // prefer not to overextend
        if (!best || score > best.score) best = { pos, target, score };
      }
      // special: a cycle next to an enemy core can channel a conquest —
      // continuing one already in progress is nearly irresistible
      if (unit.type === 'cycle') {
        for (const core of game.units) {
          if (!core.alive || core.type !== 'core' ||
              !game.isHostile(core.side, unit.side)) continue;
          if (hexDistance({ q, r }, core) !== 1) continue;
          const continuing = core.conquest && core.conquest.byCycle === unit.id;
          let score = (continuing ? 75 : 38) - pos.cost * 0.15;
          if (!best || score > best.score) {
            best = { pos, target: core, score, special: 'conquer' };
          }
        }
      }
      // special: a tank beside an enemy cycle can ram it — lethal shoves
      // (pit, wall, boundary) rate like a kill
      if (unit.type === 'tank') {
        for (const t of game.units) {
          if (!t.alive || t.type !== 'cycle' ||
              !game.isHostile(t.side, unit.side)) continue;
          if (hexDistance({ q, r }, t) !== 1) continue;
          const p = game.predictPush(unit, t, { q, r });
          const lethal = p.type === 'hole' || p.type === 'wall' || p.type === 'edge';
          let score = (lethal ? 48 : p.type === 'slam' ? 4 : 2) - pos.cost * 0.15;
          if (!best || score > best.score) {
            best = { pos, target: t, score, special: 'push' };
          }
        }
      }
    }

    if (best) {
      if (best.pos.cost > 0) {
        await game.moveUnit(unit, getPath(best.pos.k), best.pos.cost);
      }
      // an overdrive slide may have displaced the unit — re-verify the plan
      if (unit.alive && best.target.alive) {
        if (best.special === 'conquer') {
          if (game.conquerableCore(unit) === best.target) {
            await game.conquestAttack(unit);
          }
        } else if (best.special === 'push') {
          if (game.pushTargets(unit).includes(best.target)) {
            await game.pushAttack(unit, best.target);
          }
        } else {
          game.aimTurretAt(unit, best.target);
          if (game.targetsInRange(unit).includes(best.target)) {
            await game.attack(unit, best.target);
          }
        }
      }
      if (game.over) return;
      await hitAndRun(game, unit);
    } else {
      // no attack: advance toward the closest hostile, but spend the move with
      // purpose where possible — recognizers detour to SHEAR enemy jet walls,
      // jets fly to FENCE an enemy jet with a fresh wall (offenseValue), even if
      // that isn't strictly the shortest route in.
      if (!enemies.length) return;
      const mobile = enemies.filter((e) => e.type !== 'core');
      const pool = mobile.length ? mobile : enemies;
      const here = Math.min(...pool.map((e) => hexDistance(unit, e)));
      let bestK = null, bestV = 0, bestCost = 0; // need a positive reason to move
      for (const [k, info] of dests) {
        if (slideDeath(k, info.cost)) continue;
        const c = parseKey(k);
        const d = Math.min(...pool.map((e) => hexDistance(c, e)));
        const v = (here - d) + offenseValue(k, info.cost) - info.cost * 0.02;
        if (v > bestV) { bestV = v; bestK = k; bestCost = info.cost; }
      }
      if (bestK) {
        await game.moveUnit(unit, getPath(bestK), bestCost);
        // attack of opportunity after closing in
        const targets = unit.alive
          ? game.targetsInRange(unit, unit.q, unit.r, { freeTurret: unit.type === 'tank' })
          : [];
        if (targets.length) {
          targets.sort((a, b) => a.hp - b.hp);
          game.aimTurretAt(unit, targets[0]);
          await game.attack(unit, targets[0]);
          if (game.over) return;
          await hitAndRun(game, unit);
        }
      }
    }
}

// Production phase — spend leftover energy on reinforcements (max 2 per round).
export async function aiProduce(game, sideId) {
  const faction = game.factions[sideId];
  const can = (t) => !game.buildable || game.buildable.includes(t); // map restriction
  for (let builds = 0; builds < 2 && !game.over; builds++) {
    const e = faction.energy;
    let type = null;
    if (can('reco') && e >= UNIT_TYPES.reco.cost && Math.random() < 0.4) type = 'reco';
    else if (can('jet') && e >= UNIT_TYPES.jet.cost && Math.random() < 0.4) type = 'jet';
    else if (can('tank') && e >= UNIT_TYPES.tank.cost && Math.random() < 0.6) type = 'tank';
    else if (can('cycle') && e >= UNIT_TYPES.cycle.cost) type = 'cycle';
    if (!type || !game.build(sideId, type)) break;
    await game.fx.wait(0.7);
  }
}

// Pick the flight level (0 normal, 1 high, 2 top) a recognizer should aim for.
// High is the bread-and-butter perch — safe from light cycles, +1 range. It
// climbs to top for maximum reach and to glide over blockers when it's healthy
// and not pinned by tank fire, and drops down when hurt to repair and shed the
// top-level damage surcharge. (The game still limits it to one level per turn.)
function desiredRecoLevel(game, unit) {
  if (game.isCrippled(unit)) return 0;        // engines failing — can't climb anyway
  const enemies = game.hostileUnits(unit.side);
  if (!enemies.length) return Math.min(1, game.altLevel(unit)); // nobody to fear; ease down to high
  const hpFrac = unit.hp / unit.maxHp;
  if (hpFrac < 0.45) return 0;                // wounded: dive to heal and stop taking +2

  const def = UNIT_TYPES.reco;
  const tanks = enemies.filter((e) => e.type === 'tank');
  const nearTank = tanks.some(
    (t) => hexDistance(unit, t) <= UNIT_TYPES.tank.range + 2);
  const nearest = Math.min(...enemies.map((e) => hexDistance(unit, e)));

  // default perch: HIGH
  let level = 1;
  // climb to TOP for the extra reach/fly-over when healthy, the enemy is still
  // beyond comfortable striking distance, and no tank is poised to punish it
  const reach = def.range + 2 + unit.movesLeft; // effective top-level strike reach
  if (hpFrac >= 0.6 && !nearTank && nearest > def.range + 1 && nearest <= reach + 1) {
    level = 2;
  }
  return level;
}

// After a light cycle strikes, spend leftover movement falling back
// out of the counterattack.
async function hitAndRun(game, unit) {
  if (!unit.alive || unit.type !== 'cycle' || !game.canMoveNow(unit)) return;
  const hostiles = game.hostileUnits(unit.side).filter((e) => e.type !== 'core');
  if (!hostiles.length) return;
  const { dests, getPath } = game.validDestinations(unit, { avoidTrails: true });
  const def = UNIT_TYPES[unit.type];
  const here = Math.min(...hostiles.map((e) => hexDistance(unit, e)));
  let bestK = null, bestD = here, bestCost = 0;
  for (const [k, info] of dests) {
    if (unit.movesLeft === def.move && info.cost >= def.move &&
        game.predictSlide(unit, getPath(k)).dies) continue;
    const c = parseKey(k);
    const d = Math.min(...hostiles.map((e) => hexDistance(c, e)));
    if (d > bestD) { bestD = d; bestK = k; bestCost = info.cost; }
  }
  if (bestK) {
    await game.moveUnit(unit, getPath(bestK), bestCost);
    if (!unit.alive) return;
    unit.postAttackMoved = true;
    if (game.isDone(unit)) game.setDim(unit, true);
  }
}
