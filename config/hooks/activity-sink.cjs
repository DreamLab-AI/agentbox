#!/usr/bin/env node
'use strict';

/**
 * activity-sink.cjs — post agent activity to an HTTP sink (ADR-2146).
 *
 * A generic, fail-open Claude Code hook. For every registered event it POSTs
 * one small JSON record to the URL configured in `[integrations.activity_sink]`
 * so an external consumer (a code visualiser, a dashboard, an audit log) can
 * see live which files an agent is touching, what it was asked and what it
 * answered:
 *
 *   PostToolUse       Read, Edit, Write, MultiEdit, NotebookEdit → the file path;
 *                     Grep, Glob → `tool_input.path`, else the session cwd.
 *                     Any other tool (Bash included) is skipped: no path, no post.
 *   UserPromptSubmit  the prompt, redacted, then truncated to 2 KiB
 *   Stop              the last assistant text from `transcript_path`, redacted,
 *                     then truncated to 2 KiB
 *
 * Wire body (one per event):
 *   { actor, kind: "agent", event: "post_tool_use"|"user_prompt"|"stop",
 *     tool: string|null, paths: string[], text: string|null, ts_ms, session_id }
 * sent with `Authorization: Bearer <token>`.
 *
 * Configuration comes from the registered command (the boot projector inlines
 * it; hook env is the command's, not the boot shell's):
 *   ACTIVITY_SINK_URL         full endpoint URL; empty → silent no-op
 *   ACTIVITY_SINK_TOKEN_FILE  file holding the bearer token (read once, trimmed)
 *   ACTIVITY_SINK_TOKEN_ENV   name of an env var holding the token (fallback)
 *   ACTIVITY_SINK_EVENTS      comma list of post_tool_use,user_prompt,stop
 *                             (default: all three)
 *   ACTIVITY_SINK_ACTOR       actor label override (profiles pass their stack)
 *   ACTIVITY_SINK_TIMEOUT_MS  request budget, default 1000
 * The token VALUE is never in the command: settings.json is a host mount.
 *
 * Egress (ADR-2026): prompt and answer text leave the container on this route,
 * so the hook obeys the global switches — AGENTBOX_EGRESS=0 disables it, and
 * AGENTBOX_EGRESS_REDACTION=0 refuses it (there is no unredacted mode). Text is
 * redacted with the ADR-2026 prose redactor (`lib/egress-policy.cjs`) BEFORE it
 * is truncated, so a cut can never leave half a secret; a redaction failure
 * sends `text: null`, never the raw text.
 *
 * Hook discipline: nothing on stdout (for UserPromptSubmit it would be injected
 * into the model's context), diagnostics on stderr, exit 0 always, and a hard
 * deadline so a sink that never answers cannot hold the turn.
 */

const fs = require('fs');
const path = require('path');

const TEXT_CAP_BYTES = 2048;
// Bound the redactor's work on a pathological prompt; anything past this is cut
// by the 2 KiB truncation anyway.
const REDACT_INPUT_CAP = 64 * 1024;
// Read at most this much of the transcript tail when looking for the last reply.
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const STDIN_CAP_BYTES = 4 * 1024 * 1024;

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const ALL_EVENTS = ['post_tool_use', 'user_prompt', 'stop'];
const HOOK_TO_EVENT = {
  PostToolUse: 'post_tool_use',
  UserPromptSubmit: 'user_prompt',
  Stop: 'stop',
};

function log(msg) {
  try { process.stderr.write(`[activity-sink] ${msg}\n`); } catch { /* ignore */ }
}

/**
 * May the bearer token travel over this URL? https: always. Plain http: only to
 * a host that cannot be on the public internet: localhost, 127.0.0.0/8, ::1, an
 * RFC 1918 address, or a single-label name with no dots (a compose service
 * such as `sink`, resolved by the container network's DNS). Everything else,
 * including a public IP or FQDN over http:, is refused before the token is read.
 * @returns {{ok: boolean, reason?: string}}
 */
