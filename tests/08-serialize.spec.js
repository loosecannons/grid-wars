const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

test.describe('serialize / restore', () => {
  test('serialize captures live state (alive units, facing, mutations)', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      u.hp = 3;
      const s = g.serialize();
      const snapU = s.units.find((x) => x.id === u.id);
      return {
        v: s.v, sizeKey: s.sizeKey, seed: s.seed,
        aliveOnly: s.units.every((x) => g.units.find((gg) => gg.id === x.id && gg.alive)),
        mutHp: snapU && snapU.hp,
        hasFacing: Array.isArray(snapU && snapU.face),
      };
    });
    expect(r.v).toBe(1);
    expect(r.sizeKey).toBe('S');
    expect(r.aliveOnly).toBe(true);
    expect(r.mutHp).toBe(3);
    expect(r.hasFacing).toBe(true); // non-core units preserve heading
  });

  test('a snapshot carries everything a resume needs and is JSON-stable', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const s = g.serialize();
      const round = JSON.parse(JSON.stringify(s)); // survives localStorage / the wire
      const need = ['v', 'sizeKey', 'seed', 'configs', 'current', 'turnCount', 'randState', 'order', 'units'];
      const missing = need.filter((k) => round[k] === undefined);
      const u = round.units[0];
      const unitFields = !!u && ['id', 'side', 'type', 'q', 'r', 'hp', 'movesLeft'].every((k) => u[k] !== undefined);
      return {
        missing,
        stable: JSON.stringify(s) === JSON.stringify(round),
        unitFields,
        idsUnique: new Set(round.units.map((x) => x.id)).size === round.units.length,
      };
    });
    expect(r.missing).toEqual([]); // resume() reads every one of these
    expect(r.stable).toBe(true); // round-trips through storage unchanged
    expect(r.unitFields).toBe(true);
    expect(r.idsUnique).toBe(true); // ids line up across network clients
  });

  test('mid-round focus-fire state survives serialize/restore', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      u.focusHits = 3; // a unit that has been focus-fired this round
      const snap = JSON.parse(JSON.stringify(g.serialize()));
      const snapU = snap.units.find((x) => x.id === u.id);
      u.focusHits = 99; // diverge the live original from the snapshot
      // re-init from the snapshot (resume path; init appends, so the rebuilt
      // unit is the LAST one with this id — reading it proves restore set it)
      g.init(snap.sizeKey, snap.seed, snap.configs, snap.mods, snap, {});
      const matches = g.units.filter((x) => x.id === u.id);
      const restored = matches[matches.length - 1];
      return { snapped: snapU && snapU.focusHits, restored: restored ? restored.focusHits : null };
    });
    expect(r.snapped).toBe(3); // serialized, not dropped to 0
    expect(r.restored).toBe(3); // restore read the snapshot's 3, not the live 99
  });

  test('exportMap captures terrain and live placements', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      let cell = null;
      for (const c of g.cells.values()) { if (c.terrain === 'normal' && !g.unitAt(c.q, c.r)) { cell = c; break; } }
      cell.terrain = 'high';
      const map = g.exportMap('PW Export');
      return {
        name: map.name,
        sizeKey: map.sizeKey,
        hasHigh: map.terrain.some((t) => t.type === 'high'),
        placements: map.placements.length,
        factions: map.factions.length,
      };
    });
    expect(r.name).toBe('PW Export');
    expect(r.sizeKey).toBe('S');
    expect(r.hasHigh).toBe(true);
    expect(r.placements).toBeGreaterThan(2);
    expect(r.factions).toBe(2);
  });
});
