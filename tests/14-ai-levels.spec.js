const { test, expect } = require('@playwright/test');
const { bootSkirmish } = require('./helpers');

// #3/#4: selectable MCP skill levels backed by a bounded-lookahead search.
test.describe('AI skill levels (bounded lookahead)', () => {
  test('the chosen AI level flows from config to the faction', async ({ page }) => {
    await bootSkirmish(page, {
      factions: [
        { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
        { name: 'MCP', color: 1, controller: 'ai', team: 2, aiLevel: 5 },
      ],
    });
    const r = await page.evaluate(() => ({
      level: window.__game.aiLevelOf(1),
      clamped: window.__game.factions[1].aiLevel,
    }));
    expect(r.level).toBe(5);
    expect(r.clamped).toBe(5);
  });

  test('the lookahead values a kill over a retreat (search discriminates on combat)', async ({ page }) => {
    await bootSkirmish(page);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const mod = await import('/src/ai-search.js');
      const aiCyc = g.units.find((x) => x.alive && x.side === 1 && x.type === 'cycle');
      const foe = g.units.find((x) => x.alive && x.side === 0 && x.type !== 'core');
      // park the AI cycle next to a near-dead foe it can finish
      aiCyc.q = foe.q + 1; aiCyc.r = foe.r; g._setCellPos(aiCyc); foe.hp = 2;
      const kill = mod.lookaheadValue(g, 1, { unitId: aiCyc.id, q: aiCyc.q, r: aiCyc.r, targetId: foe.id }, 3);
      const flee = mod.lookaheadValue(g, 1, { unitId: aiCyc.id, q: aiCyc.q + 1, r: aiCyc.r, targetId: null }, 3);
      return { kill, flee, finite: isFinite(kill) && isFinite(flee), prefersKill: kill > flee };
    });
    expect(r.finite).toBe(true);
    expect(r.prefersKill).toBe(true);
  });

  test('a level-3 MCP plays a full turn without error', async ({ page }) => {
    await bootSkirmish(page, {
      factions: [
        { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
        { name: 'MCP', color: 1, controller: 'ai', team: 2, aiLevel: 3 },
      ],
    });
    const r = await page.evaluate(async () => {
      const g = window.__game;
      g.fx.speed = 200;
      const before = g.recording.events.length;
      document.getElementById('btn-endturn').click(); // hand the turn to the MCP
      const t0 = Date.now();
      while (g.recording.events.length < before + 2 && Date.now() - t0 < 20000 && !g.over) {
        await new Promise((res) => setTimeout(res, 200));
      }
      return { acted: g.recording.events.length - before, ms: Date.now() - t0 };
    });
    expect(r.acted).toBeGreaterThan(0); // the MCP took actions
    expect(r.ms).toBeLessThan(20000); // and didn't hang
  });
});
