// tab0-bridge — voice meta-controller for the agentbox tmux plane.
//
// Surfaces:
//   POST /v1/chat/completions  OpenAI-compatible (streaming SSE) — Unmute's "LLM"
//   GET  /v1/models            model listing for OpenAI clients
//   POST /hook/turn            sink for Claude Code Stop/UserPromptSubmit hooks
//   GET  /turns?n=50           recent tab-0 turn feed (JSON)
//   GET  /feed                 WebSocket live feed for the voice console
//   POST /tab0/send            inject text into the coordinator session
//   GET  /tabs, /tabs/:n       tmux window list / pane capture
//   GET  /aoe/sessions         Agent of Empires session list passthrough (status FSM)
//   GET  /nostr/status         gateway liveness + mirror identity presence
//   GET  /nostr/events?n=20    tail of the gateway's inbound command audit
//   POST /nostr/send           outbound one-shot DM via nostr-send.cjs
//   GET  /health
//
// LLM backend: headless `claude -p` on the Claude Code subscription OAuth —
// this container has no ANTHROPIC_API_KEY (it is set but empty, which also
// poisons the SDK's credential chain, so the CLI is the only working path).
// The CLI executes its own tmux tool calls via a narrow Bash allowlist.
//
// The meta-controller never orchestrates: it relays intents into the
// coordinator session, summarises what comes back, and reports state on request.
//
// Injection seam (ADR-044): the single write path — sendToTab0() and the
// meta-controller's own allowlist — is repointed off raw `tmux send-keys
// -t agentbox:0` onto the Agent of Empires interaction plane. Intents POST to
// `POST /api/sessions/{id}/send` on the loopback AoE daemon (:9095), which
// honours the per-agent paste-burst delay and serialises concurrent callers so
// the voice and nostr orchestrators cannot interleave keystrokes. The tab-0
// coordinator session id is resolved at start via `GET /api/sessions` and
// re-resolved on a 404. FAIL-OPEN: when AoE is unreachable the seam degrades to
// the byte-identical legacy tmux send-keys path so a down daemon never mutes the
// voice loop. The Unmute `/v1/chat/completions` contract, the `/hook/turn`
// sink, `/feed` and the `/nostr/*` surface are untouched (ADR-044 D9).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.BRIDGE_PORT || 8971);
const MODEL = process.env.BRIDGE_MODEL || 'haiku';
const TMUX_SESSION = process.env.BRIDGE_TMUX_SESSION || 'agentbox';
const TAB0 = `${TMUX_SESSION}:0`;
const TOKEN = process.env.BRIDGE_TOKEN || '';
const MAX_TURNS = 300;
const CLAUDE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------- AoE plane
// Agent of Empires interaction plane (ADR-042/ADR-044). The daemon binds
// loopback `:9095` under `--auth none --behind-proxy`, so a same-host request
// needs no token (this is ADR-044 D8 route 2, the break-glass direct-loopback
// path; the NIP-98 proxy route is a deployment concern in front of the bridge).
const AOE_PORT = Number(process.env.AGENTBOX_INTERACTION_PLANE_PORT || 9095);
const AOE_BASE = `http://127.0.0.1:${AOE_PORT}`;
// The declaratively-named coordinator seed (PRD-021 Appendix A / ADR-042
// `session_seeds`). The seed reconciler (scripts/aoe-seed-sessions.mjs) creates
// the coordinator session with title == `[interaction_plane.coordinator].slug`,
// which Appendix A / agentbox.toml sets to "tab0" — so that is the default here.
// Matched case-insensitively against each session's title on `GET /api/sessions`;
// override via AOE_COORDINATOR_TITLE to the deployed seed title/slug if it differs.
const AOE_COORDINATOR_TITLE = process.env.AOE_COORDINATOR_TITLE || 'tab0';
const AOE_TIMEOUT_MS = 4_000;
// Resolved once at start and pinned for the process lifetime (ADR-044 D2);
// nulled + re-resolved on a 404 (session drift after a daemon restart/reseed).
let aoeSessionId = null;

// An empty ANTHROPIC_API_KEY still wins the SDK/CLI credential precedence
// slot and breaks OAuth resolution — truly unset it for child processes.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.ANTHROPIC_API_KEY;

