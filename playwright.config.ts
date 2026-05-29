/**
 * Playwright config for the cross-origin handshake integration test.
 *
 * Only one test file lives under `test/e2e/`; broader e2e coverage is
 * deliberately deferred (manual / scripted Keplr smoke test
 * stays out of CI).
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /.*\.spec\.ts$/,
  // The cross-origin handshake test exercises real timers + network; allow
  // a generous default per-test timeout but keep it bounded so a hung
  // browser does not stall CI.
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  // Single worker: the two ephemeral HTTP servers are created in the test
  // file's beforeAll, so parallelism would multi-bind the ports. We keep
  // tests serial for clarity.
  workers: 1,
  fullyParallel: false,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    // headless is the default; we leave the option visible so it can be
    // flipped via `--headed` on the CLI for local debugging.
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
