'use strict';

/**
 * Contract test suite — beads adapter slot
 *
 * Parameterised over all three implementation classes.
 * M1 milestone: placeholder stubs give ≥1 real passing assertion per impl.
 * Remaining cases are .todo pending real implementations.
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');

// Placeholder stubs — replace each import with the real impl when it ships.
const { BeadsAdapterPlaceholder: LocalSqliteStub, AdapterDisabled } =
  require('../../management-api/adapters/beads/placeholder');
const { BeadsAdapterPlaceholder: ExternalStub } =
  require('../../management-api/adapters/beads/placeholder');
const { BeadsAdapterPlaceholder: OffStub, AdapterDisabled: OffAdapterDisabled } =
  require('../../management-api/adapters/beads/placeholder');

const REQUIRED_METHODS = ['createEpic', 'createChild', 'claim', 'close', 'getReady', 'show'];

const IMPLS = [
  { label: 'local-sqlite', Factory: LocalSqliteStub },
  { label: 'external',     Factory: ExternalStub     },
  { label: 'off',          Factory: OffStub           },
];

for (const { label, Factory } of IMPLS) {
  describe(`beads :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = new Factory(); });

    // --- Passing assertions (M1) ---

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'beads');
    });

    // --- Pending: off-class discipline ---

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, OffAdapterDisabled);
      });
    }

    // --- Pending: behavioural equivalence (promote when real impl ships) ---

    it.todo('createEpic returns an epic with id, title, and status=open');
    it.todo('createChild links to parent epic and inherits attribution');
    it.todo('claim is idempotent — re-claim by same actor is a no-op');
    it.todo('close sets status=closed and records outcome');
    it.todo('getReady returns only unclaimed children');
    it.todo('show returns full epic/child detail');

    // --- Pending: SLO compliance ---

    it.todo('createEpic p95 latency is under 200 ms at 50 req/s');
    it.todo('getReady p95 latency is under 100 ms at 200 req/s');

    // --- Pending: error shape ---

    it.todo('createEpic throws a typed NotFound when epic id is unknown');
    it.todo('claim throws a typed AlreadyClaimed when another actor holds the bead');
  });
}
