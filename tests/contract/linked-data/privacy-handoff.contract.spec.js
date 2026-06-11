'use strict';

/**
 * DDD-004 §L08 — Privacy → Encoder handoff is verified PER-DISPATCH.
 *
 * Regression coverage for finding O3 (docs/diagrams/00-anomaly-register.md):
 * the old assertion checked a process-global sentinel set at module-load time
 * (`global[Symbol.for('agentbox.privacyFilterApplied')] = true`), so it was
 * always true once the module loaded anywhere and could never detect a route
 * that reached the encoder without running redaction on THAT payload. The
 * counter `opf_middleware_order_violations_total` could never increment.
 *
 * The fixed mechanism stamps a per-dispatch marker (non-enumerable Symbol +
 * external WeakSet) on the payload the privacy filter processes, and the
 * encoder verifies THAT payload carries the marker.
 *
 * This suite proves:
 *   (i)  a properly-ordered dispatch passes; the payload carries the marker
 *        but the ENCODED JSON output does NOT contain it (no leak);
 *   (ii) a payload reaching the encoder WITHOUT redaction trips the
 *        violation counter and throws for fail-closed slots (pods/memory),
 *        logs-and-continues for fail-open slots (events) — matching the
 *        ADR-008 §Fail-mode per-slot posture;
 *   (iii) the check is a no-op when OPF_MODE=off (privacy filter disabled).
 */

const http = require('http');

const pf = require('../../../management-api/middleware/privacy-filter');
const {
  wrapWithPrivacyFilter,
  assertPrivacyFilterApplied,
  MiddlewareOrderViolation,
  PRIVACY_FILTER_APPLIED_KEY,
} = pf;
const ld = require('../../../management-api/middleware/linked-data');

const NULL_LOGGER = { info() {}, debug() {}, error() {}, warn() {}, log() {} };

