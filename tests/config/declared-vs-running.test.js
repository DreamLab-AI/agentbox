'use strict';

/**
 * CY-A2 — scripts/ci/check-declared-vs-running.js. Runner: node:test
 * (`node --test tests/config/declared-vs-running.test.js`, wired into
 * .github/workflows/invariants.yml).
 *
 * The CLI cases run the check against the committed runtime snapshot
 * (tests/config/fixtures/runtime-state.json, captured on the box 2026-10-02):
 * it passed only once [voice].enabled said what runs, and it must fail again
 * if the declaration goes back to false.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { judge, prune } = require('../../scripts/ci/check-declared-vs-running.js');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK = path.join(ROOT, 'scripts', 'ci', 'check-declared-vs-running.js');
const SNAPSHOT = path.join(__dirname, 'fixtures', 'runtime-state.json');

const snap = (supervisor, containers) => ({ captured_at: 'fixture', supervisor, containers });
const verdicts = (r) => Object.fromEntries(r.rows.map((x) => [x.id, x.verdict]));

describe('judge', () => {
  test('declared off while the voice compose project runs: disagree', () => {
    const r = judge([{ id: 'voice-console', state: 'off', service: 'voice-console' }],
      snap({}, { 'voice-console': { state: 'running', project: 'agentbox-voice' }, 'agentbox-voice-backend-1': { state: 'running', project: 'agentbox-voice' } }));
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].reason, 'declared off, running');
    assert.deepEqual(r.failures[0].present, ['container:voice-console=running', 'container:agentbox-voice-backend-1=running']);
  });

  test('declared on with the supervisor program FATAL: disagree', () => {
    const r = judge([{ id: 'sidechain', state: 'on', service: 'sidestr-producer' }], snap({ 'sidestr-producer': 'FATAL' }, {}));
    assert.equal(r.failures[0].reason, 'declared on, not running');
  });

  test('declared on and RUNNING, declared off and absent: agree', () => {
    const r = judge([
      { id: 'sidechain', state: 'on', service: 'sidestr-producer' },
      { id: 'comfyui', state: 'off', service: 'comfyui-builtin' },
    ], snap({ 'sidestr-producer': 'RUNNING' }, {}));
    assert.deepEqual(verdicts(r), { sidechain: 'agree', comfyui: 'agree' });
  });

  test('a oneshot that EXITED ran; a long-running program that EXITED did not', () => {
    const r = judge([
      { id: 'terminal', state: 'on', service: 'tmux-autostart' },
      { id: 'dream-machine', state: 'on', service: 'dream-engine' },
    ], snap({ 'tmux-autostart': 'EXITED', 'dream-engine': 'EXITED' }, {}));
    assert.deepEqual(verdicts(r), { terminal: 'agree', 'dream-machine': 'disagree' });
  });

  test('an unread instrument leaves the unit unjudged, never "not running"', () => {
    const r = judge([{ id: 'browser-sidecar', state: 'on', service: 'browsercontainer' }], snap({ x: 'RUNNING' }, null));
    assert.equal(r.rows[0].verdict, 'unjudged');
    assert.equal(r.failures.length, 0);
  });

  test('a unit in neither source, both read: absent', () => {
    const r = judge([{ id: 'sovereign-mesh', state: 'on', service: 'nostr-pod-bridge' }], snap({ 'nostr-relay': 'RUNNING' }, {}));
    assert.equal(r.failures[0].reason, 'declared on, not running');
  });

  test('on-demand and undeclared entries are not judged', () => {
    const r = judge([
      { id: 'setup-wizard', state: 'on', service: 'setup' },
      { id: 'thing', state: 'available', service: 'thing' },
    ], snap({}, {}));
    assert.deepEqual(verdicts(r), { 'setup-wizard': 'on-demand' });
  });

  test('prune keeps catalogue units and UNITS projects, drops everything else', () => {
    const p = prune(snap({ a: 'RUNNING' }, {
      browsercontainer: { state: 'running', project: 'agentbox' },
      'agentbox-voice-traefik-1': { state: 'running', project: 'agentbox-voice' },
      'some-estate-gateway': { state: 'running', project: 'elsewhere' },
    }), [{ id: 'browser-sidecar', service: 'browsercontainer' }]);
    assert.deepEqual(Object.keys(p.containers).sort(), ['agentbox-voice-traefik-1', 'browsercontainer']);
  });
});

describe('CLI against the committed snapshot', () => {
  test('the repo manifest agrees with the captured runtime', () => {
    const r = spawnSync(process.execPath, [CHECK, '--state', SNAPSHOT], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('[voice] enabled = false fails against the same runtime', () => {
    const toml = fs.readFileSync(path.join(ROOT, 'agentbox.toml'), 'utf8');
    const flipped = toml.replace(/^(\[voice\]\nenabled\s*=\s*)true/m, '$1false');
    assert.notEqual(flipped, toml, 'the [voice] enabled line was not found');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-a2-'));
    try {
      fs.writeFileSync(path.join(dir, 'agentbox.toml'), flipped);
      const r = spawnSync(process.execPath, [CHECK, '--state', SNAPSHOT, '--manifest', path.join(dir, 'agentbox.toml')], { encoding: 'utf8' });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /voice-console \(declared off, running\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a snapshot with no source exits 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-a2-'));
    try {
      fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({ supervisor: null, containers: null, errors: ['docker: ENOENT'] }));
      const r = spawnSync(process.execPath, [CHECK, '--state', path.join(dir, 's.json')], { encoding: 'utf8' });
      assert.equal(r.status, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
