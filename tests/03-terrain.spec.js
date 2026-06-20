const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

test.describe('terrain & healing', () => {
  test('pits/plateaus block ground units but flyers cross at a cost', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      let cell = null;
      for (const c of g.cells.values()) { if (c.terrain === 'normal' && !g.unitAt(c.q, c.r)) { cell = c; break; } }
      cell.terrain = 'hole';
      const ground = g.units.find((u) => u.alive && (u.type === 'cycle' || u.type === 'tank'));
      const reco = g.units.find((u) => u.alive && u.type === 'reco');
      const gcost = g.costFor(ground)(cell.q, cell.r);
      const rcost = reco ? g.costFor(reco)(cell.q, cell.r) : null;
      return { groundImpassable: !isFinite(gcost), recoPassable: reco ? isFinite(rcost) : null, recoCost: rcost };
    });
    expect(r.groundImpassable).toBe(true);
    if (r.recoPassable !== null) {
      expect(r.recoPassable).toBe(true);
      expect(r.recoCost).toBe(2); // ROUGH_COST
    }
  });

  test('an idle unit self-repairs +1 in the heal phase', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const core = g.units.find((u) => u.alive && u.type === 'core'); // move 0 = always idle
      g.cellOf(core).terrain = 'normal';
      core.hp = core.maxHp - 5; core.attacked = false;
      const before = core.hp;
      g.healPhase(core.side);
      return { before, after: core.hp };
    });
    expect(r.after).toBe(r.before + 1);
  });

  test('a unit on a heal pad is fully restored', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const u = g.units.find((x) => x.alive && x.type === 'cycle');
      g.cellOf(u).terrain = 'heal';
      u.hp = 1; u.attacked = false;
      g.healPhase(u.side);
      return { hp: u.hp, maxHp: u.maxHp };
    });
    expect(r.hp).toBe(r.maxHp);
  });
});