function transportAllowed(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'bad-url' }; }
  if (u.protocol === 'https:') return { ok: true };
  if (u.protocol !== 'http:') return { ok: false, reason: 'bad-scheme' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host === '::1') return { ok: true };
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return { ok: true };
    return { ok: false, reason: 'plaintext-http-to-public-host' };
  }
  // WHATWG URL already normalises numeric forms (http://2130706433 → 127.0.0.1),
  // so a dot-free hostname here is a genuine single-label name, not an integer IP.
  if (host && !host.includes('.') && !host.includes(':')) return { ok: true };
  return { ok: false, reason: 'plaintext-http-to-public-host' };
}

function isOff(v) { return String(v == null ? '' : v).trim() === '0'; }

function timeoutMs(env) {
  const n = Number(env.ACTIVITY_SINK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : 1000;
}

/** The events the operator selected; unknown names are ignored. */
function selectedEvents(env) {
  const raw = String(env.ACTIVITY_SINK_EVENTS || '').trim();
  if (!raw) return new Set(ALL_EVENTS);
  return new Set(
    raw.replace(/[[\]"']/g, '').split(/[,\s]+/).map((s) => s.trim()).filter((s) => ALL_EVENTS.includes(s)),
  );
}

/** Bearer token: the file first, then the named env var. Empty when neither yields one. */
function readToken(env) {
  const file = String(env.ACTIVITY_SINK_TOKEN_FILE || '').trim();
  if (file) {
    try {
      const t = fs.readFileSync(file, 'utf8').trim();
      if (t) return t;
    } catch (e) {
      log(`token file unreadable (${e.code || e.message})`);
    }
  }
  const name = String(env.ACTIVITY_SINK_TOKEN_ENV || '').trim();
  if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    const t = String(env[name] || '').trim();
    if (t) return t;
  }
  return '';
}

/** Truncate to at most `max` UTF-8 bytes without splitting a character. */
function truncateUtf8(s, max = TEXT_CAP_BYTES) {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= max) return s;
  let end = max;
  // Step back over continuation bytes (10xxxxxx) to a character boundary.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

/**
 * Redact, then truncate. Returns null when the text is empty or redaction
 * fails — the caller sends `text: null`, never the unredacted string.
 */
function safeText(raw, egress) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const red = egress.redactForEgress(raw.slice(0, REDACT_INPUT_CAP));
  if (red == null) { log('redaction failed — text withheld'); return null; }
  return truncateUtf8(red.trim());
}

/** Pull human-readable text out of a transcript message content (string|blocks). */
function contentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block === 'object' && block.type === 'text') parts.push(String(block.text || ''));
  }
  return parts.map((p) => String(p).trim()).filter(Boolean).join(' ').trim();
}

/** The last assistant text in a .jsonl transcript, reading only its tail. '' on any error. */
function lastAssistantText(transcriptPath) {
  let fd;
  try {
    if (!transcriptPath) return '';
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    // A tail read may start mid-line; JSON.parse rejects that fragment and it is skipped.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const message = rec && rec.message;
      if (!message || typeof message !== 'object' || message.role !== 'assistant') continue;
      const text = contentText(message.content);
      if (text) return text;
    }
  } catch { /* fail-open */ } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
  return '';
}

function absolute(p, cwd) {
  if (typeof p !== 'string' || !p.trim()) return null;
  if (path.isAbsolute(p)) return path.normalize(p);
  return cwd && path.isAbsolute(cwd) ? path.resolve(cwd, p) : null;
}

/** File paths a PostToolUse touched, absolute. Empty → the event is not posted. */
function toolPaths(tool, input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  let p = null;
  if (FILE_TOOLS.has(tool)) p = absolute(i.file_path || i.notebook_path, cwd);
  else if (SEARCH_TOOLS.has(tool)) p = absolute(i.path, cwd) || absolute(cwd, cwd);
  return p ? [p] : [];
}

