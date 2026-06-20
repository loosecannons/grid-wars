# Regression tests

Playwright end-to-end suite. Each test drives the **real** game in a headless
browser and asserts against the engine's exposed `window.__game` state (the
simulation is deterministic from a seed) and the live DOM.

## Run

```bash
# one-time: install the test runner (kept OUT of package.json deps on purpose,
# so the Docker `npm ci --omit=dev` build and the lockfile stay lean)
npm install --no-save @playwright/test
npx playwright install chromium

npm test
```

The config (`../playwright.config.js`) boots `node server.js` on port **8137**
with `MAPS_DIR=./tests/.maps-tmp` and forces software WebGL so three.js renders
without a GPU. In CI it runs via `.github/workflows/test.yml`.

## Coverage

| spec | feature |
|------|---------|
| `01-smoke` | start menu entry points, seeded skirmish boots & renders, no console errors |
| `02-combat` | `applyDamage` + derez, directional rear/front multipliers, focus fire |
| `03-terrain` | pit/plateau impassability vs flyers, idle self-repair, heal-pad restore |
| `04-portal` | boundary-crack portal: first impact derezzes, second cycle warps, rough-landing derez |
| `05-editor` | authored map plays with exact terrain + placements, validation gate |
| `06-maps-api` | `/api/maps` CRUD round-trip, malformed-body & bad-id rejection |
| `07-ui` | render-mode + theme toggles, manual overlay, unit-card iconify, chat hide |
| `08-serialize` | serialize fidelity, resume-snapshot completeness, `exportMap` |
| `09-easter-eggs` | victory crash (BSOD / Guru Meditation), new-release notice |

Helpers live in `helpers.js` (`bootSkirmish` skips the briefing via the
`gw-restart` path; `trackErrors` filters benign network noise).
