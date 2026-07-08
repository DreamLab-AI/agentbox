'use strict';

/**
 * D2 (PRD-023 WP-3) final close — agentbox Management-API side.
 *
 * The interrupt join needs the Management API to (a) ACCEPT an optional, additive
 * `claude_flow_agent_id` on create-task, (b) PERSIST it on the task record, and
 * (c) ECHO it (as `claudeFlowAgentId`) in `GET /v1/tasks` and task status — so a
 * downstream (VisionClaw) resolver can map a claude-flow swarm agent_id -> task_id.
 * The `agent` field is a role label ("coder"/"researcher"/…) and can NEVER carry
 * this id; the join key is a distinct field.
 *
 * Two layers are proven:
 *   1. the route contract (fastify.inject): create accepts + forwards the id, and
 *      the response schemas echo `claudeFlowAgentId` (fastify strips any property
 *      absent from the schema, so this also guards the schema edits);
 *   2. ProcessManager itself echoes the persisted id from getTaskStatus /
 *      getActiveTasks (white-box, no child process spawned).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const Fastify = require('../../management-api/node_modules/fastify');
const tasksRoutes = require('../../management-api/routes/tasks');
const ProcessManager = require('../../management-api/utils/process-manager');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('POST /v1/tasks — claude_flow_agent_id accept + forward + echo (route contract)', () => {
  let app;
  let spawnCalls;
  let fakePM;

  beforeEach(async () => {
    spawnCalls = [];
    // A fake ProcessManager that records what the route forwards and mirrors the
    // real persist/echo shape.
    const records = new Map();
    fakePM = {
      spawnTask(agent, task, provider, claudeFlowAgentId) {
        spawnCalls.push({ agent, task, provider, claudeFlowAgentId });
        const taskId = `task-${records.size + 1}`;
        records.set(taskId, {
          taskId,
          agent,
          task,
          provider,
          startTime: Date.now(),
          status: 'running',
          claudeFlowAgentId: claudeFlowAgentId || null,
        });
        return { taskId, taskDir: `/tmp/${taskId}`, logFile: `/tmp/${taskId}.log` };
      },
      getActiveTasks() {
        return [...records.values()].map((r) => ({
          taskId: r.taskId,
          agent: r.agent,
          startTime: r.startTime,
          duration: Date.now() - r.startTime,
          claudeFlowAgentId: r.claudeFlowAgentId || null,
        }));
      },
      getTaskStatus(taskId) {
        const r = records.get(taskId);
        if (!r) return null;
        return {
          taskId: r.taskId,
          agent: r.agent,
          task: r.task,
          provider: r.provider,
          status: r.status,
          startTime: r.startTime,
          exitTime: null,
          exitCode: null,
          duration: Date.now() - r.startTime,
          logTail: '',
          claudeFlowAgentId: r.claudeFlowAgentId || null,
        };
      },
    };

    app = Fastify({ logger: false });
    await app.register(tasksRoutes, { processManager: fakePM, logger: silentLogger });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  test('create forwards claude_flow_agent_id to spawnTask; status + list echo it', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        agent: 'coder', // a ROLE label — never the join key
        task: 'demo task',
        provider: 'gemini',
        claude_flow_agent_id: 'agent-swarm-7f3a',
      },
    });
    expect(createRes.statusCode).toBe(202);
    const created = createRes.json();
    expect(created.taskId).toBeTruthy();

    // The route forwarded the additive id verbatim (4th positional arg).
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      agent: 'coder',
      provider: 'gemini',
      claudeFlowAgentId: 'agent-swarm-7f3a',
    });

    // Task status echoes claudeFlowAgentId (schema does not strip it).
    const statusRes = await app.inject({ method: 'GET', url: `/v1/tasks/${created.taskId}` });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().claudeFlowAgentId).toBe('agent-swarm-7f3a');

    // GET /v1/tasks echoes it on the active-task entry.
    const listRes = await app.inject({ method: 'GET', url: '/v1/tasks' });
    expect(listRes.statusCode).toBe(200);
    const entry = listRes.json().activeTasks.find((t) => t.taskId === created.taskId);
    expect(entry).toBeDefined();
    expect(entry.claudeFlowAgentId).toBe('agent-swarm-7f3a');
    // The join key is distinct from the role label.
    expect(entry.agent).toBe('coder');
  });

  test('create WITHOUT claude_flow_agent_id echoes null (no fabricated join)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: { agent: 'researcher', task: 'demo', provider: 'gemini' },
    });
    expect(createRes.statusCode).toBe(202);
    const { taskId } = createRes.json();

    expect(spawnCalls[0].claudeFlowAgentId).toBeNull();

    const statusRes = await app.inject({ method: 'GET', url: `/v1/tasks/${taskId}` });
    expect(statusRes.json().claudeFlowAgentId).toBeNull();

    const listRes = await app.inject({ method: 'GET', url: '/v1/tasks' });
    const entry = listRes.json().activeTasks.find((t) => t.taskId === taskId);
    expect(entry.claudeFlowAgentId).toBeNull();
  });
});

describe('ProcessManager persists + echoes claudeFlowAgentId (white-box)', () => {
  let tmpRoot;
  let pm;

  beforeAll(() => {
    // Keep the constructor's best-effort mkdir off $HOME/workspace.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-pm-'));
    process.env.WORKSPACE = tmpRoot;
    process.env.PROCESS_MANAGER_LOGS_DIR = path.join(tmpRoot, 'logs');
    pm = new ProcessManager(silentLogger);
  });

  afterAll(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  });

  test('getTaskStatus + getActiveTasks echo the persisted join key (no spawn)', () => {
    // Seed the process registry directly — no child process, no real spawn.
    pm.processes.set('task-x', {
      pid: 1,
      taskId: 'task-x',
      agent: 'coder', // role label, distinct from the join key
      task: 'demo',
      provider: 'gemini',
      startTime: Date.now(),
      status: 'running',
      exitCode: null,
      taskDir: path.join(tmpRoot, 'task-x'),
      logFile: path.join(tmpRoot, 'task-x-nonexistent.log'), // readFileSync catches ENOENT
      claudeFlowAgentId: 'agent-swarm-7f3a',
    });

    const status = pm.getTaskStatus('task-x');
    expect(status).not.toBeNull();
    expect(status.claudeFlowAgentId).toBe('agent-swarm-7f3a');
    expect(status.agent).toBe('coder');

    const active = pm.getActiveTasks();
    const entry = active.find((t) => t.taskId === 'task-x');
    expect(entry).toBeDefined();
    expect(entry.claudeFlowAgentId).toBe('agent-swarm-7f3a');
  });

  test('a task with no join key echoes null', () => {
    pm.processes.set('task-y', {
      pid: 2,
      taskId: 'task-y',
      agent: 'researcher',
      task: 'demo',
      provider: 'gemini',
      startTime: Date.now(),
      status: 'running',
      exitCode: null,
      taskDir: path.join(tmpRoot, 'task-y'),
      logFile: path.join(tmpRoot, 'task-y-nonexistent.log'),
      claudeFlowAgentId: null,
    });

    expect(pm.getTaskStatus('task-y').claudeFlowAgentId).toBeNull();
    const entry = pm.getActiveTasks().find((t) => t.taskId === 'task-y');
    expect(entry.claudeFlowAgentId).toBeNull();
  });
});
