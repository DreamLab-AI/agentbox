const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = readFileSync('config/tmux-autostart.sh', 'utf8');
const block = script.slice(script.indexOf('SYSTEMSCAPE_FLAGS=""'), script.indexOf('# Retain bottom'));
assert(block.startsWith('SYSTEMSCAPE_FLAGS=""'));
for (const [name, help, status, expected] of [
  ['current binary records', 'Usage: systemscape [--record]', 0, 'systemscape --record;'],
  ['older binary stays plain', 'Usage: systemscape [--demo]', 0, 'systemscape;'],
  ['failed help stays plain', '', 127, 'systemscape;'],
]) {
  test(name, () => {
    const result = spawnSync('bash', ['-euc', `
      systemscape() { printf '%s\\n' "$HELP_TEXT"; return "$HELP_STATUS"; }
      tmux() { printf '%s\\n' "$@"; }
      SESSION=fixture
      ${block}
    `], { encoding: 'utf8', env: { ...process.env, HELP_TEXT: help, HELP_STATUS: String(status) } });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes(`while true; ${expected}`), result.stdout);
    assert(result.stdout.includes('fixture:5'));
  });
}
