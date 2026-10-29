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

test('approval cards still render timestamps after the session board is removed', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../../voice/console/site/app.js'), 'utf8');
  const nodes = new Map();
  const node = () => ({ children: [], appendChild(child) { this.children.push(child); }, addEventListener() {} });
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    createElement: node,
  };
  const context = vm.createContext({ document, window: {}, sessionStorage: { getItem() { return ''; } }, Date });
  // Load the same definitions used by the live console, without starting its polls.
  vm.runInContext(source.slice(0, source.indexOf('// ── boot')), context);
  vm.runInContext(`approvals = [{ request_event_id: 'request-1', title: 'Release request', created_at: ${Date.now() - 120000} }]; renderApprovals();`, context);
  assert.equal(nodes.get('approvals').children.length, 1);
  assert.equal(nodes.get('appr-count').textContent, '1');
  const card = nodes.get('approvals').children[0];
  assert.equal(card.children[0].textContent, 'Release request');
  assert.ok(card.children[1].children.some(child => child.textContent === '2m ago'));
});
