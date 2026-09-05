#!/usr/bin/env node
// mcp-projector.test.mjs — ADR-2008 acceptance tests for scripts/project-mcp-servers.mjs.
//
// Each case runs the ACTUAL projector as a child process against a temporary
// registry/target/ledger triple with a fresh environment, so nothing here
// touches the live .mcp.json. The four defects the estate review reproduced
// (see the script header, D1-D4) each have a case that fails if the fix is
// reverted, plus atomicity, ownership and no-op coverage.
//
// Run: node tests/config/mcp-projector.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SCRIPT = path.join(REPO, 'scripts/project-mcp-servers.mjs');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

const MANAGED = {
  command: 'fixture-no-execution',
  args: ['--fixture'],
  'x-agentbox-managed-by': 'projector',
  'x-agentbox-gate': 'env:FIXTURE_GATE',
  'x-agentbox-requires': [],
};
const BESPOKE_TARGET = { command: 'preserve-fixture' };

function scratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2008-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Run the projector. `registry` may be a string (written verbatim, for malformed
// input) or an object. Returns the exit status plus the on-disk state after.
function run(dir, { registry, target, gate = 'true', env = {} } = {}) {
  const reg = path.join(dir, 'registry.json');
  const tgt = path.join(dir, 'target.json');
  const state = path.join(dir, 'ledger.json');
  if (registry !== undefined) {
    fs.writeFileSync(reg, typeof registry === 'string' ? registry : JSON.stringify(registry, null, 2));
  }
  if (target !== undefined) fs.writeFileSync(tgt, JSON.stringify(target, null, 2));
  const before = fs.existsSync(tgt) ? fs.readFileSync(tgt, 'utf8') : null;
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, MCP_REGISTRY: reg, MCP_JSON: tgt, MCP_PROJECTION_STATE: state, FIXTURE_GATE: gate, ...env },
    encoding: 'utf8',
  });
  const after = fs.existsSync(tgt) ? fs.readFileSync(tgt, 'utf8') : null;
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    before,
    after,
    servers: (() => { try { return after === null ? null : (JSON.parse(after).mcpServers || {}); } catch { return null; } })(),
    ledger: fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : null,
    paths: { reg, tgt, state },
  };
}

console.log('ADR-2008 — MCP projector reconcile');

// --- baseline: gate open projects, gate closed reconciles out ---------------
console.log('\n[gate evaluation]');
scratch((dir) => {
  const r = run(dir, {
    registry: { mcpServers: { managed: MANAGED } },
    target: { mcpServers: { managed: { command: 'old-fixture' }, bespoke: BESPOKE_TARGET } },
    gate: 'true',
  });
  check('gate-on projects the managed entry', r.status === 0 && r.servers.managed?.command === 'fixture-no-execution', `status=${r.status} ${JSON.stringify(r.servers)}`);
  check('gate-on strips x-agentbox-* annotations', !Object.keys(r.servers.managed || {}).some((k) => k.startsWith('x-agentbox-')));
  check('gate-on preserves the bespoke entry', JSON.stringify(r.servers.bespoke) === JSON.stringify(BESPOKE_TARGET));
  check('gate-on records ownership in the ledger', !!r.ledger?.owned?.managed);
  check('gate-on does not claim the bespoke entry', !r.ledger?.owned?.bespoke);
});
scratch((dir) => {
  const r = run(dir, {
    registry: { mcpServers: { managed: MANAGED } },
    target: { mcpServers: { managed: { command: 'old-fixture' }, bespoke: BESPOKE_TARGET } },
    gate: 'false',
  });
  check('gate-off removes the managed entry', r.status === 0 && !('managed' in r.servers), JSON.stringify(r.servers));
  check('gate-off preserves the bespoke entry', JSON.stringify(r.servers.bespoke) === JSON.stringify(BESPOKE_TARGET));
});

