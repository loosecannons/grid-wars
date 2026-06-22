// Playwright regression suite for GRID WARS. Tests drive the real game in a
// headless browser and assert against the exposed `window.__game` state (the
// engine is deterministic from a seed), plus the DOM for UI features.
//
// Run locally:  npm install -D @playwright/test && npx playwright install chromium
//               npm test
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.PORT || '8137';

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js', // exclude the standalone node relay.test.cjs
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    // force software WebGL so three.js renders in headless CI
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { PORT, MAPS_DIR: './tests/.maps-tmp' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
