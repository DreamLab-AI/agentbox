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
    // Round-trip loopback: instead of a write-only stub (which never verifies
    // the federated spawn actually crosses the wire), the stdio sink captures
    // every JSON-RPC frame the adapter emits and exposes it via getFrames() so
    // the spec can parse it back and assert the spawn was really serialised
    // over stdio (ADR-031 §Middleware-bypass / round-trip coverage).
    makeAdapter: () => {
      const frames = [];
      const stdio = {
        write: (l) => frames.push(l),
        getFrames: () => frames.map((l) => JSON.parse(l)),
      };
      const adapter = new StdioBridgeOrchestratorAdapter({ stdio });
      adapter._testStdio = stdio; // expose for round-trip assertions
      return adapter;
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

    // --- Federated round-trip: the spawn must actually cross the stdio wire ---
    // A write-only stub proves nothing about federation; this reads the emitted
    // JSON-RPC frame back and verifies the spawn was serialised with the right
    // method, the returned agentId, and the spec params (ADR-031 §round-trip).
    if (label === 'stdio-bridge') {
      it('[M2] spawnAgent emits a well-formed agent.spawn JSON-RPC frame carrying the agentId and spec', async () => {
        const spec = { command: 'echo', args: ['hello'] };
        const { agentId } = await adapter.spawnAgent(spec);
        const frames = adapter._testStdio.getFrames();
        const spawnFrame = frames.find((f) => f.method === 'agent.spawn');
        expect(spawnFrame).toBeDefined();
        expect(spawnFrame.jsonrpc).toBe('2.0');
        expect(spawnFrame.id).toBe(agentId);
        expect(spawnFrame.params).toMatchObject(spec);
      });

      it('[M2] terminateAgent emits an agent.terminate JSON-RPC frame for the agentId', async () => {
        const { agentId } = await adapter.spawnAgent({ command: 'echo', args: [] });
        await adapter.terminateAgent(agentId);
        const frames = adapter._testStdio.getFrames();
        const termFrame = frames.find((f) => f.method === 'agent.terminate');
        expect(termFrame).toBeDefined();
        expect(termFrame.jsonrpc).toBe('2.0');
        expect(termFrame.params).toMatchObject({ agentId });
      });
    }

    // Pending (require production env)
    // Unblock spawnAgent latency: measure against local-process-manager spawning
    // real child processes on dedicated hardware; the 2 s budget includes OS
    // process creation time which is non-deterministic on shared CI VMs under load.
    it.todo('spawnAgent p95 latency is under 2 s at 2 req/s — needs k6 load harness on dedicated hardware; OS fork latency on shared CI VMs is non-deterministic under concurrent load');
    // Unblock streamEvent SLO: requires in-process event emission with a
    // high-resolution timer and a long-running agent fixture; the 20 ms p95 budget
    // is meaningful only when the agent is actively emitting — a synthetic echo
    // agent is needed but its setup would exceed 30 s on cold CI runners.
    it.todo('streamEvent delivers each event within 20 ms p95 — needs a long-running synthetic echo agent and high-resolution timing harness; cannot satisfy the 20 ms p95 SLO on cold CI runners without a dedicated agent fixture');
  });
}