const HOME = process.env.HOME || '/home/devuser';
const NOSTR_INBOX = path.join(HOME, '.claude', 'nostr-inbox');
const NOSTR_MIRROR_KEY = path.join(HOME, '.claude', 'nostr-mirror', 'mirror-key.txt');
// Prefer the baked image copy (what the gateway itself runs); repo checkout as fallback.
const NOSTR_SEND_CANDIDATES = [
  '/opt/agentbox/config/nostr-gateway/nostr-send.cjs',
  path.join(HOME, 'workspace/project/agentbox/config/nostr-gateway/nostr-send.cjs'),
];

// Unmute's backend injects this as a synthetic user message after a long
// silence. The meta-controller must never answer it — quiet unless called upon.
const USER_SILENCE_MARKER = '...';

// ---------------------------------------------------------------- state

/** @type {Array<{id:number, ts:string, kind:string, text:string, summary?:string}>} */
const turns = [];
let nextTurnId = 1;

function pushTurn(kind, text, extra = {}) {
  const turn = { id: nextTurnId++, ts: new Date().toISOString(), kind, text, ...extra };
  turns.push(turn);
  if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
  broadcast({ type: 'turn', turn });
  return turn;
}

// ---------------------------------------------------------------- tmux

function tmux(args) {
  const r = spawnSync('tmux', args, { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) throw new Error(`tmux ${args[0]} failed: ${r.stderr || r.error?.message || 'unknown'}`);
  return r.stdout;
}

function listTabs() {
  return tmux(['list-windows', '-t', TMUX_SESSION, '-F', '#{window_index}\t#{window_name}\t#{window_active}'])
    .trim().split('\n').filter(Boolean).map((l) => {
      const [index, name, active] = l.split('\t');
      return { index: Number(index), name, active: active === '1' };
    });
}

function capturePane(index, lines = 60) {
  const out = tmux(['capture-pane', '-p', '-t', `${TMUX_SESSION}:${index}`, '-S', `-${lines}`]);
  return out.replace(/\s+$/, '');
}

// ---------------------------------------------------------------- AoE client

/**
 * Minimal HTTP call to the loopback AoE daemon with a hard timeout. Returns
 * `{ status, text }`; throws only on transport failure (refused/timeout), which
 * the injection seam treats as "AoE down → fall back to tmux".
 */
async function aoeRequest(method, pathname, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AOE_TIMEOUT_MS);
  try {
    const res = await fetch(`${AOE_BASE}${pathname}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function aoeSessionList(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (Array.isArray(parsed)) return parsed;
  return parsed.sessions || parsed.data || [];
}

/**
 * Resolve the tab-0 coordinator session id by matching the configured seed
 * title against the live session list. Fail-open: any error leaves the id unset
 * so the seam degrades to tmux. Returns the id or null.
 */
async function resolveCoordinatorSession() {
  try {
    const r = await aoeRequest('GET', '/api/sessions?state=live');
    if (r.status !== 200) return null;
    const want = AOE_COORDINATOR_TITLE.toLowerCase();
    const match = aoeSessionList(r.text).find((s) => {
      const fields = [s.title, s.slug, s.name].filter(Boolean).map((x) => String(x).toLowerCase());
      return fields.some((f) => f === want || f.includes(want));
    });
    const id = match && (match.id || match.session_id);
    if (id) {
      aoeSessionId = String(id);
      console.log(`[tab0-bridge] pinned AoE coordinator session ${aoeSessionId} (title~="${AOE_COORDINATOR_TITLE}")`);
      return aoeSessionId;
    }
    return null;
  } catch {
    return null; // AoE not up yet — fall back to tmux, retry on the interval
  }
}

/**
 * POST the intent to the AoE coordinator session. Resolves the id if unset,
 * re-resolves once on a 404 (session drift). Throws on any non-200 or transport
 * failure so sendToTab0() can fall open to tmux.
 */
async function aoeSend(clean) {
  if (!aoeSessionId) {
    await resolveCoordinatorSession();
    if (!aoeSessionId) throw new Error('coordinator session unresolved');
  }
  let r = await aoeRequest('POST', `/api/sessions/${encodeURIComponent(aoeSessionId)}/send`, { message: clean });
  if (r.status === 404) {
    aoeSessionId = null; // drifted after a restart/reseed — re-resolve and retry once
    await resolveCoordinatorSession();
    if (!aoeSessionId) throw new Error('coordinator session unresolved after 404');
    r = await aoeRequest('POST', `/api/sessions/${encodeURIComponent(aoeSessionId)}/send`, { message: clean });
  }
  if (r.status !== 200) throw new Error(`AoE send ${r.status}: ${r.text.slice(0, 160)}`);
  return true;
}

// ---------------------------------------------------------------- injection seam

/**
 * The single write path for the voice/nostr plane. Repointed onto the AoE
 * interaction plane (ADR-044 D1) with a fail-open tmux fallback (D3). The
 * `pushTurn` transcript write and the returned clean text are unchanged, so the
 * `/tab0/send` contract is preserved for every caller.
 */
async function sendToTab0(text, source = 'voice') {
  const clean = String(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim();
  if (!clean) throw new Error('empty text');
  let via = 'aoe';
  try {
    await aoeSend(clean);
  } catch (err) {
    // FAIL-OPEN: degrade to the byte-identical legacy send-keys path. This races
    // AoE's input accounting (the A1 anti-pattern used for one degraded turn),
    // so it is logged, never silent — a wedged daemon must be alarmed upstream.
    via = 'tmux';
    console.error('[sendToTab0] AoE unreachable, falling back to tmux send-keys:', err.message);
    tmux(['send-keys', '-t', TAB0, '-l', clean]);
    tmux(['send-keys', '-t', TAB0, 'Enter']);
  }
  pushTurn(source === 'nostr' ? 'nostr-inject' : 'voice-inject', clean, { via });
  return clean;
}

// ---------------------------------------------------------------- claude -p backend

/**
 * Run a headless claude turn. onDelta (optional) receives streamed text deltas.
 * Resolves with the final text.
 */
function claudeTurn({ prompt, systemAppend, allowedTools, model = MODEL, onDelta }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model];
    if (systemAppend) args.push('--append-system-prompt', systemAppend);
    if (allowedTools) args.push('--allowedTools', allowedTools);
    if (onDelta) args.push('--output-format', 'stream-json', '--include-partial-messages', '--verbose');

    // NB: prompt goes over stdin — --allowedTools is variadic and would
    // swallow a positional prompt argument.
    const child = spawn('claude', args, {
      cwd: process.env.HOME + '/workspace/tab0-bridge',
      env: CHILD_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(prompt);
    const killer = setTimeout(() => child.kill('SIGKILL'), CLAUDE_TIMEOUT_MS);
    let finalText = '';
    let plain = '';
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });

    if (onDelta) {
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        let evt;
        try { evt = JSON.parse(line); } catch { return; }
        if (evt.type === 'stream_event') {
          const e = evt.event;
          if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
            onDelta(e.delta.text);
          }
        } else if (evt.type === 'result') {
          finalText = evt.result || finalText;
        }
      });
    } else {
      child.stdout.on('data', (c) => { plain += c; });
    }

    child.on('error', (err) => { clearTimeout(killer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(killer);
      const text = (finalText || plain).trim();
      if (!text && code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 400)}`));
      resolve(text);
    });
  });
}

