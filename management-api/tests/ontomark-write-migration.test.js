'use strict';
// ontomark step 9 (ontomark/write): EXP-10 row AB-03
//
// Run: node --test management-api/tests/ontomark-write-migration.test.js
//
// Red until the elevation stage (and the apply path) write pages through the
// guarded ontomark CLI AND the hand-built page writer is gone. The write path
// is exercised against two stub binaries (`ontomark`, `vault`) resolved from
// PATH by the modules' default runner; the test asserts which stub received
// `edit --expect` / `create --expect`, and that the governance verbs
// (propose, apply, panel publish) stay on the vault adapter (D4). Renaming
// `renderStagedPage` or wrapping the `['---', ...]` array cannot turn it
// green: the checks name the construct (a fence line emitted by code, a
// `[[...]]` wikilink template), not its identifier. Helpers are in
// ./ontomark-migration-lib.js (shared by the five agentbox migration tests).
//
// Ordering note (§9.1): the D4 adapter lands in step 10, so here the adapter
// side is a routing assertion against the vault runner, not a check that the
// adapter is baked. The CLI pin test stays red until the cli-publish flake
// lands and must land before or with the first CLI caller.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const L = require('./ontomark-migration-lib');

const STAGE = 'management-api/lib/elevation-stage.js';
const report = (hits) => hits.map((h) => `${h.file}:${h.line} ${h.what}`).join('\n  ');
const verbOf = L.argvVerbOf;
const guardOf = (argv) => L.flagValue(argv, '--expect');

test('AB-03: the guarded edit and create of an apply go to ontomark, never to the vault binary', async (t) => {
  const s = await L.applyScenarios(t);
  const edit = s.promote.ontomark.find((a) => verbOf(a) === 'edit');
  assert.ok(edit, 'AB-03: a promote of a draft page must run `ontomark edit` (ontology-apply.js:419-424); the ontomark stub saw: '
    + JSON.stringify(s.promote.ontomark.map(verbOf)));
  assert.equal(guardOf(edit), 'docs=1,blocks=2', 'AB-03: ontomark edit must carry the blast-radius guard --expect docs=1,blocks=2 for promote draft->stable');
  assert.ok(edit.includes('status=stable'), 'AB-03: the edit must set status=stable');
  const create = s.create.ontomark.find((a) => verbOf(a) === 'create');
  assert.ok(create, 'AB-03: a create proposal must run `ontomark create` (ontology-apply.js:478); the ontomark stub saw: '
    + JSON.stringify(s.create.ontomark.map(verbOf)));
  assert.equal(guardOf(create), 'docs=1', 'AB-03: ontomark create must carry --expect docs=1');
  for (const [name, calls] of [['promote', s.promote.vault], ['create', s.create.vault]]) {
    const leaked = calls.map(verbOf).filter((v) => v === 'edit' || v === 'create');
    assert.deepEqual(leaked, [], `AB-03: the ${name} path still sends ${leaked.join(', ')} to the vault binary`);
  }
});

test('AB-03/D4: an amendment is applied by the vault adapter (apply), not by ontomark', async (t) => {
  const s = await L.applyScenarios(t);
  const apply = s.amend.vault.find((a) => verbOf(a) === 'apply');
  assert.ok(apply, 'D4: `apply` (the signed amendment) must be run by the vault adapter; the vault stub saw: ' + JSON.stringify(s.amend.vault.map(verbOf)));
  assert.equal(guardOf(apply), 'docs=1', 'D4: vault apply keeps its --expect docs=1 guard');
  assert.deepEqual(s.amend.ontomark.map(verbOf).filter((v) => v === 'apply'), [], 'D4: ontomark must not receive `apply`');
});

