'use strict';

/**
 * Contract test suite — orchestrator adapter slot
 *
 * M2: real implementations. Promoted assertions marked [M2].
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');
const { AdapterDisabled } = require('../../management-api/adapters/errors');

const { LocalProcessManagerOrchestratorAdapter } = require('../../management-api/adapters/orchestrator/local-process-manager');
const { StdioBridgeOrchestratorAdapter }         = require('../../management-api/adapters/orchestrator/stdio-bridge');
const { OffOrchestratorAdapter }                 = require('../../management-api/adapters/orchestrator/off');

const REQUIRED_METHODS = ['spawnAgent', 'streamEvent', 'listAgents', 'terminateAgent'];

// ---------------------------------------------------------------------------
// Spawn stub: returns a minimal EventEmitter-like fake process
// ---------------------------------------------------------------------------
function makeSpawnStub() {
  const { EventEmitter } = require('events');
  return (_cmd, _args, _opts) => {
    const proc = new EventEmitter();
    proc.pid = Math.floor(Math.random() * 90000) + 10000;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = (_sig) => { proc.emit('exit', 0, null); };
    // Simulate async start
    setImmediate(() => proc.stdout.emit('data', Buffer.from('started\n')));
    return proc;
  };
}

const IMPLS = [
  {
    label: 'local-process-manager',
    makeAdapter: () => new LocalProcessManagerOrchestratorAdapter({ spawnFn: makeSpawnStub() }),
    isReal: true,
  },
  {
    label: 'stdio-bridge',
    makeAdapter: () => {
      const lines = [];
      return new StdioBridgeOrchestratorAdapter({ stdio: { write: l => lines.push(l) } });
    },
    isReal: true,
  },
  {
    label: 'off',
    makeAdapter: () => new OffOrchestratorAdapter(),
    isReal: false,
  },
];

for (const { label, makeAdapter, isReal } of IMPLS) {
  describe(`orchestrator :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'orchestrator');
    });

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, AdapterDisabled);
      });
    }

    if (isReal) {
      it('[M2] spawnAgent returns an agentId and status=running', async () => {
        const start = Date.now();
        const result = await adapter.spawnAgent({ command: 'echo', args: ['hello'] });
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('agentId');
        expect(result.status).toBe('running');
      });

      it('[M2] listAgents includes the newly spawned agent', async () => {
        const { agentId } = await adapter.spawnAgent({ command: 'echo', args: ['hi'] });
        const start = Date.now();
        const { agents } = await adapter.listAgents();
        expect(Date.now() - start).toBeLessThan(1000);
        const ids = agents.map(a => a.agentId);
        expect(ids).toContain(agentId);
      });

      it('[M2] terminateAgent sets status=terminated', async () => {
        const { agentId } = await adapter.spawnAgent({ command: 'echo', args: [] });
        const start = Date.now();
        const result = await adapter.terminateAgent(agentId);
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('agentId', agentId);
        expect(result.status).toBe('terminated');
      });

      it('[M2] streamEvent registers a handler and returns subscribed=true', async () => {
        const { agentId } = await adapter.spawnAgent({ command: 'echo', args: [] });
        const events = [];
        const start = Date.now();
        const result = await adapter.streamEvent(agentId, ev => events.push(ev));
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('agentId', agentId);
        expect(result.subscribed).toBe(true);
      });
    }

    // Promoted typed-error and additional behavioural assertions (M2)
    if (isReal) {
      it('[M2] spawnAgent throws a typed SpawnError when spec.command is missing', async () => {
        await expect(adapter.spawnAgent({})).rejects.toMatchObject({
          name: 'SpawnError',
          code: 'SPAWN_ERROR',
        });
      });

      it('[M2] terminateAgent throws a typed NotFound for an unknown agentId', async () => {
        await expect(adapter.terminateAgent('no-such-agent-xyz')).rejects.toMatchObject({
          name: 'NotFound',
          code: 'NOT_FOUND',
        });
      });

      it('[M2] listAgents returns empty agents array when none have been spawned', async () => {
        const { agents } = await adapter.listAgents();
        expect(Array.isArray(agents)).toBe(true);
        // Fresh adapter from beforeEach — no agents yet
        expect(agents).toHaveLength(0);
      });

      it('[M2] spawnAgent result has string agentId', async () => {
        const result = await adapter.spawnAgent({ command: 'echo', args: [] });
        expect(typeof result.agentId).toBe('string');
        expect(result.agentId.length).toBeGreaterThan(0);
      });

      it('[M2] terminateAgent — repeated terminate on same agent returns terminated status', async () => {
        const { agentId } = await adapter.spawnAgent({ command: 'echo', args: [] });
        const first = await adapter.terminateAgent(agentId);
        expect(first.status).toBe('terminated');
        // Second terminate: local-process-manager has the agent in map (status=terminated),
        // stdio-bridge same. Both should still return terminated (not throw).
        const second = await adapter.terminateAgent(agentId);
        expect(second.status).toBe('terminated');
      });
    }

    // Pending (require production env)
    it.todo('spawnAgent p95 latency is under 2 s at 2 req/s');
    it.todo('streamEvent delivers each event within 20 ms p95');
  });
}
