'use strict';

/**
 * One real task = one agent body. Every agent action emitted for a Management
 * API task must carry that task's `taskId` (the id `spawnTask` minted and
 * exported to the child as TASK_ID), not only pre-task / post-task. Actions
 * with no task carry none. Two concurrent tasks never share an id or a body.
 */

const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');
const hooks = require('../../management-api/hooks/agent-action-hooks');
const util = require('../../config/hooks/lib/trajectory-util.cjs');
const Fastify = require('../../management-api/node_modules/fastify');
const agentEventsRoutes = require('../../management-api/routes/agent-events');

const TASK_A = 'urn:agentbox:activity:aaaaaaaaaaaa';
const TASK_B = 'urn:agentbox:activity:bbbbbbbbbbbb';

function capture(fn) {
  const seen = [];
  const off = agentEventPublisher.subscribe((e) => seen.push(e));
  try { fn(); } finally { off(); }
  return seen;
}

// A task's full lifecycle as claude-flow hooks report it. Only pre-task and
// post-task historically carried the taskId; the mid-task hooks were bare.
function lifecycle(taskId, agent) {
  return [
    ['pre-task', { taskId, agent, description: 'do it' }],
    ['pre-edit', { taskId, agent, filePath: '/w/a.js', operation: 'edit' }],
    ['post-edit', { taskId, agent, filePath: '/w/a.js', success: true }],
    ['pre-command', { taskId, agent, command: 'ls' }],
    ['post-command', { taskId, agent, command: 'ls', exitCode: 0 }],
    ['memory-access', { taskId, agent, key: 'k', operation: 'store' }],
    ['route', { taskId, task: 't', agent: 'worker' }],
    ['agent-spawn', { taskId, agentId: 'sub', parent: agent }],
    ['agent-terminate', { taskId, agentId: 'sub', parent: agent }],
    ['action', { taskId, source: agent, target: 'x', action: 'read' }],
    ['some-unknown-hook', { taskId, agent, target: 'y' }],
    ['post-task', { taskId, agent, success: true }],
  ];
}

describe('hook emitter: taskId on every action of a task', () => {
  test('the whole pre-task .. post-task sequence carries the same taskId and one body', () => {
    const events = capture(() => {
      for (const [h, d] of lifecycle(TASK_A, 'coder')) hooks.processHookEvent(h, d);
    });
    expect(events).toHaveLength(12);
    for (const e of events) expect(e.metadata.taskId).toBe(TASK_A);
    expect(new Set(events.map((e) => e.source_agent_id)).size).toBe(1);
  });

  test('taskId nested in metadata (generic action hook) is honoured', () => {
    const [e] = capture(() => hooks.processHookEvent('action', {
      source: 'coder', target: 't', action: 'read', metadata: { taskId: TASK_A },
    }));
    expect(e.metadata.taskId).toBe(TASK_A);
  });

  test('two concurrent tasks, same agent name, interleaved: ids and bodies stay apart', () => {
    const a = lifecycle(TASK_A, 'coder');
    const b = lifecycle(TASK_B, 'coder');
    const events = capture(() => {
      for (let i = 0; i < a.length; i++) {
        hooks.processHookEvent(...a[i]);
        hooks.processHookEvent(...b[i]);
      }
    });
    const ofA = events.filter((e) => e.metadata.taskId === TASK_A);
    const ofB = events.filter((e) => e.metadata.taskId === TASK_B);
    expect(ofA).toHaveLength(12);
    expect(ofB).toHaveLength(12);
    const bodyA = new Set(ofA.map((e) => e.source_agent_id));
    const bodyB = new Set(ofB.map((e) => e.source_agent_id));
    expect(bodyA.size).toBe(1);
    expect(bodyB.size).toBe(1);
    expect([...bodyA][0]).not.toBe([...bodyB][0]);
  });

  test('actions with no task carry no taskId', () => {
    const events = capture(() => {
      hooks.processHookEvent('pre-edit', { agent: 'coder', filePath: '/w/a.js', operation: 'edit' });
      hooks.processHookEvent('action', { source: 'coder', target: 't', action: 'read' });
      hooks.processHookEvent('mystery', { agent: 'coder' });
    });
    expect(events).toHaveLength(3);
    for (const e of events) expect(Object.prototype.hasOwnProperty.call(e.metadata, 'taskId')).toBe(false);
  });

  test('agent identity is one deterministic function, not a per-process counter', () => {
    expect(hooks.getAgentId('coder')).toBe(hooks.getAgentId('coder'));
    expect(hooks.getAgentId('coder')).not.toBe(hooks.getAgentId('tester'));
    expect(hooks.getAgentId(7)).toBe(7);
    // Registry is no longer an order-dependent counter: the same name hashes alike
    // on the /hook and /emit paths.
    expect(hooks.getAgentId('coder')).toBe(require('../../management-api/lib/agent-id-hash').hashString('coder'));
  });
});

describe('trajectory step emit body carries the task id', () => {
  const step = { action: 'ls', outcome: { success: true }, durationMs: 1, tokenCount: 10 };
  test('opts.taskId lands in metadata.taskId', () => {
    const body = util.ctcEmitBodyFromStep(step, { sessionId: 's', taskId: TASK_A });
    expect(body.metadata.taskId).toBe(TASK_A);
  });
  test('no task, no taskId key', () => {
    const body = util.ctcEmitBodyFromStep(step, { sessionId: 's' });
    expect(Object.prototype.hasOwnProperty.call(body.metadata, 'taskId')).toBe(false);
  });
});

describe('POST /v1/agent-events/{emit,batch}: top-level taskId is stamped into the envelope', () => {
  let app;
  let prevAuth;
  beforeAll(async () => {
    prevAuth = process.env.AGENTBOX_AGENT_EVENT_AUTH;
    process.env.AGENTBOX_AGENT_EVENT_AUTH = 'off'; // the in-container recorder posts unauthenticated
    app = Fastify();
    const noop = () => {};
    await app.register(agentEventsRoutes, { logger: { info: noop, debug: noop, error: noop, warn: noop }, metrics: null });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (prevAuth === undefined) delete process.env.AGENTBOX_AGENT_EVENT_AUTH;
    else process.env.AGENTBOX_AGENT_EVENT_AUTH = prevAuth;
  });

  test('emit', async () => {
    const events = [];
    const off = agentEventPublisher.subscribe((e) => events.push(e));
    const res = await app.inject({ method: 'POST', url: '/v1/agent-events/emit',
      payload: { source_agent_id: 's', target_node_id: 't', action_type: 'query', taskId: TASK_A, metadata: { k: 1 } } });
    off();
    expect(res.statusCode).toBe(200);
    expect(events[0].metadata).toMatchObject({ k: 1, taskId: TASK_A });
  });

  test('batch: per event, and an event without one stays bare', async () => {
    const events = [];
    const off = agentEventPublisher.subscribe((e) => events.push(e));
    const res = await app.inject({ method: 'POST', url: '/v1/agent-events/batch', payload: { events: [
      { source_agent_id: 's', target_node_id: 't', action_type: 'query', taskId: TASK_A },
      { source_agent_id: 's', target_node_id: 't', action_type: 'query', taskId: TASK_B },
      { source_agent_id: 's', target_node_id: 't', action_type: 'query' },
    ] } });
    off();
    expect(res.statusCode).toBe(200);
    expect(events.map((e) => e.metadata.taskId)).toEqual([TASK_A, TASK_B, undefined]);
  });
});
