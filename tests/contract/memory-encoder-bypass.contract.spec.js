'use strict';

/**
 * Register O2 — routes/memory.js encoder-bypass coverage.
 *
 * Ground truth (2026-06-11 audit): the pods-fallback branch of POST /v1/memory
 * called `pods.write()` directly, skipping the JSON-LD encoder (ADR-012
 * Layer-3) even when [linked_data].pods != "off". There were NO production
 * callers of encoder.dispatch.
 *
 * ADR-031 §Middleware-bypass coverage requires a test proving a direct adapter
 * call that skips the encoder is detected, and that the wired route actually
 * routes the pod write through the encoder when the surface gate is on.
 *
 * This suite asserts at the ROUTE-WIRING level (the encoder-mechanism level is
 * covered by tests/contract/linked-data/privacy-handoff.contract.spec.js):
 *
 *   (A) When the pods linked-data surface is enabled, the memory route hands
 *       the pod payload to encoder.dispatch (it does NOT call pods.write
 *       directly) — the federated/JSON-LD leg actually runs.
 *   (B) The wired route stamps the per-dispatch privacy mark so the encoder's
 *       fail-closed L08 guard accepts the dispatch (no MiddlewareOrderViolation
 *       on the legitimate path) while a hand-rolled DIRECT pod write of the
 *       same payload to the fail-closed pods slot is rejected.
 *
 * The route is exercised through a real Fastify instance with a fake pods
 * adapter and a real (linked_data-disabled-surface vs enabled-surface) encoder,
 * so the wiring decision in routes/memory.js is what's under test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Fastify = require('../../management-api/node_modules/fastify');
const ld = require('../../management-api/middleware/linked-data');
const pf = require('../../management-api/middleware/privacy-filter');
const { assertPrivacyFilterApplied, MiddlewareOrderViolation } = pf;

// Minimal pinned-context catalogue so the encoder's ContextResolver boots
// fully offline — no runtime fetch (DDD-004 §L09). The three IRIs are exactly
// those the S1 pods surface emits in its @context array.
function makeCatalogue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-ctx-'));
  const docs = {
    'agbx.jsonld': { '@context': { '@version': 1.1, agbx: 'https://agentbox.dreamlab-ai.systems/ns/v1#', wasAttributedTo: '@id', operation: 'agbx:operation', key: 'agbx:key', namespace: 'agbx:namespace', value: 'agbx:value', stored_at: 'agbx:stored_at' } },
    'as.jsonld': { '@context': { as: 'https://www.w3.org/ns/activitystreams#', 'as:content': 'as:content', 'as:attachment': 'as:attachment' } },
    'schema.jsonld': { '@context': { schema: 'http://schema.org/', name: 'schema:name', description: 'schema:description' } },
  };
  for (const [f, body] of Object.entries(docs)) fs.writeFileSync(path.join(dir, f), JSON.stringify(body));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
    entries: [
      { iri: 'https://agentbox.dreamlab-ai.systems/ns/v1#', name: 'agbx.jsonld' },
      { iri: 'https://www.w3.org/ns/activitystreams', name: 'as.jsonld' },
      { iri: 'http://schema.org/', name: 'schema.jsonld' },
    ],
  }));
  return dir;
}

const NULL_LOGGER = { info() {}, debug() {}, error() {}, warn() {}, log() {}, child() { return NULL_LOGGER; } };

// A minimal fake pods adapter that records every write so we can prove whether
// the encoded document (with @context) or a raw payload reached it.
function makeFakePods() {
  const writes = [];
  return {
    _implName: 'local-solid-rs',
    _slot: 'pods',
    writes,
    async write(path, body, contentType) {
      writes.push({ path, body, contentType });
      return { location: path };
    },
    async read() { const e = new Error('not found'); e.name = 'NotFound'; throw e; },
    async list() { return { items: [], cursor: null }; },
  };
}

async function buildApp({ podsSurface }) {
  const app = Fastify({ logger: false });
  app.decorate('adapters', { memory: { _implName: 'off' }, pods: makeFakePods() });

  const manifest = podsSurface
    ? {
        linked_data: {
          enabled: true,
          pods: 'on',
          // Pinned catalogue + no network; skip round-trip so the test stays a
          // route-wiring assertion (round-trip is exercised by the LD suites).
          context_catalogue: makeCatalogue(),
          round_trip_in_dispatch: false,
          unknown_context_policy: 'fail-closed',
        },
      }
    : { linked_data: { enabled: false, pods: 'off' } };

  const encoder = await ld.createEncoder({ manifest, logger: NULL_LOGGER });
  app.decorate('linkedData', encoder);

  await app.register(require('../../management-api/routes/memory'));
  await app.ready();
  return app;
}

describe('O2 — memory route routes pods writes through the JSON-LD encoder (ADR-031)', () => {
  const saved = {};
  beforeAll(() => {
    saved.OPF_MODE = process.env.OPF_MODE;
    saved.NPUB = process.env.AGENTBOX_NPUB;
    // NPUB must be set for the pods fallback branch to engage.
    process.env.AGENTBOX_NPUB = 'npub1testtesttesttesttesttesttesttesttesttesttesttesttest';
    process.env.MEMORY_ADMIN_ACCESS_MODE = 'permissive';
  });
  afterAll(() => {
    if (saved.OPF_MODE === undefined) delete process.env.OPF_MODE; else process.env.OPF_MODE = saved.OPF_MODE;
    if (saved.NPUB === undefined) delete process.env.AGENTBOX_NPUB; else process.env.AGENTBOX_NPUB = saved.NPUB;
  });

  test('(A) with the pods surface ON, the pod write is encoded (carries @context) and stored as ld+json', async () => {
    process.env.OPF_MODE = 'on'; // privacy filter active — fail-closed guard live
    const app = await buildApp({ podsSurface: true });
    try {
      const res = await app.inject({
        method: 'POST', url: '/v1/memory',
        payload: { key: 'k-enc', value: 'no-pii-here', namespace: 'unit' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.encoded).toBe(true); // route took the encoder branch, not the raw branch

      const pods = app.adapters.pods;
      expect(pods.writes).toHaveLength(1);
      const doc = JSON.parse(pods.writes[0].body);
      expect(doc).toHaveProperty('@context');     // S1 surface output
      expect(pods.writes[0].contentType).toBe('application/ld+json');
      // The non-enumerable privacy marker must NOT have leaked into the bytes.
      expect(pods.writes[0].body).not.toContain('privacyFilterApplied');
    } finally {
      await app.close();
    }
  });

  test('(B) bypass detection: a DIRECT unmarked pod-slot dispatch (no privacy stamp) is rejected fail-closed', () => {
    process.env.OPF_MODE = 'on';
    // This models the OLD routes/memory.js behaviour: build the entry and hand
    // it to the encoder/adapter WITHOUT stamping privacy. pods is fail-closed.
    const bypassed = { '@context': 'http://schema.org/', '@type': 'MemoryEntry', key: 'k', value: 'leak@example.com' };
    expect(() => assertPrivacyFilterApplied(bypassed, 'pods', NULL_LOGGER))
      .toThrow(MiddlewareOrderViolation);
  });

  test('(C) with the pods surface OFF, the raw path still stamps privacy and writes (no bypass, no throw)', async () => {
    process.env.OPF_MODE = 'on';
    const app = await buildApp({ podsSurface: false });
    try {
      const res = await app.inject({
        method: 'POST', url: '/v1/memory',
        payload: { key: 'k-raw', value: 'clean', namespace: 'unit' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.encoded).toBeUndefined(); // raw branch
      expect(app.adapters.pods.writes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
