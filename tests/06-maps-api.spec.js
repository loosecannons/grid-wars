const { test, expect } = require('@playwright/test');

// The custom-maps backend: /api/maps CRUD over JSON files in MAPS_DIR.
test.describe('custom maps API', () => {
  test('create, list, fetch and delete round-trips a map', async ({ request }) => {
    const map = {
      v: 1, name: 'PW API Map', sizeKey: 'S', radius: 5, income: 3,
      factions: [
        { name: 'A', color: 0, controller: 'human', team: 1 },
        { name: 'B', color: 1, controller: 'ai', team: 2 },
      ],
      terrain: [{ q: 0, r: 0, type: 'high' }, { q: 1, r: -1, type: 'heal' }],
      placements: [
        { side: 0, type: 'core', q: 0, r: 5 },
        { side: 1, type: 'core', q: 0, r: -5 },
      ],
    };

    const post = await request.post('/api/maps', { data: map });
    expect(post.ok()).toBeTruthy();
    const { id } = await post.json();
    expect(id).toBeTruthy();

    const list = await (await request.get('/api/maps')).json();
    expect(list.maps.some((m) => m.id === id)).toBe(true);

    const full = await (await request.get('/api/maps/' + id)).json();
    expect(full.name).toBe('PW API Map');
    expect(full.terrain.length).toBe(2);
    expect(full.placements.length).toBe(2);

    const del = await request.delete('/api/maps/' + id);
    expect(del.ok()).toBeTruthy();

    const after = await (await request.get('/api/maps')).json();
    expect(after.maps.some((m) => m.id === id)).toBe(false);
  });

  test('rejects a malformed map body', async ({ request }) => {
    const bad = await request.post('/api/maps', { data: { name: 'oops' } }); // no terrain/placements
    expect(bad.status()).toBe(400);
  });

  test('rejects a bad map id', async ({ request }) => {
    const res = await request.get('/api/maps/' + encodeURIComponent('../secret'));
    expect(res.status()).toBe(400);
  });

  test('a malicious map sizeKey is HTML-escaped in the maps list (no stored XSS)', async ({ page, request }) => {
    const payload = '<img src=x onerror=window.__pwned=1>';
    const post = await request.post('/api/maps', {
      data: {
        name: 'PW XSS', sizeKey: payload, terrain: [],
        placements: [{ side: 0, type: 'core', q: 0, r: 5 }, { side: 1, type: 'core', q: 0, r: -5 }],
      },
    });
    const { id } = await post.json();
    try {
      await page.goto('/');
      await page.click('#maps-btn');
      await page.waitForFunction(
        () => document.getElementById('maps-list').textContent.includes('PW XSS'),
        null, { timeout: 15000 });
      const r = await page.evaluate(() => ({
        pwned: window.__pwned === 1,
        escaped: document.getElementById('maps-list').innerHTML.includes('&lt;img'),
        noRawImg: !document.querySelector('#maps-list img'),
      }));
      expect(r.pwned).toBe(false); // the onerror never fired
      expect(r.escaped).toBe(true); // rendered as text, not markup
      expect(r.noRawImg).toBe(true); // no injected element
    } finally {
      await request.delete('/api/maps/' + id);
    }
  });
});
