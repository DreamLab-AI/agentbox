'use strict';

/**
 * ADR-2005 acceptance — mutation coverage, sensitive-field coverage, type
 * preservation and policy behaviour for the privacy filter.
 *
 * The estate review reproduced four defects with synthetic strict-policy calls
 * against the real wrapper:
 *
 *   P1  only six write names were recognised, so `createEpic` was not filtered;
 *   P2  only `args[0].value` was sanitised, so `key` and `metadata` text passed
 *       through a call that WAS filtered;
 *   P3  an object `value` came back as a JSON string — the adapter received a
 *       different type from the one the caller passed;
 *   P4  strict/soft/off and redactor-failure behaviour was untested beyond an
 *       unreachable sidecar.
 *
 * Every case here runs the ACTUAL middleware against a stub /redact server on
 * loopback. No OPF model, real adapter, persistence or network egress occurs.
 *
 * Run: npx jest tests/contract/privacy-coverage.contract.spec.js --testEnvironment node
 *      (jest provides the `test` global; assertions use node:assert/strict)
 */

const assert = require('node:assert/strict');
const http = require('node:http');

const pf = require('../../management-api/middleware/privacy-filter');
const {
  wrapWithPrivacyFilter, AdapterWriteRejected, isMutationMethod,
  collectLeaves, RedactionShapeError,
} = pf;

const PII = 'victim@example.com';
const MASK = '[REDACTED:email]';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Stub the OPF /redact contract.
 *
 * @param {object} opts
 * @param {'redact'|'passthrough'|'http500'|'nonjson'|'eat-delimiter'|'no-text'} opts.mode
 * @returns {Promise<{port:number, calls:Array, close:Function}>}
 */
async function opfStub({ mode = 'redact' } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (mode === 'http500') { res.writeHead(500); res.end('{}'); return; }
      if (mode === 'nonjson') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('not json at all'); return; }
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { text: '' }; }
      calls.push(parsed);
      const replaced = [];
      let text = String(parsed.text || '');
      if (mode !== 'passthrough') {
        text = text.replace(EMAIL_RE, (m) => { replaced.push({ entity: 'email', original: m }); return MASK; });
      }
      if (mode === 'eat-delimiter') {
        // A redactor that mangles the field delimiter must never have its
        // result applied — the segments could not be mapped back.
        text = text.replace(/--OPF-FIELD-[0-9a-f]{32}--/g, '');
      }
      if (mode === 'no-text') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ replaced })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, replaced }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    calls,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Wrap a recording adapter method under a given slot policy. */
function harness(slot, method, policy) {
  const received = [];
  const fn = async (...args) => { received.push(args); return { ok: true }; };
  const manifest = { privacy_filter: { policy: { [slot]: policy } } };
  return { received, wrapped: wrapWithPrivacyFilter(slot, method, fn, manifest) };
}

function useStub(stub) {
  process.env.OPF_ENDPOINT = `http://127.0.0.1:${stub.port}`;
  process.env.OPF_MODE = 'local-cpu';
}
function clearEnv() { delete process.env.OPF_ENDPOINT; delete process.env.OPF_MODE; }

// ---------------------------------------------------------------------------
// P1 — mutation coverage
// ---------------------------------------------------------------------------

test('P1: the mutation set covers exact names and <verb><Noun> forms', () => {
  for (const m of ['store', 'write', 'create', 'publish', 'append', 'emit', 'update', 'upsert', 'delete']) {
    assert.equal(isMutationMethod(m), true, `${m} should be a mutation`);
  }
  for (const m of ['createEpic', 'storeSnapshot', 'publishDigest', 'updateBead', 'appendEvent', 'emitAudit', 'removeEpic']) {
    assert.equal(isMutationMethod(m), true, `${m} should be a mutation`);
  }
  for (const m of ['get', 'getEpic', 'list', 'listEpics', 'query', 'search', 'fetch', 'read', 'resolve', 'health', 'stats']) {
    assert.equal(isMutationMethod(m), false, `${m} should NOT be a mutation`);
  }
  // A read verb that merely starts with a mutation verb's letters is not a
  // mutation: the prefix rule requires a camelCase boundary.
  assert.equal(isMutationMethod('created'), false);
  assert.equal(isMutationMethod('adder'), false);
});

test('P1: createEpic is filtered — its title reaches the adapter redacted', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('beads', 'createEpic', 'strict');
    await wrapped({ title: `escalation for ${PII}` });
    assert.equal(stub.calls.length, 1, 'exactly one redactor round trip');
    assert.equal(received[0][0].title, `escalation for ${MASK}`);
    assert.ok(!JSON.stringify(received[0]).includes(PII));
  } finally { await stub.close(); clearEnv(); }
});

