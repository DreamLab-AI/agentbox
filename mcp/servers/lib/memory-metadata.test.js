'use strict';
/**
 * memory-metadata.test.js — the expiry predicates never cast an invalid value.
 *
 * Run with `node mcp/servers/lib/memory-metadata.test.js` (plain assert, like
 * memory-tools.test.js). A value can pass the date-prefix check and still be an
 * invalid timestamp ('2026-99-99T00'); casting it throws and aborts the whole
 * statement, so one such row failed every read and the sweep that should
 * delete it. Both predicates must guard the cast with pg_input_is_valid.
 */
const assert = require('assert');
const { notExpiredPredicate, expiredPredicate } = require('./memory-metadata');

for (const [name, fn, keep] of [
  ['notExpiredPredicate', notExpiredPredicate, 'true'],
  ['expiredPredicate', expiredPredicate, 'false'],
]) {
  const sql = fn('m.metadata').replace(/\s+/g, ' ');
  const guard = sql.indexOf("pg_input_is_valid(m.metadata->>'expires_at', 'timestamptz')");
  const cast = sql.indexOf('::timestamptz');
  assert.ok(guard > 0, `${name} lacks the validity guard: ${sql}`);
  assert.ok(guard < cast, `${name} must guard before it casts: ${sql}`);
  assert.ok(
    sql.includes(`'timestamptz') THEN ${keep}`),
    `${name} must treat an invalid value as ${keep === 'true' ? 'live' : 'not expired'}`,
  );
}
console.log('memory-metadata.test.js: ok');
