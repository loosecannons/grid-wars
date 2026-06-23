const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// Regression: in simultaneous (WeGo) mode a cycle used to lay a string of
// straight per-step ribbon segments, so its wall was always straight. It should
// instead lay ONE smooth CatmullRom curve through the whole path, exactly like
// sequential _driveCycle.
test.describe('simultaneous-mode cycle walls', () => {
  test('a cycle lays a single curved wall through a turning path', async ({ page }) => {
    await bootSkirmish(page, { sim: true });
    const r = await page.evaluate(async () => {
      const g = window.__game;
      g.fx.speed = 200;
      const cyc = g.units.find((u) => u.alive && u.type === 'cycle');
      cyc.q = 0; cyc.r = 0;
      // a path that clearly turns: east, east, then north-east
      const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: -1 }, { q: 2, r: -2 }];
      const before = g.trails.length;
      await g._simMove(cyc, path);
      const trail = g.trails[g.trails.length - 1];
      const wall = trail.walls[0];
      return {
        newTrails: g.trails.length - before,
        wallCount: trail.walls.length,
        wallType: wall && wall._build && wall._build.type,
        curvePoints: wall && wall._build && wall._build.pts.length,
        collisionCells: trail.path.length,
      };
    });
    expect(r.newTrails).toBe(1);
    expect(r.wallCount).toBe(1); // ONE ribbon, not one straight piece per step
    expect(r.wallType).toBe('curve'); // CatmullRom curve, not straight 'points'
    expect(r.curvePoints).toBe(6); // phantom lead-in + start + 4 path cells
    expect(r.collisionCells).toBe(4); // the deadly wall cells are unchanged
  });
});
