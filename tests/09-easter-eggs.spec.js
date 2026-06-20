const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// Beating the final Grid War mission triggers a retro "crash" gag — a Windows
// blue screen in dark mode, an Amiga Guru Meditation in light mode.
test.describe('victory crash easter egg', () => {
  test('dark mode → blue screen, dismissed by click', async ({ page }) => {
    await bootSkirmish(page);
    await page.evaluate(() => {
      document.body.classList.remove('light');
      const g = window.__game;
      g.mission = { cid: 'grid_war', idx: 99 }; // idx beyond the last → no "next mission"
      g.onMissionEnd(true);
    });
    await page.waitForFunction(
      () => document.getElementById('bsod').classList.contains('show'),
      null, { timeout: 6000 }); // fires on a ~2.4s delay
    await page.click('#bsod');
    expect(await page.evaluate(() => document.getElementById('bsod').classList.contains('show'))).toBe(false);
  });

  test('light mode → Amiga guru meditation, dismissed by click', async ({ page }) => {
    await bootSkirmish(page, { theme: 'light' });
    await page.evaluate(() => {
      document.body.classList.add('light');
      const g = window.__game;
      g.mission = { cid: 'grid_war', idx: 99 };
      g.onMissionEnd(true);
    });
    await page.waitForFunction(
      () => document.getElementById('guru').classList.contains('show'),
      null, { timeout: 6000 });
    expect(await page.evaluate(() => document.body.classList.contains('guru-shift'))).toBe(true);
    await page.click('#guru');
    const r = await page.evaluate(() => ({
      guru: document.getElementById('guru').classList.contains('show'),
      shift: document.body.classList.contains('guru-shift'),
    }));
    expect(r.guru).toBe(false);
    expect(r.shift).toBe(false);
  });
});

test.describe('new-release notice', () => {
  test('shows when a newer version is cached and dismisses per-version', async ({ page }) => {
    await page.goto('/');
    // seed the update-check cache with a newer tag so the real boot flow (which
    // avoids a live GitHub fetch within the TTL) surfaces the pill
    await page.evaluate(() => {
      localStorage.setItem('gw-upd-latest', '9.9.9');
      localStorage.setItem('gw-upd-checked', String(Date.now()));
      localStorage.removeItem('gw-upd-dismiss');
    });
    await page.reload();
    await page.waitForFunction(
      () => document.getElementById('update-notice').classList.contains('show'),
      null, { timeout: 8000 });
    expect(await page.evaluate(() => document.querySelector('#update-notice .uv').textContent)).toBe('v9.9.9');
    await page.click('#update-dismiss');
    const r = await page.evaluate(() => ({
      shown: document.getElementById('update-notice').classList.contains('show'),
      dismissed: localStorage.getItem('gw-upd-dismiss'),
    }));
    expect(r.shown).toBe(false);
    expect(r.dismissed).toBe('9.9.9');
  });
});
