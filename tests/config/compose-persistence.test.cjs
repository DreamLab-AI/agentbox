// Host-side gate: inspect Compose's resolved model, never print environment values.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const cwd = path.resolve(__dirname, '../..');
const model = JSON.parse(execFileSync('docker', ['compose', '-f', 'docker-compose.yml',
  '-f', 'docker-compose.override.yml', 'config', '--format', 'json'], { cwd, encoding: 'utf8' }));
const expected = {
  '/var/lib/ruvector': 'agentbox-ruvector-data',
  '/var/lib/solid': 'agentbox-solid-data',
  '/var/lib/agentbox/identities': 'agentbox-sovereign-identities',
  '/var/lib/agentbox/secrets': 'agentbox-secrets',
  '/var/lib/agentbox/events': 'agentbox-events',
  '/var/lib/agentbox/code-harness': 'agentbox-code-harness-data',
  '/var/lib/agentbox/consultations': 'agentbox-consultations-data',
  '/var/lib/agentbox/telemetry': 'agentbox-telemetry-data',
  '/home/devuser/.config/agent-of-empires/profiles': 'agentbox-aoe-profiles',
  '/home/devuser/.cache/huggingface': 'agentbox-hf-cache',
  '/home/devuser/.local/share/code-server': 'agentbox-codeserver-config',
  '/home/devuser/.local/share/opencode': 'agentbox-opencode-store',
  '/home/devuser/.codex/packages': 'agentbox-codex-packages',
  '/var/lib/nostr-relay': 'agentbox-nostr-relay-data',
  '/var/lib/tailscale': 'agentbox-tailscale-state',
  '/home/devuser/.claude': 'agentbox-claude-home',
};
for (const [target, name] of Object.entries(expected)) {
  const mount = model.services.agentbox.volumes.find(v => v.target === target);
  assert.equal(mount?.type, 'volume', target);
  assert.equal(model.volumes[mount.source]?.name, name, target);
}
assert.equal(model.volumes['agentbox-claude-home'].external, true);
const instructions = model.services.agentbox.volumes.find(v => v.target === '/etc/agentbox/instructions');
assert.equal(instructions?.read_only, true);
assert.equal(model.services.agentbox.pids_limit, model.services.agentbox.deploy.resources.limits.pids);
console.log(`PASS: ${Object.keys(expected).length} persistent volume identities, external Claude home, read-only instructions and PID parity`);
