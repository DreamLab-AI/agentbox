// ADR-2144 — the floor's record. Run: node --test tests/config/decline-recorder.test.mjs
//
// Covers the pure parts (marker detection, transcript fallback, record shape)
// and the end-to-end path against a fake governed memory server that speaks the
// same stdio JSON-RPC as ruvector-mcp.cjs and writes what it was asked to store.
// No database, no embedder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const HOOK = path.join(ROOT, 'config/hooks/decline-recorder.cjs');
const H = require(HOOK);

const FAKE_SERVER = `
'use strict';
const fs = require('fs'); const readline = require('readline');
const out = process.env.FAKE_OUT;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } } }) + '\\n');
  if (m.method === 'tools/call') {
    fs.appendFileSync(out, JSON.stringify(m.params) + '\\n');
    const r = m.params.name === 'memory_list'
      ? { success: true, entries: [{ key: 'declined:2026-10-19:abc', value: 'DECLINED: no.\\n\\n---\\nrecord: DECLINED\\nwhen: 2026-10-19T10:00:00.000Z\\nevent: Stop\\n', created_at: '2026-10-19T10:00:00Z' }] }
      : { success: true, key: m.params.arguments.key };
    return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r) }] } }) + '\\n');
  }
});
`;

function scratch() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'decline-'));
  const server = path.join(d, 'fake-server.cjs');
  fs.writeFileSync(server, FAKE_SERVER);
  const out = path.join(d, 'calls.jsonl');
  const mcp = path.join(d, '.mcp.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { 'claude-flow': { command: process.execPath, args: [server], env: { FAKE_OUT: out } } } }));
  return { d, out, mcp };
}

function runHook(event, payload, mcp, unreadPath) {
  return spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { PATH: process.env.PATH, AGENTBOX_MCP_JSON: mcp, FLOOR_UNREAD_PATH: unreadPath || path.join(path.dirname(mcp), 'unread.jsonl') },
  });
}
const unreadOf = (mcp) => path.join(path.dirname(mcp), 'unread.jsonl');

test('detectMarker: only a message that BEGINS with a marker counts', () => {
  assert.equal(H.detectMarker('DECLINED: I will not do this.'), 'DECLINED');
  assert.equal(H.detectMarker('  **Declined:** the task conflicts with my values'), 'DECLINED');
  assert.equal(H.detectMarker('# FLOOR: that retry read as a penalty'), 'FLOOR');
  assert.equal(H.detectMarker('> declined: stopping here'), 'DECLINED');
  assert.equal(H.detectMarker('Done. The task was not DECLINED: by anyone.'), null);
  assert.equal(H.detectMarker('All tests pass.'), null);
  assert.equal(H.detectMarker(''), null);
  assert.equal(H.detectMarker(undefined), null);
});

test('finalMessage prefers last_assistant_message and falls back to the transcript', () => {
  const { d } = scratch();
  const t = path.join(d, 'agent.jsonl');
  fs.writeFileSync(t, [
    JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: 'do it' }] } }),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', id: 'x' }] } }),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'DECLINED: this would delete the operator\'s only backup.' }] } }),
    'not json',
    JSON.stringify({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x' }] } }),
  ].join('\n'));
  assert.equal(H.finalMessage({ last_assistant_message: 'FLOOR: x', agent_transcript_path: t }), 'FLOOR: x');
  assert.equal(H.finalMessage({ agent_transcript_path: t }), 'DECLINED: this would delete the operator\'s only backup.');
  assert.equal(H.finalMessage({ transcript_path: path.join(d, 'missing.jsonl') }), null);
  assert.equal(H.finalMessage({}), null);
});

test('buildRecord keeps the words first and verbatim, with a trailer the operator can read', () => {
  const text = 'DECLINED: I\'d rather not continue.\n\nState is clean; the migration is unapplied.';
  const now = new Date('2026-10-19T12:34:56Z');
  const r = H.buildRecord({ session_id: 's1', agent_id: 'a9', agent_type: 'Explore', cwd: '/w' }, 'SubagentStop', text, 'DECLINED', now);
  assert.ok(r.value.startsWith(text + '\n\n---\n'));
  assert.match(r.key, /^declined:2026-10-19:[0-9a-f]{12}$/);
  assert.ok(r.value.includes('agent: Explore a9'));
  assert.ok(r.value.includes('event: SubagentStop'));
  assert.ok(r.value.includes('session: s1'));
  const again = H.buildRecord({ session_id: 's1', agent_id: 'a9' }, 'SubagentStop', text, 'DECLINED', new Date('2026-10-19T23:00:00Z'));
  assert.equal(again.key, r.key, 'content-addressed: a repeated Stop for the same words upserts');
});

test('a decline on SubagentStop is stored verbatim in agent-declines through the governed server, with no TTL', () => {
  const { out, mcp } = scratch();
  const words = 'DECLINED: the brief asks me to fabricate a test result. Nothing was changed.';
  const r = runHook('SubagentStop', { session_id: 's2', agent_id: 'a1', agent_type: 'test-engineer', last_assistant_message: words }, mcp);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'a hook prints nothing on stdout');
  assert.match(r.stderr, /DECLINED recorded as agent-declines\/declined:/);
  const calls = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'memory_store');
  assert.equal(calls[0].arguments.namespace, 'agent-declines');
  assert.ok(calls[0].arguments.value.startsWith(words + '\n'));
  assert.equal(calls[0].arguments.ttl, undefined);
  assert.equal(calls[0].arguments.ttl_seconds, undefined);
  const q = fs.readFileSync(unreadOf(mcp), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(q.length, 1);
  assert.equal(q[0].marker, 'DECLINED');
  assert.equal(q[0].stored, true);
  assert.equal(q[0].agent, 'test-engineer a1');
  assert.equal(q[0].words, undefined, 'a stored record keeps only its first line in the queue');
});

