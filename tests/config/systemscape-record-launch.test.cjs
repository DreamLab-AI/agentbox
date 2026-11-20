const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = readFileSync('config/tmux-autostart.sh', 'utf8');
const block = script.slice(script.indexOf('SYSTEMSCAPE_FLAGS=""'), script.indexOf('# Retain bottom'));
assert(block.startsWith('SYSTEMSCAPE_FLAGS=""'));
const wait = script.match(/^_systemscape_wait_for_hosts\(\) \{[\s\S]*?^\}/m)?.[0];
assert(wait);
for (const mode of ['no-mount', 'operator-file', 'late-projection', 'timeout']) {
  test(`hosts projection wait: ${mode}`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'systemscape-wait-'));
    try {
      const mounted = path.join(tmp, 'mounted'), projected = path.join(tmp, 'projected');
      if(mode !== 'no-mount') fs.writeFileSync(mounted, 'fixture');
      if(mode === 'operator-file') fs.writeFileSync(projected, 'operator file');
      const code = `${wait}\ncount=0\nsleep() { count=$((count+1)); if [ "$MODE" = late-projection ]; then printf fixture > "$PROJECTED"; fi; }\n_systemscape_wait_for_hosts "$MOUNTED" "$PROJECTED" 2\nprintf '%s' "$count"`;
      const r = spawnSync('bash', ['-eu', '-c', code], {encoding:'utf8', env:{...process.env, MODE:mode,MOUNTED:mounted,PROJECTED:projected}});
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, mode==='timeout'?'2':mode==='late-projection'?'1':'0');
      assert.equal(r.stderr.includes('WARN'),mode==='timeout');
      if(mode==='operator-file') assert.equal(fs.readFileSync(projected,'utf8'),'operator file');
    } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  });
}
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
