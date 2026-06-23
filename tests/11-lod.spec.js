const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// Level of detail: far from the camera a unit's full ~40-mesh model is swapped
// for a single bright blip (a big draw-call win on large maps zoomed out). Both
// the model and the proxy carry the unit id, so picking works in either mode.
test.describe('level of detail', () => {
  test('units swap model<->proxy by detail level, with picking preserved', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      const lod = u.mesh.userData.lod;
      const proxyId = lod.proxy.userData.unitId;
      const partsCarryId = lod.parts.every((p) => p.userData.unitId === u.id);
      g.setDetailLevel(true);
      const far = {
        modelHidden: lod.parts.every((p) => !p.visible),
        proxyShown: lod.proxy.visible,
        detailPruned: lod.parts.every((p) => p.matrixWorldAutoUpdate === false),
      };
      g.setDetailLevel(false);
      const near = { modelShown: lod.parts.every((p) => p.visible), proxyHidden: !lod.proxy.visible };
      return { unitId: u.id, proxyId, partsCarryId, far, near };
    });
    expect(r.proxyId).toBe(r.unitId); // proxy is a valid pick target when far
    expect(r.partsCarryId).toBe(true); // model is a valid pick target when near
    expect(r.far.modelHidden).toBe(true);
    expect(r.far.proxyShown).toBe(true);
    expect(r.far.detailPruned).toBe(true); // hidden detail leaves the matrix walk
    expect(r.near.modelShown).toBe(true);
    expect(r.near.proxyHidden).toBe(true);
  });

  test('a unit built while zoomed out spawns straight into blip mode', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      g.setDetailLevel(true); // pretend the camera is pulled far out
      const side = g.current;
      g.factions[side].energy = 999;
      const core = g.units.find((u) => u.alive && u.type === 'core' && u.side === side);
      const before = g.units.length;
      g.build(side, 'cycle', core);
      const nu = g.units[g.units.length - 1];
      const lod = nu && nu.mesh.userData.lod;
      return {
        built: g.units.length === before + 1,
        proxyShown: !!(lod && lod.proxy.visible),
        modelHidden: !!(lod && lod.parts.every((p) => !p.visible)),
      };
    });
    expect(r.built).toBe(true);
    expect(r.proxyShown).toBe(true);
    expect(r.modelHidden).toBe(true);
  });
});
