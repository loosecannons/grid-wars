// Shared test helpers. Boots a deterministic skirmish (seeded → reproducible
// terrain + initiative) without the briefing flow, and exposes the game via
// window.__game for state-level assertions.
const DEFAULT_FACTIONS = [
  { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
  { name: 'SARK', color: 1, controller: 'ai', team: 2 },
];

// Boot straight into a running skirmish (gw-restart path skips the briefing).
async function bootSkirmish(page, opts = {}) {
  const size = opts.size || 'S';
  const seed = opts.seed || 777;
  const factions = opts.factions || DEFAULT_FACTIONS;
  await page.goto('/');
  await page.evaluate((o) => {
    localStorage.setItem('gw-classic', o.classic ? '1' : '0');
    localStorage.setItem('gw-theme', o.theme || 'dark');
    localStorage.setItem('gw-muted', '1');
    localStorage.setItem('gw-turnmode', o.sim ? 'sim' : 'seq');
    sessionStorage.removeItem('gw-mission');
    sessionStorage.setItem('gw-restart', JSON.stringify({
      size: o.size, seed: o.seed, factions: o.factions, simultaneous: !!o.sim,
    }));
  }, { classic: !!opts.classic, theme: opts.theme, sim: !!opts.sim, size, seed, factions });
  await page.reload();
  await page.waitForFunction(
    () => window.__game && window.__game.config && window.__game.units && window.__game.units.length > 0,
    null, { timeout: 30000 });
  await page.evaluate(() => { if (window.__game.fx) window.__game.fx.speed = 90; });
}

// Collect uncaught JS errors + real console.errors (filtering out benign
// network noise like the GitHub update check or a missing favicon).
function trackErrors(page) {
  const errors = [];
  const benign = /favicon|api\.github\.com|fonts\.googleapis|ERR_|Failed to load resource|the server responded with a status/i;
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !benign.test(m.text())) errors.push('console: ' + m.text());
  });
  return errors;
}

module.exports = { bootSkirmish, trackErrors, DEFAULT_FACTIONS };