// ---------------------------------------------------------------------------
// Minimal OPF /redact stub — echoes text back (no real redaction needed; we
// only care that the filter ran and stamped the payload).
// ---------------------------------------------------------------------------
function makeOpfStub() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let text = '';
      try { text = JSON.parse(body).text || ''; } catch { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text, replaced: [] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        endpoint: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function violationCount(slot) {
  return pf._violationCount(slot);
}

describe('DDD-004 §L08 — privacy→encoder handoff is per-dispatch (O3 regression)', () => {
  let opf;
  const savedMode = process.env.OPF_MODE;
  const savedEndpoint = process.env.OPF_ENDPOINT;

  beforeAll(async () => {
    opf = await makeOpfStub();
    process.env.OPF_ENDPOINT = opf.endpoint;
  });

  afterAll(async () => {
    if (opf) await opf.close();
    if (savedMode === undefined) delete process.env.OPF_MODE; else process.env.OPF_MODE = savedMode;
    if (savedEndpoint === undefined) delete process.env.OPF_ENDPOINT; else process.env.OPF_ENDPOINT = savedEndpoint;
  });

  // -------------------------------------------------------------------------
  // O3 proof — the old defect is gone: marker is per-payload, not global.
  // -------------------------------------------------------------------------
  test('O3: an unstamped payload is NOT considered privacy-applied even though the module is loaded', () => {
    process.env.OPF_MODE = 'on';
    // Two distinct payloads: one stamped by the filter, one never seen by it.
    const stamped = { value: 'x' };
    pf._markPrivacyApplied(stamped);
    const fresh = { value: 'x' };

    expect(pf._hasPrivacyMark(stamped)).toBe(true);
    // The whole point of O3: a fresh payload is unmarked regardless of module load.
    expect(pf._hasPrivacyMark(fresh)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (i) Properly-ordered dispatch passes; marker present but not serialised.
  // -------------------------------------------------------------------------
  test('(i) properly-ordered dispatch stamps the payload, and the marker does not leak into encoded JSON', async () => {
    process.env.OPF_MODE = 'on';

    // Object-convention write (the routes-layer shape, privacy-filter.js §A):
    // fn({ key, value, namespace }). The filter forwards the same payload
    // object onward and stamps it. This is the object the encoder receives.
    let forwarded;
    const rawAdapter = async (payload) => { forwarded = payload; return 'ok'; };
    const wrapped = wrapWithPrivacyFilter('events', 'emit', rawAdapter, null);

    const payloadObj = { key: 'k1', value: 'hello world no PII', namespace: 'ns', greeting: 'hi' };
    await wrapped(payloadObj);

    // The payload object the filter forwarded carries the per-dispatch marker…
    expect(pf._hasPrivacyMark(forwarded)).toBe(true);
    // …and the marker is the non-enumerable Symbol, invisible to JSON.
    const encoded = JSON.stringify(forwarded);
    expect(encoded).not.toContain('privacyFilterApplied');
    expect(Object.keys(forwarded)).not.toContain(PRIVACY_FILTER_APPLIED_KEY);
    expect(Object.getOwnPropertyDescriptor(forwarded, PRIVACY_FILTER_APPLIED_KEY).enumerable).toBe(false);
    // Symbol-keyed props never serialise — confirm round-trip is clean.
    expect(JSON.parse(encoded).greeting).toBe('hi');

    // And the encoder's assertion accepts a marked payload without throwing.
    expect(() => assertPrivacyFilterApplied(forwarded, 'events', NULL_LOGGER)).not.toThrow();
  });

  test('(i+) full encoder.dispatch on a marked payload succeeds and the encoded document omits the marker', async () => {
    process.env.OPF_MODE = 'on';

    // Disabled linked-data => encoder is a pass-through, but the L08 assertion
    // still runs first (encoder.js:128). A marked payload must pass.
    const encoder = await ld.createEncoder({
      manifest: { linked_data: { enabled: false } },
      logger: NULL_LOGGER,
    });

    const payload = { hello: 'world' };
    pf._markPrivacyApplied(payload);

    let encodedSeenByAdapter;
    const result = await encoder.dispatch({
      slot: 'pods', operation: 'write', payload,
      context: {}, adapterCall: (p) => { encodedSeenByAdapter = p; return Promise.resolve({ stored: true }); },
    });
    expect(result).toEqual({ stored: true });
    // Marker must not be serialisable in whatever the adapter persists.
    expect(JSON.stringify(encodedSeenByAdapter)).not.toContain('privacyFilterApplied');
  });

  // -------------------------------------------------------------------------
  // (ii) Bypass — unmarked payload trips the violation. Fail-closed slots throw.
  // -------------------------------------------------------------------------
  test('(ii) fail-closed slot (pods): unmarked payload increments the counter AND throws', async () => {
    process.env.OPF_MODE = 'on';
    const before = await violationCount('pods');

    const encoder = await ld.createEncoder({
      manifest: { linked_data: { enabled: false } },
      logger: NULL_LOGGER,
    });

    // Payload never went through wrapWithPrivacyFilter — the O2 direct-bypass shape.
    const bypassed = { value: 'leak@example.com' };

    await expect(encoder.dispatch({
      slot: 'pods', operation: 'write', payload: bypassed,
      context: {}, adapterCall: () => Promise.resolve('should-not-reach'),
    })).rejects.toBeInstanceOf(MiddlewareOrderViolation);

    expect(await violationCount('pods')).toBe(before + 1);
  });

  test('(ii) fail-closed slot (memory): direct assertion on unmarked payload throws and counts', async () => {
    process.env.OPF_MODE = 'on';
    const before = await violationCount('memory');
    const bypassed = { value: 'secret' };

    expect(() => assertPrivacyFilterApplied(bypassed, 'memory', NULL_LOGGER))
      .toThrow(MiddlewareOrderViolation);
    expect(await violationCount('memory')).toBe(before + 1);
  });

  test('(ii) fail-open slot (events): unmarked payload counts but does NOT throw', async () => {
    process.env.OPF_MODE = 'on';
    const before = await violationCount('events');
    const bypassed = { value: 'audit-line' };

    expect(() => assertPrivacyFilterApplied(bypassed, 'events', NULL_LOGGER)).not.toThrow();
    expect(await violationCount('events')).toBe(before + 1);
  });

  // -------------------------------------------------------------------------
  // (iii) OPF_MODE=off — assertion is a no-op (privacy filter disabled).
  // -------------------------------------------------------------------------
  test('(iii) OPF_MODE=off: assertion is a no-op even for an unmarked fail-closed payload', async () => {
    process.env.OPF_MODE = 'off';
    const before = await violationCount('pods');
    const bypassed = { value: 'whatever' };
    expect(() => assertPrivacyFilterApplied(bypassed, 'pods', NULL_LOGGER)).not.toThrow();
    expect(await violationCount('pods')).toBe(before); // unchanged
  });
});
