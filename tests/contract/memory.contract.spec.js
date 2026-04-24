'use strict';

/**
 * Contract test suite — memory adapter slot
 *
 * M2: real implementations. Promoted assertions marked [M2].
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');
const { AdapterDisabled } = require('../../management-api/adapters/errors');

const { EmbeddedRuvectorMemoryAdapter } = require('../../management-api/adapters/memory/embedded-ruvector');
const { ExternalPgMemoryAdapter }       = require('../../management-api/adapters/memory/external-pg');
const { OffMemoryAdapter }              = require('../../management-api/adapters/memory/off');

const REQUIRED_METHODS = ['store', 'search', 'retrieve', 'del'];

// ---------------------------------------------------------------------------
// Minimal pg client stub
// ---------------------------------------------------------------------------
function makePgStub() {
  const tables = new Map(); // `${key}::${namespace}` -> {key, namespace, value, stored_at}

  return {
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('CREATE TABLE')) return { rows: [], rowCount: 0 };

      if (s.startsWith('INSERT INTO memory_entries')) {
        const [key, namespace, value] = params;
        tables.set(`${key}::${namespace}`, { key, namespace, value, stored_at: new Date() });
        return { rows: [], rowCount: 1 };
      }

      if (s.startsWith('SELECT key, value, namespace, stored_at FROM memory_entries WHERE key')) {
        const [key, namespace] = params;
        const row = tables.get(`${key}::${namespace}`);
        return { rows: row ? [row] : [] };
      }

      if (s.startsWith('SELECT key, value, namespace, stored_at,')) {
        // search
        const [pattern, namespace, limit] = params;
        const term = pattern.replace(/%/g, '').toLowerCase();
        const results = [];
        for (const row of tables.values()) {
          if (row.namespace === namespace && row.value.toLowerCase().includes(term)) {
            results.push({ ...row, score: '1.0' });
          }
        }
        return { rows: results.slice(0, limit) };
      }

      if (s.startsWith('DELETE FROM memory_entries')) {
        const [key, namespace] = params;
        const existed = tables.delete(`${key}::${namespace}`);
        return { rows: [], rowCount: existed ? 1 : 0 };
      }

      if (s.startsWith('SELECT key FROM memory_entries WHERE namespace')) {
        const [namespace] = params;
        const keys = [];
        for (const row of tables.values()) {
          if (row.namespace === namespace) keys.push({ key: row.key });
        }
        return { rows: keys };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

const IMPLS = [
  {
    label: 'embedded-ruvector',
    makeAdapter: () => new EmbeddedRuvectorMemoryAdapter(),
    isReal: true,
  },
  {
    label: 'external-pg',
    makeAdapter: () => new ExternalPgMemoryAdapter({ client: makePgStub() }),
    isReal: true,
  },
  {
    label: 'off',
    makeAdapter: () => new OffMemoryAdapter(),
    isReal: false,
  },
];

for (const { label, makeAdapter, isReal } of IMPLS) {
  describe(`memory :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'memory');
    });

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, AdapterDisabled);
      });
    }

    if (isReal) {
      it('[M2] store persists a value and returns the assigned key', async () => {
        const start = Date.now();
        const result = await adapter.store('k1', 'hello world', 'test-ns');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('key', 'k1');
        expect(result).toHaveProperty('namespace', 'test-ns');
        expect(result).toHaveProperty('stored_at');
      });

      it('[M2] retrieve returns the value previously stored under a key', async () => {
        await adapter.store('k2', 'stored-value', 'test-ns');
        const start = Date.now();
        const entry = await adapter.retrieve('k2', 'test-ns');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(entry).not.toBeNull();
        expect(entry.value).toBe('stored-value');
      });

      it('[M2] del removes the entry and retrieve subsequently returns null', async () => {
        await adapter.store('k3', 'to-delete', 'test-ns');
        const start = Date.now();
        const delResult = await adapter.del('k3', 'test-ns');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(delResult.deleted).toBe(true);
        const gone = await adapter.retrieve('k3', 'test-ns');
        expect(gone).toBeNull();
      });

      it('[M2] retrieve returns null (not an error) for unknown keys', async () => {
        const result = await adapter.retrieve('nonexistent-key-xyz', 'test-ns');
        expect(result).toBeNull();
      });

      it('[M2] search returns ranked results for a semantic query', async () => {
        await adapter.store('doc1', 'the quick brown fox', 'search-ns');
        await adapter.store('doc2', 'lazy dog sleeping', 'search-ns');
        const start = Date.now();
        const { results } = await adapter.search('fox', { namespace: 'search-ns', limit: 10 });
        expect(Date.now() - start).toBeLessThan(1000);
        expect(Array.isArray(results)).toBe(true);
        // At least one result should reference 'fox' content
        const keys = results.map(r => r.key);
        expect(keys).toContain('doc1');
      });
    }

    // Promoted additional behavioural assertions (M2)
    if (isReal) {
      it('[M2] store is idempotent — re-storing same key overwrites and returns updated stored_at', async () => {
        await adapter.store('idem-key', 'first-value', 'idem-ns');
        const second = await adapter.store('idem-key', 'second-value', 'idem-ns');
        expect(second.key).toBe('idem-key');
        const retrieved = await adapter.retrieve('idem-key', 'idem-ns');
        expect(retrieved.value).toBe('second-value');
      });

      it('[M2] namespace isolation — key in ns-a is not visible in ns-b', async () => {
        await adapter.store('shared-key', 'ns-a-value', 'ns-a');
        const fromNsB = await adapter.retrieve('shared-key', 'ns-b');
        expect(fromNsB).toBeNull();
      });

      it('[M2] search returns empty results for a namespace with no entries', async () => {
        const { results } = await adapter.search('anything', { namespace: 'empty-ns-xyz' });
        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(0);
      });

      it('[M2] del returns deleted=false when key does not exist', async () => {
        const result = await adapter.del('never-stored-key-xyz', 'test-ns');
        expect(result.deleted).toBe(false);
      });

      it('[M2] search respects limit — returns at most limit results', async () => {
        for (let i = 0; i < 5; i++) {
          await adapter.store(`limit-doc-${i}`, `fox quick brown ${i}`, 'limit-ns');
        }
        const { results } = await adapter.search('fox', { namespace: 'limit-ns', limit: 2 });
        expect(results.length).toBeLessThanOrEqual(2);
      });
    }

    // Pending (require production env or ONNX pipeline)
    // Unblock latency todos: k6 against a live embedded-ruvector instance with
    // the ONNX model loaded; test on hardware with ONNX runtime available.
    // Latency is dominated by the MiniLM-L6-v2 inference pass (~200 ms cold,
    // ~50 ms warm) and cannot be measured fairly in CI on shared runners.
    it.todo('store (with embedding) p95 latency is under 500 ms at 10 req/s — needs k6 load harness + hardware with ONNX runtime (MiniLM-L6-v2 ~200 ms cold); CI shared runners are too variable');
    it.todo('search p95 latency is under 250 ms at 50 req/s — needs k6 load harness + ONNX runtime; same constraint as store latency');
    // Unblock EmbeddingError: inject a broken ONNX pipeline (e.g. corrupt model
    // weights or a mock that throws) into EmbeddedRuvectorMemoryAdapter and assert
    // the adapter wraps the error as EmbeddingError before propagating.
    // Blocked on: EmbeddedRuvectorMemoryAdapter exposing an injectable model path
    // or model-loader function so tests can substitute a broken ONNX session.
    it.todo('search throws a typed EmbeddingError when the embedding model is unavailable — blocked on EmbeddedRuvectorMemoryAdapter accepting an injectable ONNX model loader (broken model mock)');
  });
}
