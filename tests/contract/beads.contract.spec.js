'use strict';

/**
 * Contract test suite — beads adapter slot
 *
 * Parameterised over all three implementation classes.
 * M2: real implementations. Promoted assertions marked [M2].
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');
const { AdapterDisabled } = require('../../management-api/adapters/errors');

const { LocalSqliteBeadsAdapter } = require('../../management-api/adapters/beads/local-sqlite');
const { ExternalBeadsAdapter }    = require('../../management-api/adapters/beads/external');
const { OffBeadsAdapter }         = require('../../management-api/adapters/beads/off');

const REQUIRED_METHODS = ['createEpic', 'createChild', 'claim', 'close', 'getReady', 'show'];

// ---------------------------------------------------------------------------
// Helpers — minimal fetch stub for external adapter
// ---------------------------------------------------------------------------
function makeFetchStub(responses) {
  // responses: Map<url-substring, {status, body}>
  return async (url, _opts) => {
    for (const [key, resp] of responses) {
      if (url.includes(key)) {
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => resp.body,
          text: async () => JSON.stringify(resp.body),
        };
      }
    }
    return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
  };
}

// ---------------------------------------------------------------------------
// Implementation factories
// ---------------------------------------------------------------------------
const IMPLS = [
  {
    label: 'local-sqlite',
    makeAdapter: () => new LocalSqliteBeadsAdapter({ dbPath: ':memory:' }),
    isReal: true,
  },
  {
    label: 'external',
    makeAdapter: () => {
      const epicBody = { id: 'ep1', title: 'T', type: 'epic', status: 'open', priority: 1, actor: null, tags: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const childBody = { id: 'ch1', title: 'C', type: 'child', parent_id: 'ep1', status: 'open', priority: 1, actor: null, tags: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const claimBody = { ...childBody, status: 'claimed', actor: 'agent-1' };
      const closeBody = { ...childBody, status: 'closed' };
      const readyBody = [epicBody];
      const fetchFn = makeFetchStub(new Map([
        ['epics', { status: 201, body: epicBody }],
        ['children', { status: 201, body: childBody }],
        ['claim', { status: 200, body: claimBody }],
        ['close', { status: 200, body: closeBody }],
        ['ready', { status: 200, body: readyBody }],
        ['ep1', { status: 200, body: epicBody }],
      ]));
      return new ExternalBeadsAdapter({ baseUrl: 'http://fake-host', fetchFn });
    },
    isReal: false, // fetch-stubbed
  },
  {
    label: 'off',
    makeAdapter: () => new OffBeadsAdapter(),
    isReal: false,
  },
];

for (const { label, makeAdapter, isReal } of IMPLS) {
  describe(`beads :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });
    afterEach(() => { if (adapter && adapter.close_db) adapter.close_db(); });

    // --- Shape + contract assertions ---

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'beads');
    });

    // --- Off-class discipline ---

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, AdapterDisabled);
      });
    }

    // --- Promoted behavioural assertions (M2) ---

    if (isReal) {
      it('[M2] createEpic returns an epic with id, title, and status=open', async () => {
        const start = Date.now();
        const epic = await adapter.createEpic({ title: 'My Epic' });
        expect(Date.now() - start).toBeLessThan(1000);
        expect(epic).toHaveProperty('id');
        expect(epic.title).toBe('My Epic');
        expect(epic.type).toBe('epic');
        expect(epic.status).toBe('open');
      });

      it('[M2] createChild links to parent epic and inherits attribution', async () => {
        const epic = await adapter.createEpic({ title: 'Parent', actor: 'alice' });
        const start = Date.now();
        const child = await adapter.createChild({ title: 'Sub-task', parent_id: epic.id, actor: 'alice' });
        expect(Date.now() - start).toBeLessThan(1000);
        expect(child).toHaveProperty('id');
        expect(child.parent_id).toBe(epic.id);
        expect(child.type).toBe('child');
        expect(child.actor).toBe('alice');
      });

      it('[M2] claim is idempotent — re-claim by same actor is a no-op', async () => {
        const epic = await adapter.createEpic({ title: 'E' });
        await adapter.claim(epic.id, 'agent-1');
        const start = Date.now();
        const second = await adapter.claim(epic.id, 'agent-1');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(second.actor).toBe('agent-1');
        expect(second.status).toBe('claimed');
      });

      it('[M2] close sets status=closed and records outcome', async () => {
        const epic = await adapter.createEpic({ title: 'E' });
        const start = Date.now();
        const closed = await adapter.close(epic.id, 'done');
        expect(Date.now() - start).toBeLessThan(1000);
        expect(closed.status).toBe('closed');
      });

      it('[M2] getReady returns only unclaimed children', async () => {
        const epic = await adapter.createEpic({ title: 'E' });
        const c1 = await adapter.createChild({ title: 'C1', parent_id: epic.id });
        const c2 = await adapter.createChild({ title: 'C2', parent_id: epic.id });
        await adapter.claim(c1.id, 'agent-1');
        const start = Date.now();
        const ready = await adapter.getReady({ parent_id: epic.id });
        expect(Date.now() - start).toBeLessThan(1000);
        const ids = ready.map(r => r.id);
        expect(ids).not.toContain(c1.id);
        expect(ids).toContain(c2.id);
      });

      it('[M2] show returns full epic/child detail', async () => {
        const epic = await adapter.createEpic({ title: 'Full Detail' });
        const start = Date.now();
        const shown = await adapter.show(epic.id);
        expect(Date.now() - start).toBeLessThan(1000);
        expect(shown.id).toBe(epic.id);
        expect(shown.title).toBe('Full Detail');
      });
    }

    // --- Pending ---

    it.todo('createEpic p95 latency is under 200 ms at 50 req/s');
    it.todo('getReady p95 latency is under 100 ms at 200 req/s');
    it.todo('createEpic throws a typed NotFound when epic id is unknown');
    it.todo('claim throws a typed AlreadyClaimed when another actor holds the bead');
  });
}
