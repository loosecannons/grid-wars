const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// three.js geometries/materials must be disposed explicitly — scene.remove()
// alone leaks GPU memory. renderer.info.memory.geometries is the live count, so
// a unit death should DROP it (the audit found ~40 leaked objects per kill).
test.describe('GPU resource disposal', () => {
  // _disposeMesh is what the three death sites call after scene.remove(). Test it
  // directly: removing+disposing a unit must release its tracked GPU geometries
  // (scene.remove alone leaks them). Measured synchronously so the result isn't
  // confounded by the derez animation or the turn continuing to spawn units.
  test('disposing a unit mesh releases its geometries (no per-death leak)', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const info = window.__renderer.info.memory;
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      let own = 0;
      u.mesh.traverse((o) => { if (o.geometry) own++; });
      const before = info.geometries;
      g.scene.remove(u.mesh);
      g._disposeMesh(u.mesh);
      return { own, before, after: info.geometries };
    });
    expect(r.own).toBeGreaterThan(5); // a unit owns many distinct geometries
    expect(r.after).toBeLessThan(r.before); // they were released, not leaked
  });
});
