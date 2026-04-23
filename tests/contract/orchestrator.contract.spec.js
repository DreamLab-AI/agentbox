'use strict';

/**
 * Contract test suite — orchestrator adapter slot
 *
 * Parameterised over local-process-manager, stdio-bridge, off classes.
 * M1: placeholder stubs give ≥1 real passing assertion per impl.
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');

const { OrchestratorAdapterPlaceholder: LocalProcStub, AdapterDisabled } =
  require('../../management-api/adapters/orchestrator/placeholder');
const { OrchestratorAdapterPlaceholder: StdioBridgeStub } =
  require('../../management-api/adapters/orchestrator/placeholder');
const { OrchestratorAdapterPlaceholder: OffStub, AdapterDisabled: OffAdapterDisabled } =
  require('../../management-api/adapters/orchestrator/placeholder');

const REQUIRED_METHODS = ['spawnAgent', 'streamEvent', 'listAgents', 'terminateAgent'];

const IMPLS = [
  { label: 'local-process-manager', Factory: LocalProcStub    },
  { label: 'stdio-bridge',          Factory: StdioBridgeStub  },
  { label: 'off',                   Factory: OffStub           },
];

for (const { label, Factory } of IMPLS) {
  describe(`orchestrator :: ${label}`, () => {

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
      assertContractVersion(adapter, 'orchestrator');
    });

    // --- Pending: off-class discipline ---

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, OffAdapterDisabled);
      });
    }

    // --- Pending: behavioural equivalence ---

    it.todo('spawnAgent returns an agentId and status=running');
    it.todo('streamEvent delivers lifecycle events in order');
    it.todo('listAgents includes the newly spawned agent');
    it.todo('terminateAgent sets status=terminated and subsequent listAgents excludes it');

    // --- Pending: SLO compliance ---

    it.todo('spawnAgent p95 latency is under 2 s at 2 req/s');
    it.todo('streamEvent delivers each event within 20 ms p95');

    // --- Pending: error shape ---

    it.todo('spawnAgent throws a typed SpawnError when the process cannot start');
    it.todo('terminateAgent throws a typed NotFound for unknown agentId');
  });
}
