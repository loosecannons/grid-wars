const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

test.describe('UI toggles & overlays', () => {
  test('render-mode toggle flips classic/modern and persists', async ({ page }) => {
    await page.goto('/');
    const before = await page.evaluate(() => localStorage.getItem('gw-classic'));
    await page.click('#visual-toggle');
    const after = await page.evaluate(() => localStorage.getItem('gw-classic'));
    expect(after).not.toBe(before);
    expect(['0', '1']).toContain(after);
  });

  test('theme toggle adds/removes body.light and persists', async ({ page }) => {
    await page.goto('/');
    const wasLight = await page.evaluate(() => document.body.classList.contains('light'));
    await page.click('#btn-theme');
    const r = await page.evaluate(() => ({
      light: document.body.classList.contains('light'),
      stored: localStorage.getItem('gw-theme'),
    }));
    expect(r.light).toBe(!wasLight);
    expect(r.stored).toBe(r.light ? 'light' : 'dark');
  });

  test('manual overlay renders the README with mechanics tables', async ({ page }) => {
    await page.goto('/');
    await page.click('#manual-btn');
    await page.waitForFunction(
      () => { const c = document.getElementById('manual-content'); return c && c.querySelector('h1'); },
      null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const c = document.getElementById('manual-content');
      return {
        shown: document.getElementById('manual-overlay').classList.contains('show'),
        h1: c.querySelector('h1').textContent,
        tables: c.querySelectorAll('table').length,
      };
    });
    expect(r.shown).toBe(true);
    expect(r.h1.toUpperCase()).toContain('GRID WARS');
    expect(r.tables).toBeGreaterThan(0);
    await page.click('#manual-close');
    expect(await page.evaluate(() => document.getElementById('manual-overlay').classList.contains('show'))).toBe(false);
  });

  test('unit card iconifies to a restore button and back', async ({ page }) => {
    await bootSkirmish(page);
    await page.evaluate(() => {
      const g = window.__game;
      const u = g.units.find((x) => x.alive && x.type !== 'core');
      g.ui.showUnit(u, g);
    });
    await page.click('#unit-card-min');
    let r = await page.evaluate(() => ({
      hidden: getComputedStyle(document.getElementById('unit-card')).display === 'none',
      restore: document.getElementById('unit-card-show').classList.contains('show'),
    }));
    expect(r.hidden).toBe(true);
    expect(r.restore).toBe(true);
    await page.click('#unit-card-show');
    r = await page.evaluate(() => ({
      shown: getComputedStyle(document.getElementById('unit-card')).display !== 'none',
      restoreGone: !document.getElementById('unit-card-show').classList.contains('show'),
    }));
    expect(r.shown).toBe(true);
    expect(r.restoreGone).toBe(true);
  });

  test('transmissions hide collapses chat to a corner icon', async ({ page }) => {
    await bootSkirmish(page);
    await page.click('#btn-chat-toggle');
    const r = await page.evaluate(() => ({
      min: document.getElementById('chat').classList.contains('min'),
      icon: document.getElementById('btn-chat-show').classList.contains('show'),
    }));
    expect(r.min).toBe(true);
    expect(r.icon).toBe(true);
  });
});
