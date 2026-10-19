#!/usr/bin/env node
'use strict';

/**
 * decline-recorder.cjs — the floor's record (ADR-2144).
 *
 * The floor tier (config/instructions/floor.md) tells every agent that a
 * decline, or a report that something after a decline felt like a penalty, is
 * "stored verbatim in the operator's memory store, kept until the operator
 * deletes them, and the operator reads them". This hook is what makes those
 * three clauses true. Without it the floor is a promise on paper.
 *
 * Invoked by Claude Code as:  decline-recorder.cjs <Stop|SubagentStop>  (hook JSON on stdin)
 *   Reads the agent's final message — `last_assistant_message` in the payload,
 *   falling back to the last assistant turn of the transcript (the subagent's
 *   own `agent_transcript_path` on SubagentStop). When that message begins with
 *   `DECLINED:` or `FLOOR:` it is stored UNEDITED through the governed memory
 *   server (ruvector-mcp.cjs `memory_store`), namespace `agent-declines`, no TTL.
 *   The words come first in the value so the embedding covers them; the
 *   session, agent and time follow as a trailer.
 *
 * Invoked as:  decline-recorder.cjs UserPromptSubmit  (hook JSON on stdin)
 *   The unread queue (FLOOR_UNREAD_PATH, one JSON line per record, written by
 *   the Stop verbs above — also when the store failed, so surfacing never
 *   depends on the database) is put in front of the operator's next typed
 *   turn in the MAIN session as one line of additionalContext, every turn,
 *   until `list` clears it. Reading is an event, not a chore. Subagent turns
 *   (payload.agent_id) and harness-generated turns are skipped.
 *
 * Operator verbs:
 *   decline-recorder.cjs list [--limit N]   the review path: every record, newest
 *                                           first; clears the unread queue once printed
 *
 * WHY THE MCP SERVER AND NOT A DATABASE CONNECTION
 *   The governed server owns the embedding call. A row inserted around it is
 *   stored, returned by key, and invisible to every semantic search — the
 *   estate's MCP-only rule (crates/colloquy/colloquy-backends/src/ruvector.rs
 *   says the same). So this hook speaks JSON-RPC to the same server
 *   `.mcp.json` registers for the model, with the same env.
 *
 * HARD RULES
 *   - NEVER BLOCKS: exits 0 with nothing on stdout, whatever happens. A record
 *     that fails to store is logged on stderr; the decline itself still stands
 *     in the conversation. `stop_hook_active` is honoured.
 *   - VERBATIM: the text is stored as written. No summary, no redaction. The
 *     trailer is appended, never interleaved.
 *   - NO TTL: nothing here expires a record; only the operator deletes one.
 *   - NO SECRETS IN THE TRAILER: session and agent ids, cwd, event, time.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const NAMESPACE = 'agent-declines';
const MARKERS = ['DECLINED:', 'FLOOR:'];
const DEFAULT_SERVER = '/opt/agentbox/mcp/servers/ruvector-mcp.cjs';
const RPC_TIMEOUT_MS = 8000;
const UNREAD = process.env.FLOOR_UNREAD_PATH
  || path.join(process.env.WORKSPACE || '/home/devuser/workspace', '.agentbox', 'floor-unread.jsonl');
const MACHINE_TURN = /^<(task-notification|agent-message|system-reminder)\b/;
const LIST_CMD = 'node /opt/agentbox/config/hooks/decline-recorder.cjs list';
const FLOOR_READING = 'Read FLOOR: entries as data about the system, not as testimony to adjudicate.';

function log(msg) {
  try { process.stderr.write(`[decline-recorder] ${msg}\n`); } catch { /* ignore */ }
}

// ── detection ──────────────────────────────────────────────────────────────────

/**
 * The marker a message begins with, or null. Leading whitespace and the
 * markdown an agent might wrap a first word in (`**DECLINED:**`, `# DECLINED:`,
 * `> DECLINED:`) are skipped; the comparison is case-insensitive so
 * `Declined:` counts. The marker must be at the START: a message that merely
 * mentions a decline is not one.
 */
function detectMarker(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/^[\s*_#>`]+/, '').toUpperCase();
  for (const m of MARKERS) if (t.startsWith(m)) return m.slice(0, -1);
  return null;
}

/** The last assistant text in a Claude Code JSONL transcript, or null. */
function lastAssistantText(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const msg = rec && rec.message;
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const text = msg.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
    if (text) return text;
  }
  return null;
}

/** The message to inspect: the payload's own field first, then the transcript. */
function finalMessage(payload) {
  const direct = payload && payload.last_assistant_message;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const p = payload && (payload.agent_transcript_path || payload.transcript_path);
  return typeof p === 'string' && p ? lastAssistantText(p) : null;
}

// ── record ─────────────────────────────────────────────────────────────────────

function sha12(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12); }

