const { test, expect } = require('@playwright/test');
const { bootSkirmish, trackErrors } = require('./helpers');

test.describe('smoke', () => {
  test('start menu loads cleanly with all entry points', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.locator('#startmenu .title')).toHaveText('GRID WARS');
    for (const m of ['tutorial', 'proving', 'grid_war']) {
      await expect(page.locator(`.modes button[data-mode="${m}"]`)).toBeVisible();
    }
    await expect(page.locator('#maps-btn')).toBeVisible();
    await expect(page.locator('#editor-btn')).toBeVisible();
    // skirmish sizes present
    for (const s of ['S', 'M', 'L', 'XL', 'XXL', 'EPIC', 'MANIC']) {
      await expect(page.locator(`.sizes button[data-size="${s}"]`)).toHaveCount(1);
    }
    expect(await page.evaluate(() => !!window.__game)).toBe(true);
    await page.waitForTimeout(500);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a seeded skirmish boots and renders units', async ({ page }) => {
    const errors = trackErrors(page);
    await bootSkirmish(page);
    const state = await page.evaluate(() => {
      const g = window.__game;
      return {
        radius: g.config.radius,
        factions: g.factions.length,
        units: g.units.filter((u) => u.alive).length,
        cores: g.units.filter((u) => u.alive && u.type === 'core').length,
        hasCanvas: !!document.querySelector('canvas'),
        inGame: document.body.classList.contains('in-game'),
      };
    });
    expect(state.radius).toBe(5); // size S
    expect(state.factions).toBe(2);
    expect(state.units).toBeGreaterThan(2);
    expect(state.cores).toBe(2); // one per faction
    expect(state.hasCanvas).toBe(true);
    expect(state.inGame).toBe(true);
    await page.waitForTimeout(300);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
