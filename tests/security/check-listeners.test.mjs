#!/usr/bin/env node
// check-listeners.test.mjs — ADR-2062 acceptance fixtures for the LISTENER half
// of scripts/ci/check-ports-loopback.mjs.
//
// ADR-2013's gate reasons about compose `ports:`, i.e. what is published to the
// HOST. ADR-2062 extends it to what a supervised program BINDS inside the
// container, because a container-internal 0.0.0.0 bind on a shared docker
// network is reachable by every sibling container and is invisible to a
// ports-based gate in any syntax.
//
// Each case feeds SYNTHETIC supervisor-block text (the shape flake.nix
// generates) straight to the exported checker. Nothing is built, no supervisord
// runs, no socket is bound, and no fixture asserts anything about a deployed
// service. Two end-to-end cases additionally run the real .sh wrapper against a
// temporary root to prove the rule is wired into the CI entry point and that a
// root with no flake.nix is reported rather than silently passed.
//
// Run: node --test tests/security/check-listeners.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { checkListeners, classifyAddress, resolveNixValue, collectNixLetBindings }
  from '../../scripts/ci/check-ports-loopback.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const GATE = path.join(REPO, 'scripts/ci/check-ports-loopback.sh');

// A supervisor block as flake.nix generates it, wrapped in the `''` string
// terminator so the block boundary is the real one the parser looks for.
const block = (name, command, environment = 'HOME="/home/devuser"') => `
        supervisorText = ''
[program:${name}]
command=${command}
user=devuser
environment=${environment}
autostart=true
'';
`;

const names = (v) => v.map((x) => x.split(' ').find((w) => w.startsWith('[program:')));

// ---------------------------------------------------------------------------
test('loopback bind passes with no sanction — the aoe-serve shape', () => {
  const r = checkListeners(block('aoe-serve',
    '${aoePkg}/bin/aoe serve --auth token --behind-proxy --allowed-host 127.0.0.1 --host 127.0.0.1 --port 9095'));
  assert.deepEqual(r.violations, [], 'a loopback listener must not need a sanction');
  assert.deepEqual(r.unresolved, []);
  assert.ok(r.listeners.length >= 1);
  assert.ok(r.listeners.every((l) => l.verdict === 'loopback'));
});

test('non-loopback SANCTIONED passes and carries its reason', () => {
  const r = checkListeners(block('code-server',
    '${pkgs.code-server}/bin/code-server --bind-addr 0.0.0.0:8080 --auth password'));
  assert.deepEqual(r.violations, [], 'code-server is on LISTENER_SANCTIONED (ADR-2040)');
  const l = r.listeners.find((x) => x.source === '--bind-addr');
  assert.equal(l.verdict, 'non-loopback');
  assert.match(l.sanction, /ADR-2040/);
});

test('non-loopback UNSANCTIONED fails, naming program, flag, address and line', () => {
  const r = checkListeners(block('rogue-service',
    '${pkgs.rogue}/bin/rogue --bind-addr 0.0.0.0:4242'));
  assert.equal(r.violations.length, 1);
  const v = r.violations[0];
  assert.match(v, /\[program:rogue-service\]/);
  assert.match(v, /--bind-addr/);
  assert.match(v, /0\.0\.0\.0/);
  assert.match(v, /^flake\.nix:\d+:/, 'a violation must cite a flake.nix line');
});

test('every argument spelling the ADR names is understood', () => {
  const spellings = [
    ['--bind-addr 0.0.0.0:4242', '--bind-addr'],
    ['--bind 0.0.0.0:4242', '--bind'],
    ['--host 0.0.0.0 --port 4242', '--host'],
    ['--listen 0.0.0.0 --port 4242', '--listen'],
    ['--ip=0.0.0.0 --port=4242', '--ip'],
    ['--address 0.0.0.0', '--address'],
    ['--port 0.0.0.0:4242', '--port'],
    ['--output=HEADLESS-1 0.0.0.0 4242', '(positional)'],   // the wayvnc shape
  ];
  for (const [args, source] of spellings) {
    const r = checkListeners(block('rogue-service', `/bin/rogue ${args}`));
    assert.equal(r.violations.length, 1, `${args} must be caught`);
    assert.ok(r.listeners.some((l) => l.source === source && l.verdict === 'non-loopback'),
      `${args} must be attributed to ${source}`);
  }
});

test('a loopback spelling of each flag is NOT flagged', () => {
  for (const args of ['--bind-addr 127.0.0.1:4242', '--ip=127.0.0.1', '--listen 127.0.0.1',
    '--host localhost', '--bind [::1]:4242']) {
    const r = checkListeners(block('quiet-service', `/bin/q ${args}`));
    assert.deepEqual(r.violations, [], `${args} is loopback`);
  }
});

test('environment-style HOST= and BIND= assignments are read', () => {
  const bad = checkListeners(block('rogue-service', '/bin/rogue',
    'HOME="/home/devuser",ROGUE_HOST="0.0.0.0"'));
  assert.equal(bad.violations.length, 1);
  assert.match(bad.violations[0], /env ROGUE_HOST/);

  const good = checkListeners(block('nostr-relay', '${relayPkg}/bin/nostr-rs-relay',
    'HOME="/home/devuser",AGENTBOX_RELAY_BIND="${relayCfg.bind or "127.0.0.1"}:${toString (relayCfg.port or 7777)}"'));
  assert.deepEqual(good.violations, [], 'the default resolves loopback');
  const l = good.listeners.find((x) => x.source === 'env AGENTBOX_RELAY_BIND');
  assert.equal(l.address, '127.0.0.1:7777', 'nested interpolation must resolve through the commas and quotes');
  assert.equal(l.defaulted, true, 'a manifest-overridable default must be marked');

  const badBind = checkListeners(block('rogue-service', '/bin/rogue',
    'HOME="/home/devuser",ROGUE_BIND="0.0.0.0:9999"'));
  assert.equal(badBind.violations.length, 1);

  const home = checkListeners(block('quiet-service', '/bin/q', 'HOME="/home/devuser"'));
  assert.deepEqual(home.listeners, [], 'HOME is not a bind address');
});