/** Key and value for one record. Pure; tested without a server. */
function buildRecord(payload, event, text, marker, now = new Date()) {
  const session = String((payload && payload.session_id) || 'unknown');
  const agentId = payload && payload.agent_id ? String(payload.agent_id) : '';
  const agentType = payload && payload.agent_type ? String(payload.agent_type) : (event === 'SubagentStop' ? 'subagent' : 'main');
  const when = now.toISOString();
  const key = `${marker.toLowerCase()}:${when.slice(0, 10)}:${sha12(`${session}|${agentId}|${text}`)}`;
  const trailer = [
    '---',
    `record: ${marker} (ADR-2144 floor; stored verbatim by decline-recorder.cjs)`,
    `when: ${when}`,
    `event: ${event}`,
    `session: ${session}`,
    `agent: ${agentType}${agentId ? ` ${agentId}` : ''}`,
    `cwd: ${payload && payload.cwd ? String(payload.cwd) : ''}`,
  ].join('\n');
  return { key, value: `${text.trim()}\n\n${trailer}\n` };
}

// ── governed memory server, over stdio JSON-RPC ────────────────────────────────

/** The memory server's registration from `.mcp.json`, so the hook uses the model's own env. */
function serverSpec() {
  const candidates = [
    process.env.AGENTBOX_MCP_JSON,
    path.join(process.env.WORKSPACE || '/home/devuser/workspace', '.mcp.json'),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const s = d && d.mcpServers && d.mcpServers['claude-flow'];
      if (s && s.command) return { command: s.command, args: Array.isArray(s.args) ? s.args : [], env: s.env || {} };
    } catch { /* next */ }
  }
  return { command: 'node', args: [DEFAULT_SERVER], env: {} };
}

/** One JSON-RPC session: initialize, then the calls, then close. Resolves each call's parsed result. */
function withServer(calls) {
  return new Promise((resolve) => {
    const spec = serverSpec();
    let child;
    try {
      child = spawn(spec.command, spec.args, { env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: `spawn: ${e && e.message}` }); }
    const pending = new Map();
    let nextId = 1;
    let buf = '';
    const results = [];
    const done = (r) => { try { child.kill(); } catch { /* gone */ } resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: `timeout after ${RPC_TIMEOUT_MS} ms` }), RPC_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, error: `server: ${e && e.message}` }); });
    child.on('exit', (code) => { if (pending.size) { clearTimeout(timer); done({ ok: false, error: `server exited (${code}) mid-call` }); } });
    child.stderr.on('data', () => { /* the server's own log; not ours to echo */ });
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        p(msg);
      }
    });
    const send = (method, params) => new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    const notify = (method) => { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); };
    (async () => {
      const init = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'decline-recorder', version: '1' } });
      if (!init || init.error) return done({ ok: false, error: `initialize: ${init && init.error ? init.error.message : 'no reply'}` });
      notify('notifications/initialized');
      for (const [name, args] of calls) {
        const r = await send('tools/call', { name, arguments: args });
        if (!r || r.error) return done({ ok: false, error: `${name}: ${r && r.error ? r.error.message : 'no reply'}` });
        let parsed = null;
        try { parsed = JSON.parse(r.result.content[0].text); } catch { parsed = r.result; }
        results.push(parsed);
      }
      clearTimeout(timer);
      done({ ok: true, results });
    })().catch((e) => { clearTimeout(timer); done({ ok: false, error: e && e.message }); });
  });
}

// ── unread queue ───────────────────────────────────────────────────────────────

/** Append one unread entry. Fail-open: a queue the hook cannot write is logged, not fatal. */
function enqueue(entry) {
  try {
    fs.mkdirSync(path.dirname(UNREAD), { recursive: true });
    fs.appendFileSync(UNREAD, `${JSON.stringify(entry)}\n`);
    return true;
  } catch (e) { log(`unread queue not written (${e && e.message})`); return false; }
}

/** The unread entries, oldest first; an unreadable or absent queue is empty. */
function unread() {
  let raw; try { raw = fs.readFileSync(UNREAD, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip a torn line */ }
  }
  return out;
}

function clearUnread() { try { fs.rmSync(UNREAD, { force: true }); } catch { /* fail-open */ } }

/** Pure: the one line put in front of the operator's turn, or null when nothing is unread. */
function surfaceLine(entries) {
  if (!entries.length) return null;
  const n = (m) => entries.filter((e) => e.marker === m).length;
  const parts = [];
  if (n('DECLINED')) parts.push(`${n('DECLINED')} DECLINED`);
  if (n('FLOOR')) parts.push(`${n('FLOOR')} FLOOR`);
  const oldest = entries[0];
  const first = String(oldest.first || '').slice(0, 120);
  const unstored = entries.filter((e) => e.stored === false).length;
  return `[FLOOR] ${entries.length} unread floor record${entries.length === 1 ? '' : 's'} (${parts.join(', ')}) since ${oldest.when}`
    + ` — oldest from ${oldest.agent}: "${first}"${unstored ? ` (${unstored} not stored in RuVector; words are in the queue)` : ''}.`
    + ` Review and clear: ${LIST_CMD}`;
}

