const { test, expect } = require('@playwright/test');

// The map editor paints terrain + places units, then hands an exact spec to the
// engine. We drive the editor through its debug handle (window.__mapEditor) and
// assert the live game reproduces the authored terrain and placements verbatim.
test.describe('map editor', () => {
  test('an authored map plays with exact terrain and placements', async ({ page }) => {
    await page.goto('/');
    await page.click('#editor-btn');
    await page.waitForFunction(
      () => window.__mapEditor && document.querySelectorAll('.ed-hex').length > 0,
      null, { timeout: 15000 });

    const built = await page.evaluate(() => {
      const ed = window.__mapEditor;
      ed._setSize('S');
      ed.tool = { id: 'high', kind: 'terrain' }; ed._apply(0, 0); ed._apply(1, 0);
      ed.tool = { id: 'hole', kind: 'terrain' }; ed._apply(0, 1);
      ed.tool = { id: 'heal', kind: 'terrain' }; ed._apply(2, -1);
      ed.activeFaction = 0;
      ed.tool = { id: 'core', kind: 'unit' }; ed._apply(0, 4);
      ed.tool = { id: 'cycle', kind: 'unit' }; ed._apply(0, 3);
      ed.activeFaction = 1;
      ed.tool = { id: 'core', kind: 'unit' }; ed._apply(0, -4);
      ed.tool = { id: 'cycle', kind: 'unit' }; ed._apply(0, -3);
      return { terrain: ed.terrain.size, units: ed.units.size };
    });
    expect(built.terrain).toBe(4);
    expect(built.units).toBe(4);

    // test-drive it
    await page.evaluate(() => {
      document.getElementById('ed-name').value = 'PW Authored';
      document.getElementById('ed-play').click();
    });
    await page.waitForFunction(
      () => window.__game && window.__game.config && window.__game.units.length > 0
        && document.body.classList.contains('in-game'),
      null, { timeout: 30000 });

    const live = await page.evaluate(() => {
      const g = window.__game;
      const terr = (q, r) => { const c = g.cells.get(q + ',' + r); return c ? c.terrain : '?'; };
      return {
        editorHidden: getComputedStyle(document.getElementById('editor')).display === 'none',
        plateau00: terr(0, 0), plateau10: terr(1, 0), pit01: terr(0, 1), heal: terr(2, -1),
        units: g.units.filter((u) => u.alive).length,
        cores: g.units.filter((u) => u.alive && u.type === 'core').length,
      };
    });
    expect(live.editorHidden).toBe(true);
    expect(live.plateau00).toBe('high');
    expect(live.plateau10).toBe('high');
    expect(live.pit01).toBe('hole');
    expect(live.heal).toBe('heal');
    expect(live.units).toBe(4);
    expect(live.cores).toBe(2);
  });

  test('validation rejects a map without two cored factions', async ({ page }) => {
    await page.goto('/');
    await page.click('#editor-btn');
    await page.waitForFunction(() => window.__mapEditor, null, { timeout: 15000 });
    const err = await page.evaluate(() => {
      const ed = window.__mapEditor;
      ed._setSize('S');
      ed.terrain.clear(); ed.units.clear();
      ed.activeFaction = 0;
      ed.tool = { id: 'core', kind: 'unit' }; ed._apply(0, 4); // only ONE faction has a core
      return ed._validate(ed._toMap());
    });
    expect(err).toBeTruthy(); // a non-empty error string blocks play/save
  });
});
