const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// #5: a selected cycle can ride into a cracked-wall portal by clicking the tear,
// instead of having to slam the boundary at full overdrive velocity.
test.describe('portal click-to-enter', () => {
  test('clicking a tear warps a selected cycle through it (no overdrive needed)', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      g.fx.speed = 200;
      const R = g.config.radius;
      // clear + normalise the centre cluster so the warp lands somewhere survivable
      [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
        .forEach(([q, r]) => { const c = g.cells.get(q + ',' + r); if (c) c.terrain = 'normal'; });
      g.units.forEach((u) => { if (u.alive && u.type !== 'core' && Math.abs(u.q) <= 1 && Math.abs(u.r) <= 1) { u.q = 90; u.r = 90; } });
      // a human cycle sitting on a boundary edge, with a tear just off-grid beyond it
      const cyc = g.units.find((u) => u.alive && u.type === 'cycle' && u.side === 0);
      cyc.q = 0; cyc.r = R; g._setCellPos(cyc);
      g.portals.forEach((p) => { if (p.mesh) g.scene.remove(p.mesh); }); g.portals = [];
      g._createPortal(0, R + 1, 0, R);
      const padPickable = g.pickMeshes.includes(g.portals[0].pad);
      // force it to be this cycle's (human) turn, select it, then simulate a tear click
      g.current = 0; g._turnLocal = true; g.busy = false; g.over = false;
      g.select(cyc);
      const before = { q: cyc.q, r: cyc.r, hp: cyc.hp };
      g.onPick({ portal: 0, cellKey: '0,' + R }, false); // a pad click
      await new Promise((res) => setTimeout(res, 900));
      return {
        padPickable, before,
        after: { q: cyc.q, r: cyc.r, hp: cyc.hp, alive: cyc.alive },
        warpedToCentre: Math.abs(cyc.q) <= 1 && Math.abs(cyc.r) <= 1,
        spent: cyc.movesLeft === 0 && cyc.attacked === true,
      };
    });
    expect(r.padPickable).toBe(true); // the tear is a real click target
    expect(r.warpedToCentre).toBe(true); // it rode through to the middle
    expect(r.after.alive).toBe(true); // survived the landing
    expect(r.after.hp).toBeLessThan(r.before.hp); // took the portal self-damage
    expect(r.spent).toBe(true); // the warp ended its turn
  });
});
