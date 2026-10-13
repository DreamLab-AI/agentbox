'use strict';
// ontomark step 1 (ontomark/parse): EXP-10 rows AB-01, AB-04, AB-06 and the parse half of AB-05
//
// Run: node --test management-api/tests/ontomark-parse-migration.test.js
//
// Red until the consumer is on ontomark AND the legacy code named by the
// DEPRECATION rows is gone. Never imports ontomark: manifests are parsed
// (TOML, JSON, Nix), Rust and JS are lexed/parsed so comments and strings
// never count, and the legacy JS modules are exercised against stub binaries
// so a rename or a rewrite of the same algorithm cannot turn it green.
// Helpers live in ./ontomark-migration-lib.js (shared by the five agentbox
// migration tests; not itself a test).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./ontomark-migration-lib');

const CRATE = 'services/podcast-ingest';
const report = (hits) => hits.map((h) => `${h.file}:${h.line} ${h.what}`).join('\n  ');

test('AB-06: podcast-ingest has a real registry dependency on ontomark-parse (not optional, not `*`, not metadata, not a comment)', () => {
  const manifest = L.toml(`${CRATE}/Cargo.toml`);
  assert.ok(manifest, `AB-06: ${CRATE}/Cargo.toml does not exist`);
  const deps = L.cargoNormalDeps(manifest).filter((d) => d.crate === 'ontomark-parse');
  assert.ok(deps.length > 0, 'AB-06: [dependencies] of services/podcast-ingest/Cargo.toml must name `ontomark-parse`');
  assert.ok(deps.some(L.realRegistryDep),
    `AB-06: the ontomark-parse dependency must carry a registry version (found ${JSON.stringify(deps.map((d) => d.spec))}); optional, "*", path and git do not count`);
});

test('AB-06: Cargo.lock resolves ontomark-parse from the registry', () => {
  const lock = L.toml(`${CRATE}/Cargo.lock`);
  assert.ok(lock, `AB-06: ${CRATE}/Cargo.lock does not exist`);
  const pkg = (lock.package || []).find((p) => p.name === 'ontomark-parse');
  assert.ok(pkg, 'AB-06: Cargo.lock has no [[package]] named ontomark-parse (run cargo update after adding the dependency)');
  assert.match(pkg.source || '', /^registry\+/, 'AB-06: Cargo.lock resolves ontomark-parse from something other than a registry');
  assert.match(pkg.version || '', /^\d+\.\d+\.\d+/, 'AB-06: Cargo.lock ontomark-parse has no version');
});