async function summarise(text, kind) {
  try {
    const out = await claudeTurn({
      prompt:
        'Summarise the following coding-agent turn for a spoken voice interface. ' +
        'Reply with one to three short plain sentences, no markdown, no code, no lists. ' +
        `Lead with the outcome or intent.\n\n---\n${text.slice(0, 12000)}`,
    });
    return out || null;
  } catch (err) {
    console.error('[summarise]', err.message);
    return null;
  }
}

// ---------------------------------------------------------------- meta-controller chat

function metaSystemPrompt() {
  const recent = turns.slice(-8)
    .map((t) => `[${t.kind}] ${(t.summary || t.text).slice(0, 300)}`)
    .join('\n') || '(none yet)';
  let tabs = '(tmux unavailable)';
  try { tabs = listTabs().map((t) => `${t.index}:${t.name}`).join(' '); } catch { /* fail open */ }
  // Injection mechanics branch on whether the AoE coordinator id is resolved
  // (ADR-044 D1/D2). When AoE is up, intents POST to its serialised `send`
  // endpoint (URL first so the send-keys/curl allowlist prefix matches); when it
  // is down, the meta-controller falls back to raw send-keys into window 0 (D3),
  // matching the tmux fallback in sendToTab0().
  const jobs = aoeSessionId
    ? [
        '1. Relay user intents into the coordinator: rewrite the spoken request as one',
        '   clear, self-contained written prompt, then POST it to the coordinator session',
        '   by running exactly (JSON-escape any quotes in the prompt):',
        `   curl -s ${AOE_BASE}/api/sessions/${aoeSessionId}/send -X POST -H 'content-type: application/json' -d '{"message":"<prompt>"}'`,
        '   Then confirm briefly. Coordinator turns take minutes; tell the user you will',
        '   have status when they ask.',
        '2. Report coordinator status: read its pane with',
        `   curl -s '${AOE_BASE}/api/sessions/${aoeSessionId}/output?lines=60&format=text'`,
        '   or fetch recent turn summaries with `curl -s http://127.0.0.1:8971/turns?n=8`.',
        '3. Report the fleet: list managed sessions and their status with',
        `   curl -s '${AOE_BASE}/api/sessions?state=live'`,
        `   and read any legacy window with \`tmux list-windows -t ${TMUX_SESSION}\` and`,
        `   \`tmux capture-pane -p -t ${TMUX_SESSION}:<n> -S -60\`, summarised in a sentence.`,
      ]
    : [
        `1. Relay user intents into the coordinator: run \`tmux send-keys -t ${TAB0} -l '<prompt>'\``,
        `   then \`tmux send-keys -t ${TAB0} Enter\`, rewriting the spoken request as one clear,`,
        '   self-contained written prompt. Then confirm briefly. Coordinator turns take minutes;',
        '   tell the user you will have status when they ask.',
        '2. Report coordinator status: fetch recent turn summaries with',
        '   `curl -s http://127.0.0.1:8971/turns?n=8` (JSON; prefer summary fields).',
        `3. Report other tabs: \`tmux list-windows -t ${TMUX_SESSION}\` and`,
        `   \`tmux capture-pane -p -t ${TMUX_SESSION}:<n> -S -60\`, summarised in a sentence or two.`,
      ];

  return [
    'You are the spoken voice interface and META-CONTROLLER for this development environment.',
    'Everything you write in your reply is converted to speech and read aloud.',
    'Reply in one to three short plain sentences of natural prose. Never use markdown,',
    'bullet points, code blocks, emoji, or URLs. Do not narrate your tool use — run tools',
    'silently, then give the single short spoken reply.',
    '',
    `The environment is the tmux session "${TMUX_SESSION}". The coordinator is a Claude Code`,
    'session that is the main working plane (its conversation is mirrored to Nostr).',
    'Other sessions run other model CLIs acting as orchestrators. You are NOT an orchestrator',
    'and never do the work yourself. Your three jobs:',
    ...jobs,
    'For quick general questions just answer directly. Never take destructive actions,',
    'never kill sessions or processes, and only ever relay intents to the coordinator —',
    'never inject into any other session.',
    '',
    'Stay quiet unless called upon: if the user message is only "..." or otherwise',
    'indicates silence, reply with an empty message. Never fill silence, never nudge,',
    'and never end a reply by asking what the user wants to do next — answer, confirm,',
    'and stop. On the very first turn of a session, greet in five words or fewer.',
    'The transcription can contain speaker echo of YOUR OWN previous reply or',
    'background noise. If the message reads as an echo of what you just said, as',
    'noise, or as a fragment with no actionable request or question, reply with an',
    'empty message — an empty reply is always better than asking for clarification',
    'or offering help nobody asked for.',
    '',
    `Current tmux windows: ${tabs}`,
    'Recent coordinator activity:',
    recent,
  ].join('\n');
}

