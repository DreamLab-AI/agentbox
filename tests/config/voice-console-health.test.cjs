const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('voice console reaps children and probes the actual HTTPS origin without BusyBox wget', () => {
  const compose = fs.readFileSync(path.join(__dirname, '../../docker-compose.voice.yml'), 'utf8');
  const service = compose.split(/^  voice-console:\s*$/m)[1]?.split(/^volumes:\s*$/m)[0];
  assert.ok(service, 'voice-console service exists');
  assert.match(service, /^    init: true\s*$/m);
  assert.match(service, /test:\s*\["CMD",\s*"curl",\s*"-kfsS",\s*"-o",\s*"\/dev\/null",\s*"https:\/\/localhost:8444\/"\]/);
  assert.doesNotMatch(service, /test:\s*\["CMD",\s*"wget"/);
});