test('AB-06: write_working_page writes its frontmatter through ontomark_parse (a call, not an import or a comment)', () => {
  const f = L.rustFile(`${CRATE}/src/promote/working_page.rs`);
  assert.ok(f.exists, 'AB-06: working_page.rs does not exist');
  const body = L.rustFnBody(f.code, 'write_working_page');
  assert.ok(body !== null, 'AB-06: working_page.rs no longer defines write_working_page');
  // used in the function itself, or in a helper in the same file that it calls
  const helpers = [...f.code.matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((n) => n !== 'write_working_page' && new RegExp(`\\b${n}\\s*\\(`).test(body));
  const direct = L.usesCrate(body, 'ontomark_parse');
  const viaHelper = helpers.some((h) => L.usesCrate(L.rustFnBody(f.code, h) || '', 'ontomark_parse'));
  const imported = L.usesCrate(f.code, 'ontomark_parse');
  assert.ok(imported && (direct || viaHelper),
    'AB-06: services/podcast-ingest/src/promote/working_page.rs:56 write_working_page must call into ontomark_parse');
});

test('AB-06: the frontmatter quoting rules and the hand-built page writer are gone from the crate', () => {
  const rust = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(L.ROOT, rel), { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(r); else if (e.name.endsWith('.rs')) rust.push(r);
    }
  };
  walk(`${CRATE}/src`);
  const rules = [
    [/true\s*\|\s*false\s*\|\s*null/i, 'bool-like quoting pattern (true|false|null|yes|no|on|off|~)'],
    [/\\d\{4\}-\\d\{2\}-\\d\{2\}/, 'date-like quoting pattern'],
    [/\[:#\\\[\\\]\{\},/, 'special-character quoting class [:#[]{},"\']'],
    [/\|>&\*!%@`\[\{/, 'leading-indicator quoting set'],
    [/\(\\d\+\\\.\?\\d\*\|\\\.\\d\+\)/, 'number-like quoting pattern'],
  ];
  const found = [];
  for (const rel of rust) {
    const f = L.rustFile(rel);
    for (const s of f.strings) for (const [re, what] of rules) if (re.test(s)) found.push({ file: rel, line: 0, what });
    if (/(^|[^A-Za-z0-9_])Regex\s*::\s*new\b/.test(f.code) && /yaml_scalar\.rs$/.test(rel)) found.push({ file: rel, line: 0, what: 'Regex::new in the scalar-quoting module' });
    // a quoting function surviving under any file name, unless it delegates to ontomark_parse
    if (/\bfn\s+yaml_scalar\b/.test(f.code) && !L.usesCrate(f.code, 'ontomark_parse')) found.push({ file: rel, line: 0, what: 'fn yaml_scalar defined without delegating to ontomark_parse' });
  }
  const wp = L.rustFile(`${CRATE}/src/promote/working_page.rs`);
  if (wp.strings.includes('---')) found.push({ file: `${CRATE}/src/promote/working_page.rs`, line: 0, what: 'frontmatter fence line `---` assembled by hand (:56 page writer)' });
  assert.deepEqual(found, [], `AB-06: legacy frontmatter quoting/writing logic remains (yaml_scalar.rs:33, working_page.rs:56):\n  ${report(found)}`);
});

test('AB-01: no module parses a page\'s frontmatter fence or reads its status line by pattern', () => {
  // headroom.js recognises unified-diff headers, not pages: unrelated, listed so the allowance is visible.
  const RETAINED_UNRELATED = new Set(['management-api/lib/headroom.js']);
  const found = [];
  for (const rel of L.ontologyScope()) {
    if (RETAINED_UNRELATED.has(rel)) continue;
    for (const h of L.frontmatterParseSites(L.parseJs(rel))) found.push({ file: rel, ...h });
  }
  assert.deepEqual(found, [], `AB-01: a frontmatter parser survives (ontology-apply.js:320 readPageStatus regex) or moved:\n  ${report(found)}`);
});

test('AB-01: a page\'s text handed to readPageStatus is not parsed locally', () => {
  const file = path.join(L.ROOT, 'management-api', 'lib', 'ontology-apply.js');
  if (!fs.existsSync(file)) return; // module removed: nothing parses locally
  const apply = require(file);
  if (typeof apply.readPageStatus !== 'function') return; // export removed
  const text = '---\ntype: Class\nresource: urn:ngm:class:x\nstatus: stable\n---\nbody\n';
  let status;
  try { status = apply.readPageStatus('X', { repo: os.tmpdir(), readFile: () => text }); } catch { status = undefined; }
  assert.notEqual(status, 'stable',
    'AB-01: readPageStatus still reads `status` out of page text with its own frontmatter parse (ontology-apply.js:320); take it from the ontomark CLI JSON');
});

test('AB-01: ontology-apply asks the ontomark CLI to read a page (retrieve), from live code', () => {
  assert.ok(L.invokesOntomark('management-api/lib/ontology-apply.js', new Set(['retrieve', 'find'])),
    'AB-01: management-api/lib/ontology-apply.js must call `ontomark retrieve --json` (a call site reached from live code, not a constant or a comment)');
});

test('AB-04: candidate relations come from ontomark JSON, not from the agent value\'s is-a / parents / is_subclass_of', async (t) => {
  L.stubTools(t);
  const { extractProposals } = require(path.join(L.ROOT, 'management-api', 'lib', 'kg-proposal-extractor'));
  const OWNER = 'a'.repeat(64);
  const env = { AGENTBOX_DID: 'did:nostr:test', AGENTBOX_X_ONLY_PUBKEY_HEX: OWNER };
  const MARK = ['Zz Marker Alpha', 'Zz Marker Beta', 'Zz Marker Gamma'];
  const value = {
    preferred_term: 'Photon Sieve', definition: 'A diffractive optic that focuses light through a pattern of pinholes rather than zones.',
    domain: 'robotics', physicality: 'physical', role: 'component',
    is_subclass_of: [MARK[0]], 'is-a': [MARK[1]], parents: [MARK[2]],
  };
  let out;
  try {
    out = await Promise.resolve(extractProposals([{ key: 'k1', value }], { ownerPubkey: OWNER, env, minScore: 0 }));
  } catch (e) {
    assert.fail(`AB-04: extractProposals threw against stub ontomark/vault binaries: ${e && e.message}`);
  }
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'raw' ? undefined : v)));
  const text = JSON.stringify(strip(out));
  for (const m of MARK) {
    assert.ok(!text.includes(m),
      `AB-04: kg-proposal-extractor.js:156-181 still lifts "${m}" out of the agent's value into the descriptor; relations must come from the ontomark CLI JSON`);
  }
});

test('AB-04: no module reads is-a / parents off an agent value (nor a renamed copy of the extraction)', () => {
  // `is_subclass_of` is also the descriptor's own OUTPUT key, so reads of it are covered by the behavioural
  // test above; `is-a` and `parents` exist only on the agent's raw value and are checked statically.
  // Pre-existing readers of OTHER objects (class records from an index), listed so the allowance is visible.
  const RETAINED = new Set(['mcp/servers/lib/ontology-local.js', 'mcp/servers/lib/ontology-condense.js', 'mcp/servers/lib/ontology-workingset.js']);
  const found = [];
  for (const rel of L.ontologyScope()) {
    if (RETAINED.has(rel)) continue;
    // string uses count only in the extractor itself: elsewhere `is-a` is the page key the writer emits (step 9)
    const strings = rel === 'management-api/lib/kg-proposal-extractor.js';
    for (const h of L.relationKeyReads(L.parseJs(rel), ['is-a', 'parents'], { strings })) found.push({ file: rel, ...h });
  }
  assert.deepEqual(found, [], `AB-04: is-subclass-of extraction survives (kg-proposal-extractor.js:156-181) or moved:\n  ${report(found)}`);
});

test('AB-04: the extractor, or a module that imports it, invokes ontomark from live code', () => {
  const target = 'management-api/lib/kg-proposal-extractor.js';
  const importers = L.jsSources().filter((rel) => L.moduleSpecifiers(rel).some(({ spec }) => /(^|\/)kg-proposal-extractor(\.js)?$/.test(spec)));
  const family = [target, ...importers];
  assert.ok(family.some((rel) => L.invokesOntomark(rel)),
    `AB-04: none of ${family.join(', ')} invokes the ontomark CLI; the replacement for the extracted relations is CLI JSON`);
});

test('AB-05 (parse half): the interim local index does not parse json-ld class blocks, and its consumers still resolve', (t) => {
  const rel = 'mcp/servers/lib/ontology-local.js';
  const consumers = ['mcp/servers/lib/typed-spawn.js', 'mcp/servers/lib/ontology-workingset.js', 'config/hooks/ontology-monitor.cjs'];
  const stillThere = L.exists(rel);
  for (const c of consumers) {
    for (const { spec, line } of L.moduleSpecifiers(c)) {
      if (!/ontology-local/.test(spec)) continue;
      const resolved = path.resolve(L.ROOT, path.dirname(c), spec);
      assert.ok(fs.existsSync(resolved) || fs.existsSync(`${resolved}.js`),
        `AB-05: ${c}:${line} still requires ${spec}, which no longer exists: repoint the consumer to ontomark in the same step`);
    }
  }
  if (!stillThere) return;
  assert.deepEqual(L.jsonldFenceSites(L.parseJs(rel)), [], `AB-05: ${rel}:83 still carries the json-ld fence pattern (JSONLD_RE)`);
  // behaviour: a corpus whose only class lives in a json-ld fence must index nothing
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const IRI = 'urn:ngm:class:zz-fixture-marker';
  fs.writeFileSync(path.join(dir, 'Zz Fixture Marker.md'),
    `# Zz Fixture Marker\n\n\`\`\`json-ld\n${JSON.stringify({ '@type': 'Class', '@id': IRI, label: 'Zz Fixture Marker', definition: 'fixture' })}\n\`\`\`\n`);
  const { createLocalOntology } = require(path.join(L.ROOT, rel));
  let hit = null;
  try { hit = createLocalOntology(dir).resolve(IRI); } catch { hit = null; }
  assert.equal(hit, null, 'AB-05: ontology-local.js still indexes a class straight out of a json-ld fence (:104-327 interim parser)');
});

test('wiring: the migration test is in the command CI runs (management-api `test:node`, finding 9)', () => {
  assert.ok(L.wiredIntoTestNode('ontomark-parse-migration.test.js'),
    'management-api/package.json `test:node` must list tests/ontomark-parse-migration.test.js (Jest roots exclude tests/; node --test does not discover it by itself)');
});

test('pin: the CLI the JS consumers call is pinned in flake.nix and flake.lock (AB-P1/P2 land before the first CLI caller)', () => {
  const problems = L.ontomarkPinProblems();
  assert.deepEqual(problems, [], `AB-P1/AB-P2: ${problems.join('; ')}`);
});
