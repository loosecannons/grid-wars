const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// The cracked-boundary-portal easter egg: a cycle flung off the Grid at speed
// cracks the wall (derezzing); later cycles driving into the crack warp instead.
test.describe('boundary portals', () => {
  test('first impact cracks a portal and derezzes; a second cycle warps through', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const R = g.config.radius;
      // clear the centre cluster so the warp drop lands on clear ground
      const cluster = [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      cluster.forEach(([q, r]) => { const c = g.cells.get(q + ',' + r); if (c) c.terrain = 'normal'; });
      g.units.forEach((u) => { if (u.alive && u.type !== 'core' && Math.abs(u.q) <= 1 && Math.abs(u.r) <= 1) { u.q = 90; u.r = 90; } });
      const off = { q: 0, r: R + 1 }, edge = { q: 0, r: R };
      const cycles = g.units.filter((u) => u.alive && u.type === 'cycle');
      const A = cycles[0], B = cycles[1];
      await g._hitBoundary(A, off, edge);
      const afterFirst = { aAlive: A.alive, portals: g.portals.length };
      await g._hitBoundary(B, off, edge);
      return {
        afterFirst,
        portalsStill: g.portals.length,
        bAlive: B.alive,
        bNearCentre: Math.abs(B.q) <= 1 && Math.abs(B.r) <= 1,
      };
    });
    expect(r.afterFirst.portals).toBe(1);
    expect(r.afterFirst.aAlive).toBe(false); // the wall-cracker crashes
    expect(r.portalsStill).toBe(1); // no duplicate portal at the same spot
    expect(r.bAlive).toBe(true); // survived the warp onto a clear hex
    expect(r.bNearCentre).toBe(true); // dropped in the middle
  });

  test('a portal drop onto rough terrain does not survive', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      g.portals.forEach((p) => { if (p.mesh) g.scene.remove(p.mesh); });
      g.portals = [];
      g._createPortal(0, g.config.radius + 1, 0, g.config.radius);
      // every centre-cluster cell a plateau, and clear of units → guaranteed rough landing
      [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].forEach(([q, r]) => { const c = g.cells.get(q + ',' + r); if (c) c.terrain = 'high'; });
      g.units.forEach((u) => { if (u.alive && Math.abs(u.q) <= 1 && Math.abs(u.r) <= 1) { u.q = 90; u.r = 90; } });
      const cyc = g.units.find((u) => u.alive && u.type === 'cycle' && u.q !== 90);
      await g._enterPortal(cyc, g.portals[0]);
      return { alive: cyc.alive };
    });
    expect(r.alive).toBe(false);
  });
});