// --- D1: a definition deleted from the registry must be removed -------------
console.log('\n[D1 deleted definition]');
scratch((dir) => {
  const first = run(dir, {
    registry: { mcpServers: { managed: MANAGED } },
    target: { mcpServers: { bespoke: BESPOKE_TARGET } },
    gate: 'true',
  });
  check('D1 setup: entry projected and owned', first.status === 0 && 'managed' in first.servers && !!first.ledger.owned.managed);
  // Registry rewritten with the definition gone; target left as the first run wrote it.
  const second = run(dir, { registry: { mcpServers: {} }, gate: 'true' });
  check('D1 deleted definition is removed from the target', second.status === 0 && !('managed' in second.servers), JSON.stringify(second.servers));
  check('D1 bespoke entry survives the removal', JSON.stringify(second.servers.bespoke) === JSON.stringify(BESPOKE_TARGET));
  check('D1 ownership is released', !second.ledger.owned.managed);
  check('D1 removal is recorded in the ledger history',
    (second.ledger.history || []).some((h) => h.name === 'managed' && h.event === 'definition-removed'),
    JSON.stringify(second.ledger.history));
});
scratch((dir) => {
  const first = run(dir, { registry: { mcpServers: { managed: MANAGED } }, target: { mcpServers: {} }, gate: 'true' });
  check('D1 setup (rename): entry owned', first.status === 0 && !!first.ledger.owned.managed);
  // Renamed: old name gone, new name present.
  const second = run(dir, { registry: { mcpServers: { renamed: MANAGED } }, gate: 'true' });
  check('D1 rename removes the old name', !('managed' in second.servers), JSON.stringify(second.servers));
  check('D1 rename projects the new name', second.servers.renamed?.command === 'fixture-no-execution');
});
scratch((dir) => {
  const first = run(dir, { registry: { mcpServers: { managed: MANAGED } }, target: { mcpServers: {} }, gate: 'true' });
  check('D1 setup (demotion): entry owned', first.status === 0 && !!first.ledger.owned.managed);
  const demoted = { ...MANAGED, 'x-agentbox-managed-by': 'bespoke' };
  const second = run(dir, { registry: { mcpServers: { managed: demoted } }, gate: 'true' });
  check('D1 demotion to bespoke removes the projected entry', !('managed' in second.servers), JSON.stringify(second.servers));
});
scratch((dir) => {
  // An entry the projector has NEVER owned must not be deleted, even though the
  // registry does not mention it — that is the bespoke-preservation guarantee.
  const r = run(dir, {
    registry: { mcpServers: {} },
    target: { mcpServers: { handwritten: { command: 'never-touch' } } },
    gate: 'true',
  });
  check('unowned target entry is never removed', r.status === 0 && r.servers.handwritten?.command === 'never-touch', JSON.stringify(r.servers));
});

// --- D4: a definition with no x-agentbox-requires array ---------------------
console.log('\n[D4 missing requirements array]');
scratch((dir) => {
  const noReqs = { ...MANAGED };
  delete noReqs['x-agentbox-requires'];
  const r = run(dir, {
    registry: { mcpServers: { managed: noReqs } },
    target: { mcpServers: { managed: { command: 'old-fixture' }, bespoke: BESPOKE_TARGET } },
    gate: 'true',
  });
  check('D4 gated-on entry with no requires array is RETAINED', r.status === 0 && r.servers.managed?.command === 'fixture-no-execution', `status=${r.status} ${JSON.stringify(r.servers)}`);
  check('D4 the empty requirement set is reported explicitly', /no x-agentbox-requires declared/.test(r.stdout), r.stdout.trim());
});
scratch((dir) => {
  const nullReqs = { ...MANAGED, 'x-agentbox-requires': null };
  const r = run(dir, { registry: { mcpServers: { managed: nullReqs } }, target: { mcpServers: {} }, gate: 'true' });
  check('D4 null requires is the empty requirement set', r.status === 0 && 'managed' in r.servers, `status=${r.status} ${JSON.stringify(r.servers)}`);
});
scratch((dir) => {
  const unmet = { ...MANAGED, 'x-agentbox-requires': [{ envset: 'FIXTURE_NEVER_SET_20260905' }] };
  const r = run(dir, { registry: { mcpServers: { managed: unmet } }, target: { mcpServers: { managed: { command: 'old' } } }, gate: 'true' });
  check('unmet requirement still reconciles the entry out', r.status === 0 && !('managed' in r.servers), JSON.stringify(r.servers));
});

// --- D2/D3: malformed and schema-invalid registries -------------------------
console.log('\n[D2/D3 malformed and invalid registry]');
const INVALID = [
  ['truncated JSON', '{'],
  ['root is an array', '[]'],
  ['mcpServers is a string', JSON.stringify({ mcpServers: 'nope' })],
  ['args is a string', JSON.stringify({ mcpServers: { managed: { ...MANAGED, args: '--fixture' } } })],
  ['no command or url', JSON.stringify({ mcpServers: { managed: { ...MANAGED, command: undefined } } })],
  ['bogus gate expression', JSON.stringify({ mcpServers: { managed: { ...MANAGED, 'x-agentbox-gate': 'whenever' } } })],
  ['requires is a string', JSON.stringify({ mcpServers: { managed: { ...MANAGED, 'x-agentbox-requires': 'bin' } } })],
  ['unknown managed-by', JSON.stringify({ mcpServers: { managed: { ...MANAGED, 'x-agentbox-managed-by': 'magic' } } })],
  ['env value is not a string', JSON.stringify({ mcpServers: { managed: { ...MANAGED, env: { A: 1 } } } })],
];
for (const [label, body] of INVALID) {
  scratch((dir) => {
    const r = run(dir, { registry: body, target: { mcpServers: { managed: { command: 'old-fixture' }, bespoke: BESPOKE_TARGET } }, gate: 'true' });
    check(`invalid registry (${label}) exits non-zero`, r.status === 2, `status=${r.status} stderr=${r.stderr.trim()}`);
    check(`invalid registry (${label}) leaves the target byte-identical`, r.before === r.after);
    check(`invalid registry (${label}) reports the reason on stderr`, r.stderr.trim().length > 0);
  });
}

