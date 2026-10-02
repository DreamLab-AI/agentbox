'use strict';

/**
 * GET /v1/tasks and task status echo `didNostr`: the did:nostr the task was
 * dispatched as (ADR-2097 rail; the VisionClaw render contract with S5,
 * 2026-10-02). VisionClaw keys agent nodes by it, and draws a payment edge
 * only between nodes whose DIDs match a payment's payer and payee.
 *
 * The DID is the one the action pipeline already journals as agent_did
 * (action-plane resolveAgentDid): the verified NIP-98 signer, else the
 * container agent's AGENTBOX_AGENT_DID. A non-canonical value echoes null,
 * never a placeholder.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

jest.mock('../../management-api/adapters/manifest-loader', () => ({
  ...jest.requireActual('../../management-api/adapters/manifest-loader'),
  loadManifest: () => ({}),
}));
jest.mock('../../management-api/adapters/index', () => ({
  resolveAdapters: () => {
    const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');
    return { events: new LocalJsonlEventsAdapter({ appendFn: () => {} }) };
  },
}));

const Fastify = require('../../management-api/node_modules/fastify');
const tasksRoutes = require('../../management-api/routes/tasks');
const ProcessManager = require('../../management-api/utils/process-manager');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const SIGNER = 'a1'.repeat(32);
const CONTAINER = 'c0'.repeat(32);

describe('POST /v1/tasks — the dispatching did:nostr is persisted and echoed as didNostr', () => {
  let app; let spawnCalls; let savedDid;

  beforeEach(async () => {
    savedDid = process.env.AGENTBOX_AGENT_DID;
    process.env.AGENTBOX_AGENT_DID = `did:nostr:${CONTAINER}`;
    spawnCalls = [];
    const records = new Map();
    const fakePM = {
      spawnTask(agent, task, provider, claudeFlowAgentId, agentDid) {
        spawnCalls.push({ agent, agentDid });
        const taskId = `task-${records.size + 1}`;
        records.set(taskId, { taskId, agent, task, provider, startTime: Date.now(), status: 'running', claudeFlowAgentId: claudeFlowAgentId || null, didNostr: agentDid || null });
        return { taskId, taskDir: `/tmp/${taskId}`, logFile: `/tmp/${taskId}.log` };
      },
      getActiveTasks() {
        return [...records.values()].map((r) => ({ taskId: r.taskId, agent: r.agent, startTime: r.startTime, duration: 0, claudeFlowAgentId: r.claudeFlowAgentId, didNostr: r.didNostr }));
      },
      getTaskStatus(taskId) {
        const r = records.get(taskId);
        return r ? { taskId, agent: r.agent, task: r.task, provider: r.provider, status: r.status, startTime: r.startTime, exitTime: null, exitCode: null, duration: 0, logTail: '', claudeFlowAgentId: r.claudeFlowAgentId, didNostr: r.didNostr } : null;
      },
    };
    app = Fastify({ logger: false });
    app.addHook('preValidation', async (req) => {
      if (req.headers['x-test-nip98']) req.auth = { mode: 'nip98', pubkey: req.headers['x-test-nip98'] };
    });
    await app.register(tasksRoutes, { processManager: fakePM, logger: silentLogger });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (savedDid === undefined) delete process.env.AGENTBOX_AGENT_DID; else process.env.AGENTBOX_AGENT_DID = savedDid;
  });

  test('a NIP-98 caller: the signer\'s DID', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/tasks', headers: { 'x-test-nip98': SIGNER }, payload: { agent: 'coder', task: 'demo', provider: 'gemini' } });
    expect(res.statusCode).toBe(202);
    const { taskId } = res.json();
    expect(spawnCalls[0].agentDid).toBe(`did:nostr:${SIGNER}`);
    expect((await app.inject({ method: 'GET', url: `/v1/tasks/${taskId}` })).json().didNostr).toBe(`did:nostr:${SIGNER}`);
    const entry = (await app.inject({ method: 'GET', url: '/v1/tasks' })).json().activeTasks.find((t) => t.taskId === taskId);
    expect(entry.didNostr).toBe(`did:nostr:${SIGNER}`);
  });

  test('no NIP-98 signer: the container agent\'s DID', async () => {
    const { taskId } = (await app.inject({ method: 'POST', url: '/v1/tasks', payload: { agent: 'coder', task: 'demo', provider: 'gemini' } })).json();
    expect((await app.inject({ method: 'GET', url: '/v1/tasks' })).json().activeTasks.find((t) => t.taskId === taskId).didNostr).toBe(`did:nostr:${CONTAINER}`);
  });
});

describe('ProcessManager keeps only a canonical did:nostr (white-box, no spawn)', () => {
  let tmpRoot; let pm;
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'did-pm-'));
    process.env.WORKSPACE = tmpRoot;
    process.env.PROCESS_MANAGER_LOGS_DIR = path.join(tmpRoot, 'logs');
    pm = new ProcessManager(silentLogger);
  });
  afterAll(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {} });

  test('echoes didNostr from the record, null when absent', () => {
    const base = { pid: 1, agent: 'coder', task: 'demo', provider: 'gemini', startTime: Date.now(), status: 'running', exitCode: null, taskDir: tmpRoot, logFile: path.join(tmpRoot, 'none.log'), claudeFlowAgentId: null };
    pm.processes.set('t1', { ...base, taskId: 't1', didNostr: `did:nostr:${SIGNER}` });
    pm.processes.set('t2', { ...base, taskId: 't2' });
    expect(pm.getTaskStatus('t1').didNostr).toBe(`did:nostr:${SIGNER}`);
    expect(pm.getTaskStatus('t2').didNostr).toBeNull();
    const list = pm.getActiveTasks();
    expect(list.find((t) => t.taskId === 't1').didNostr).toBe(`did:nostr:${SIGNER}`);
    expect(list.find((t) => t.taskId === 't2').didNostr).toBeNull();
  });

  test('canonicalTaskDid refuses anything but did:nostr:<64 lowercase hex>', () => {
    expect(ProcessManager.canonicalTaskDid(`did:nostr:${SIGNER}`)).toBe(`did:nostr:${SIGNER}`);
    for (const bad of ['did:nostr:local', `did:nostr:${SIGNER.toUpperCase()}`, SIGNER, null, undefined, 42]) {
      expect(ProcessManager.canonicalTaskDid(bad)).toBeNull();
    }
  });
});
