'use strict';

/**
 * Contract test — privacy-filter middleware (ADR-008).
 *
 * Tests:
 *   1. strict policy: write containing PII is redacted before reaching the adapter.
 *   2. strict policy: OPF unreachable → write rejected (fail-closed, AdapterWriteRejected).
 *   3. soft policy: OPF unreachable → write allowed with original payload (fail-open).
 *   4. off policy: OPF never called; payload passes through unchanged.
 *   5. Smoke test: POST /v1/memory with a fake email in value → stored value has PII token replaced.
 *
 * The OPF sidecar is stubbed via an HTTP server on a loopback port so no real
 * model load is needed.
 */

const http = require('http');
const { wrapWithPrivacyFilter, AdapterWriteRejected, DEFAULT_POLICY } = require('../../management-api/middleware/privacy-filter');
const { EmbeddedRuvectorMemoryAdapter } = require('../../management-api/adapters/memory/embedded-ruvector');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Start a minimal HTTP server that simulates the OPF /redact endpoint.
 *
 * @param {object} opts
 * @param {boolean} opts.redact     — if true, replace all email-like tokens
 * @param {boolean} opts.fail       — if true, respond with 500
 * @param {boolean} opts.disconnect — if true, destroy socket without response
 * @returns {{ server: http.Server, port: number, close: () => Promise<void>, calls: Array }}
 */