test('P1: a read method is never sent to the redactor', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('beads', 'getEpic', 'strict');
    await wrapped({ id: PII });
    assert.equal(stub.calls.length, 0);
    assert.equal(received[0][0].id, PII, 'a read payload is passed through untouched');
  } finally { await stub.close(); clearEnv(); }
});

// ---------------------------------------------------------------------------
// P2 — sensitive-field coverage
// ---------------------------------------------------------------------------

test('P2: metadata text is redacted, not just value', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await wrapped({ key: 'incident-42', value: 'summary', metadata: { note: `raised by ${PII}`, tier: 2 } });
    assert.equal(stub.calls.length, 1);
    assert.equal(received[0][0].metadata.note, `raised by ${MASK}`);
    assert.equal(received[0][0].metadata.tier, 2, 'non-string metadata is untouched');
  } finally { await stub.close(); clearEnv(); }
});

test('P2: personal data in a KEY is rejected under strict, not silently rewritten', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await assert.rejects(
      () => wrapped({ key: `contact-${PII}`, value: 'body' }),
      (err) => err instanceof AdapterWriteRejected && /IdentifierPiiDetected/.test(err.message),
    );
    assert.equal(received.length, 0, 'the adapter is never called');
  } finally { await stub.close(); clearEnv(); }
});

test('P2: personal data in a key under SOFT is allowed with the key intact', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('events', 'emit', 'soft');
    await wrapped({ key: `contact-${PII}`, value: 'body' });
    assert.equal(received.length, 1);
    assert.equal(received[0][0].key, `contact-${PII}`,
      'the key is never rewritten — rewriting it would change what the record is addressed by');
  } finally { await stub.close(); clearEnv(); }
});

test('P2: an unclassified field carrying personal data is screened, not rewritten', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await assert.rejects(
      () => wrapped({ key: 'k', value: 'clean', operatorHandle: PII }),
      (err) => err instanceof AdapterWriteRejected,
    );
    assert.equal(received.length, 0);
  } finally { await stub.close(); clearEnv(); }
});

test('P2: the positional convention screens key and namespace and redacts the value', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await wrapped('incident-42', `reported by ${PII}`, 'default');
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(received[0], ['incident-42', `reported by ${MASK}`, 'default']);
  } finally { await stub.close(); clearEnv(); }
});

test('P2: leaf collection assigns the documented roles', () => {
  const { leaves } = collectLeaves([{ key: 'k', value: 'v', metadata: { note: 'n' }, widget: 'w' }], 'store');
  const byPath = Object.fromEntries(leaves.map((l) => [l.path.join('.'), l.role]));
  assert.equal(byPath['0.value'], 'content');
  assert.equal(byPath['0.metadata.note'], 'content');
  assert.equal(byPath['0.key'], 'identifier');
  assert.equal(byPath['0.widget'], 'unclassified');
});

// ---------------------------------------------------------------------------
// P3 — argument and result type preservation
// ---------------------------------------------------------------------------

test('P3: an object value stays an object of the same shape', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await wrapped({ key: 'k', value: { note: `see ${PII}`, count: 3, nested: { deep: `also ${PII}` } } });
    const v = received[0][0].value;
    assert.equal(typeof v, 'object', 'the value must not become a JSON string');
    assert.equal(v.note, `see ${MASK}`);
    assert.equal(v.count, 3);
    assert.equal(v.nested.deep, `also ${MASK}`);
  } finally { await stub.close(); clearEnv(); }
});

test('P3: an array value stays an array', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await wrapped({ key: 'k', value: [`a ${PII}`, 'b', 7] });
    const v = received[0][0].value;
    assert.ok(Array.isArray(v));
    assert.deepEqual(v, [`a ${MASK}`, 'b', 7]);
  } finally { await stub.close(); clearEnv(); }
});

test('P3: a string value stays a string and the result is the adapter result', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const fn = async (p) => ({ stored: true, echoed: p.value });
    const wrapped = wrapWithPrivacyFilter('memory', 'store', fn, { privacy_filter: { policy: { memory: 'strict' } } });
    const out = await wrapped({ key: 'k', value: `hello ${PII}` });
    assert.equal(typeof out.echoed, 'string');
    assert.deepEqual(out, { stored: true, echoed: `hello ${MASK}` });
  } finally { await stub.close(); clearEnv(); }
});

test('P3: the caller\'s own object is not mutated in place', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    const payload = { key: 'k', value: `hello ${PII}` };
    await wrapped(payload);
    assert.equal(payload.value, `hello ${PII}`, 'the caller keeps its original object');
    assert.equal(received[0][0].value, `hello ${MASK}`);
  } finally { await stub.close(); clearEnv(); }
});