// --- target-side failures ---------------------------------------------------
console.log('\n[target failures]');
scratch((dir) => {
  const r = run(dir, { registry: { mcpServers: { managed: MANAGED } }, target: undefined, gate: 'true' });
  check('absent target exits non-zero and writes nothing', r.status === 3 && r.after === null, `status=${r.status}`);
});
scratch((dir) => {
  const tgt = path.join(dir, 'target.json');
  fs.writeFileSync(tgt, '{ not json');
  const r = run(dir, { registry: { mcpServers: { managed: MANAGED } }, gate: 'true' });
  check('unparseable target exits non-zero', r.status === 3, `status=${r.status}`);
  check('unparseable target is left untouched', fs.readFileSync(tgt, 'utf8') === '{ not json');
});
scratch((dir) => {
  // Atomic replacement: an unwritable directory must fail loudly with the old
  // target intact, never a truncated or half-written file.
  const sub = path.join(dir, 'ro');
  fs.mkdirSync(sub);
  const tgt = path.join(sub, 'target.json');
  const reg = path.join(dir, 'registry.json');
  const original = JSON.stringify({ mcpServers: { bespoke: BESPOKE_TARGET } }, null, 2);
  fs.writeFileSync(tgt, original);
  fs.writeFileSync(reg, JSON.stringify({ mcpServers: { managed: MANAGED } }));
  fs.chmodSync(sub, 0o500);
  try {
    const r = spawnSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, MCP_REGISTRY: reg, MCP_JSON: tgt, MCP_PROJECTION_STATE: path.join(dir, 'ledger.json'), FIXTURE_GATE: 'true' },
      encoding: 'utf8',
    });
    check('unwritable target directory exits non-zero', r.status === 3, `status=${r.status} stderr=${(r.stderr || '').trim()}`);
    check('unwritable target keeps its previous content', fs.readFileSync(tgt, 'utf8') === original);
    check('no temp file is left behind', fs.readdirSync(sub).filter((f) => f.includes('.tmp-')).length === 0, fs.readdirSync(sub).join(','));
  } finally { fs.chmodSync(sub, 0o700); }
});

// --- idempotence and dry-run ------------------------------------------------
console.log('\n[idempotence]');
scratch((dir) => {
  const first = run(dir, { registry: { mcpServers: { managed: MANAGED } }, target: { mcpServers: {} }, gate: 'true' });
  const second = run(dir, { gate: 'true' });
  check('second run is a no-op on content', first.after === second.after);
  check('second run reports already-current', /already-current=1/.test(second.stdout), second.stdout.trim());
});
scratch((dir) => {
  const reg = path.join(dir, 'registry.json');
  const tgt = path.join(dir, 'target.json');
  fs.writeFileSync(reg, JSON.stringify({ mcpServers: { managed: MANAGED } }));
  const original = JSON.stringify({ mcpServers: { bespoke: BESPOKE_TARGET } }, null, 2);
  fs.writeFileSync(tgt, original);
  const r = spawnSync(process.execPath, [SCRIPT, '--dry-run'], {
    env: { PATH: process.env.PATH, MCP_REGISTRY: reg, MCP_JSON: tgt, MCP_PROJECTION_STATE: path.join(dir, 'ledger.json'), FIXTURE_GATE: 'true' },
    encoding: 'utf8',
  });
  check('dry run exits zero', r.status === 0, `status=${r.status}`);
  check('dry run writes nothing', fs.readFileSync(tgt, 'utf8') === original);
});

// --- the live registry must satisfy the schema ------------------------------
console.log('\n[live registry]');
scratch((dir) => {
  const live = path.join(REPO, 'skills/mcp.json');
  const tgt = path.join(dir, 'target.json');
  fs.writeFileSync(tgt, JSON.stringify({ mcpServers: {} }, null, 2));
  const r = spawnSync(process.execPath, [SCRIPT, '--dry-run'], {
    env: { PATH: process.env.PATH, MCP_REGISTRY: live, MCP_JSON: tgt, MCP_PROJECTION_STATE: path.join(dir, 'ledger.json') },
    encoding: 'utf8',
  });
  check('skills/mcp.json passes schema validation', r.status === 0, `status=${r.status} stderr=${(r.stderr || '').trim()}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