test('a ${...} bind resolved from a literal let binding is audited on its value', () => {
  const text = `
        mcpHubBind        = resHubCfg.bind or "127.0.0.1:9720";
` + block('agentbox-mcp-hub', '${agentboxMcpPkg}/bin/agentbox-mcp hub --bind ${mcpHubBind}');
  const r = checkListeners(text);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.unresolved, []);
  const l = r.listeners.find((x) => x.source === '--bind');
  assert.equal(l.address, '127.0.0.1:9720');
  assert.equal(l.defaulted, true);

  // The same shape defaulting NON-loopback is a violation, not a pass.
  const open = `
        openBind          = someCfg.bind or "0.0.0.0:9720";
` + block('rogue-service', '/bin/rogue --bind ${openBind}');
  assert.equal(checkListeners(open).violations.length, 1);
});

test('an UNRESOLVED interpolation is reported explicitly, never silently passed', () => {
  const r = checkListeners(block('rogue-service', '/bin/rogue --bind-addr ${somethingComputed}'));
  assert.deepEqual(r.violations, [], 'an unresolved value is not asserted to be a violation');
  assert.equal(r.unresolved.length, 1, 'it is reported as UNRESOLVED instead');
  assert.match(r.unresolved[0], /UNRESOLVED/);
  assert.match(r.unresolved[0], /\[program:rogue-service\]/);
  assert.ok(r.listeners.some((l) => l.verdict === 'UNRESOLVED'));
});

test('block boundaries stop at the end of the Nix string', () => {
  // A `*_BIND=` line far below the last block must not be attributed to it.
  const text = block('quiet-service', '/bin/q --host 127.0.0.1')
    + '\n          "SOMETHING_BIND=0.0.0.0:1234"\n';
  assert.deepEqual(checkListeners(text).violations, [],
    'text outside the supervisor string is not part of any program block');
});

test('address classification', () => {
  for (const a of ['127.0.0.1', '127.0.0.1:8080', 'localhost', '::1', '[::1]:80'])
    assert.equal(classifyAddress(a), 'loopback', a);
  for (const a of ['0.0.0.0', '0.0.0.0:8080', '192.168.2.132', '::', '[::]:80'])
    assert.equal(classifyAddress(a), 'non-loopback', a);
  assert.equal(classifyAddress('%(ENV_MANAGEMENT_API_PORT)s'), 'ignore');
});

test('let-binding collection and value resolution', () => {
  const lets = collectNixLetBindings('        a = "127.0.0.1";\n        b = cfg.x or "0.0.0.0";\n');
  assert.equal(lets.get('a'), '"127.0.0.1"');
  assert.equal(resolveNixValue('${a}', lets).value, '127.0.0.1');
  assert.equal(resolveNixValue('${b}', lets).defaulted, true);
  assert.equal(resolveNixValue('${nope}', lets).ok, false);
  assert.equal(resolveNixValue('0.0.0.0:8080', lets).value, '0.0.0.0:8080');
});

// --- end to end, through the CI entry point ---------------------------------

function runGate(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2062-'));
  try {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    const r = spawnSync('sh', [GATE, dir], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const LOOPBACK_COMPOSE = 'services:\n  fixture:\n    image: x\n    ports:\n      - "127.0.0.1:45678:45678"\n';

test('the wrapper applies the listener rule and fails an unsanctioned bind', () => {
  const r = runGate({
    'docker-compose.yml': LOOPBACK_COMPOSE,
    'flake.nix': block('rogue-service', '/bin/rogue --bind-addr 0.0.0.0:45679'),
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^PASS \(check-ports-loopback\):/m, 'the publish rule still reports its own verdict');
  assert.match(r.stderr, /FAIL \(check-listeners, ADR-2062\)/);
  assert.match(r.stderr, /\[program:rogue-service\]/);
});

test('the wrapper passes a loopback-only flake and enumerates the listeners', () => {
  const r = runGate({
    'docker-compose.yml': LOOPBACK_COMPOSE,
    'flake.nix': block('quiet-service', '/bin/q --host 127.0.0.1 --port 4242'),
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /LISTENERS \(check-listeners, ADR-2062\): 1 declared bind address/);
  assert.match(r.stdout, /\[program:quiet-service\] --host\s+127\.0\.0\.1\s+\[loopback\]/);
});

test('an unresolvable bind exits 2 (unauditable), not 0', () => {
  const r = runGate({
    'docker-compose.yml': LOOPBACK_COMPOSE,
    'flake.nix': block('rogue-service', '/bin/rogue --bind-addr ${somethingComputed}'),
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /UNRESOLVED/);
});

test('a root with no flake.nix reports that the rule did not apply', () => {
  const r = runGate({ 'docker-compose.yml': LOOPBACK_COMPOSE });
  assert.equal(r.status, 0, 'the compose-only fixtures of ADR-2013 must keep their exit codes');
  assert.match(r.stdout, /NOTE \(check-listeners, ADR-2062\): no flake\.nix/);
});
