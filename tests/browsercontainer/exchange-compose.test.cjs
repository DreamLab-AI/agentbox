// ADR-2207 D2: one exchange path, the same absolute path in agentbox and the sidecar.
//
// Cases:
//   1. browsercontainer (Compose's resolved model) mounts the exchange volume at
//      /home/devuser/exchange, and the volume resolves to the live name
//      agentbox_gui-tools-exchange (pinned, so no migration and no project-name drift)
//   2. agentbox (docker-compose.override.yml) mounts the same volume at
//      /home/devuser/exchange AND keeps /home/devuser/gui-tools, the alias skills use
//   3. every compose file that declares gui-tools-exchange pins the identical name
//      expression, and none marks it external except isaac-sim (which needs the
//      volume to exist first, unchanged)
//   4. the sidecar passes BROWSER_DISPLAY_SIZE through with the 1920x1080 default
//      and its exchange directory to the bridge
// Case 1 inspects the resolved model like compose-profile-volume.test.cjs. Cases 2-3
// read the YAML text: the override's resolved model is checked host-side by
// tests/config/compose-persistence.test.cjs (it needs the host's .env).
// Run: node tests/browsercontainer/exchange-compose.test.cjs
'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cwd = path.resolve(__dirname, '../..');
const EXCHANGE = '/home/devuser/exchange';
const ALIAS = '/home/devuser/gui-tools';
const LIVE_NAME = 'agentbox_gui-tools-exchange';
const NAME_EXPR = '${GUI_TOOLS_EXCHANGE_VOLUME:-agentbox_gui-tools-exchange}';
let passed = 0;

// 1 -- resolved model of the sidecar file
const env = { ...process.env, NVIDIA_VISIBLE_DEVICES: 'all' };
delete env.GUI_TOOLS_EXCHANGE_VOLUME;
delete env.BROWSER_DISPLAY_SIZE;
const model = JSON.parse(execFileSync('docker', ['compose', '--project-name', 'agentbox',
  '-f', 'docker-compose.browsercontainer.yml', 'config', '--format', 'json'], { cwd, encoding: 'utf8', env }));
const svc = model.services.browsercontainer;
const mount = svc.volumes.find((v) => v.target === EXCHANGE);
assert.equal(mount?.type, 'volume', `browsercontainer mounts a volume at ${EXCHANGE}`);
assert.equal(mount.source, 'gui-tools-exchange');
assert.equal(model.volumes['gui-tools-exchange']?.name, LIVE_NAME, 'pinned to the live volume name');
assert.ok(!model.volumes['gui-tools-exchange'].external, 'compose may create it on a fresh host');
passed++;

// 2 -- agentbox (override file, text): both paths on the one volume
const override = fs.readFileSync(path.join(cwd, 'docker-compose.override.yml'), 'utf8');
const mountLines = override.split('\n').map((l) => l.trim())
  .filter((l) => /^- gui-tools-exchange:/.test(l));
assert.ok(mountLines.includes(`- gui-tools-exchange:${EXCHANGE}`), `agentbox mounts the exchange at ${EXCHANGE}`);
assert.ok(mountLines.includes(`- gui-tools-exchange:${ALIAS}`), `agentbox keeps the ${ALIAS} alias`);
passed++;

// 3 -- every declaration pins the same name
const files = fs.readdirSync(cwd).filter((f) => /^docker-compose.*\.yml$/.test(f));
const declaring = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(cwd, f), 'utf8');
  const top = text.split(/^volumes:\s*$/m)[1];
  if (!top || !/^ {2}gui-tools-exchange:/m.test(top)) continue;
  const block = top.split(/^ {2}gui-tools-exchange:\s*$/m)[1].split(/^ {2}\S/m)[0];
  const name = (block.match(/^ {4}name:\s*(\S+)\s*$/m) || [])[1];
  assert.equal(name, NAME_EXPR, `${f} pins gui-tools-exchange to ${NAME_EXPR}`);
  const external = /^ {4}external:\s*true\s*$/m.test(block);
  assert.equal(external, f === 'docker-compose.isaac-sim.yml', `${f} external flag unchanged`);
  declaring.push(f);
}
for (const f of ['docker-compose.override.yml', 'docker-compose.browsercontainer.yml',
  'docker-compose.gui-tools.yml', 'docker-compose.concat.yml', 'docker-compose.isaac-sim.yml']) {
  assert.ok(declaring.includes(f), `${f} declares gui-tools-exchange`);
}
passed++;

// 4 -- display size and exchange dir reach the sidecar
const envList = svc.environment;
assert.equal(envList.BROWSER_DISPLAY_SIZE, '1920x1080', 'BROWSER_DISPLAY_SIZE default passed through');
assert.equal(envList.BROWSER_EXCHANGE_DIR, EXCHANGE, 'the bridge is told where the exchange is');
passed++;

console.log(`PASS: ${passed} exchange checks (${EXCHANGE} in agentbox and browsercontainer, ${ALIAS} alias kept, ` +
  `name pinned in ${declaring.length} files)`);