function actorFor(env, sessionId) {
  const label = String(env.ACTIVITY_SINK_ACTOR || env.AGENTBOX_PROFILE || env.AGENT_STACK || 'claude').trim() || 'claude';
  const short = String(sessionId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'nosession';
  return `${label}:${short}`;
}

/**
 * Build the wire body for one hook payload, or null when there is nothing to
 * post (event not selected, tool not tracked, no path, no text on Stop).
 */
function buildBody(payload, hookEvent, env, egress, now = Date.now()) {
  const event = HOOK_TO_EVENT[hookEvent];
  if (!event || !selectedEvents(env).has(event)) return null;
  const sessionId = String(payload.session_id || '');
  const base = { actor: actorFor(env, sessionId), kind: 'agent', event, ts_ms: now, session_id: sessionId };

  if (event === 'post_tool_use') {
    const tool = String(payload.tool_name || '');
    const paths = toolPaths(tool, payload.tool_input, payload.cwd);
    if (!paths.length) return null;
    return { ...base, tool, paths, text: null };
  }
  if (event === 'user_prompt') {
    return { ...base, tool: null, paths: [], text: safeText(payload.prompt, egress) };
  }
  // stop
  const text = safeText(lastAssistantText(payload.transcript_path), egress);
  return { ...base, tool: null, paths: [], text };
}

function readStdin(deadlineMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const t = setTimeout(finish, deadlineMs);
    process.stdin.on('data', (c) => {
      size += c.length;
      if (size <= STDIN_CAP_BYTES) chunks.push(c);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

/** POST once with a hard budget. Resolves with the status code, or an error string. */
function post(url, token, body, budgetMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve('bad-url'); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { resolve('bad-scheme'); return; }
    const mod = require(u.protocol === 'https:' ? 'https' : 'http');
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      res.resume();
      settle(res.statusCode);
    });
    const timer = setTimeout(() => { req.destroy(new Error('timeout')); settle('timeout'); }, budgetMs);
    req.on('error', (e) => settle(e.message === 'timeout' ? 'timeout' : (e.code || 'error')));
    req.end(data);
  });
}

async function main() {
  const env = process.env;
  const url = String(env.ACTIVITY_SINK_URL || '').trim();
  if (!url) return; // disabled: no stdin read, no request
  if (isOff(env.AGENTBOX_EGRESS)) { log('skipped: egress-globally-disabled'); return; }
  if (isOff(env.AGENTBOX_EGRESS_REDACTION)) { log('skipped: redaction-disabled-so-egress-refused'); return; }

  const transport = transportAllowed(url);
  if (!transport.ok) {
    // Host only: a URL may carry user:pass@, and the token is not read yet.
    let host = '?';
    try { host = new URL(url).host; } catch { /* bad url */ }
    log(`refused: ${transport.reason} (${host}); use https: or a private/compose host`);
    return;
  }

  const budget = timeoutMs(env);
  // Backstop: whatever happens below, the process is gone shortly after the budget.
  setTimeout(() => process.exit(0), budget + 400).unref();

  const raw = await readStdin(Math.min(budget, 500));
  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch { log('unparseable hook payload'); return; }
  if (!payload || typeof payload !== 'object') return;
  const hookEvent = String(payload.hook_event_name || process.argv[2] || '');

  let egress;
  try { egress = require('./lib/egress-policy.cjs'); } catch (e) { log(`egress policy unavailable (${e.message}) — refused`); return; }

  const body = buildBody(payload, hookEvent, env, egress);
  if (!body) return;
  const token = readToken(env);
  if (!token) { log('skipped: no bearer token (token_file / token_env)'); return; }

  const outcome = await post(url, token, body, budget);
  if (typeof outcome !== 'number' || outcome >= 300) log(`post ${body.event} → ${outcome}`);
}

if (require.main === module) {
  main().catch((e) => log(`error: ${e && e.message}`)).finally(() => process.exit(0));
}

module.exports = { transportAllowed, buildBody, truncateUtf8, toolPaths, actorFor, selectedEvents, readToken, lastAssistantText };