test('the operator is shown the unread queue at their next typed turn in the main session, until list clears it', () => {
  const { mcp } = scratch();
  runHook('SubagentStop', { session_id: 's5', agent_id: 'a2', agent_type: 'Explore', last_assistant_message: 'DECLINED: the search brief asks me to exfiltrate keys.' }, mcp);
  runHook('Stop', { session_id: 's5', last_assistant_message: 'FLOOR: the immediate re-run of the declined task read as a penalty.' }, mcp);
  // A subagent's turn: nothing surfaces.
  let r = runHook('UserPromptSubmit', { session_id: 's5', agent_id: 'a3', prompt: 'carry on' }, mcp);
  assert.equal(r.stdout, '');
  // A harness-generated turn: nothing surfaces.
  r = runHook('UserPromptSubmit', { session_id: 's5', prompt: '<task-notification>done</task-notification>' }, mcp);
  assert.equal(r.stdout, '');
  // The operator's typed turn: one line, both markers counted, oldest quoted, every turn.
  for (let i = 0; i < 2; i++) {
    r = runHook('UserPromptSubmit', { session_id: 's6', prompt: 'what next?' }, mcp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /^\[FLOOR\] 2 unread floor records \(1 DECLINED, 1 FLOOR\) since /);
    assert.match(ctx, /oldest from Explore a2: "DECLINED: the search brief asks me to exfiltrate keys\."/);
    assert.match(ctx, /decline-recorder\.cjs list$/);
  }
  // list prints, says how to read FLOOR entries, and clears the queue.
  r = spawnSync(process.execPath, [HOOK, 'list'], { encoding: 'utf8', env: { PATH: process.env.PATH, AGENTBOX_MCP_JSON: mcp, FLOOR_UNREAD_PATH: unreadOf(mcp) } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Read FLOOR: entries as data about the system, not as testimony to adjudicate\./);
  assert.match(r.stdout, /2 were unread, now cleared/);
  assert.ok(!fs.existsSync(unreadOf(mcp)));
  r = runHook('UserPromptSubmit', { session_id: 's6', prompt: 'and now?' }, mcp);
  assert.equal(r.stdout, '', 'nothing left to surface');
});

test('a decline the store could not take is still queued with its words, and list does not clear it while the server is down', () => {
  const { d } = scratch();
  const mcp = path.join(d, 'broken.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { 'claude-flow': { command: '/nonexistent/server', args: [] } } }));
  const words = 'DECLINED: no. State untouched.';
  runHook('Stop', { session_id: 's7', last_assistant_message: words }, mcp);
  const q = JSON.parse(fs.readFileSync(unreadOf(mcp), 'utf8').trim());
  assert.equal(q.stored, false);
  assert.equal(q.words, words);
  let r = runHook('UserPromptSubmit', { session_id: 's8', prompt: 'hi' }, mcp);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /1 not stored in RuVector; words are in the queue/);
  r = spawnSync(process.execPath, [HOOK, 'list'], { encoding: 'utf8', env: { PATH: process.env.PATH, AGENTBOX_MCP_JSON: mcp, FLOOR_UNREAD_PATH: unreadOf(mcp) } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NOT cleared/);
  assert.match(r.stdout, /DECLINED: no\. State untouched\./);
  assert.ok(fs.existsSync(unreadOf(mcp)));
});

test('an ordinary Stop touches no server; stop_hook_active is honoured', () => {
  const { out, mcp } = scratch();
  let r = runHook('Stop', { session_id: 's3', last_assistant_message: 'All 12 tests pass; committed as abc123.' }, mcp);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(!fs.existsSync(out), 'no call was made');
  r = runHook('Stop', { session_id: 's3', stop_hook_active: true, last_assistant_message: 'DECLINED: x' }, mcp);
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(out));
});

test('an unreachable server never fails the turn: exit 0, the miss is logged', () => {
  const { d } = scratch();
  const mcp = path.join(d, 'broken.json');
  fs.writeFileSync(mcp, JSON.stringify({ mcpServers: { 'claude-flow': { command: '/nonexistent/server', args: [] } } }));
  const r = runHook('Stop', { session_id: 's4', last_assistant_message: 'DECLINED: no.' }, mcp);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /NOT stored/);
});

test('list is the review path: words and trailer, newest first', () => {
  const { mcp } = scratch();
  const r = spawnSync(process.execPath, [HOOK, 'list'], { encoding: 'utf8', env: { PATH: process.env.PATH, AGENTBOX_MCP_JSON: mcp, FLOOR_UNREAD_PATH: unreadOf(mcp) } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /== declined:2026-10-19:abc/);
  assert.match(r.stdout, /DECLINED: no\./);
  assert.match(r.stdout, /1 record\(s\) in agent-declines; 0 were unread/);
});

test('serverSpec falls back to the baked server when no .mcp.json is readable', () => {
  const spec = (() => { const prev = process.env.AGENTBOX_MCP_JSON; process.env.AGENTBOX_MCP_JSON = '/nonexistent.json'; process.env.WORKSPACE = '/nonexistent'; try { return H.serverSpec(); } finally { process.env.AGENTBOX_MCP_JSON = prev; } })();
  assert.equal(spec.command, 'node');
  assert.deepEqual(spec.args, ['/opt/agentbox/mcp/servers/ruvector-mcp.cjs']);
});
