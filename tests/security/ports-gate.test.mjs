#!/usr/bin/env node
// ports-gate.test.mjs — ADR-2013 acceptance fixtures for the compose port gate.
//
// Each case writes a synthetic compose file into a temporary root and runs the
// ACTUAL gate (scripts/ci/check-ports-loopback.sh, which execs the .mjs) against
// that root. No Docker Compose evaluation, service launch or port binding
// occurs, and no fixture asserts anything about a deployed service.
//
// The four cases the estate review reproduced are the first four negative
// fixtures: a public port in block form was rejected while the SAME port in
// nested service-flow, JSON-flow and long syntax passed the old walker.
//
// Run: node tests/security/ports-gate.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const GATE = path.join(REPO, 'scripts/ci/check-ports-loopback.sh');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

function runGate(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2013-'));
  try {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    const r = spawnSync('sh', [GATE, dir], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// PUBLIC is the same door in six syntaxes; every one of them must be rejected.
const PUBLIC = '0.0.0.0:45678:45678';

const CASES = [
  // --- the reproduced bypass, in each syntax --------------------------------
  ['block sequence, public', 1, {
    'docker-compose.yml': `services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - "${PUBLIC}"\n`,
  }],
  ['nested service-flow mapping, public', 1, {
    'docker-compose.yml': `services:\n  fixture: {image: "fixture:no-launch", ports: ["${PUBLIC}"]}\n`,
  }],
  ['JSON flow document, public', 1, {
    'docker-compose.yml': JSON.stringify({ services: { fixture: { image: 'fixture:no-launch', ports: [PUBLIC] } } }, null, 2) + '\n',
  }],
  ['flow sequence on the ports key, public', 1, {
    'docker-compose.yml': `services:\n  fixture:\n    image: fixture:no-launch\n    ports: ["${PUBLIC}"]\n`,
  }],
  ['long syntax, public', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - target: 45678\n        published: 45678\n        host_ip: 0.0.0.0\n',
  }],
  ['inline flow long syntax, public', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - {target: 45678, published: 45678, host_ip: 0.0.0.0}\n',
  }],
  ['long syntax with no host_ip, public by default', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - target: 45678\n        published: 45678\n',
  }],

  // --- anchors, aliases and merge keys --------------------------------------
  ['alias to a public ports list', 1, {
    'docker-compose.yml': `x-public: &pub\n  - "${PUBLIC}"\nservices:\n  fixture:\n    image: fixture:no-launch\n    ports: *pub\n`,
  }],
  ['merge key pulling in a public ports list', 1, {
    'docker-compose.yml': `x-base: &base\n  ports:\n    - "${PUBLIC}"\nservices:\n  fixture:\n    <<: *base\n    image: fixture:no-launch\n`,
  }],
  ['alias to a loopback ports list', 0, {
    'docker-compose.yml': 'x-lo: &lo\n  - "127.0.0.1:45678:45678"\nservices:\n  fixture:\n    image: fixture:no-launch\n    ports: *lo\n',
  }],

  // --- unauditable shapes ---------------------------------------------------
  ['environment interpolation in the host address', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - "${HOST:-0.0.0.0}:45678:45678"\n',
  }],
  ['port range', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - "127.0.0.1:45000-45005:45000-45005"\n',
  }],
  ['bare container-only port', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - 45678\n',
  }],
  ['IPv6 wildcard bind', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - "[::]:45678:45678"\n',
  }],
  ['IPv6 loopback bind is still rejected', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - "[::1]:45678:45678"\n',
  }],
  ['ports value is a scalar, not a list', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports: "127.0.0.1:45678:45678"\n',
  }],
  ['unknown long-syntax key', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - target: 45678\n        published: 45678\n        host_ip: 127.0.0.1\n        bind_all: true\n',
  }],
  ['tab in indentation is rejected as unparseable', 2, {
    'docker-compose.yml': 'services:\n  fixture:\n\t\timage: fixture:no-launch\n',
  }],
  ['unterminated flow collection is rejected as unparseable', 2, {
    'docker-compose.yml': 'services:\n  fixture: {image: "x", ports: ["127.0.0.1:1:1"\n',
  }],
  ['undefined alias is rejected as unparseable', 2, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: x\n    ports: *nowhere\n',
  }],
  ['YAML tag is rejected as unparseable', 2, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: !!str x\n    ports:\n      - "127.0.0.1:1:1"\n',
  }],

  // --- filename scope: EVERY compose file is audited, not just the root one --
  ['public port in a non-root-named overlay file', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: x\n    ports:\n      - "127.0.0.1:1:1"\n',
    'docker-compose.sneaky.yml': `services:\n  other:\n    image: x\n    ports:\n      - "${PUBLIC}"\n`,
  }],
  ['public port in a .yaml-suffixed compose file', 1, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: x\n    ports:\n      - "127.0.0.1:1:1"\n',
    'docker-compose.extra.yaml': `services:\n  other:\n    image: x\n    ports:\n      - "${PUBLIC}"\n`,
  }],
  ['public port in a second YAML document of the same file', 1, {
    'docker-compose.yml': `services:\n  a:\n    image: x\n    ports:\n      - "127.0.0.1:1:1"\n---\nservices:\n  b:\n    image: x\n    ports:\n      - "${PUBLIC}"\n`,
  }],
  ['public port under a top-level x- extension', 1, {
    'docker-compose.yml': `x-template:\n  ports:\n    - "${PUBLIC}"\nservices:\n  fixture:\n    image: x\n    ports:\n      - "127.0.0.1:1:1"\n`,
  }],

  // --- accepted shapes ------------------------------------------------------
  ['loopback block mapping', 0, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - "127.0.0.1:45678:45678"\n',
  }],
  ['loopback unquoted', 0, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - 127.0.0.1:45678:45678\n',
  }],
  ['loopback single-quoted with a udp protocol suffix', 0, {
    'docker-compose.yml': "services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - '127.0.0.1:45678:45678/udp'\n",
  }],
  ['loopback long syntax', 0, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: fixture:no-launch\n    ports:\n      - target: 45678\n        published: 45678\n        host_ip: 127.0.0.1\n        protocol: tcp\n',
  }],
  ['loopback JSON flow', 0, {
    'docker-compose.yml': JSON.stringify({ services: { fixture: { image: 'x', ports: ['127.0.0.1:45678:45678'] } } }, null, 2) + '\n',
  }],
  ['a sanctioned mapping in its governing file', 0, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: x\n    ports:\n      - "9096:9096"\n',
  }],
  ['comments and block scalars do not confuse the parser', 0, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: x   # trailing comment\n    command: |\n      ports:\n        - "0.0.0.0:45678:45678"\n    ports:\n      # a comment inside the block\n      - "127.0.0.1:45678:45678"\n',
  }],
  ['a compose file with no ports at all', 0, {
    'docker-compose.yml': 'services:\n  fixture:\n    image: x\n',
  }],
];