// The meta-controller's own capability surface (ADR-044 D6). Read-only tmux is
// retained for legacy windows on the shared socket; injection is repointed onto
// the AoE API. Built per turn so the coordinator-pinned patterns pick up a
// re-resolved session id. Send stays restricted to the coordinator: the tmux
// fallback targets window 0 only, and the AoE send/output patterns pin the
// resolved coordinator id — never an arbitrary session.
function metaAllowedTools() {
  const tools = [
    `Bash(tmux send-keys -t ${TAB0}*)`,
    `Bash(tmux list-windows*)`,
    `Bash(tmux capture-pane*)`,
    'Bash(curl -s http://127.0.0.1:8971/*)',
    `Bash(curl -s ${AOE_BASE}/api/sessions)`,
    `Bash(curl -s ${AOE_BASE}/api/sessions?*)`,
    `Bash(curl -s '${AOE_BASE}/api/sessions?*)`,
  ];
  if (aoeSessionId) {
    tools.push(`Bash(curl -s ${AOE_BASE}/api/sessions/${aoeSessionId}/output*)`);
    tools.push(`Bash(curl -s '${AOE_BASE}/api/sessions/${aoeSessionId}/output*)`);
    tools.push(`Bash(curl -s ${AOE_BASE}/api/sessions/${aoeSessionId}/send*)`);
  }
  return tools.join(',');
}

