'use strict';
// ontomark step 7 (ontomark/validate): EXP-10 row AB-05 (the validator half and the index builder; the json-ld
// parse half of ontology-local.js is step 1, §9.1 "AB-05 split")
//
// Run: node --test management-api/tests/ontomark-validate-migration.test.js
//
// Red until the interim json-ld class index and dangling-link validator are
// replaced by `ontomark find` / `ontomark validate` AND nothing that still
// depends on them is left dangling. The legacy modules are exercised against
// a fixture corpus (a page whose only class lives in a ```json-ld fence), so
// renaming `extractJsonLdBlocks`, reformatting `function validate ()` or
// spelling the result key as a computed property cannot turn it green.
// Helpers are in ./ontomark-migration-lib.js (shared by the five agentbox
// migration tests; not itself a test).
//
// Ordering note (DEPRECATION §9.1): the CLI is only baked into the image by
// the cli-publish step (AB-P1..P5); the pin test below must stay red until
// that flake lands, and must land before or with the first CLI caller.

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./ontomark-migration-lib');

const LOCAL = 'mcp/servers/lib/ontology-local.js';
const BUILD = 'mcp/servers/lib/ontology-index-build.js';
const MARK_IRI = 'urn:ngm:class:zz-fixture-marker';

function fixtureCorpus(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-validate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const block = { '@type': 'Class', '@id': MARK_IRI, label: 'Zz Fixture Marker', definition: 'fixture', relations: { requires: [{ '@id': 'urn:ngm:class:zz-missing-target', label: 'Missing' }] } };
  fs.writeFileSync(path.join(dir, 'Zz Fixture Marker.md'), `# Zz Fixture Marker\n\n\`\`\`json-ld\n${JSON.stringify(block)}\n\`\`\`\n`);
  return dir;
}

test('AB-05: no JSON-LD class parse, dangling-link check or local validator remains in the interim index modules', () => {
  const found = [];
  for (const rel of [LOCAL, BUILD]) {
    if (!L.exists(rel)) continue;
    const ast = L.parseJs(rel);
    // the json-ld PARSE in ontology-local.js is step 1 (§9.1); here only the index builder's json-ld class index counts
    if (rel === BUILD) for (const h of L.jsonldFenceSites(ast)) found.push(`${rel}:${h.line} ${h.what}`);
    // the validator's defining behaviour: a count/set of relation targets that no class defines
    L.walk(ast.program, (n) => {
      if (n.type === 'Identifier' && /dangling/i.test(n.name)) found.push(`${rel}:${L.lineOf(n)} identifier \`${n.name}\``);
      if (n.type === 'StringLiteral' && /dangling/i.test(n.value) && !/^\s*$/.test(n.value)) found.push(`${rel}:${L.lineOf(n)} string \`${n.value}\``);
    });
  }
  assert.deepEqual(found, [],
    `AB-05: the JSON-LD class index / dangling-link check survives (ontology-index-build.js:49-56,126-127; ontology-local.js:320-330):\n  ${found.join('\n  ')}`);
});

test('AB-05: the local index exposes no validator', (t) => {
  if (!L.exists(LOCAL)) return; // module removed
  const dir = fixtureCorpus(t);
  const { createLocalOntology } = require(path.join(L.ROOT, LOCAL));
  let api;
  try { api = createLocalOntology(dir); } catch { return; }
  assert.notEqual(typeof api.validate, 'function', 'AB-05: ontology-local.js:320-330 createLocalOntology() still returns a validate()');
});

test('AB-05: running the index builder over a json-ld corpus emits no class record', (t) => {
  if (!L.exists(BUILD)) return; // script removed
  const dir = fixtureCorpus(t);
  const out = path.join(dir, 'classes.json');
  const r = cp.spawnSync(process.execPath, [path.join(L.ROOT, BUILD), dir, out], {
    encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, HOME: dir, AGENTBOX_VAULT_ENABLED: '1' },
  });
  const emitted = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  assert.ok(!emitted.includes(MARK_IRI),
    `AB-05: ontology-index-build.js:49-56,126-127 still extracts a class from a json-ld fence (exit ${r.status})`);
});

test('AB-05: the remaining index modules, if any, invoke ontomark (find / validate) from live code', () => {
  const present = [LOCAL, BUILD].filter((rel) => L.exists(rel));
  for (const rel of present) {
    assert.ok(L.invokesOntomark(rel, new Set(['find', 'validate', 'retrieve'])),
      `AB-05: ${rel} still exists but does not call the ontomark CLI; delete it or make it read through \`ontomark find\` / \`validate\``);
  }
});

test('AB-05: if the index builder is deleted, no caller still runs it (consumers repointed)', () => {
  if (L.exists(BUILD)) return;
  const refs = [];
  for (const rel of ['config/entrypoint-unified.sh', 'scripts/ontology-condense-refresh.sh']) {
    const text = L.stripShell(L.read(rel));
    text.split('\n').forEach((line, i) => { if (/ontology-index-build/.test(line)) refs.push(`${rel}:${i + 1}`); });
  }
  assert.deepEqual(refs, [], `AB-05: ontology-index-build.js is gone but still invoked at ${refs.join(', ')}`);
});

test('AB-05: package.json test:vault points at tests that exist, or is gone (it globs a missing directory today)', () => {
  const pkg = L.json('package.json');
  const script = (pkg.scripts || {})['test:vault'];
  if (script === undefined) return;
  const m = /(?:^|\s)((?:\.\/)?[^\s*]+)\/\*\.test\.js(?:\s|$)/.exec(script);
  assert.ok(m, `AB-05: package.json test:vault (${script}) is not a recognisable test glob`);
  const dir = path.join(L.ROOT, m[1]);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')) : [];
  assert.ok(files.length > 0, `AB-05: package.json:10 test:vault globs ${m[1]}/*.test.js, which holds no tests (delete the script or point it at real tests)`);
});

test('pin: the CLI these consumers invoke is pinned in flake.nix and flake.lock (AB-P1/P2 land before the first CLI caller)', () => {
  const problems = L.ontomarkPinProblems();
  assert.deepEqual(problems, [], `AB-P1/AB-P2: ${problems.join('; ')}`);
});

test('wiring: the migration test is in the command CI runs (management-api `test:node`, finding 9)', () => {
  assert.ok(L.wiredIntoTestNode('ontomark-validate-migration.test.js'),
    'management-api/package.json `test:node` must list tests/ontomark-validate-migration.test.js (Jest roots exclude tests/; node --test does not discover it by itself)');
});
