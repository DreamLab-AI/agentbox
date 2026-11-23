'use strict';
/** typed-spawn.test.js — AB-26.7: empty AGENTBOX_BEADS_DB must not mean :memory:. Run with plain `node`. */
const assert = require('assert');
const { resolveDbPath, loadDeps } = require('./typed-spawn');

assert.strictEqual(resolveDbPath(undefined), undefined);
assert.strictEqual(resolveDbPath(null), undefined);
assert.strictEqual(resolveDbPath(''), undefined);
assert.strictEqual(resolveDbPath('   '), undefined);
assert.strictEqual(resolveDbPath(':memory:'), ':memory:');
assert.strictEqual(resolveDbPath('/x/y.db'), '/x/y.db');

// Stub the sqlite adapter so the test records the dbPath it receives and does not
// depend on the better-sqlite3 native binding matching the running Node ABI.
const adapterPath = require.resolve('../../../management-api/adapters/beads/local-sqlite.js');
let received;
require.cache[adapterPath] = {
  id: adapterPath, filename: adapterPath, loaded: true,
  exports: { LocalSqliteBeadsAdapter: class { constructor(o) { received = o; } } },
};
const ontology = { classGet: () => ({ iri: 'x' }) };

for (const empty of ['', '  ', undefined, null]) {
  received = null;
  loadDeps({ ontology, dbPath: empty });
  assert.ok(received, 'adapter constructed');
  assert.strictEqual(received.dbPath, undefined, `dbPath=${JSON.stringify(empty)} must fall through to the adapter default, not :memory:`);
}
loadDeps({ ontology, dbPath: ':memory:' });
assert.strictEqual(received.dbPath, ':memory:');
loadDeps({ ontology, dbPath: '/x/y.db' });
assert.strictEqual(received.dbPath, '/x/y.db');
console.log('typed-spawn.test.js: ok');
