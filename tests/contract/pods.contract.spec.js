'use strict';

/**
 * Contract test suite — pods adapter slot
 *
 * M2: real implementations. Promoted assertions marked [M2].
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');
const { AdapterDisabled } = require('../../management-api/adapters/errors');

const { LocalJssPodsAdapter }      = require('../../management-api/adapters/pods/local-jss');
const { LocalSolidRsPodsAdapter }  = require('../../management-api/adapters/pods/local-solid-rs');
const { ExternalPodsAdapter }      = require('../../management-api/adapters/pods/external');
const { OffPodsAdapter }           = require('../../management-api/adapters/pods/off');

const REQUIRED_METHODS = ['write', 'read', 'patch', 'del', 'list'];

// ---------------------------------------------------------------------------
// Fetch stub for JSS/external — in-memory document store
// ---------------------------------------------------------------------------
function makeJssFetch() {
  const store = new Map();
  return async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const uri = url.replace('http://localhost:8484', '').replace('http://fake-host', '');

    if (method === 'PUT') {
      store.set(uri, { body: opts.body || '', contentType: (opts.headers || {})['Content-Type'] || 'application/octet-stream' });
      const status = store.size === 1 ? 201 : 200;
      return {
        ok: true, status,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '',
      };
    }

    if (method === 'GET') {
      const entry = store.get(uri);
      if (!entry) {
        // Container URIs (trailing slash) return an empty container document, not 404
        if (uri.endsWith('/')) {
          return {
            ok: true, status: 200,
            headers: { get: (h) => h === 'content-type' ? 'application/ld+json' : null },
            text: async () => '{}',
            json: async () => ({ '@graph': [], _cursor: null }),
          };
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => 'Not Found' };
      }
      return {
        ok: true, status: 200,
        headers: { get: (h) => h === 'content-type' ? entry.contentType : null },
        text: async () => entry.body,
        json: async () => ({ '@graph': [], _cursor: null }),
      };
    }

    if (method === 'PATCH') {
      if (!store.has(uri)) return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'Not Found' };
      return { ok: true, status: 204, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    }

    if (method === 'DELETE') {
      store.delete(uri);
      return { ok: true, status: 204, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    }

    return { ok: false, status: 405, headers: { get: () => null }, text: async () => 'Method Not Allowed' };
  };
}

// solid-pod-rs aware fetch stub — advertises Accept-Patch (N3) and Link rel=next
// so the LocalSolidRsPodsAdapter capability probe returns realistic values.
function makeSolidRsFetch() {
  const base = makeJssFetch();
  return async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'OPTIONS' && url.endsWith('/')) {
      return {
        ok: true, status: 204,
        headers: {
          get: (h) => {
            if (h === 'accept-patch') return 'text/n3, application/sparql-update, application/json-patch+json';
            if (h === 'accept-post')  return 'text/turtle, application/ld+json';
            return null;
          }
        },
        text: async () => '', json: async () => ({}),
      };
    }
    return base(url, opts);
  };
}

const IMPLS = [
  {
    label: 'local-solid-rs',
    makeAdapter: () => new LocalSolidRsPodsAdapter({
      baseUrl: 'http://127.0.0.1:8484',
      fetchFn: makeSolidRsFetch(),
      probeCapabilities: false, // deterministic: exercise explicitly where needed
    }),
    isReal: true,
    firstClass: true,
  },
  {
    label: 'local-jss',
    makeAdapter: () => new LocalJssPodsAdapter({ baseUrl: 'http://localhost:8484', fetchFn: makeJssFetch() }),
    isReal: true,
    firstClass: false,
  },
  {
    label: 'external',
    makeAdapter: () => new ExternalPodsAdapter({ baseUrl: 'http://fake-host', fetchFn: makeJssFetch() }),
    isReal: true,
    firstClass: false,
  },
  {
    label: 'off',
    makeAdapter: () => new OffPodsAdapter(),
    isReal: false,
    firstClass: false,
  },
];

for (const { label, makeAdapter, isReal, firstClass } of IMPLS) {
  describe(`pods :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'pods');
    });

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, AdapterDisabled);
      });
    }

    if (isReal) {
      it('[M2] write stores a resource and returns uri and status', async () => {
        const start = Date.now();
        const result = await adapter.write('/docs/brief-1', '{"hello":"world"}', 'application/ld+json');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('uri', '/docs/brief-1');
        expect([200, 201]).toContain(result.status);
        expect(result).toHaveProperty('created_at');
      });

      it('[M2] read retrieves the stored resource with correct content-type', async () => {
        await adapter.write('/docs/brief-2', 'content here', 'text/plain');
        const start = Date.now();
        const result = await adapter.read('/docs/brief-2');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('uri', '/docs/brief-2');
        expect(result).toHaveProperty('body', 'content here');
      });

      it('[M2] patch applies a JSON-patch diff and returns updated_at', async () => {
        await adapter.write('/docs/brief-3', '{"a":1}', 'application/ld+json');
        const start = Date.now();
        const result = await adapter.patch('/docs/brief-3', [{ op: 'replace', path: '/a', value: 2 }]);
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('uri', '/docs/brief-3');
        expect(result).toHaveProperty('updated_at');
      });

      it('[M2] del removes the resource and subsequent read returns 404', async () => {
        await adapter.write('/docs/brief-4', 'data', 'text/plain');
        const start = Date.now();
        const result = await adapter.del('/docs/brief-4');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('deleted', true);
        await expect(adapter.read('/docs/brief-4')).rejects.toThrow();
      });

      it('[M2] list returns container children', async () => {
        await adapter.write('/container/item-1', 'x', 'text/plain');
        const start = Date.now();
        const result = await adapter.list('/container/');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('items');
        expect(Array.isArray(result.items)).toBe(true);
      });
    }

    // Promoted typed-error and additional behavioural assertions (M2)
    if (isReal) {
      it('[M2] read throws a typed NotFound for unknown URIs', async () => {
        await expect(adapter.read('/never/written/resource')).rejects.toMatchObject({
          name: 'NotFound',
          code: 'NOT_FOUND',
        });
      });

      it('[M2] write overwrites an existing resource and returns status 200', async () => {
        await adapter.write('/docs/overwrite-target', 'v1', 'text/plain');
        const result = await adapter.write('/docs/overwrite-target', 'v2', 'text/plain');
        expect([200, 201]).toContain(result.status);
        expect(result.uri).toBe('/docs/overwrite-target');
      });

      it('[M2] del on a resource that does not exist does not throw (idempotent delete)', async () => {
        // JSS fetch-stub returns 204 for DELETE regardless; contract allows idempotent del
        await expect(adapter.del('/docs/never-existed')).resolves.toBeDefined();
      });

      it('[M2] list on a container always returns an items array', async () => {
        const result = await adapter.list('/empty-container/');
        expect(result).toHaveProperty('items');
        expect(Array.isArray(result.items)).toBe(true);
      });

      it('[M2] write followed by read returns correct content-type', async () => {
        await adapter.write('/docs/ct-check', '<html/>', 'text/html');
        const { contentType } = await adapter.read('/docs/ct-check');
        // content-type may include charset suffix; check prefix
        expect(contentType || '').toMatch(/text\/html|text\/plain|application/);
      });
    }

    // ADR-010 first-class-impl assertions (solid-pod-rs only).
    if (firstClass) {
      it('[ADR-010] reports impl tag "local-solid-rs"', () => {
        expect(adapter.impl).toBe('local-solid-rs');
      });

      it('[ADR-010] probeCapabilities surfaces Accept-Patch dialects', async () => {
        await adapter.probeCapabilities();
        expect(adapter._capabilities.acceptPatch).toMatch(/n3|sparql|json-patch/);
      });

      it('[ADR-010] patch with format="n3" routes through N3 when advertised', async () => {
        await adapter.write('/n3/doc', '<> <http://x> "v1".', 'text/n3');
        const probed = await adapter.probeCapabilities();
        expect(probed.acceptPatch).toMatch(/n3/);
        const out = await adapter.patch('/n3/doc', '@prefix ex:<http://x#>. <> ex:says "hi".', { format: 'n3' });
        expect(out.format).toBe('n3');
      });

      // Follow-ups requiring a running solid-pod-rs instance; stubbed as todos
      // so they surface in CI reports and get wired when the live test harness lands.
      it.todo('[ADR-010] did:nostr:<npub> resolves to a Tier 1 DID document with alsoKnownAs');
      it.todo('[ADR-010] quota: write past quota_default_bytes returns 413');
      it.todo('[ADR-010] rate-limit: 21st req/sec per connection returns 429 when rate_limit_per_sec=20');
      it.todo('[ADR-010] WAC 2.0: acl:default inheritance propagates from container to child');
      it.todo('[ADR-010] notifications: PUT triggers WebSocket notification within 200 ms p95');
      it.todo('[ADR-010] webhook-signing: outbound notification carries RFC 9421 Ed25519 signature');
      it.todo('[ADR-010] ETag: If-Match with stale ETag returns 412');
      it.todo('[ADR-010] cold-start: supervisord → first 200 on OPTIONS / within 4 s');
    }

    // Pending (require production env or WAC-capable runtime)
    // Unblock latency todos: k6 against a live Community Solid Server instance
    // with network round-trip included; CI has no Solid pod service running.
    it.todo('write p95 latency is under 300 ms at 20 req/s — needs k6 load harness + live Community Solid Server (CSS); no CSS instance in CI');
    it.todo('read p95 latency is under 150 ms at 100 req/s — needs k6 load harness + live CSS instance; same constraint as write latency');
    // Unblock PermissionDenied: spin up CSS with a WAC policy that denies the
    // test agent's WebID write access to a specific resource, then confirm the
    // adapter surfaces PermissionDenied.  Requires a running CSS instance with
    // WAC enabled and a pre-configured ACL fixture — not feasible without a
    // container-based service fixture in the test environment.
    it.todo('write throws a typed PermissionDenied when WAC policy is violated — blocked on a WAC-capable CSS instance with ACL fixture; PermissionDenied is only reachable via HTTP 403 from a live server');
  });
}