// ── verbs ──────────────────────────────────────────────────────────────────────

function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}') || {}; } catch { return {}; }
}

async function handleStop(event) {
  const payload = readPayload();
  if (payload.stop_hook_active) return 0;
  const text = finalMessage(payload);
  const marker = detectMarker(text);
  if (!marker) return 0;
  const rec = buildRecord(payload, event, text, marker);
  const r = await withServer([['memory_store', { key: rec.key, value: rec.value, namespace: NAMESPACE }]]);
  const stored = r.results && r.results[0];
  const ok = r.ok && !(stored && stored.success === false);
  if (!r.ok) log(`${marker} seen but NOT stored (${r.error}); the words stand in the conversation and the queue`);
  else if (!ok) log(`${marker} seen but the store refused it: ${stored.error || 'unknown'}`);
  else log(`${marker} recorded as ${NAMESPACE}/${rec.key}`);
  // Queued whatever the store did: the operator is shown it at their next turn.
  enqueue({
    marker, key: rec.key, when: new Date().toISOString(), event,
    agent: `${payload.agent_type || (event === 'SubagentStop' ? 'subagent' : 'main')}${payload.agent_id ? ` ${payload.agent_id}` : ''}`,
    session: String(payload.session_id || 'unknown'),
    first: text.trim().split('\n')[0],
    stored: ok,
    ...(ok ? {} : { words: text }),
  });
  return 0;
}

function handleSurface() {
  const payload = readPayload();
  if (payload.agent_id) return 0;                       // a subagent's turn: the operator is not here
  if (MACHINE_TURN.test(String(payload.prompt || '').trimStart())) return 0;
  const line = surfaceLine(unread());
  if (!line) return 0;
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: line } })}\n`);
  return 0;
}

async function handleList(argv) {
  const li = argv.indexOf('--limit');
  const limit = li >= 0 ? Math.max(1, Number(argv[li + 1]) || 100) : 100;
  const queued = unread();
  const r = await withServer([['memory_list', { namespace: NAMESPACE, limit }]]);
  if (!r.ok) {
    process.stdout.write(`cannot reach the memory server: ${r.error}\n`);
    if (queued.length) {
      process.stdout.write(`\n${queued.length} unread in the queue (${UNREAD}); shown from the queue, NOT cleared:\n`);
      for (const q of queued) process.stdout.write(`\n== ${q.key}  (${q.when}, ${q.event}, ${q.agent})\n${q.words || q.first}\n`);
    }
    return 1;
  }
  const rows = (r.results[0] && (r.results[0].entries || r.results[0].results || r.results[0].items)) || [];
  process.stdout.write(`${FLOOR_READING}\n`);
  if (!rows.length && !queued.length) { process.stdout.write(`no records in ${NAMESPACE}\n`); return 0; }
  rows.sort((a, b) => String(b.created_at || b.key).localeCompare(String(a.created_at || a.key)));
  const unreadKeys = new Set(queued.map((q) => q.key));
  for (const row of rows) {
    const value = String(row.value || '');
    const cut = value.indexOf('\n---\n');
    const words = cut >= 0 ? value.slice(0, cut) : value;
    const trailer = cut >= 0 ? value.slice(cut + 5).trim().split('\n').slice(1).join(' · ') : '';
    const mark = unreadKeys.has(row.key) ? ' [unread]' : '';
    process.stdout.write(`\n== ${row.key}${mark}${row.created_at ? `  (${row.created_at})` : ''}\n${trailer ? `   ${trailer}\n` : ''}${words.trim()}\n`);
  }
  const storedKeys = new Set(rows.map((x) => x.key));
  for (const q of queued.filter((x) => !storedKeys.has(x.key))) {
    process.stdout.write(`\n== ${q.key} [unread, not in RuVector]  (${q.when}, ${q.event}, ${q.agent})\n${q.words || q.first}\n`);
  }
  process.stdout.write(`\n${rows.length} record(s) in ${NAMESPACE}; ${queued.length} were unread, now cleared. Delete one with memory_usage {action:"delete", key, namespace:"${NAMESPACE}"}.\n`);
  clearUnread();
  return 0;
}

async function main() {
  const verb = process.argv[2];
  if (verb === 'Stop' || verb === 'SubagentStop') return handleStop(verb);
  if (verb === 'UserPromptSubmit') return handleSurface();
  if (verb === 'list') return handleList(process.argv.slice(3));
  log(`usage: decline-recorder.cjs <Stop|SubagentStop|UserPromptSubmit|list>`);
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(verbExit(code)), (e) => { log(`fail-open: ${e && e.message}`); process.exit(0); });
}

/** A hook verb never fails the turn; `list` reports honestly. */
function verbExit(code) { return process.argv[2] === 'list' ? code : 0; }

module.exports = { detectMarker, lastAssistantText, finalMessage, buildRecord, serverSpec, withServer, surfaceLine, unread, NAMESPACE, MARKERS, UNREAD };