function makeOpfStub({ redact = true, fail = false, disconnect = false } = {}) {
  const calls = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (disconnect) {
        req.socket.destroy();
        return;
      }
      if (fail) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'model load failed' }));
        return;
      }
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { text: '', slot: '' }; }
      calls.push({ path: req.url, body: parsed });

      let text = parsed.text || '';
      const replaced = [];
      if (redact) {
        // Replace anything matching a simple email pattern with [REDACTED:email]
        text = text.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, (m) => {
          replaced.push({ entity: 'email', original: m, replacement: '[REDACTED:email]' });
          return '[REDACTED:email]';
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, replaced }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        calls,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Test 1: strict policy — PII is redacted before adapter receives payload
// ---------------------------------------------------------------------------

test('strict policy: email in value is redacted before reaching adapter', async () => {
  const stub = await makeOpfStub({ redact: true });

  process.env.OPF_ENDPOINT = `http://127.0.0.1:${stub.port}`;
  process.env.OPF_MODE     = 'local-cpu';

  const received = [];
  async function fakeStore(payload) {
    received.push(payload);
    return { stored: true };
  }

  const manifest = { privacy_filter: { policy: { memory: 'strict' } } };
  const wrapped = wrapWithPrivacyFilter('memory', 'store', fakeStore, manifest);

  await wrapped({ key: 'test', value: 'contact victim@example.com for details' });

  expect(stub.calls.length).toBe(1);
  expect(received.length).toBe(1);
  expect(received[0].value).toBe('contact [REDACTED:email] for details');
  expect(received[0].value).not.toContain('victim@example.com');

  await stub.close();
  delete process.env.OPF_ENDPOINT;
  delete process.env.OPF_MODE;
});

// ---------------------------------------------------------------------------
// Test 2: strict policy — OPF unreachable → fail-closed (AdapterWriteRejected)
// ---------------------------------------------------------------------------

test('strict policy: OPF unreachable rejects write (fail-closed)', async () => {
  // Point at a port nothing is listening on
  process.env.OPF_ENDPOINT = 'http://127.0.0.1:19999';
  process.env.OPF_MODE     = 'local-cpu';

  let adapterCalled = false;
  async function fakeStore(payload) {
    adapterCalled = true;
    return { stored: true };
  }

  const manifest = { privacy_filter: { policy: { memory: 'strict' } } };
  const wrapped = wrapWithPrivacyFilter('memory', 'store', fakeStore, manifest);

  await expect(
    wrapped({ key: 'k', value: 'pii@example.com' })
  ).rejects.toThrow(AdapterWriteRejected);

  expect(adapterCalled).toBe(false);

  delete process.env.OPF_ENDPOINT;
  delete process.env.OPF_MODE;
});

// ---------------------------------------------------------------------------
// Test 3: soft policy — OPF unreachable → fail-open (original payload allowed)
// ---------------------------------------------------------------------------

test('soft policy: OPF unreachable allows write with original payload (fail-open)', async () => {
  process.env.OPF_ENDPOINT = 'http://127.0.0.1:19999';
  process.env.OPF_MODE     = 'local-cpu';

  const received = [];
  async function fakeEmit(payload) {
    received.push(payload);
    return { emitted: true };
  }

  // events default policy is 'soft'
  const manifest = {};
  const wrapped = wrapWithPrivacyFilter('events', 'emit', fakeEmit, manifest);

  await wrapped({ type: 'test', data: 'contact secret@example.com' });

  expect(received.length).toBe(1);
  // Original payload is preserved because OPF was unavailable (fail-open)
  expect(received[0].data).toContain('secret@example.com');

  delete process.env.OPF_ENDPOINT;
  delete process.env.OPF_MODE;
});

// ---------------------------------------------------------------------------
// Test 4: OPF_MODE=off → no OPF call, payload passes through unchanged
// ---------------------------------------------------------------------------

test('OPF_MODE=off: no redaction call, payload unchanged', async () => {
  process.env.OPF_MODE = 'off';
  // Set endpoint to a working stub; calls to it would indicate a bug
  const stub = await makeOpfStub({ redact: true });
  process.env.OPF_ENDPOINT = `http://127.0.0.1:${stub.port}`;

  const received = [];
  async function fakeStore(payload) {
    received.push(payload);
    return { stored: true };
  }

  const manifest = { privacy_filter: { policy: { memory: 'strict' } } };
  const wrapped = wrapWithPrivacyFilter('memory', 'store', fakeStore, manifest);

  await wrapped({ key: 'k', value: 'plain@example.com' });

  expect(stub.calls.length).toBe(0);
  expect(received[0].value).toBe('plain@example.com');

  await stub.close();
  delete process.env.OPF_ENDPOINT;
  delete process.env.OPF_MODE;
});

// ---------------------------------------------------------------------------
// Test 5: Smoke test — EmbeddedRuvectorMemoryAdapter + privacy filter
//   Simulates what routes/memory.js does: mem.store(key, valueString, ns)
//   The value on retrieval must have the PII email address replaced.
// ---------------------------------------------------------------------------

test('smoke: memory adapter store(key, value, ns) with PII email is redacted on retrieval', async () => {
  const stub = await makeOpfStub({ redact: true });
  process.env.OPF_ENDPOINT = `http://127.0.0.1:${stub.port}`;
  process.env.OPF_MODE     = 'local-cpu';

  const adapter = new EmbeddedRuvectorMemoryAdapter();
  const manifest = { privacy_filter: { policy: { memory: 'strict' } } };

  // Wrap the adapter's store method (positional convention: key, value, namespace)
  const wrappedStore = wrapWithPrivacyFilter(
    'memory',
    'store',
    adapter.store.bind(adapter),
    manifest,
  );

  // Store a value using the positional calling convention that routes/memory.js uses:
  //   mem.store(key, valueString, effectiveNamespace)
  await wrappedStore('contact', 'reach out to victim@example.com for support', 'test');

  // Retrieve and assert PII was redacted before the adapter persisted the value
  const entry = await adapter.retrieve('contact', 'test');

  expect(entry).not.toBeNull();
  // The original email address must not appear in the stored value
  expect(entry.value).not.toContain('victim@example.com');
  // The OPF replacement token must be present
  expect(entry.value).toContain('[REDACTED:email]');

  // Verify the OPF stub was actually called
  expect(stub.calls.length).toBeGreaterThan(0);

  await stub.close();
  delete process.env.OPF_ENDPOINT;
  delete process.env.OPF_MODE;
});

// ---------------------------------------------------------------------------
// Test 6: DEFAULT_POLICY table matches ADR-008 §Manifest contract defaults
// ---------------------------------------------------------------------------

test('default policy table matches ADR-008 spec', () => {
  expect(DEFAULT_POLICY.pods).toBe('strict');
  expect(DEFAULT_POLICY.memory).toBe('strict');
  expect(DEFAULT_POLICY.events).toBe('soft');
  expect(DEFAULT_POLICY.beads).toBe('soft');
  expect(DEFAULT_POLICY.orchestrator).toBe('off');
});
