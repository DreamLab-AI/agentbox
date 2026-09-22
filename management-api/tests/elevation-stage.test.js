'use strict';
// ADR-2116 — an elevation stages its promoted page, validates it on its own,
// and only then runs `vault propose --diff`.
//
// Run: node --test management-api/tests/elevation-stage.test.js
//
// A stub `vault` on PATH answers `validate` with a scripted report and records
// every `propose` argv together with the CONTENT of the `--diff` target at the
// moment of the call (the staging directory is gone afterwards, by design).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stage = require('../lib/elevation-stage');
const { extractProposals } = require('../lib/kg-proposal-extractor');

const OWNER = 'a'.repeat(64);
const ENV = { AGENTBOX_DID: 'did:nostr:test', AGENTBOX_X_ONLY_PUBKEY_HEX: OWNER };

function descriptor(value, key = 'k1') {
  const { proposals } = extractProposals([{ key, value }], { ownerPubkey: OWNER, env: ENV, minScore: 0 });
  return proposals[0];
}

const NOTE = {
  preferred_term: 'Photon Sieve',
  definition: 'A diffractive optic that focuses light through a pattern of pinholes rather than zones.',
  domain: 'robotics',
  physicality: 'physical',
  role: 'component',
  working_page: 'Photon sieve notes',
};

/**
 * Stub vault. `report` is what `validate` prints (with `validateExit`);
 * `proposeOut` what `propose` prints. Returns readers for the propose log.
 */
