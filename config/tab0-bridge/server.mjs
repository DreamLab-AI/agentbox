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
//   GET  /sessions             owned session-plane status
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
// ADR-2153: coordinator injection uses the session socket with a tmux fallback.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.BRIDGE_PORT || 8971);
const MODEL = process.env.BRIDGE_MODEL || 'haiku';
const TMUX_SESSION = process.env.BRIDGE_TMUX_SESSION || 'agentbox';
const TAB0 = `${TMUX_SESSION}:0`;
const TOKEN = process.env.BRIDGE_TOKEN || '';
// Bind interface (ADR-044 finding 1). Default `0.0.0.0` so the Unmute backend
// can reach `agentbox:8971` over the docker network; a loopback bind
// (127.0.0.1/::1/localhost) is the token-optional dev path. A non-loopback bind
// without a BRIDGE_TOKEN exposes the injection seam + `claude -p` backend to the
// network unauthenticated, so we refuse to start in that configuration.
const BIND = process.env.BRIDGE_BIND || '0.0.0.0';
const BIND_IS_LOOPBACK = BIND === '127.0.0.1' || BIND === '::1' || BIND === 'localhost';
const MAX_TURNS = 300;
const CLAUDE_TIMEOUT_MS = 90_000;

if (!TOKEN && !BIND_IS_LOOPBACK) {
  console.error(
    `[tab0-bridge] refusing to start: BRIDGE_BIND=${BIND} is non-loopback but BRIDGE_TOKEN is unset. ` +
    'Set BRIDGE_TOKEN (the Unmute backend carries it as KYUTAI_LLM_API_KEY) or bind to 127.0.0.1.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------- session-plane plane
// ADR-2153: the unix-socket client, also when this file is deployed to workspace.
const SESSION_CLIENT = createRequire(import.meta.url)(fs.existsSync('/opt/agentbox/config/session-plane/client.cjs')
  ? '/opt/agentbox/config/session-plane/client.cjs' : '../session-plane/client.cjs');
const COORDINATOR = process.env.AGENTBOX_COORDINATOR_SLUG || 'tab0';
let coordinatorReady = false;

// An empty ANTHROPIC_API_KEY still wins the SDK/CLI credential precedence
// slot and breaks OAuth resolution — truly unset it for child processes.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.ANTHROPIC_API_KEY;
// Headless turns are routine summarise/route work: no extended thinking, and no
// CLAUDE.md tier (the meta-controller carries its own system prompt). Measured
// on 2.1.280 with haiku: 38.4k-token prefix / 9.3 s → 6.8k (no tools) or 10.4k
// (Bash only) / 2.7 s once MCP, hooks, skills and CLAUDE.md are stripped too.
CHILD_ENV.MAX_THINKING_TOKENS = '0';
CHILD_ENV.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
const EFFORT = process.env.BRIDGE_EFFORT || 'low';

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

// ---------------------------------------------------------------- session-plane client

async function resolveCoordinatorSession() {
  try {
    const r = await SESSION_CLIENT.call({ op: 'list' });
    coordinatorReady = r.sessions.some(s => s.slug === COORDINATOR && s.present);
  } catch { coordinatorReady = false; }
}
async function sessionSend(text) {
  await SESSION_CLIENT.call({ op: 'send', slug: COORDINATOR, text });
}

// ---------------------------------------------------------------- injection seam

/**
 * The single write path for the voice/nostr plane. Repointed onto the session-plane
 * interaction plane (ADR-044 D1) with a fail-open tmux fallback (D3). The
 * `pushTurn` transcript write and the returned clean text are unchanged, so the
 * `/tab0/send` contract is preserved for every caller.
 */
async function sendToTab0(text, source = 'voice') {
  const clean = String(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim();
  if (!clean) throw new Error('empty text');
  let via = 'session-plane';
  try {
    await sessionSend(clean);
  } catch (err) {
    // FAIL-OPEN: degrade to the byte-identical legacy send-keys path. This races
    // session-plane's input accounting (the A1 anti-pattern used for one degraded turn),
    // so it is logged, never silent — a wedged daemon must be alarmed upstream.
    via = 'tmux';
    console.error('[sendToTab0] Session plane unreachable, falling back to tmux send-keys:', err.message);
    tmux(['send-keys', '-t', TAB0, '-l', clean]);
    // A TUI may read text and Enter in one burst as a paste and keep the Enter
    // as a newline (Codex does); pause so the Enter submits.
    await new Promise((r) => setTimeout(r, 1500));
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
    // Lean headless surface: no MCP servers (the bridge only ever uses Bash),
    // no settings/plugin hooks (`disableAllHooks` keeps subscription OAuth,
    // unlike --bare; `{"hooks":{}}` merges and suppresses nothing), no skills,
    // and only the built-in tools the turn is allowed to call. --tools and
    // --mcp-config are variadic: the prompt goes over stdin, never positional.
    const args = [
      '-p', '--model', model, '--effort', EFFORT,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--settings', '{"disableAllHooks":true}',
      '--disable-slash-commands',
      '--tools', allowedTools ? 'Bash' : '',
    ];
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
  const jobs = coordinatorReady
    ? [
        '1. Relay the user intent as a clear, self-contained written prompt:',
        `   node /opt/agentbox/scripts/session-control.cjs send '<prompt>'`,
        `2. Read coordinator status: tmux capture-pane -p -t ${TAB0} -S -60`,
        '3. Report the fleet: node /opt/agentbox/scripts/session-control.cjs list',
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
// the session-plane API. Built per turn so the coordinator-pinned patterns pick up a
// re-resolved session id. Send stays restricted to the coordinator: the tmux
// fallback targets window 0 only, and the session-plane send/output patterns pin the
// resolved coordinator id — never an arbitrary session.
function metaAllowedTools() {
  const tools = [
    `Bash(tmux send-keys -t ${TAB0}*)`,
    `Bash(tmux list-windows*)`,
    `Bash(tmux capture-pane*)`,
    'Bash(curl -s http://127.0.0.1:8971/*)',
    'Bash(node /opt/agentbox/scripts/session-control.cjs list)',
    'Bash(node /opt/agentbox/scripts/session-control.cjs send*)',
  ];
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

// Global gate (ADR-044 finding 1). Every surface except `/health` requires a
// credential when a BRIDGE_TOKEN is set. Carriers:
//   - `Authorization: Bearer <TOKEN>` — the Unmute backend (KYUTAI_LLM_API_KEY),
//     the console over Caddy (which forwards Authorization), and CLI callers.
//   - `?token=<TOKEN>` query param — browser WebSocket clients, which cannot set
//     request headers on the `/feed` upgrade.
//   - `Authorization: Nostr <b64>` — a NIP-98 (kind-27235) event signed by the
//     operator or an allowlisted key (the cockpit's window.nostr signer, so the
//     operator never has to paste the bearer). Verified via NostrBridge, same
//     verifier as the nip98-proxy and management-api; pubkey-gated because this
//     surface reaches the tab0 injection seam.
//   - `?auth=<b64>` query param — the same NIP-98 payload for the `/feed` WS
//     upgrade (headers impossible there; the event's signature + 60s window +
//     replay cache bound its reuse).
// When no TOKEN is set (loopback dev only — a non-loopback bind without one is
// refused at startup) the gate is open.

// NIP-98 verifier + allowed signer set. Fail-open to bearer-only: if the bridge
// module or key material is absent, Nostr headers are simply not accepted.
const NostrBridge = (() => {
  const candidates = [
    process.env.NOSTR_BRIDGE_PATH,
    '/opt/agentbox/mcp/servers/nostr-bridge.js',
    new URL('../../mcp/servers/nostr-bridge.js', import.meta.url).pathname,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = createRequire(import.meta.url)(candidate);
      if (mod?.NostrBridge?.verifyNip98) return mod.NostrBridge;
    } catch { /* try next */ }
  }
  console.warn('[tab0-bridge] NostrBridge unavailable — NIP-98 auth disabled, bearer only.');
  return null;
})();

// Keys allowed to drive the bridge over NIP-98: the box operator, the env
// allowlist (same vars lib/authz.js reads in management-api), and the
// manifest's [sovereign_mesh.relay].allowed_pubkeys — read directly from
// agentbox.toml because the flake only bakes that list into the pod-bridge
// program env, so a container-global env var cannot be assumed here.
const NIP98_ALLOWED = (() => {
  const hex = /^[0-9a-f]{64}$/;
  const keys = new Set();
  for (const v of [process.env.AGENTBOX_X_ONLY_PUBKEY_HEX, process.env.AGENTBOX_PUBKEY]) {
    const s = String(v || '').toLowerCase();
    if (hex.test(s)) keys.add(s);
  }
  for (const v of String(process.env.AGENTBOX_RELAY_ALLOWED_PUBKEYS || process.env.AGENTBOX_APPROVAL_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase())) {
    if (hex.test(v)) keys.add(v);
  }
  try {
    // Targeted extraction, not a TOML parse (the bridge is zero-dep): quoted
    // 64-hex strings inside the allowed_pubkeys = [ … ] array only.
    const toml = fs.readFileSync(process.env.AGENTBOX_MANIFEST_PATH || '/etc/agentbox.toml', 'utf8');
    const arr = toml.match(/allowed_pubkeys\s*=\s*\[([\s\S]*?)\]/);
    if (arr) {
      for (const m of arr[1].matchAll(/"([0-9a-f]{64})"/g)) keys.add(m[1]);
    }
  } catch { /* no manifest — env/operator keys only */ }
  return keys;
})();

function verifyNip98Credential(req, headerValue) {
  if (!NostrBridge || !headerValue || NIP98_ALLOWED.size === 0) return false;
  try {
    // The loopback ingress rewrites Host and strips /bridge before forwarding.
    // Rebuild its public URL to re-verify the original operator signature.
    // Only the local proxy may supply the forwarded host; sibling containers
    // authenticate against their direct request URL.
    const peer = req.socket.remoteAddress;
    const fromProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
      && typeof req.headers['x-forwarded-host'] === 'string';
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = (fromProxy ? req.headers['x-forwarded-host'] : req.headers.host)
      || `127.0.0.1:${PORT}`;
    const upstreamPath = String(req.url || '/').split('?')[0];
    const path = fromProxy && upstreamPath !== '/feed' ? `/bridge${upstreamPath}` : upstreamPath;
    const result = NostrBridge.verifyNip98(headerValue, req.method || 'GET', `${proto}://${host}${path}`);
    return Boolean(result?.valid && NIP98_ALLOWED.has(String(result.pubkey || '').toLowerCase()));
  } catch {
    return false;
  }
}

function authorised(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${TOKEN}`) return true;
  if (header.startsWith('Nostr ') && verifyNip98Credential(req, header)) return true;
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (u.searchParams.get('token') === TOKEN) return true;
    const wsAuth = u.searchParams.get('auth');
    if (wsAuth && verifyNip98Credential(req, `Nostr ${wsAuth}`)) return true;
  } catch { /* malformed URL — treat as unauthorised */ }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    if (path === '/health') {
      let tabCount = 0; try { tabCount = listTabs().length; } catch { /* tmux down */ }
      return json(res, 200, { ok: true, backend: 'claude-cli', model: MODEL, tabs: tabCount, turns: turns.length });
    }
    // Global auth gate (ADR-044 finding 1): everything past /health requires the
    // bearer, including the Unmute LLM contract (/v1/chat/completions, /v1/models).
    if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
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
    if (path === '/sessions' && req.method === 'GET') {
      try {
        const r = await SESSION_CLIENT.call({ op: 'list' });
        return json(res, 200, { sessions: r.sessions, coordinator: COORDINATOR });
      } catch (err) {
        return json(res, 502, { error: 'session plane unreachable', detail: err.message });
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

// WebSocket-upgrade auth (ADR-044 finding 1). verifyClient rejects the `/feed`
// upgrade with 401 when the bearer is missing; browser clients pass it as
// `/feed?token=<TOKEN>` since they cannot set the Authorization header.
const wss = new WebSocketServer({
  server,
  path: '/feed',
  verifyClient: (info) => authorised(info.req),
});
function broadcast(evt) {
  const data = JSON.stringify(evt);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(data);
}
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', turns: turns.slice(-50) }));
});

server.listen(PORT, BIND, () => {
  console.log(`tab0-bridge listening on ${BIND}:${PORT} (backend=claude-cli, model=${MODEL}, session=${TMUX_SESSION}, auth=${TOKEN ? 'token' : 'open'}, nip98=${NostrBridge ? `enabled (${NIP98_ALLOWED.size} keys)` : 'off'}, sessions=unix)`);
  // Resolve and pin the session-plane coordinator session id (ADR-044 D2). Fail-open: if
  // session-plane is not up yet, the injection seam falls back to tmux and the interval
  // below picks the id up once the daemon is running.
  resolveCoordinatorSession();
});

// Re-resolve while unpinned so the id is acquired if session-plane starts after the
// bridge; stops once pinned (a 404 in sessionSend re-resolves on demand).
const sessionResolveTimer = setInterval(() => { if (!coordinatorReady) resolveCoordinatorSession(); }, 30_000);
if (sessionResolveTimer.unref) sessionResolveTimer.unref();