// ---------------------------------------------------------------------------
// P4 — strict / soft / off and redactor failure
// ---------------------------------------------------------------------------

const FAILURES = [
  ['sidecar unreachable', null],
  ['HTTP 500', 'http500'],
  ['response body is not JSON', 'nonjson'],
  ['response has no text field', 'no-text'],
  ['field delimiter destroyed', 'eat-delimiter'],
];

for (const [label, mode] of FAILURES) {
  test(`P4 strict: ${label} rejects the write and never calls the adapter`, async () => {
    let stub = null;
    if (mode === null) { process.env.OPF_ENDPOINT = 'http://127.0.0.1:1'; process.env.OPF_MODE = 'local-cpu'; }
    else { stub = await opfStub({ mode }); useStub(stub); }
    try {
      const { received, wrapped } = harness('memory', 'store', 'strict');
      await assert.rejects(() => wrapped({ key: 'k', value: `x ${PII}` }), AdapterWriteRejected);
      assert.equal(received.length, 0);
    } finally { if (stub) await stub.close(); clearEnv(); }
  });

  test(`P4 soft: ${label} allows the write with the ORIGINAL payload`, async () => {
    let stub = null;
    if (mode === null) { process.env.OPF_ENDPOINT = 'http://127.0.0.1:1'; process.env.OPF_MODE = 'local-cpu'; }
    else { stub = await opfStub({ mode }); useStub(stub); }
    try {
      const { received, wrapped } = harness('events', 'emit', 'soft');
      await wrapped({ key: 'k', value: `x ${PII}` });
      assert.equal(received.length, 1);
      assert.equal(received[0][0].value, `x ${PII}`,
        'fail-open means the ORIGINAL payload, never a partially-applied redaction');
    } finally { if (stub) await stub.close(); clearEnv(); }
  });
}

test('P4 off: the redactor is never called and the payload is unchanged', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('orchestrator', 'store', 'off');
    await wrapped({ key: `k ${PII}`, value: `v ${PII}` });
    assert.equal(stub.calls.length, 0);
    assert.equal(received[0][0].value, `v ${PII}`);
  } finally { await stub.close(); clearEnv(); }
});

test('P4: OPF_MODE=off forces every policy to off', async () => {
  const stub = await opfStub();
  process.env.OPF_ENDPOINT = `http://127.0.0.1:${stub.port}`;
  process.env.OPF_MODE = 'off';
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await wrapped({ key: 'k', value: `v ${PII}` });
    assert.equal(stub.calls.length, 0);
    assert.equal(received[0][0].value, `v ${PII}`);
  } finally { await stub.close(); clearEnv(); }
});

test('P4: a shape mismatch is a typed RedactionShapeError, distinguishable from a transport fault', async () => {
  const stub = await opfStub({ mode: 'eat-delimiter' }); useStub(stub);
  try {
    const { wrapped } = harness('memory', 'store', 'strict');
    await assert.rejects(
      () => wrapped({ key: 'k', value: 'a', metadata: { note: 'b' } }),
      (err) => err instanceof AdapterWriteRejected && /RedactionShapeError/.test(err.message),
    );
    assert.ok(RedactionShapeError.prototype instanceof Error);
  } finally { await stub.close(); clearEnv(); }
});

test('P4: a payload with no text at all makes no redactor call', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    await wrapped({ count: 3, flag: true });
    assert.equal(stub.calls.length, 0);
    assert.equal(received.length, 1);
  } finally { await stub.close(); clearEnv(); }
});

test('P4: a cyclic payload cannot be certified redacted and is rejected under strict', async () => {
  const stub = await opfStub(); useStub(stub);
  try {
    const { received, wrapped } = harness('memory', 'store', 'strict');
    const payload = { key: 'k', value: { note: `x ${PII}` } };
    payload.value.self = payload.value;
    await assert.rejects(() => wrapped(payload), AdapterWriteRejected);
    assert.equal(received.length, 0);
  } finally { await stub.close(); clearEnv(); }
});

// ---------------------------------------------------------------------------
// Traversal marker vs verified redaction — the review asked these be distinct.
// ---------------------------------------------------------------------------

test('the traversal marker is not evidence of redaction: an off-policy payload carries it too', async () => {
  const { wrapped } = harness('orchestrator', 'store', 'off');
  const payload = { key: 'k', value: { note: PII } };
  await wrapped(payload);
  assert.equal(pf._hasPrivacyMark(payload), true, 'marked as having traversed the layer');
  assert.equal(payload.value.note, PII, 'yet nothing was redacted — the marker is a traversal fact only');
});