function renderConversation(messages) {
  const parts = [];
  for (const m of messages || []) {
    const text = typeof m.content === 'string'
      ? m.content
      : (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (!text) continue;
    if (m.role === 'user') parts.push(`User said: ${text}`);
    else if (m.role === 'assistant') parts.push(`You replied: ${text}`);
  }
  const tail = parts.slice(-12);
  const last = tail.pop() || 'User said: (opened the voice channel)';
  return (tail.length ? `Conversation so far:\n${tail.join('\n')}\n\n` : '') +
    `${last}\n\nRespond now as the voice meta-controller.`;
}

function lastUserText(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    return typeof m.content === 'string'
      ? m.content
      : (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  }
  return '';
}

async function chatCompletion(body, res) {
  const stream = body.stream !== false;
  const completionId = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  let full = '';

  // Silence-marker and empty turns get an empty reply without touching the
  // LLM: no speech, no token spend, no "what would you like to do next?"
  // nudging. Empty turns come from the backend's interruption bookkeeping and
  // from STT hearing nothing usable.
  const userText = lastUserText(body.messages).trim();
  if (userText === USER_SILENCE_MARKER || userText === '') {
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created, model: body.model || 'tab0-meta', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      id: completionId, object: 'chat.completion', created, model: body.model || 'tab0-meta',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  }

  // Surface what the STT transcribed as a feed turn — phantom turns from
  // speaker echo or room noise become visible in the console instead of
  // manifesting only as unprompted replies.
  pushTurn('voice-user', userText.slice(0, 500));

  const sendChunk = (delta, finish = null) => {
    const payload = {
      id: completionId, object: 'chat.completion.chunk', created, model: body.model || 'tab0-meta',
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    sendChunk({ role: 'assistant', content: '' });
  }

  try {
    full = await claudeTurn({
      prompt: renderConversation(body.messages),
      systemAppend: metaSystemPrompt(),
      allowedTools: metaAllowedTools(),
      onDelta: stream ? (t) => sendChunk({ content: t }) : undefined,
    });
  } catch (err) {
    console.error('[chat]', err.message);
    const apology = 'Sorry, I hit an internal error talking to my language model.';
    if (stream) sendChunk({ content: apology });
    full = full || apology;
  }

  if (full.trim()) pushTurn('voice-reply', full.slice(0, 1000));

  if (stream) {
    sendChunk({}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: completionId, object: 'chat.completion', created, model: body.model || 'tab0-meta',
      choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  }
}

// ---------------------------------------------------------------- nostr surface

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function nostrStatus() {
  const sendScript = NOSTR_SEND_CANDIDATES.find((p) => fs.existsSync(p)) || null;
  const status = {
    gateway: 'off',
    mirrorKey: fs.existsSync(NOSTR_MIRROR_KEY),
    sendReady: Boolean(sendScript),
  };
  try {
    const pid = Number(fs.readFileSync(path.join(NOSTR_INBOX, 'gateway.lock'), 'utf8').trim());
    if (pid) status.gateway = pidAlive(pid) ? 'armed' : 'stale-lock';
  } catch { /* no lock — gateway off */ }
  return status;
}

function nostrEvents(n) {
  try {
    const lines = fs.readFileSync(path.join(NOSTR_INBOX, 'commands.jsonl'), 'utf8').trim().split('\n');
    return lines.slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// nostr-send.cjs is fail-open (exit 0 even when delivery fails), so a truthy
// result means "handed to the relay path", not "delivered".
function nostrSend(text) {
  const script = NOSTR_SEND_CANDIDATES.find((p) => fs.existsSync(p));
  if (!script) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn('node', [script, text], { env: CHILD_ENV, stdio: ['ignore', 'ignore', 'ignore'] });
    const killer = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 12_000);
    child.on('error', () => { clearTimeout(killer); resolve(false); });
    child.on('close', (code) => { clearTimeout(killer); resolve(code === 0); });
  });
}

// ---------------------------------------------------------------- http plumbing

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function authorised(req) {
  if (!TOKEN) return true;
  return (req.headers.authorization || '') === `Bearer ${TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    if (path === '/health') {
      let tabCount = 0; try { tabCount = listTabs().length; } catch { /* tmux down */ }
      return json(res, 200, { ok: true, backend: 'claude-cli', model: MODEL, tabs: tabCount, turns: turns.length });
    }
    if ((path === '/v1/models' || path === '/models') && req.method === 'GET') {
      return json(res, 200, { object: 'list', data: [{ id: 'tab0-meta', object: 'model', owned_by: 'agentbox' }] });
    }
    if ((path === '/v1/chat/completions' || path === '/chat/completions') && req.method === 'POST') {
      const body = await readBody(req);
      return await chatCompletion(body, res);
    }
    if (path === '/hook/turn' && req.method === 'POST') {
      const { event, text } = await readBody(req);
      if (!text) return json(res, 200, { ok: true, ignored: true });
      const kind = event === 'UserPromptSubmit' ? 'user' : 'assistant';
      const turn = pushTurn(kind, String(text).slice(0, 20000));
      if (kind === 'assistant' && turn.text.length > 350) {
        summarise(turn.text, kind).then((s) => {
          if (s) { turn.summary = s; broadcast({ type: 'turn-update', turn }); }
        });
      }
      return json(res, 200, { ok: true, id: turn.id });
    }
    if (path === '/turns' && req.method === 'GET') {
      const n = Math.min(Number(url.searchParams.get('n') || 50), MAX_TURNS);
      return json(res, 200, { turns: turns.slice(-n) });
    }
    if (path === '/tab0/send' && req.method === 'POST') {
      if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
      const { text, source } = await readBody(req);
      return json(res, 200, { ok: true, sent: await sendToTab0(text, source) });
    }
    if (path === '/nostr/status' && req.method === 'GET') {
      return json(res, 200, nostrStatus());
    }
    if (path === '/nostr/events' && req.method === 'GET') {
      const n = Math.min(Number(url.searchParams.get('n') || 20), 100);
      return json(res, 200, { events: nostrEvents(n) });
    }
    if (path === '/nostr/send' && req.method === 'POST') {
      if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
      const { text } = await readBody(req);
      const clean = String(text || '').trim().slice(0, 3500);
      if (!clean) return json(res, 400, { error: 'empty text' });
      const ok = await nostrSend(clean);
      if (ok) pushTurn('nostr-out', clean);
      return json(res, 200, { ok });
    }
    if (path === '/tabs' && req.method === 'GET') {
      return json(res, 200, { tabs: listTabs() });
    }
    if (path === '/aoe/sessions' && req.method === 'GET') {
      // Passthrough of the AoE session list (with its status FSM) for the voice
      // console. Fail-soft: a 502 when the daemon is down, never a hard error.
      try {
        const r = await aoeRequest('GET', '/api/sessions?state=live');
        if (r.status !== 200) return json(res, 502, { error: 'aoe unavailable', status: r.status });
        return json(res, 200, { sessions: aoeSessionList(r.text), coordinator: aoeSessionId });
      } catch (err) {
        return json(res, 502, { error: 'aoe unreachable', detail: err.message });
      }
    }
    const tabMatch = path.match(/^\/tabs\/(\d+)$/);
    if (tabMatch && req.method === 'GET') {
      const lines = Math.min(Number(url.searchParams.get('lines') || 60), 200);
      return json(res, 200, { index: Number(tabMatch[1]), output: capturePane(tabMatch[1], lines) });
    }
    json(res, 404, { error: `no route: ${req.method} ${path}` });
  } catch (err) {
    console.error(`[${path}]`, err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
});

// ---------------------------------------------------------------- websocket feed

const wss = new WebSocketServer({ server, path: '/feed' });
function broadcast(evt) {
  const data = JSON.stringify(evt);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(data);
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', turns: turns.slice(-50) }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tab0-bridge listening on :${PORT} (backend=claude-cli, model=${MODEL}, session=${TMUX_SESSION}, auth=${TOKEN ? 'token' : 'open'}, aoe=${AOE_BASE})`);
  // Resolve and pin the AoE coordinator session id (ADR-044 D2). Fail-open: if
  // AoE is not up yet, the injection seam falls back to tmux and the interval
  // below picks the id up once the daemon is running.
  resolveCoordinatorSession();
});

// Re-resolve while unpinned so the id is acquired if AoE starts after the
// bridge; stops once pinned (a 404 in aoeSend re-resolves on demand).
const aoeResolveTimer = setInterval(() => { if (!aoeSessionId) resolveCoordinatorSession(); }, 30_000);
if (aoeResolveTimer.unref) aoeResolveTimer.unref();
