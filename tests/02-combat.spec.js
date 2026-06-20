const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// Combat is exercised through the engine (applyDamage / predictAttack) so the
// assertions are deterministic and independent of turn order / animations.
test.describe('combat & damage', () => {
  test('applyDamage reduces HP and derezzes at zero', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      const before = u.hp;
      await g.applyDamage(u, 1);
      const mid = { hp: u.hp, alive: u.alive };
      await g.applyDamage(u, u.hp);
      return { before, mid, after: { hp: u.hp, alive: u.alive } };
    });
    expect(r.mid.hp).toBe(r.before - 1);
    expect(r.mid.alive).toBe(true);
    expect(r.after.alive).toBe(false);
  });

  test('directional damage: rear strike x1.5, front deflected x0.75', async ({ page }) => {
    await bootSkirmish(page);
    const m = await page.evaluate(() => {
      const g = window.__game;
      const a = g.units.find((u) => u.alive && u.type !== 'core');
      const b = g.units.find((u) => u.alive && u.id !== a.id && u.type !== 'core');
      // the multiplier is read off mesh WORLD positions + the target's heading,
      // so place them explicitly: attacker at z=0, target ahead at z=2
      a.mesh.position.set(0, a.mesh.position.y, 0);
      b.mesh.position.set(0, b.mesh.position.y, 2);
      const sample = (lookZ) => {
        b.mesh.lookAt(0, b.mesh.position.y, lookZ); // orient the target's forward
        b.mesh.updateMatrixWorld(true);
        return g.predictAttack(a, b).mult;
      };
      // facing away (toward +z) → attacker is behind → rear strike;
      // facing toward the attacker (-z) → deflected
      return { rear: sample(3), front: sample(1) };
    });
    expect(m.rear).toBeCloseTo(1.5, 5); // rear strike
    expect(m.front).toBeCloseTo(0.75, 5); // deflected front
  });

  test('focus fire: a repeated hit on the same target is boosted', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const a = g.units.find((u) => u.alive && u.type === 'cycle');
      const b = g.units.find((u) => u.alive && u.id !== a.id && u.type !== 'core');
      b.q = a.q; b.r = a.r - 1;
      b.mesh.lookAt(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z); // side-on (x1)
      b.focusHits = 0; const first = g.predictAttack(a, b).dmg;
      b.focusHits = 1; const second = g.predictAttack(a, b).dmg;
      return { first, second };
    });
    expect(r.second).toBeGreaterThan(r.first);
  });
});
