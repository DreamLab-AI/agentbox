'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/web',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  },
  webServer: [
    {
      command: 'python3 -m http.server 18081 --bind 0.0.0.0 --directory voice/console/site',
      url: 'http://127.0.0.1:18081/',
      reuseExistingServer: true,
    },
    {
      command: 'python3 -m http.server 18082 --bind 0.0.0.0 --directory setup/frontend/dist',
      url: 'http://127.0.0.1:18082/',
      reuseExistingServer: true,
    },
  ],
});