console.log('ADR-2013 — compose ports gate');
for (const [name, expected, files] of CASES) {
  const r = runGate(files);
  check(`${name} -> exit ${expected}`, r.status === expected,
    `got ${r.status}; stdout=${r.stdout.trim()} stderr=${r.stderr.trim().split('\n').slice(0, 3).join(' | ')}`);
}

// --- sanctioned entries are matched semantically, not by spelling ------------
console.log('\n[sanctioned matching is on the normalised tuple]');
{
  const r = runGate({ 'docker-compose.yml': 'services:\n  fixture:\n    image: x\n    ports:\n      - target: 9096\n        published: 9096\n' });
  check('the 9096 ingress is sanctioned in long syntax too', r.status === 0, `${r.status} ${r.stderr.trim()}`);
}
{
  // Same mapping, wrong file: the sanction is bound to a file, not global.
  const r = runGate({
    'docker-compose.yml': 'services:\n  a:\n    image: x\n    ports:\n      - "127.0.0.1:1:1"\n',
    'docker-compose.voice.yml': 'services:\n  b:\n    image: x\n    ports:\n      - "9096:9096"\n',
  });
  check('a sanction does not transfer to another compose file', r.status === 1, `${r.status} ${r.stderr.trim()}`);
}
{
  // A sanctioned port number with a different target is a different door.
  const r = runGate({ 'docker-compose.yml': 'services:\n  a:\n    image: x\n    ports:\n      - "9096:9097"\n' });
  check('a sanctioned published port with a different target is rejected', r.status === 1, `${r.status} ${r.stderr.trim()}`);
}

// --- missing input and missing implementation --------------------------------
console.log('\n[input and wrapper failure modes]');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2013-empty-'));
  try {
    const r = spawnSync('sh', [GATE, dir], { encoding: 'utf8' });
    check('a root with no compose files fails rather than passing', r.status === 3, `${r.status}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
{
  // A copy of the wrapper on its own must not look like a pass — this is the
  // shape the estate probe used when it copied the old gate into a temp root.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2013-lonely-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts/ci'), { recursive: true });
    const copy = path.join(dir, 'scripts/ci/check-ports-loopback.sh');
    fs.copyFileSync(GATE, copy);
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), `services:\n  fixture:\n    image: x\n    ports:\n      - "${PUBLIC}"\n`);
    const r = spawnSync('sh', [copy], { encoding: 'utf8' });
    check('the wrapper copied without its gate fails loudly', r.status === 3 && /gate implementation missing/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// --- the real tree still passes ---------------------------------------------
console.log('\n[current tree]');
{
  const r = spawnSync('sh', [GATE], { encoding: 'utf8', cwd: REPO });
  check('the checked-in compose files pass the gate', r.status === 0, `${r.status} ${r.stderr.trim()}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
