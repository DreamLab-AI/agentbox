// ER-9: the role-isolation gate is rebuild-class. devuser's sudo drop is baked from the build-time
// flag (config/bake-devuser-privilege.sh), so a boot-time flip alone leaves degraded:devuser-sudo.
//
//   node --test tests/config/role-isolation-class.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOGUE } = require('../../management-api/lib/system-manifest');

test('role-isolation is catalogued rebuild-class on security.role_isolation', () => {
  const e = CATALOGUE.find((x) => x.id === 'role-isolation');
  assert.ok(e, 'role-isolation entry exists');
  assert.equal(e.gate, 'security.role_isolation');
  assert.equal(e.apply_class, 'rebuild');
  assert.match(e.summary, /devuser-sudo/);
});
