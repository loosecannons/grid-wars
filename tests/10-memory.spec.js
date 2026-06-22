const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// three.js geometries/materials must be disposed explicitly — scene.remove()
// alone leaks GPU memory. renderer.info.memory.geometries is the live count, so
// a unit death should DROP it (the audit found ~40 leaked objects per kill).
test.describe('GPU resource disposal', () => {
  test('killing a unit frees its geometries (no per-death leak)', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const info = window.__renderer.info.memory;
      const before = info.geometries;
      // derez a non-core unit through the real damage path
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      await g.applyDamage(u, u.hp + 99);
      // let the derez animation settle, then sample again
      await new Promise((res) => setTimeout(res, 400));
      return { before, after: info.geometries, dead: !u.alive };
    });
    expect(r.dead).toBe(true);
    // a leak would make `after` >= `before`; disposal makes it strictly smaller
    expect(r.after).toBeLessThan(r.before);
  });
});
