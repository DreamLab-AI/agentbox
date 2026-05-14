'use strict';
const { execFileSync } = require('child_process');

module.exports = function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(); } catch {}
  try { return execFileSync('which', ['chromium-browser'], { encoding: 'utf8' }).trim(); } catch {}
  try { return execFileSync('which', ['google-chrome-stable'], { encoding: 'utf8' }).trim(); } catch {}
  return '/usr/bin/chromium';
};
