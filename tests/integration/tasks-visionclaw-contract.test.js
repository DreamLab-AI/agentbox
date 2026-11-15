'use strict';

/**
 * Contract test: the REAL route + REAL ProcessManager serialisation must carry
 * every field VisionClaw's client deserialises without a serde default.
 *
 * Consumer source: VisionClaw src/services/management_api_client.rs
 *   - `TaskInfo`   (GET /v1/tasks items): taskId, agent, task, provider, status,
 *                  startTime, duration are non-Option.
 *   - `TaskStatus` (GET /v1/tasks/:id): additionally taskDir, logFile are non-Option.
 * Unlike tasks-claude-flow-agent-id.test.js, nothing here is a hand-built fake of
 * the process manager: the registry is seeded and the response goes through
 * fastify's response-schema serialiser, which strips undeclared fields.
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

// Fields VisionClaw requires (no #[serde(default)] / Option).
const TASK_INFO_REQUIRED = ['taskId', 'agent', 'task', 'provider', 'status', 'startTime', 'duration'];
const TASK_STATUS_REQUIRED = [
  ...TASK_INFO_REQUIRED, 'taskDir', 'logFile',
];
// serde `TaskState` is lowercase: running | completed | failed.
const TASK_STATES = ['running', 'completed', 'failed'];

describe('GET /v1/tasks[/:id] satisfies the VisionClaw TaskInfo / TaskStatus contract', () => {
  let app;
  let tmpRoot;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-contract-'));
    process.env.WORKSPACE = tmpRoot;
    process.env.PROCESS_MANAGER_LOGS_DIR = path.join(tmpRoot, 'logs');
    const pm = new ProcessManager(silentLogger);
    pm.processes.set('task-contract', {
      pid: 1,
      taskId: 'task-contract',
      agent: 'coder',
      task: 'demo task',
      provider: 'gemini',
      startTime: Date.now() - 1000,
      status: 'running',
      exitCode: null,
      taskDir: path.join(tmpRoot, 'task-contract'),
      logFile: path.join(tmpRoot, 'task-contract.log'),
      claudeFlowAgentId: null,
    });
    app = Fastify({ logger: false });
    await app.register(tasksRoutes, { processManager: pm, logger: silentLogger });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  });

  test('list items carry task, provider and status', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tasks' });
    expect(res.statusCode).toBe(200);
    const item = res.json().activeTasks.find((t) => t.taskId === 'task-contract');
    expect(item).toBeDefined();
    for (const key of TASK_INFO_REQUIRED) {
      expect(item).toHaveProperty(key);
      expect(item[key]).not.toBeNull();
    }
    expect(item.task).toBe('demo task');
    expect(item.provider).toBe('gemini');
    expect(TASK_STATES).toContain(item.status);
  });

  test('status carries taskDir and logFile as strings', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tasks/task-contract' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const key of TASK_STATUS_REQUIRED) {
      expect(body).toHaveProperty(key);
      expect(body[key]).not.toBeNull();
    }
    expect(typeof body.taskDir).toBe('string');
    expect(typeof body.logFile).toBe('string');
    expect(TASK_STATES).toContain(body.status);
  });
});