test('AB-03: the elevation stage stages a page with `ontomark create --expect`, and proposes through the vault adapter', async (t) => {
  const e = await L.elevationScenario(t);
  const create = e.ontomark.find((a) => verbOf(a) === 'create');
  assert.ok(create, 'AB-03: gateElevation must stage the page with `ontomark create` (a guarded write); the ontomark stub saw: '
    + JSON.stringify(e.ontomark.map(verbOf)));
  assert.match(guardOf(create) || '', /^docs=1/, 'AB-03: ontomark create must carry --expect docs=1');
  const leaked = e.vault.map(verbOf).filter((v) => v === 'create' || v === 'edit');
  assert.deepEqual(leaked, [], `AB-03: elevation-stage still sends ${leaked.join(', ')} to the vault binary`);
  const bad = e.vault.map(verbOf).filter((v) => v !== 'propose' && v !== 'apply' && v !== 'panel' && v !== 'validate' && v !== 'find');
  assert.deepEqual(bad, [], `D4: only propose/apply/panel (and, until step 10, validate/find) may reach the vault binary; saw ${bad.join(', ')}`);
});

test('AB-03: no module emits a frontmatter page line by line (fence lines, title/resource/status lines assembled in code)', () => {
  const found = [];
  for (const rel of L.ontologyScope()) {
    for (const h of L.frontmatterBuildSites(L.parseJs(rel))) found.push({ file: rel, ...h });
  }
  assert.deepEqual(found, [], `AB-03: the page writer survives (elevation-stage.js:136-174 renderStagedPage) or moved:\n  ${report(found)}`);
});

test('AB-03: no module renders a `[[...]]` wikilink or resolves relation IRIs to page ids in the stage (:75, :80-94)', () => {
  const ast = L.parseJs(STAGE);
  const found = [];
  L.walk(ast.program, (n) => {
    if (n.type === 'TemplateLiteral' && n.quasis[0].value.cooked.startsWith('[[') && n.quasis[n.quasis.length - 1].value.cooked.endsWith(']]')) {
      found.push(`${STAGE}:${L.lineOf(n)} wikilink template`);
    }
  });
  const imported = L.importedNames(STAGE, /(^|\/)ontology-(apply|propose)(\.js)?$/).filter((n) => ['resolveIriToPage', 'slugify', 'IRI_NAMESPACE'].includes(n));
  for (const n of imported) found.push(`${STAGE} still imports ${n} (relation resolution)`);
  assert.deepEqual(found, [], `AB-03: elevation-stage.js:75,80-94 relation resolution / wikilink rendering survives:\n  ${found.join('\n  ')}`);
});

test('AB-03: the surviving elevation-stage test only uses exports that still exist', () => {
  const testRel = 'management-api/tests/elevation-stage.test.js';
  const ast = L.parseJs(testRel);
  const mod = require(path.join(L.ROOT, STAGE));
  const names = new Set();
  let binding = null;
  L.walk(ast.program, (n) => {
    if (n.type === 'VariableDeclarator' && n.init && n.init.type === 'CallExpression' && n.init.callee.name === 'require'
      && n.init.arguments[0] && n.init.arguments[0].value === '../lib/elevation-stage' && n.id.type === 'Identifier') binding = n.id.name;
  });
  L.walk(ast.program, (n) => {
    if (binding && n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === binding && !n.computed) names.add(n.property.name);
  });
  const missing = [...names].filter((nme) => !(nme in mod));
  assert.deepEqual(missing, [], `AB-03: tests/elevation-stage.test.js uses ${missing.join(', ')}, which elevation-stage no longer exports; rewrite it against the ontomark path`);
  assert.ok(names.size > 0, 'AB-03: tests/elevation-stage.test.js no longer exercises elevation-stage at all');
});

test('pin: the CLI the write path calls is pinned in flake.nix and flake.lock (AB-P1/P2 land before the first CLI caller)', () => {
  const problems = L.ontomarkPinProblems();
  assert.deepEqual(problems, [], `AB-P1/AB-P2: ${problems.join('; ')}`);
});

test('wiring: the migration test is in the command CI runs (management-api `test:node`, finding 9)', () => {
  assert.ok(L.wiredIntoTestNode('ontomark-write-migration.test.js'),
    'management-api/package.json `test:node` must list tests/ontomark-write-migration.test.js (Jest roots exclude tests/; node --test does not discover it by itself)');
});
