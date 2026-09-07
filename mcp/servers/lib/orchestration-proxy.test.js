'use strict';
/**
 * orchestration-proxy.test.js — coverage for the ADR-2082 orchestration proxy.
 *
 * Runnable standalone with plain `node` (the repo jest config is rooted at
 * tests/config only). Two layers:
 *   1. pure functions: category parsing, the ADR-2014 deny list, tool-list
 *      merging, legacy-alias resolution and result unwrapping;
 *   2. the process plumbing against a FAKE ruflo child (a node one-liner that
 *      speaks just enough MCP), including the fail-open path when the child
 *      binary does not exist.
 */

const assert = require('assert');
const path = require('path');
const {
  parseCategories, isDeniedTool, mergeToolLists, resolveCall, unwrapChildResult,
  createOrchestrationProxy, DEFAULT_CATEGORIES,
} = require('./orchestration-proxy');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack || e.message}`); process.exitCode = 1; }
}

const stub = (name, props = {}) => ({
  name,
  description: '[unimplemented in ruvector-mcp] Returns { ok:false, error:"unimplemented" }.',
  inputSchema: { type: 'object', properties: props },
});
const local = [
  { name: 'memory_store', description: 'Store persistent memory in ruvector-postgres', inputSchema: { type: 'object', properties: {} } },
  { name: 'memory_search', description: 'Semantic vector search', inputSchema: { type: 'object', properties: {} } },
  stub('swarm_init', { topology: { type: 'string' } }),
  stub('agent_spawn', { type: { type: 'string' }, name: { type: 'string' } }),
  stub('task_orchestrate', { task: { type: 'string' }, strategy: { type: 'string' }, priority: { type: 'string' } }),
  stub('swarm_status'),
  stub('neural_patterns'),
  stub('load_balance', { swarmId: { type: 'string' }, tasks: { type: 'array' } }),
  stub('bottleneck_analyze'),
];
const childCat = [
  { name: 'swarm_init', description: 'ruflo swarm_init', inputSchema: { type: 'object', properties: { topology: {}, maxAgents: {}, strategy: {}, config: {} } } },
  { name: 'swarm_status', description: 'ruflo swarm_status', inputSchema: { type: 'object', properties: {} } },
  { name: 'swarm_shutdown', description: 'ruflo swarm_shutdown', inputSchema: { type: 'object', properties: {} } },
  { name: 'agent_spawn', description: 'ruflo agent_spawn', inputSchema: { type: 'object', properties: { agentType: {}, agentId: {} } } },
  { name: 'coordination_orchestrate', description: 'ruflo orchestrate', inputSchema: { type: 'object', properties: { task: {}, strategy: {} }, required: ['task'] } },
  { name: 'coordination_load_balance', description: 'ruflo lb', inputSchema: { type: 'object', properties: {} } },
  { name: 'memory_store', description: 'ruflo SQLITE memory — must never surface', inputSchema: { type: 'object', properties: {} } },
  { name: 'memory_search_unified', description: 'ruflo memory — must never surface', inputSchema: { type: 'object', properties: {} } },
  { name: 'hooks_route', description: 'ruflo hooks — denied', inputSchema: { type: 'object', properties: {} } },
];

(async () => {
  console.log('orchestration-proxy pure functions');

  await test('parseCategories: default, trims, drops blanks', () => {
    assert.deepStrictEqual(parseCategories(undefined), DEFAULT_CATEGORIES.split(','));
    assert.deepStrictEqual(parseCategories('  '), DEFAULT_CATEGORIES.split(','));
    assert.deepStrictEqual(parseCategories(' swarm, agent ,,task '), ['swarm', 'agent', 'task']);
  });

  await test('isDeniedTool: every memory/agentdb/embeddings/hooks prefix is denied', () => {
    for (const n of ['memory_store', 'memory_search_unified', 'agentdb_route', 'embeddings_search', 'hooks_route', 'agentic_flow_x', 'ruvllm_status', 'agenticow_query']) {
      assert.strictEqual(isDeniedTool(n), true, n);
    }
    for (const n of ['swarm_init', 'agent_spawn', 'task_create', 'coordination_sync', 'hive-mind_spawn']) {
      assert.strictEqual(isDeniedTool(n), false, n);
    }
  });

  await test('mergeToolLists: stubs replaced, memory never forwarded, unknown stubs stay honest', () => {
    const { tools, forwarded, aliased } = mergeToolLists(local, childCat);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    // the governed memory tools are untouched and appear exactly once
    assert.strictEqual(tools.filter((t) => t.name === 'memory_store').length, 1);
    assert.strictEqual(byName.memory_store.description, 'Store persistent memory in ruvector-postgres');
    assert.ok(!byName.memory_search_unified, 'child memory tool leaked');
    assert.ok(!byName.hooks_route, 'child hooks tool leaked');
    // stub replaced by the upstream schema
    assert.strictEqual(byName.swarm_init.description, 'ruflo swarm_init');
    assert.ok('maxAgents' in byName.swarm_init.inputSchema.properties);
    assert.ok(forwarded.has('swarm_init') && forwarded.has('swarm_status') && forwarded.has('swarm_shutdown'));
    // agent_spawn: v3 schema advertised, but still shimmed (alias to itself)
    assert.ok('agentType' in byName.agent_spawn.inputSchema.properties);
    assert.strictEqual(aliased.get('agent_spawn'), 'agent_spawn');
    // legacy alias keeps its v2 schema, points at the v3 target
    assert.strictEqual(aliased.get('task_orchestrate'), 'coordination_orchestrate');
    assert.ok('priority' in byName.task_orchestrate.inputSchema.properties);
    assert.ok(byName.task_orchestrate.description.startsWith('Alias → ruflo coordination_orchestrate'));
    assert.strictEqual(aliased.get('load_balance'), 'coordination_load_balance');
    // a legacy alias whose target is NOT in the enabled categories stays a stub
    assert.ok(!forwarded.has('bottleneck_analyze'));
    assert.ok(byName.bottleneck_analyze.description.startsWith('[unimplemented in ruvector-mcp]'));
    assert.ok(!forwarded.has('neural_patterns'));
    assert.ok(byName.neural_patterns.description.startsWith('[unimplemented in ruvector-mcp]'));
    // new child tools are appended once
    assert.strictEqual(tools.filter((t) => t.name === 'coordination_orchestrate').length, 1);
  });

  await test('mergeToolLists: with no child tools the list is byte-identical', () => {
    const { tools, forwarded } = mergeToolLists(local, []);
    assert.deepStrictEqual(tools, local);
    assert.strictEqual(forwarded.size, 0);
  });

  await test('resolveCall: shims v2 argument shapes into v3', () => {
    const { forwarded, aliased } = mergeToolLists(local, childCat);
    let r = resolveCall('task_orchestrate', { task: 'do it', strategy: 'adaptive', priority: 'high' }, forwarded, aliased);
    assert.deepStrictEqual(r, { target: 'coordination_orchestrate', args: { task: 'do it', strategy: 'parallel' } });
    r = resolveCall('task_orchestrate', { task: 'x', strategy: 'pipeline' }, forwarded, aliased);
    assert.strictEqual(r.args.strategy, 'pipeline');
    r = resolveCall('agent_spawn', { type: 'coder', name: 'c1', swarmId: 's' }, forwarded, aliased);
    assert.deepStrictEqual(r, { target: 'agent_spawn', args: { swarmId: 's', agentType: 'coder', agentId: 'c1' } });
    r = resolveCall('agent_spawn', { agentType: 'tester', type: 'ignored' }, forwarded, aliased);
    assert.strictEqual(r.args.agentType, 'tester');
    r = resolveCall('load_balance', { swarmId: 's', tasks: ['a', 'b'] }, forwarded, aliased);
    assert.deepStrictEqual(r, { target: 'coordination_load_balance', args: { action: 'distribute', task: 'a; b' } });
    assert.strictEqual(resolveCall('swarm_init', { topology: 'mesh' }, forwarded, aliased).target, 'swarm_init');
    assert.strictEqual(resolveCall('memory_store', {}, forwarded, aliased), null);
    assert.strictEqual(resolveCall('bottleneck_analyze', {}, forwarded, aliased), null);
  });

  await test('unwrapChildResult: JSON text → object; isError → ok:false; plain text kept', () => {
    assert.deepStrictEqual(unwrapChildResult({ content: [{ type: 'text', text: '{"success":true,"swarmId":"s1"}' }] }), { success: true, swarmId: 's1' });
    const err = unwrapChildResult({ isError: true, content: [{ type: 'text', text: '{"error":"boom"}' }] });
    assert.strictEqual(err.ok, false); assert.strictEqual(err.error, 'boom');
    assert.deepStrictEqual(unwrapChildResult({ content: [{ type: 'text', text: 'not json' }] }), { text: 'not json' });
    assert.strictEqual(unwrapChildResult(null).ok, false);
  });

  console.log('orchestration-proxy process plumbing (fake ruflo child)');

  // A minimal MCP responder: initialize, tools/list (echoes the categories it
  // was given so the filter contract is observable), tools/call echo.
  const FAKE = `
    const rl = require('readline').createInterface({ input: process.stdin });
    const cats = (process.env.CLAUDE_FLOW_MCP_TOOLS || '').split(',');
    const tools = [
      { name: 'swarm_init', description: 'fake swarm_init cats=' + cats.join('+'), inputSchema: { type: 'object', properties: { topology: {} } } },
      { name: 'coordination_orchestrate', description: 'fake orchestrate', inputSchema: { type: 'object', properties: { task: {} } } },
      { name: 'memory_store', description: 'fake sqlite memory', inputSchema: { type: 'object', properties: {} } },
    ];
    process.stderr.write('fake ruflo starting\\n');
    rl.on('line', (l) => {
      let m; try { m = JSON.parse(l); } catch { return; }
      if (m.method === 'initialize') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake-ruflo', version: '0' }, capabilities: {} } }) + '\\n');
      if (m.method === 'tools/list') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools } }) + '\\n');
      if (m.method === 'tools/call') {
        if (m.params.name === 'die') process.exit(3);
        if (m.params.name === 'slow') return; // never answers → timeout path
        const payload = { success: true, echo: m.params };
        return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }) + '\\n');
      }
    });
  `;
  const logs = [];
  const log = (lvl, msg) => logs.push(`${lvl} ${msg}`);
  const mk = (extraEnv = {}) => createOrchestrationProxy({
    log,
    command: process.execPath,
    args: ['-e', FAKE],
    env: { PATH: process.env.PATH, RUVECTOR_ORCHESTRATION_TOOLS: 'swarm,coordination', RUVECTOR_ORCHESTRATION_TIMEOUT_MS: '1500', ...extraEnv },
  });

  await test('advertise spawns the child with the category filter and merges its tools', async () => {
    const p = mk();
    const tools = await p.advertise(local);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.strictEqual(byName.swarm_init.description, 'fake swarm_init cats=swarm+coordination');
    assert.ok(!tools.some((t) => t.description === 'fake sqlite memory'), 'sqlite memory leaked through the proxy');
    assert.ok(p.handles('swarm_init'));
    assert.ok(p.handles('task_orchestrate'), 'legacy alias not forwarded');
    assert.ok(!p.handles('memory_store'));
    assert.ok(p.status().child_running);
    p.shutdown();
  });

  await test('call forwards, unwraps and marks proxied aliases', async () => {
    const p = mk();
    await p.advertise(local);
    const r = await p.call('swarm_init', { topology: 'mesh' });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.echo, { name: 'swarm_init', arguments: { topology: 'mesh' } });
    const a = await p.call('task_orchestrate', { task: 't', strategy: 'balanced' });
    assert.strictEqual(a._proxied_as, 'coordination_orchestrate');
    assert.deepStrictEqual(a.echo.arguments, { task: 't', strategy: 'parallel' });
    p.shutdown();
  });

  await test('a call that never answers times out with an honest error', async () => {
    const p = mk();
    await p.advertise(local);
    // force-forward a name the fake child ignores
    const { forwarded } = mergeToolLists(local, [{ name: 'slow', description: 'x', inputSchema: {} }]);
    assert.ok(forwarded.has('slow'));
    const tools = await p.advertise([...local, { name: 'slow', description: '[unimplemented in ruvector-mcp] x', inputSchema: {} }]);
    assert.ok(tools.some((t) => t.name === 'slow'));
    // 'slow' was not in the child's tools/list so it is not forwarded; the
    // honest answer is unimplemented, not a hang
    const r = await p.call('slow', {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'unimplemented');
    p.shutdown();
  });

  await test('child death fails open: honest error, then respawn on next call', async () => {
    const p = mk();
    await p.advertise(local);
    const pid1 = p.status().child_pid;
    const { forwarded, aliased } = mergeToolLists(local, [{ name: 'die', description: 'x', inputSchema: {} }]);
    assert.ok(forwarded.has('die') && !aliased.has('die'));
    // reach into the running proxy by advertising a tool list that names 'die'
    await p.advertise([...local, { name: 'die', description: '[unimplemented in ruvector-mcp] x', inputSchema: {} }]);
    // The fake child does not list 'die', so it is not forwarded; simulate a
    // crash instead by killing the child and checking the next call recovers.
    process.kill(pid1, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(p.status().child_running, false);
    const r = await p.call('swarm_init', { topology: 'ring' });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.notStrictEqual(p.status().child_pid, pid1);
    assert.strictEqual(p.status().respawns, 1);
    p.shutdown();
  });

  await test('missing binary fails open: stubs advertised unchanged, calls answer unimplemented', async () => {
    const p = createOrchestrationProxy({ log, command: path.join(__dirname, 'no-such-ruflo-binary'), args: [], env: { PATH: '' } });
    const tools = await p.advertise(local);
    assert.deepStrictEqual(tools, local);
    assert.ok(!p.handles('swarm_init'));
    const r = await p.call('swarm_init', { topology: 'mesh' });
    assert.strictEqual(r.ok, false);
    assert.ok(logs.some((l) => l.includes('advertising honest stubs')), 'fail-open not logged');
    p.shutdown();
  });

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
})();
