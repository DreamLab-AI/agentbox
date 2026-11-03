'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const identity = require('../../management-api/lib/identity-port');

test('isolation selects port from the boot flag or manifest', () => {
  assert.equal(identity.selected(null, {}), false);
  assert.equal(identity.selected(null, { AGENTBOX_ROLE_ISOLATION: '1' }), true);
  assert.equal(identity.selected({ security: { role_isolation: true } }, {}), true);
});

test('port signer has no secret and uses narrow operations for every consumer flow', async () => {
  const calls = [];
  const signer = identity.signer('junkiejarvis', {
    requestSync: (op, params) => { calls.push([op, params]); return { pubkey: 'a'.repeat(64) }; },
    request: async (op, params) => { calls.push([op, params]); return { event: { kind: 1059 }, rumor: { kind: 14 } }; },
  });
  assert.equal('skBytes' in signer, false);
  await signer.sign({ kind: 22242, tags: [['relay', 'wss://relay.test'], ['challenge', 'fixture']] });
  await signer.sign({ kind: 42, content: 'fixture' });
  await signer.wrapDm('b'.repeat(64), 'fixture');
  await signer.unwrapAny({ kind: 1059 });
  await signer.sealChannel({ content: 'fixture' }, { key: { zone: 'staff', epoch: 2, pubkey: 'c'.repeat(64) } });
  assert.deepEqual(calls.map(([op]) => op), ['pubkey', 'nip42_auth', 'forum_event', 'nip17_wrap', 'nip17_unwrap', 'forum_seal']);
  assert.deepEqual(calls.at(-1)[1].zone, { id: 'staff', epoch: 2, pubkey: 'c'.repeat(64) });
});

test('port refusal never falls back to local secret loading or another signer', async () => {
  const signer = identity.signer('junkiejarvis', {
    requestSync: () => ({ pubkey: 'a'.repeat(64) }),
    request: async () => { throw new Error('refused'); },
  });
  await assert.rejects(signer.sign({ kind: 31403 }), /refused/);
  await assert.rejects(signer.wrapDm('b'.repeat(64), 'fixture'), /refused/);
  assert.throws(() => identity.signer('junkiejarvis', { requestSync: () => { throw new Error('absent'); } }), /absent/);
});

test('bounded CLI parameters travel on stdin and error output is withheld', async () => {
  let invocation;
  const fakeSpawn = (bin, argv, opts) => {
    invocation = { bin, argv, opts };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = input => {
      invocation.input = input;
      queueMicrotask(() => { child.stdout.emit('data', JSON.stringify({ refused: { reason: 'sensitive' } })); child.emit('close', 1); });
    };
    child.kill = () => {};
    return child;
  };
  await assert.rejects(identity.request('nip17_wrap', { content: 'private fixture' }, { spawn: fakeSpawn, env: {} }), /^Error: identity port refused or unavailable$/);
  assert.deepEqual(invocation.argv, ['sign-request', 'nip17_wrap']);
  assert.equal(invocation.input, '{"content":"private fixture"}');
  assert.equal(invocation.opts.stdio[2], 'ignore');
});