function stubVault(t, { report = { knowledge: { issues: [] } }, validateExit = 0, findResult = [],
  proposeOut = { proposal: { level: 'content', blockers: [] }, event: { kind: 31402 } } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elev-stub-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'ontology'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ontology', 'vocabulary.yaml'), 'version: 1\n');
  fs.writeFileSync(path.join(repo, 'vault.toml'), '[vault]\nname = "t"\n');
  const log = path.join(dir, 'log.jsonl');
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(dir, 'propose.json'), JSON.stringify(proposeOut));
  fs.writeFileSync(path.join(dir, 'find.json'), JSON.stringify(findResult));
  // Node, not sh: the stub has to read the --diff target and log it as JSON.
  fs.writeFileSync(path.join(dir, 'vault'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const repo = argv[0] === '--repo' ? argv[1] : null;
const sub = argv[0] === '--repo' ? argv[2] : argv[0];
const entry = { repo, argv };
if (sub === 'validate') {
  entry.staged = fs.readdirSync(path.join(repo, 'knowledge', 'pages'));
  entry.stagedContent = entry.staged.map(f => fs.readFileSync(path.join(repo, 'knowledge', 'pages', f), 'utf8'));
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');
  process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'report.json'))}, 'utf8'));
  process.exit(${validateExit});
}
if (sub === 'find') {
  process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'find.json'))}, 'utf8'));
  process.exit(0);
}
if (sub === 'propose') {
  const d = argv[argv.indexOf('--diff') + 1];
  entry.diffIsDir = fs.statSync(d).isDirectory();
  entry.diff = entry.diffIsDir
    ? Object.fromEntries(fs.readdirSync(d).map(f => [f, fs.readFileSync(path.join(d, f), 'utf8')]))
    : { [path.basename(d)]: fs.readFileSync(d, 'utf8') };
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');
  process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'propose.json'))}, 'utf8'));
  process.exit(0);
}
process.stdout.write('null');
`, { mode: 0o755 });

  const saved = { PATH: process.env.PATH, VAULT_BIN: process.env.VAULT_BIN, VAULT_REPO: process.env.VAULT_REPO };
  process.env.PATH = `${dir}:${saved.PATH}`;
  delete process.env.VAULT_BIN;
  process.env.VAULT_REPO = repo;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const entries = () => (fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return {
    repo,
    tmpRoot: fs.mkdtempSync(path.join(dir, 'tmp-')),
    validates: () => entries().filter(e => e.argv.includes('validate')),
    proposes: () => entries().filter(e => e.argv.includes('propose')),
  };
}

// ── The staged page ─────────────────────────────────────────────────────────

test('the staged page is the promoted form: Class, slug IRI, draft, private, origin → working page', async () => {
  const raw = descriptor({ ...NOTE, is_subclass_of: ['urn:ngm:class:optical-element'],
    relationships: { 'has-part': ['Pinhole'] } });
  // IRIs become the id of the page that answers to them (a slug is not a link).
  const p = await stage.resolveRelationTargets(raw,
    { runVault: async (argv) => (argv[0] === 'find' ? [{ id: 'Optical Element' }] : null) });
  const pg = stage.renderStagedPage(p, { now: new Date('2026-09-22T12:00:00Z') });
  assert.equal(pg.id, 'Photon Sieve');
  assert.equal(pg.iri, 'urn:ngm:class:photon-sieve');
  assert.equal(pg.markdown, [
    '---',
    'type: Class',
    'title: "Photon Sieve"',
    'resource: "urn:ngm:class:photon-sieve"',
    'public: false',
    'status: draft',
    'domain: "robotics"',
    'generated:',
    '  by: "process:agentbox-kg-elevation/1.0"',
    '  at: "2026-09-22T12:00:00.000Z"',
    'has-part:',
    '- "[[Pinhole]]"',
    'is-a:',
    '- "[[Optical Element]]"',
    'sources:',
    '- id: origin',
    '  resource: "[[Photon sieve notes]]"',
    '---',
    NOTE.definition,
    '',
  ].join('\n'));
});

test('title is always the page id; a term that had to be sanitised survives as an alias', () => {
  const pg = stage.renderStagedPage(descriptor({ ...NOTE, preferred_term: 'TCP/IP Stack' }));
  assert.equal(pg.id, 'TCP IP Stack');
  assert.match(pg.markdown, /^title: "TCP IP Stack"$/m);
  assert.match(pg.markdown, /^aliases:\n- "TCP\/IP Stack"$/m);
  assert.equal(pg.iri, 'urn:ngm:class:tcp-ip-stack');
  const plain = stage.renderStagedPage(descriptor(NOTE)).markdown;
  assert.match(plain, /^title: "Photon Sieve"$/m);
  assert.doesNotMatch(plain, /^aliases:/m);
});

test('without a working page the origin is the lesson URN, else the proposal URN', () => {
  const { working_page, ...noPage } = NOTE; // eslint-disable-line no-unused-vars
  const p = descriptor(noPage);
  assert.equal(stage.originOf(p), p.proposal_urn);
  assert.equal(stage.originOf({ ...p, source_lesson_urn: 'urn:agentbox:memory:x:lesson-1' }),
    'urn:agentbox:memory:x:lesson-1');
});

// ── The gate ────────────────────────────────────────────────────────────────

test('a sound staged page is validated alone, then proposed with --diff <page file>', async (t) => {
  const stub = stubVault(t, {
    // A dangling relation target is corpus-relative: it does not disqualify.
    report: { knowledge: { issues: [{ path: 'Photon Sieve', severity: 'warning', code: 'DANGLING_LINK', message: 'x' }] } },
    validateExit: 1, // --strict exits non-zero on any finding; the report is still read
  });
  const out = await stage.gateElevation(descriptor(NOTE), { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });

  assert.equal(out.proposable, true, out.error);
  assert.equal(out.blocked, false);
  const [v] = stub.validates();
  assert.notEqual(v.repo, stub.repo, 'validation runs in a scratch repo, never the corpus');
  assert.deepEqual(v.staged, ['Photon Sieve.md'], 'the staged page and nothing else');
  assert.deepEqual(v.argv.slice(2), ['validate', '--strict', '--json']);

  const [pr] = stub.proposes();
  assert.equal(pr.repo, stub.repo, 'propose runs against the real repo');
  assert.equal(pr.diffIsDir, false);
  assert.deepEqual(Object.keys(pr.diff), ['Photon Sieve.md']);
  assert.equal(pr.diff['Photon Sieve.md'], v.stagedContent[0], 'propose sees exactly what was validated');
  const a = pr.argv.slice(2);
  assert.deepEqual(a.slice(0, 4), ['propose', 'urn:ngm:class:photon-sieve', '--level', 'content']);
  assert.ok(a.includes('--dry-run'));
  assert.ok(!a.includes('--title'), 'a single page needs no title');
  assert.deepEqual(fs.readdirSync(stub.tmpRoot), [], 'the staging dir is removed');
});

test('a staged page that fails validation is not proposable, and propose never runs', async (t) => {
  const stub = stubVault(t, {
    report: { knowledge: { issues: [
      { path: 'Photon Sieve', severity: 'error', code: 'UNKNOWN_KEY', message: '`frobnicates` is not in the vocabulary' },
    ] } },
    validateExit: 1,
  });
  const out = await stage.gateElevation(descriptor({ ...NOTE, relationships: { frobnicates: ['X'] } }),
    { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });
  assert.equal(out.proposable, false);
  assert.equal(out.blocked, true);
  assert.equal(out.proposal, null);
  assert.match(out.error, /not proposable — UNKNOWN_KEY \(Photon Sieve\): `frobnicates`/);
  assert.equal(out.stage_issues[0].code, 'UNKNOWN_KEY');
  assert.deepEqual(stub.proposes(), [], 'vault propose was never spawned');
  assert.deepEqual(fs.readdirSync(stub.tmpRoot), [], 'cleaned up on refusal too');
});

test('a manifest-level error disqualifies even though it names no page', async (t) => {
  const stub = stubVault(t, {
    report: { knowledge: { issues: [{ severity: 'error', code: 'VOCABULARY_UNREADABLE', message: 'bad' }] } },
  });
  const out = await stage.gateElevation(descriptor(NOTE), { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });
  assert.equal(out.proposable, false);
  assert.deepEqual(stub.proposes(), []);
});

test('several classes from one elevation go as ONE grouped proposal: --diff <dir> --title', async (t) => {
  const stub = stubVault(t);
  const out = await stage.gateElevation(
    [descriptor(NOTE, 'k1'), descriptor({ ...NOTE, preferred_term: 'Zone Plate', working_page: 'Zone notes' }, 'k2')],
    { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot, title: 'Diffractive optics' },
  );
  assert.equal(out.proposable, true, out.error);
  assert.deepEqual(out.staged, ['Photon Sieve', 'Zone Plate']);
  assert.deepEqual(stub.validates()[0].staged.sort(), ['Photon Sieve.md', 'Zone Plate.md']);
  const [pr] = stub.proposes();
  assert.equal(pr.diffIsDir, true);
  assert.deepEqual(Object.keys(pr.diff).sort(), ['Photon Sieve.md', 'Zone Plate.md']);
  const a = pr.argv;
  assert.equal(a[a.indexOf('--title') + 1], 'Diffractive optics');
  assert.deepEqual(fs.readdirSync(stub.tmpRoot), []);
});

test('two candidates staging one page id are refused before anything runs', async (t) => {
  const stub = stubVault(t);
  const out = await stage.gateElevation([descriptor(NOTE, 'k1'), descriptor(NOTE, 'k2')],
    { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });
  assert.equal(out.proposable, false);
  assert.equal(out.stage_issues[0].code, 'STAGE_COLLISION');
  assert.deepEqual(stub.validates(), []);
});

test('no resolvable repo: not proposable, nothing spawned', async (t) => {
  const stub = stubVault(t);
  const out = await stage.gateElevation(descriptor(NOTE), {
    env: { ...ENV, VAULT_REPO: '', VAULT_ROOT: '/nonexistent/knowledge' }, tmpRoot: stub.tmpRoot,
  });
  assert.equal(out.proposable, false);
  assert.equal(out.stage_issues[0].code, 'NO_REPO');
  assert.deepEqual(stub.validates(), []);
});

test('the pageIdFor rule never yields a path', () => {
  assert.equal(stage.pageIdFor('a/b\\c'), 'a b c');
  assert.throws(() => stage.pageIdFor('/'), /no usable page id/);
  assert.throws(() => stage.pageIdFor('..'), /no usable page id/);
});


test('elevation keeps nothing: after the gate, no staged bytes survive anywhere under tmpRoot', async (t) => {
  const stub = stubVault(t);
  const out = await stage.gateElevation(descriptor(NOTE), { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });
  assert.equal(out.proposable, true, out.error);
  assert.equal(out.stored, undefined);
  assert.deepEqual(fs.readdirSync(stub.tmpRoot), []);
});

// ── Relation targets resolve to real page ids before staging ────────────────

test('an IRI relation target is staged as the id of the corpus page that answers to it', async (t) => {
  const stub = stubVault(t, { findResult: [{ id: 'Optical Elements' }, { id: 'Optical Element' }] });
  const out = await stage.gateElevation(descriptor({ ...NOTE, is_subclass_of: ['urn:ngm:class:optical-element'] }),
    { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });
  assert.equal(out.proposable, true, out.error);
  const staged = stub.validates()[0].stagedContent[0];
  assert.match(staged, /^is-a:\n- "\[\[Optical Element\]\]"$/m, 'the exact-slug match, not the first hit');
});

test('an IRI relation target no corpus page answers to makes the candidate not proposable', async (t) => {
  const stub = stubVault(t, { findResult: [] });
  const out = await stage.gateElevation(descriptor({ ...NOTE, is_subclass_of: ['urn:ngm:class:no-such-class'] }),
    { env: { ...process.env, ...ENV }, tmpRoot: stub.tmpRoot });
  assert.equal(out.proposable, false);
  assert.equal(out.stage_issues[0].code, 'RELATION_TARGET_UNRESOLVED');
  assert.match(out.error, /no vault page answers to urn:ngm:class:no-such-class/);
  assert.deepEqual(stub.validates(), [], 'nothing was staged or validated');
  assert.deepEqual(stub.proposes(), []);
});

test('a title relation target is taken as-is (the vault checks it)', async () => {
  let spawned = 0;
  const p = await stage.resolveRelationTargets(descriptor({ ...NOTE, relationships: { 'has-part': ['Pinhole'] } }),
    { runVault: async () => { spawned++; return []; } });
  assert.deepEqual(p.propose_command.proposal.relationships, { 'has-part': ['Pinhole'] });
  assert.equal(spawned, 0);
});
