#!/usr/bin/env node
'use strict';
/**
 * Nostr control gateway — the INBOUND half of the agentbox session mirror.
 *
 * The live mirror (config/hooks/nostr-live-mirror.cjs) is one-way: agentbox →
 * NIP-59 gift-wrapped self-DM → cloud relay → Amethyst. This daemon closes the
 * loop the other way: it AUTHenticates to the same relay as the SAME derived
 * mirror child key, subscribes for gift wraps addressed to that key, unwraps
 * them, and — only if the sealed sender is the child key itself (i.e. the
 * operator typing in their own mirror thread from Amethyst) — executes the
 * command against the local tmux fleet and DMs a reply back.
 *
 * Security model (all gates must pass, in order):
 *   1. Relay AUTH (NIP-42) as child key — the relay only serves kind-1059
 *      p-tagged to a reader that has AUTH'd as that pubkey.
 *   2. Sealed-sender == child pubkey — the ONLY authorised commander. Anything
 *      else is dropped. This is the RCE gate: injecting into a tmux Claude tab
 *      means "an agent will now do what the message says", so nothing but the
 *      operator's own key may drive it.
 *   3. Arm-after-EOSE — only wraps arriving after the first EOSE run, so a
 *      cold boot never replays the (timestamp-randomized) gift-wrap backlog.
 *   4. De-dup by event id — in-memory for this run, PLUS a durable
 *      executed-command store (nostr-inbox/executed.json): a wrap id that has
 *      ever executed can never re-fire, across restarts AND relay re-serves.
 *      Memory alone is not enough — the 15s keep-warm re-REQ re-fetches the
 *      whole lookback window and the in-memory set FIFO-evicts, so a
 *      long-running armed process saw days-old commands come back as "new"
 *      (verified replay burst 2026-07-28, commands.jsonl).
 *   5. Freshness — the INNER rumor's created_at is real time (NIP-59
 *      randomizes only the outer wrap/seal), so a command whose rumor is older
 *      than CMD_FRESH_WINDOW never executes, only logs. This is the
 *      authoritative replay gate: whatever the relay re-serves, history is
 *      stale by construction. Gates 3–4 are noise/token savers on top.
 *   6. Grammar + provenance — '/' selects an explicit fleet-control command;
 *      ordinary operator text is chat routed only to tab 0. Every Agentbox
 *      egress message carries a client tag and is ignored on re-ingress, so
 *      mirrored replies cannot feed themselves back into the agent.
 *
 * Control model: the operator talks naturally, prefixed with '/'. Read verbs
 * (/tabs, /report, /peek) are fast deterministic capture-pane reads. Anything
 * else is a free-form INSTRUCTION: a bounded Sonnet C2 call reads the fleet
 * (tab list + live state + scrollback) and decides which tab it is for, then
 * sends it — asking a clarifying question only when it is genuinely unsure or
 * the target is mid-dialog. No /confirm gate: instructions execute immediately
 * and the reply echoes exactly what was typed where, so the operator course-
 * corrects after the fact instead of pre-confirming every line.
 *
 * Lifecycle model: the C2 owns the whole session lifecycle, not just routing.
 * It can SPAWN a new agent tab anywhere under ~/workspace (tmux new-window at
 * that cwd, then a launcher typed into the fish shell: `dsp` → claude
 * --dangerously-skip-permissions (default), or `codex` / `zai`, optionally
 * sending a first instruction once the prompt is up) and EXIT a tab's session
 * (types its exit verb — /exit, /quit for codex — at the prompt; the window
 * and shell stay for reuse). Spawn targets are confined to the ~/workspace
 * subtree — realpath-checked, so symlinks cannot escape it.
 *
 * Token model: /tabs and /peek are ZERO-token. /report and instruction-routing
 * each spend ONE bounded headless Sonnet call (Sonnet minimum — Haiku misreads
 * noisy pane scrollback). Idle cost is a WebSocket, nothing more.
 *
 * Observability model: reporting is READ-ONLY by construction — /tabs, /peek and
 * /report only ever capture-pane, never send keys, so a busy agent can be
 * interrogated without injecting into its prompt. Only an explicit instruction
 * (routed, or /tab // /say) ever sends keys, and the reply always shows the
 * target's pre-send state badge. Sends are no longer fire-and-forget: each
 * instructed tab gets a watcher that polls its pane until the agent settles
 * (idle again, or stopped on a dialog), then DMs ONE automatic deep report —
 * the result flows back without the operator having to /report. Broadcasts
 * (/say) are exempt — N simultaneous reports would drown the thread.
 *
 * Reuses the mirror's child-key derivation and the vendored nostr-tools/ws in
 * management-api/node_modules — no new dependencies. Fail-open throughout: any
 * unmet precondition exits 0 so it is never a hard dependency of the box.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

// ── constants (mirror parity) ───────────────────────────────────────────────
const DEFAULT_RELAY = 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';
const KIND_GIFT_WRAP = 1059;
const KIND_DM_RUMOR = 14;
const KIND_AUTH = 22242;   // NIP-42
const MAX_BODY = 3500;
const WRAP_LOOKBACK = 50 * 3600; // NIP-59 randomizes gift-wrap timestamps up to ~48h into the PAST; query wider or the relay filters them out
const CONFIRM_TTL = 300;   // an unresolved clarification / pending route expires after 5 min
const HOME = os.homedir();
const INBOX = path.join(HOME, '.claude', 'nostr-inbox');
const LOCK = path.join(INBOX, 'gateway.lock');
const AUDIT = path.join(INBOX, 'commands.jsonl');
const CMD_FRESH_WINDOW = 600; // max age (s) of a command's inner rumor — older never executes (replay gate)
const EXEC_FILE = path.join(INBOX, 'executed.json'); // durable wrap-id store of executed commands
// C2 model: Sonnet is the FLOOR (operator requirement — Haiku misreads noisy
// pane scrollback). The env var may raise it, never lower it below Sonnet.
const MODEL_RAW = process.env.NOSTR_GATEWAY_MODEL || 'claude-sonnet-5';
const MODEL = /haiku/i.test(MODEL_RAW) ? 'claude-sonnet-5' : MODEL_RAW;
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// The tab-0 bridge is the common ingress/feed for voice, browser text, and
// Nostr.  Keeping it local means Nostr adds no exposed HTTP surface.
const TAB0_BRIDGE_URL = (process.env.AGENTBOX_TAB0_BRIDGE_URL || 'http://127.0.0.1:8971').replace(/\/$/, '');
// Agent of Empires interaction plane (ADR-042/ADR-044 D5). /spawn creates a
// managed AoE session (status FSM, optional worktree, serialised send) instead
// of a raw tmux window, falling open to tmux new-window when the daemon is
// down. The plain-chat path already rides the tab-0 bridge /tab0/send seam,
// which is itself repointed onto AoE — so it inherits D1–D3 for free. The daemon
// now runs `--auth token` (N-05: loopback is no longer the boundary), so this
// direct :9095 route authenticates with the daemon's shared-secret token, read
// from aoe's own state file (serve.url) — the same token the nip98-proxy injects.
// A co-resident process that cannot read the token file can no longer drive the
// daemon even though the port is loopback-reachable.
const AOE_PORT = Number(process.env.AGENTBOX_INTERACTION_PLANE_PORT || 9095);
const AOE_BASE = `http://127.0.0.1:${AOE_PORT}`;
// DUPLICATED VERBATIM (modulo the fs accessor) in 4 runtime consumers of :9095 —
// no shared-lib path spans all four deploy locations. KEEP IN SYNC:
//   config/nip98-proxy/proxy.mjs · config/nostr-gateway/gateway.cjs
//   config/tab0-bridge/server.mjs · scripts/aoe-seed-sessions.mjs
// Read-then-stat with a single retry on mtime skew (guards a torn read while the
// daemon rewrites the file on restart); a transient stat/read error keeps the
// last-good cache (NEVER caches null on error). Callers MUST fail closed on null.
const AOE_TOKEN_FILE = process.env.AGENTBOX_AOE_TOKEN_FILE
  || path.join(HOME, '.config', 'agent-of-empires', 'serve.url');
let _aoeTokenCache = { mtimeMs: -1, token: null, valid: false };
function readAoeToken() {
  for (let attempt = 0; attempt < 2; attempt++) {
    let stBefore;
    try { stBefore = fs.statSync(AOE_TOKEN_FILE); }
    catch { return _aoeTokenCache.valid ? _aoeTokenCache.token : null; }
    if (_aoeTokenCache.valid && stBefore.mtimeMs === _aoeTokenCache.mtimeMs) return _aoeTokenCache.token;
    let raw, stAfter;
    try {
      raw = fs.readFileSync(AOE_TOKEN_FILE, 'utf-8');
      stAfter = fs.statSync(AOE_TOKEN_FILE);
    } catch { return _aoeTokenCache.valid ? _aoeTokenCache.token : null; }
    if (stBefore.mtimeMs !== stAfter.mtimeMs) continue; // file changed under us → retry once
    const m = /[?&]token=([0-9a-fA-F]{64})(?:[&#\s]|$)/.exec(raw); // aoe mints a 32-byte (64-hex) token
    const token = m ? m[1] : null;
    _aoeTokenCache = { mtimeMs: stAfter.mtimeMs, token, valid: true };
    return token;
  }
  return _aoeTokenCache.valid ? _aoeTokenCache.token : null;
}
const AOE_ENABLED = String(process.env.AGENTBOX_INTERACTION_PLANE || '').trim() !== '0';
const AOE_TIMEOUT_MS = 12000; // create with ?wait=ready blocks until status leaves Starting (~10s)

function log(...a) { try { process.stdout.write(`[gw ${new Date().toISOString()}] ${a.join(' ')}\n`); } catch { /* noop */ } }
function nowSec() { return Math.floor(Date.now() / 1000); }

// ── off switch ──────────────────────────────────────────────────────────────
if (String(process.env.AGENTBOX_NOSTR_GATEWAY || '').trim() === '0') { log('disabled (AGENTBOX_NOSTR_GATEWAY=0)'); process.exit(0); }

// ── dependency + key load (fail-open) ───────────────────────────────────────
const AB = path.resolve(__dirname, '..', '..');
function req(cands) { for (const c of cands) { try { return require(c); } catch { /* next */ } } return null; }
const tools = req([path.join(AB, 'management-api', 'node_modules', 'nostr-tools'), path.join(AB, 'mcp', 'node_modules', 'nostr-tools'), 'nostr-tools']);
const WS = req([path.join(AB, 'management-api', 'node_modules', 'ws'), path.join(AB, 'mcp', 'node_modules', 'ws'), 'ws']);
if (!tools || !WS) { log('nostr-tools/ws unavailable — exiting'); process.exit(0); }

function envFirst(...ks) { for (const k of ks) { const v = process.env[k]; if (v && String(v).trim()) return String(v).trim(); } return ''; }
// Control identity. Default 'operator': the daemon reads/sends as the operator
// (admin) key, so the control channel is the SAME self-DM thread you already
// read in Amethyst — no new contact. The relay fans out admin-addressed wraps to
// every AUTH'd admin subscriber, so the phone and the daemon both receive.
// 'gateway' mode is available (own whitelisted derived key, tag
// 'agentbox-gateway-v1') if you ever want a dedicated bot contact instead.
// In both modes the sole authorised commander is the operator, and replies go to
// the operator (your phone).
const OP_HEX = envFirst('AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY');
if (!/^[0-9a-f]{64}$/i.test(OP_HEX)) { log('no operator key (AGENTBOX_PRIVKEY_HEX) — exiting'); process.exit(0); }
const rawSk = Uint8Array.from(Buffer.from(OP_HEX, 'hex'));
const adminPub = tools.getPublicKey(rawSk).toLowerCase();
const IDENTITY = (envFirst('AGENTBOX_GATEWAY_IDENTITY') || 'operator').toLowerCase();
const sk = IDENTITY === 'gateway'
  ? Uint8Array.from(crypto.createHmac('sha256', Buffer.from(OP_HEX, 'hex')).update(envFirst('AGENTBOX_GATEWAY_KEY_TAG') || 'agentbox-gateway-v1').digest())
  : rawSk;
const pub = tools.getPublicKey(sk);                                    // identity we AUTH + receive as
const commanderPub = adminPub;                                          // only the operator may command
const replyTo = (envFirst('AGENTBOX_GATEWAY_REPLY_TO') || adminPub).toLowerCase(); // replies → your phone
const relayUrl = /^wss?:\/\//i.test(process.env.NOSTR_MIRROR_RELAY || '') ? process.env.NOSTR_MIRROR_RELAY.trim() : DEFAULT_RELAY;

// ── singleton lock (survives concurrent SessionStart nudges) ────────────────
fs.mkdirSync(INBOX, { recursive: true });
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function acquire() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    try { const old = parseInt(fs.readFileSync(LOCK, 'utf8'), 10); if (old && !alive(old)) { fs.writeFileSync(LOCK, String(process.pid)); return true; } } catch { /* noop */ }
    return false;
  }
}
if (!acquire()) { log('another gateway holds the lock — exiting'); process.exit(0); }
process.on('exit', () => { try { if (fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK); } catch { /* noop */ } });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));

// ── state ───────────────────────────────────────────────────────────────────
const seen = new Set(); const seenOrder = []; // FIFO-evicted dedupe of wrap ids
function markSeen(id) { if (!id || seen.has(id)) return false; seen.add(id); seenOrder.push(id); if (seenOrder.length > 20000) seen.delete(seenOrder.shift()); return true; }

// Durable replay guard: wrap ids of EXECUTED commands only (rare — mirror
// traffic never lands here), keyed to the rumor's real timestamp so the file
// self-prunes. Written BEFORE dispatch → at-most-once even across a crash.
let executed = { ids: {} };
try { const j = JSON.parse(fs.readFileSync(EXEC_FILE, 'utf8')); if (j && j.ids) executed = j; } catch { /* first run */ }
function recordExecuted(id, ts) {
  executed.ids[id] = ts;
  const cut = nowSec() - 7 * 86400;
  for (const k of Object.keys(executed.ids)) if (executed.ids[k] < cut) delete executed.ids[k];
  try { fs.writeFileSync(EXEC_FILE + '.tmp', JSON.stringify(executed)); fs.renameSync(EXEC_FILE + '.tmp', EXEC_FILE); } catch { /* fail-open */ }
}
let pendingRoute = null; // { instr, at } — an instruction the C2 asked the operator to clarify
let armed = false;       // true after the first EOSE — gates out the initial history batch
let coldBoot = true;     // cleared after the first arm; reconnects then stay armed (seen-set dedupes)

const HELP = [
  '🛰 agentbox C2 — prefix everything with /, then just talk',
  '',
  'ASK (read-only · never disturbs a tab):',
  '  /tabs            list the fleet (● busy · ⏸ waiting · ○ idle)',
  '  /report          one-line Sonnet summary per Claude tab',
  '  /report <n>      deep read-only report on tab n',
  '  /report <quest.> answer a question from the panes',
  '  /peek <n> [k]    raw last k lines of tab n (zero tokens)',
  '',
  'INSTRUCT (C2 routes it, executes immediately, echoes what it sent):',
  '  /<instruction>   e.g. "/run the tests on the website tab" — the agent',
  '                   picks the tab and sends it, asking only if unsure;',
  '                   a report DMs back automatically when the tab settles',
  '  /tab <n> <text>  force a specific tab (skips routing)',
  '  /say <text>      broadcast to every Claude tab',
  '',
  'LIFECYCLE (spawn/exit sessions — also routable, e.g. "/start claude in project2"):',
  '  /spawn <dir> [agent] [text]  new tab: cd ~/workspace/<dir>, launch agent',
  '                   (dsp=claude default · codex · zai), send text once booted',
  '  /exit <n>        end tab n\'s session (/exit — /quit for codex); shell stays',
  '  /help            this message',
].join('\n');

// ── shell helpers ───────────────────────────────────────────────────────────
function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000 }); } catch (e) { return String((e && e.stdout) || ''); } }
function stripAnsi(s) { return String(s).replace(/\[[0-9;?]*[a-zA-Z]/g, ''); }
function sanitize(s) { return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[`$\\]/g, '').trim().slice(0, 500); }

function allWindows() {
  const out = sh('tmux', ['list-windows', '-a', '-F', '#{window_index}\t#{window_name}\t#{pane_current_command}']);
  return out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
}
function agentWindows() { return allWindows().filter((p) => /claude|node|codex|zai/i.test(p[2] || '')); }
function capture(idx, scrollback = 45, keep = 40) {
  return stripAnsi(sh('tmux', ['capture-pane', '-p', '-t', String(idx), '-S', `-${scrollback}`])).split('\n').slice(-keep).join('\n');
}

// Deterministic pane-state heuristic (zero tokens): Claude Code shows
// "esc to interrupt" in its footer while streaming/working, and permission
// dialogs render "Do you want …" with numbered options. Everything else is
// treated as idle-at-prompt. Advisory only — it gates nothing, it informs.
function paneState(idx) {
  const tail = capture(idx, 20, 15);
  if (/esc to interrupt|Interrupting/i.test(tail)) return 'busy';
  if (/Do you want|❯\s*1\.|\(y\/n\)|waiting for (your|approval)/i.test(tail)) return 'waiting';
  return 'idle';
}
const STATE_BADGE = { busy: '● busy', waiting: '⏸ waiting on prompt', idle: '○ idle' };

function listTabs() {
  const lines = allWindows().map(([idx, name, cmd]) => {
    const base = `${idx}: ${name} [${cmd}]`;
    return /claude|node/i.test(cmd || '') ? `${base} ${STATE_BADGE[paneState(idx)]}` : base;
  });
  return '🖥 tabs\n' + (lines.join('\n') || '(none)');
}
function sendKeys(idx, text) { sh('tmux', ['send-keys', '-t', idx, '-l', text]); sh('tmux', ['send-keys', '-t', idx, 'Enter']); }

// ── crypto: reply on the live authed socket ─────────────────────────────────
function buildWrap(text) {
  const rumor = { kind: KIND_DM_RUMOR, created_at: nowSec(), tags: [['p', replyTo], ['client', 'agentbox-nostr-gateway']], content: String(text).slice(0, MAX_BODY), pubkey: pub };
  return tools.nip59.wrapEvent(rumor, sk, replyTo); // gateway → operator (your phone)
}
function reply(ws, text) { try { ws.send(JSON.stringify(['EVENT', buildWrap(text)])); log('reply:', text.slice(0, 60).replace(/\n/g, ' ⏎ ')); } catch (e) { log('reply failed', e.message); } }

function audit(cmd) { try { fs.appendFileSync(AUDIT, JSON.stringify({ ts: nowSec(), cmd }) + '\n'); } catch { /* noop */ } }

// ── command dispatch (deterministic; only /report spends tokens) ────────────
function dispatch(ws, text) {
  const body = text.slice(1);
  const verb = (body.split(/\s+/)[0] || '').toLowerCase();
  const after = body.replace(/^\S+\s*/, '');
  log('cmd:', verb);
  try {
    if (verb === '' || verb === 'help') return reply(ws, HELP);
    if (verb === 'tabs') return reply(ws, listTabs());
    if (verb === 'report') return doReport(ws, after.trim());
    if (verb === 'peek') {
      const [idx, kRaw] = after.split(/\s+/);
      if (!/^\d+$/.test(idx || '')) return reply(ws, 'usage: /peek <n> [lines]');
      const k = Math.min(Math.max(parseInt(kRaw, 10) || 20, 5), 60);
      const tail = capture(idx, k + 5, k).trim() || '(pane empty)';
      return reply(ws, `👁 tab ${idx} · last ${k} lines · ${STATE_BADGE[paneState(idx)]}\n${tail}`.slice(0, MAX_BODY));
    }
    if (verb === 'tab') {
      // Explicit override: operator names the tab, so skip routing and send now.
      const idx = (after.split(/\s+/)[0] || '');
      const instr = after.replace(/^\S+\s*/, '');
      if (!/^\d+$/.test(idx) || !instr.trim()) return reply(ws, 'usage: /tab <n> <instruction>');
      return doSend(ws, idx, instr, 'explicit /tab');
    }
    if (verb === 'say') {
      // Broadcast to every Claude tab, immediately (no confirm).
      const instr = sanitize(after);
      if (!instr) return reply(ws, 'usage: /say <text>');
      const wins = agentWindows();
      if (!wins.length) return reply(ws, 'no active Claude tabs');
      wins.forEach((p) => sendKeys(p[0], instr));
      const states = wins.map((p) => `  tab ${p[0]} ${STATE_BADGE[paneState(p[0])]}`).join('\n');
      return reply(ws, `✔ broadcast → tabs ${wins.map((p) => p[0]).join(',')}: "${instr}"\n${states}`);
    }
    if (verb === 'spawn' || verb === 'cd') {
      // /spawn <dir> [agent] [instruction] — agent word optional, defaults dsp.
      const parts = after.split(/\s+/);
      const dir = parts[0] || '';
      // Operators use /spawn conversationally ("/spawn report on thermals…").
      // If the first word isn't a real workspace dir, this wasn't the strict
      // form — give the whole message to the C2 router instead of erroring.
      if (dir && resolveWorkspaceDir(dir).err) return routeInstruction(ws, body.trim());
      let rest = after.replace(/^\S+\s*/, '');
      let agentName = 'dsp';
      const maybe = (rest.split(/\s+/)[0] || '').toLowerCase();
      if (AGENTS[maybe]) { agentName = maybe; rest = rest.replace(/^\S+\s*/, ''); }
      return doSpawn(ws, dir, agentName, rest, `explicit /${verb}`);
    }
    if (verb === 'exit' || verb === 'quit') {
      const idx = (after.split(/\s+/)[0] || '');
      if (!/^\d+$/.test(idx)) return reply(ws, 'usage: /exit <n>');
      return doExit(ws, idx, 'explicit /exit');
    }
    // Anything else after '/' is a free-form instruction → the C2 agent routes it.
    return routeInstruction(ws, body.trim());
  } catch (e) { log('dispatch error', e.message); reply(ws, '⚠ ' + e.message.slice(0, 120)); }
}

// Send keys to one tab immediately and echo exactly what was typed + the tab's
// pre-send state, so the operator can course-correct with a follow-up (this
// transparency-after is what replaces the old /confirm gate). A tab that was
// ⏸ waiting on a permission dialog is flagged loudly — the routed path avoids
// those by clarifying first; an explicit /tab respects the operator's choice.
function doSend(ws, idx, msg, why) {
  const win = allWindows().find((w) => w[0] === String(idx));
  if (!win) return reply(ws, `no tab ${idx}`);
  const clean = sanitize(msg);
  if (!clean) return reply(ws, 'nothing to send');
  const st = paneState(idx);
  sendKeys(idx, clean);
  watchTab(idx);
  const flag = st === 'waiting' ? `🛑 tab was ⏸ WAITING on a dialog — text may have answered it; /peek ${idx} to check\n` : '';
  return reply(ws, `${flag}✔ tab ${idx} ${win[1]} ← "${clean}"  ${STATE_BADGE[st]}${why ? '\n↳ ' + String(why).slice(0, 120) : ''}`);
}

// Ordinary operator Nostr text is chat with the main agent, not a fleet
// command.  Route it through the same bridge used by the voice console so it
// is visible in the shared transcript.  Slash-prefixed text remains the
// explicit fleet-control protocol above.
async function chatTab0(ws, msg) {
  const clean = sanitize(msg);
  if (!clean) return reply(ws, 'nothing to send');
  const st = paneState('0');
  try {
    const response = await fetch(`${TAB0_BRIDGE_URL}/tab0/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: clean, source: 'nostr' }),
    });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    watchTab('0');
    reply(ws, `💬 tab 0 ← "${clean}"  ${STATE_BADGE[st]}`);
  } catch (e) {
    // Keep the control plane useful during a bridge restart; the fallback does
    // not mirror the input in the browser feed, but still reaches tab 0.
    log('tab-0 bridge unavailable:', e.message);
    doSend(ws, '0', clean, 'Nostr chat (bridge unavailable)');
  }
}

// ── auto-report: close the loop on fire-and-forget sends ────────────────────
// After an instruction lands in a tab, poll that pane until the agent settles
// — back to idle, or stopped on a permission dialog — then DM ONE automatic
// deep report. One watcher per tab; a newer instruction replaces the watch.
// Phases: settling (≤90s for the agent to visibly start; a fast answer that
// never trips the busy heuristic still reports at the 90s mark) → running →
// settled. A 45-min cap ends marathon watches with a still-running report.
// Replies use the module-global `ws` at fire time, so a socket reconnect
// between send and settle cannot strand the report on a dead connection.
const watchers = new Map(); // tab idx → interval handle
function watchTab(idx) {
  const key = String(idx);
  if (watchers.has(key)) clearInterval(watchers.get(key));
  const started = nowSec();
  let sawBusy = false;
  const iv = setInterval(() => {
    const stop = () => { clearInterval(iv); watchers.delete(key); };
    let st; try { st = paneState(key); } catch { st = 'idle'; }
    if (st === 'busy') {
      sawBusy = true;
      if (nowSec() - started > 2700) { stop(); doReport(ws, key, 'still running after 45 min — watch ended'); }
      return;
    }
    if (!sawBusy && nowSec() - started < 90) return; // agent hasn't started yet
    stop();
    doReport(ws, key, st === 'waiting' ? '⏸ stopped on a dialog' : 'settled');
  }, 5000);
  watchers.set(key, iv);
}

// ── lifecycle: spawn / exit agent sessions ──────────────────────────────────
// Launchers the C2 may start in a fresh tab. 'dsp' is the fish alias for
// claude --dangerously-skip-permissions; codex and zai are their own CLIs.
// exit is what to type at the agent's prompt to end its session; match tells
// us (via pane_current_command) which exit verb a running tab needs.
// aoeTool maps the launcher onto AoE's tool enum for POST /api/sessions: dsp/zai
// are the `claude` binary (zai is redirected via env, still tool=claude), codex
// is native. Used when /spawn creates an AoE session instead of a tmux window.
const AGENTS = {
  dsp:    { launch: 'dsp',   exit: '/exit', aoeTool: 'claude' },
  claude: { launch: 'dsp',   exit: '/exit', aoeTool: 'claude' },
  codex:  { launch: 'codex', exit: '/quit', aoeTool: 'codex' },
  zai:    { launch: 'zai',   exit: '/exit', aoeTool: 'claude' },
};

// ── AoE interaction-plane client (fail-open) ────────────────────────────────
async function aoeRequest(method, pathname, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AOE_TIMEOUT_MS);
  try {
    const tok = readAoeToken();
    if (!tok) throw new Error('AoE token unavailable (N-05 fail-closed) — not sending unauthenticated request');
    const headers = { authorization: `Bearer ${tok}` };
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(`${AOE_BASE}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    return { status: res.status, json, text };
  } finally { clearTimeout(timer); }
}
// Create an AoE session at `repoPath` running `tool`, blocking until it leaves
// Starting. Throws on non-2xx / transport failure → caller falls back to tmux.
async function aoeCreateSession(repoPath, tool, title) {
  const r = await aoeRequest('POST', '/api/sessions?wait=ready', { path: repoPath, tool, title });
  if (r.status !== 200 && r.status !== 201) throw new Error(`aoe create ${r.status}: ${String(r.text).slice(0, 120)}`);
  const id = r.json && (r.json.id || r.json.session_id);
  if (!id) throw new Error('aoe create returned no session id');
  return { id: String(id), status: (r.json && r.json.status) || 'Starting' };
}
async function aoeSendSession(id, message) {
  const r = await aoeRequest('POST', `/api/sessions/${encodeURIComponent(id)}/send`, { message });
  return r.status === 200;
}
const WORKSPACE = path.join(HOME, 'workspace');

function workspaceDirs() {
  try {
    return fs.readdirSync(WORKSPACE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort().join(', ');
  } catch { return '(unreadable)'; }
}

// Resolve an operator-supplied path to a real directory strictly inside
// ~/workspace — the C2 may cd anywhere in the workspace subtree, nowhere else.
function resolveWorkspaceDir(spec) {
  const raw = String(spec || '').trim().replace(/^~\/?(workspace\/?)?/, '').replace(/^workspace(\/|$)/, '');
  const abs = path.resolve(WORKSPACE, raw || '.');
  let real; try { real = fs.realpathSync(abs); } catch { return { err: `no such directory under ~/workspace: ${raw || '.'}` }; }
  if (real !== WORKSPACE && !real.startsWith(WORKSPACE + path.sep)) return { err: `outside ~/workspace: ${raw}` };
  try { if (!fs.statSync(real).isDirectory()) return { err: `not a directory: ${raw}` }; } catch { return { err: `unreadable: ${raw}` }; }
  return { dir: real, rel: '~/' + path.relative(HOME, real) };
}

// New tmux window at cwd → type the launcher → (optionally) send the first
// instruction once the agent reaches a prompt. Boot detection is generic:
// pane_current_command has left the shell and the pane looks idle.
async function doSpawn(ws, dirSpec, agentName, instr, why) {
  const agent = AGENTS[(agentName || 'dsp').toLowerCase()];
  if (!agent) return reply(ws, `unknown agent "${agentName}" — one of: ${Object.keys(AGENTS).join(', ')}`);
  const r = resolveWorkspaceDir(dirSpec);
  if (r.err) return reply(ws, `⚠ ${r.err}\ntop-level dirs: ${workspaceDirs()}`);
  const name = path.basename(r.dir);
  const follow = sanitize(instr);
  // Prefer the AoE interaction plane — a managed session with a status FSM and
  // serialised send replaces the hand-rolled "poll the pane until it boots"
  // loop. Fail open to a raw tmux window if the daemon is unreachable so a spawn
  // is never dropped (ADR-044 D5). The whitelist/replay gates upstream in
  // handleWrap and the ~/workspace realpath confinement are unchanged.
  if (AOE_ENABLED) {
    try {
      const sess = await aoeCreateSession(r.dir, agent.aoeTool, name);
      const short = sess.id.slice(0, 8);
      reply(ws, `🚀 aoe ${short} · ${name} · ${r.rel} · ${agent.aoeTool} · ${sess.status}${follow ? `\n⏳ sending "${follow}"` : ''}${why ? '\n↳ ' + String(why).slice(0, 120) : ''}`);
      if (follow) {
        let sent = false;
        try { sent = await aoeSendSession(sess.id, follow); } catch (e) { log('aoe follow-up send failed', e.message); }
        reply(ws, sent ? `✔ aoe ${short} ← "${follow}"` : `⚠ aoe ${short} is up but the follow-up send failed — check the dashboard`);
      }
      return;
    } catch (e) {
      log('aoe spawn failed, falling back to tmux new-window:', e.message);
    }
  }
  return doSpawnTmux(ws, r, agent, name, follow, why);
}

// Legacy fail-open path: new tmux window at cwd → type the launcher → send the
// first instruction once the agent reaches a prompt. Boot detection is generic:
// pane_current_command has left the shell and the pane looks idle.
function doSpawnTmux(ws, r, agent, name, follow, why) {
  const idx = sh('tmux', ['new-window', '-d', '-P', '-F', '#{window_index}', '-c', r.dir, '-n', name]).trim();
  if (!/^\d+$/.test(idx)) return reply(ws, '⚠ tmux would not open a window');
  sendKeys(idx, agent.launch);
  reply(ws, `🚀 tab ${idx} ${name} · ${r.rel} · launching ${agent.launch}${follow ? `\n⏳ will send "${follow}" once it boots` : ''}${why ? '\n↳ ' + String(why).slice(0, 120) : ''}`);
  if (!follow) return;
  let polls = 0;
  const timer = setInterval(() => {
    polls += 1;
    const cmd = (allWindows().find((w) => w[0] === idx) || [])[2] || '';
    if (polls >= 2 && cmd && !/fish|bash|sh$/i.test(cmd) && paneState(idx) === 'idle') {
      clearInterval(timer); sendKeys(idx, follow); watchTab(idx); reply(ws, `✔ tab ${idx} ← "${follow}"`);
    } else if (polls >= 20) {
      clearInterval(timer); reply(ws, `⚠ tab ${idx}: agent didn't reach a prompt in 60s — /peek ${idx}, then /tab ${idx} <text>`);
    }
  }, 3000);
}

// End a tab's agent session gracefully by typing its exit verb at the prompt.
// The tmux window (and its fish shell) stays open for a later /spawn. A ⏸ or
// ● tab is still sent the verb — the echo flags it so the operator can /peek.
function doExit(ws, idx, why) {
  const win = allWindows().find((w) => w[0] === String(idx));
  if (!win) return reply(ws, `no tab ${idx}`);
  if (!/claude|node|codex|zai/i.test(win[2] || '')) return reply(ws, `tab ${idx} ${win[1]} [${win[2]}] isn't running an agent`);
  const verb = /codex/i.test(win[2]) ? AGENTS.codex.exit : AGENTS.dsp.exit;
  const st = paneState(idx);
  sendKeys(idx, verb);
  const flag = st !== 'idle' ? `⚠ tab was ${STATE_BADGE[st]} — exit may queue or answer a dialog; /peek ${idx} to check\n` : '';
  return reply(ws, `${flag}👋 tab ${idx} ${win[1]} ← ${verb}${why ? '\n↳ ' + String(why).slice(0, 120) : ''}`);
}

// Pull the first {...} object out of a headless model reply (it may wrap the
// JSON in prose or fences despite instructions).
function parseDecision(stdout) {
  const m = String(stdout).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Free-form instruction → one bounded Sonnet call decides the target tab from
// live fleet state and either sends it, asks a clarifying question, or (if the
// message was really a question) hands off to the read-only report path.
function routeInstruction(ws, instr) {
  if (!instr) return reply(ws, HELP);
  const wins = agentWindows();
  const blocks = wins.length
    ? wins.map(([idx, name]) => `### tab ${idx} — ${name} [${STATE_BADGE[paneState(idx)]}]\n${capture(idx, 40, 30)}`).join('\n\n')
    : '(no agent tabs running — "spawn" is the only way to start one)';
  const prior = pendingRoute && (nowSec() - pendingRoute.at < CONFIRM_TTL) ? pendingRoute.instr : null;
  const prompt = [
    'You are the command-and-control dispatcher for a tmux fleet of coding agents (Claude Code,',
    "Codex, Z.AI), relaying for an operator on their phone. Decide what to do with the operator's message.",
    'Return ONLY one JSON object — no prose, no markdown fences — in one of these shapes:',
    '{"action":"send","tab":<index>,"message":"<exact instruction to type into that tab>","why":"<short reason>"}',
    "  when one tab clearly owns this instruction. Put the operator's intent, faithfully, in \"message\".",
    '{"action":"spawn","dir":"<path relative to ~/workspace>","agent":"dsp|codex|zai","message":"<optional first instruction>","why":"<short reason>"}',
    '  when the operator wants a NEW agent session somewhere in the workspace (cd there and start it).',
    '  Agent "dsp" is Claude Code — the default unless they name codex or zai. Pick the dir from the',
    '  WORKSPACE DIRS list; leave "message" empty if they gave no task yet.',
    '{"action":"exit","tab":<index>,"why":"<short reason>"}',
    '  when the operator wants to END the session in a tab (its exit verb is typed at its prompt).',
    '{"action":"clarify","ask":"<one short question naming the candidate tabs>"}',
    '  when it is genuinely ambiguous, no tab fits, or the best-match tab is ⏸ WAITING on a',
    '  permission dialog (typing would answer the dialog — never send blindly, ask first).',
    '{"action":"report","question":"<the operator\'s question>"}',
    '  when the message is really a QUESTION about the fleet, not an instruction to run.',
    prior ? `\nThe operator has an UNRESOLVED earlier instruction: "${prior}". Their new message may be the clarification — if so, resolve it and act.` : '',
    '\nOPERATOR MESSAGE: ' + instr,
    '\nWORKSPACE DIRS (valid spawn targets, relative to ~/workspace): ' + workspaceDirs(),
    '\nFLEET (one block per agent tab: index, name, live state badge, recent scrollback):\n' + blocks,
  ].filter(Boolean).join('\n');
  reply(ws, '⏳ routing…');
  execFile(CLAUDE_BIN, ['-p', '--model', MODEL, prompt],
    { timeout: 90000, maxBuffer: 1 << 20, env: { ...process.env, AGENTBOX_LIVE_MIRROR: '0', AGENTBOX_NOSTR_GATEWAY: '0' } },
    (err, stdout) => {
      if (err) { log('route err', err.message); return reply(ws, '⚠ routing failed: ' + err.message.slice(0, 120)); }
      const d = parseDecision(stdout);
      if (!d || !d.action) { pendingRoute = { instr, at: nowSec() }; return reply(ws, "🤔 couldn't decide — rephrase, or force it with /tab <n> <text>"); }
      if (d.action === 'report') { pendingRoute = null; return doReport(ws, String(d.question || instr).trim()); }
      if (d.action === 'spawn') { pendingRoute = null; return doSpawn(ws, String(d.dir || ''), String(d.agent || 'dsp'), d.message || '', d.why || 'routed'); }
      if (d.action === 'exit') {
        const idx = String(d.tab);
        if (!/^\d+$/.test(idx) || !wins.some((w) => w[0] === idx)) { pendingRoute = { instr, at: nowSec() }; return reply(ws, `🤔 tab ${idx} isn't in the fleet — reply /<tab> or /exit <n>`); }
        pendingRoute = null; return doExit(ws, idx, d.why || 'routed');
      }
      if (d.action === 'clarify') { pendingRoute = { instr, at: nowSec() }; return reply(ws, '❓ ' + String(d.ask || 'which tab?').slice(0, 300) + '\n(reply /<tab> or /<more detail>)'); }
      if (d.action === 'send') {
        const idx = String(d.tab);
        if (!/^\d+$/.test(idx) || !wins.some((w) => w[0] === idx)) { pendingRoute = { instr, at: nowSec() }; return reply(ws, `🤔 tab ${idx} isn't in the fleet — reply /<tab> or /tab <n> <text>`); }
        pendingRoute = null;
        return doSend(ws, idx, d.message || instr, d.why || 'routed');
      }
      pendingRoute = { instr, at: nowSec() };
      return reply(ws, '🤔 unclear — reply /<tab> or /tab <n> <text>');
    });
}

// /report            → fleet mode: one Sonnet line per Claude tab.
// /report <n>        → deep mode: ~220 lines of one tab's scrollback, summarised.
// /report <question> → answer the operator's question from fleet pane captures
//                      (the audit log shows this is how it gets used from the
//                      phone: "/report what are you working on").
// All are pure capture-pane reads — reporting NEVER sends keys to a tab, so
// the operator can interrogate a busy agent without disturbing it.
// The optional `auto` arg marks a watcher-fired report: the interim "⏳" is
// skipped (the operator didn't just ask for anything) and the result leads
// with 🔔 + why the watch ended, so unsolicited DMs are self-explaining.
function doReport(ws, arg, auto) {
  const single = /^\d+$/.test(arg || '') ? arg : null;
  const question = !single && (arg || '').trim() ? (arg || '').trim().slice(0, 300) : null;
  let prompt;
  if (single) {
    const scroll = capture(single, 250, 220).trim();
    if (!scroll) return reply(ws, `📋 tab ${single}: pane empty or not found`);
    prompt = 'You are an ops dispatcher reporting to the operator\'s phone. Below is the recent '
      + 'terminal scrollback of ONE Claude Code agent. Report in at most 8 short plain-text lines: '
      + '(1) what task it is working on, (2) the latest concrete thing it did or output, '
      + '(3) its state — WORKING / WAITING on a question or permission dialog (quote the question) / '
      + 'IDLE / ERRORED (quote the error), (4) anything the operator should act on. '
      + 'No preamble, no markdown.\n\n### tab ' + single + ` (${STATE_BADGE[paneState(single)]})\n` + scroll;
  } else {
    const wins = agentWindows();
    if (!wins.length) return reply(ws, '📋 no active Claude tabs');
    const blocks = wins.map(([idx, name]) => `### tab ${idx} (${name}) [${STATE_BADGE[paneState(idx)]}]\n${capture(idx, 60, 50)}`).join('\n\n');
    prompt = question
      ? 'You are an ops dispatcher reporting to the operator\'s phone. Answer the operator\'s question '
        + 'using ONLY the tmux pane captures below (one per Claude agent tab). Cite tabs by number. '
        + 'Plain text, max 10 short lines, no preamble, no markdown.\n\nQUESTION: ' + question + '\n\n' + blocks
      : 'You are a terse ops dispatcher. For each tmux tab below, output exactly ONE line: '
        + '"tab <n> <project>: <what it is doing / WAITING on X / idle>". The bracketed state badge is a '
        + 'deterministic hint — trust the scrollback over it if they disagree. No preamble, no markdown, max 16 words per line.\n\n' + blocks;
  }
  if (!auto) reply(ws, single ? `⏳ compiling deep report on tab ${single}…` : question ? '⏳ checking the fleet…' : '⏳ compiling fleet report…');
  execFile(CLAUDE_BIN, ['-p', '--model', MODEL, prompt],
    { timeout: 90000, maxBuffer: 1 << 20, env: { ...process.env, AGENTBOX_LIVE_MIRROR: '0', AGENTBOX_NOSTR_GATEWAY: '0' } },
    (err, stdout) => {
      if (err) { log('report err', err.message); return reply(ws, '⚠ report failed: ' + err.message.slice(0, 120)); }
      const head = auto ? `🔔 tab ${single} ${auto} — auto-report` : `📋 report${single ? ' · tab ' + single : ''}`;
      reply(ws, head + '\n' + String(stdout).trim().slice(0, MAX_BODY));
    });
}

// ── relay protocol ──────────────────────────────────────────────────────────
const SUB = 'ctrl';
function subscribe(ws, quiet) { ws.send(JSON.stringify(['REQ', SUB, { kinds: [KIND_GIFT_WRAP], '#p': [pub], since: nowSec() - WRAP_LOOKBACK }])); if (!quiet) log('REQ sent'); }
function authenticate(ws, challenge) {
  try {
    const evt = tools.finalizeEvent({ kind: KIND_AUTH, created_at: nowSec(), tags: [['relay', relayUrl], ['challenge', String(challenge)]], content: '' }, sk);
    ws.send(JSON.stringify(['AUTH', evt]));
    log('AUTH sent'); setTimeout(() => subscribe(ws), 200); // re-REQ after auth
  } catch (e) { log('AUTH failed', e.message); }
}
// ── website enquiry/signup notifications ────────────────────────────────────
// The dreamlab-ai.com signup + contact forms deliver NIP-17 wraps to the SAME
// admin inbox this gateway reads (src/lib/nostr.ts in the website repo). They
// arrive from ephemeral per-session keys, so the commander gate would silently
// drop them — the RADHWAN enquiry of 2026-08-17 sat unseen for 8 days. Detect
// them by payload shape and forward a summary DM to the operator's phone.
// Dedupe rides the durable executed store (7-day prune ≥ the relay's re-serve
// lookback), and unlike commands there is NO freshness gate: an enquiry that
// lands while the gateway is down must still notify on the next cold boot.
function notifyEnquiry(ws, wrap, rumor) {
  const text = String(rumor.content || '');
  const subject = (Array.isArray(rumor.tags) ? rumor.tags : []).find((t) => t[0] === 'subject')?.[1] || '';
  const isForm = /"type":\s*"contact_(signup|enquiry)"/.test(text) || /^DreamLab website/i.test(subject);
  if (!isForm) return false;
  if (executed.ids[wrap.id]) return true;                              // already notified
  recordExecuted(wrap.id, Number(rumor.created_at) || nowSec());
  let f = {}; try { f = JSON.parse(text.slice(text.indexOf('{'))); } catch { /* non-JSON body — raw fallback */ }
  if (f.source === 'ops_verification_probe' || f.test === true) return true; // ops probes: swallow silently
  const kind = f.type === 'contact_signup' ? 'signup' : 'enquiry';
  const when = new Date((Number(rumor.created_at) || nowSec()) * 1000).toISOString().slice(0, 16) + 'Z';
  const body = f.name || f.email
    ? `name: ${f.name || '—'}\nemail: ${f.email || '—'}`
      + (f.engagement_type ? `\ntype: ${f.engagement_type}` : '')
      + (f.message ? `\nmessage: ${String(f.message).slice(0, 500)}` : '')
    : text.slice(0, 500);
  log(`website ${kind} forwarded (${when})`);
  reply(ws, `🔔 website ${kind} · ${when}\n${body}`);
  return true;
}

function handleWrap(ws, wrap) {
  if (!wrap || wrap.kind !== KIND_GIFT_WRAP) return;
  if (!markSeen(wrap.id)) return;                                     // already handled
  let rumor; try { rumor = tools.nip59.unwrapEvent(wrap, sk); } catch { return; } // not ours to decrypt — silent
  if (!rumor) return;
  if (notifyEnquiry(ws, wrap, rumor)) return;                          // website form → phone, never a command
  if (String(rumor.pubkey || '').toLowerCase() !== commanderPub) return; // only the operator may command
  if (Array.isArray(rumor.tags) && rumor.tags.some((tag) => tag[0] === 'client' && /^agentbox-/.test(String(tag[1] || '')))) return;
  const text = String(rumor.content || '').trim();
  if (!text) return;
  // Replay guards, in order of authority (the relay re-serves stored history
  // on every keep-warm re-REQ, so "it arrived" never implies "it is new"):
  //   a. durable executed store — this exact wrap already ran, maybe in a
  //      previous process lifetime;
  //   b. rumor freshness — the OUTER wrap timestamp is randomized (NIP-59) but
  //      the INNER rumor carries real time, so replayed history is stale by
  //      construction and can never execute, however it reaches us;
  //   c. arm-after-EOSE — cold-boot backlog is skipped without spending a log
  //      line per event on gates a/b.
  if (!armed) { log('backlog message skipped:', text.slice(0, 40)); return; }
  if (executed.ids[wrap.id]) { log('replayed message skipped (already executed):', text.slice(0, 40)); return; }
  const age = nowSec() - Number(rumor.created_at || 0);
  if (age > CMD_FRESH_WINDOW) { log(`stale cmd skipped (age ${Math.round(age / 60)}m):`, text.slice(0, 40)); return; }
  recordExecuted(wrap.id, Number(rumor.created_at) || nowSec());
  audit(text);
  if (text.startsWith('/')) dispatch(ws, text);
  else void chatTab0(ws, text);
}
function onMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  const [t, ...rest] = m;
  if (process.env.GW_DEBUG) log('frame', t, JSON.stringify(rest).slice(0, 160));
  if (t === 'AUTH') return authenticate(ws, rest[0]);
  if (t === 'EVENT') return handleWrap(ws, rest[1]);
  if (t === 'CLOSED') { const r = rest[1] || ''; log('CLOSED', r); if (/auth/i.test(r)) { /* AUTH frame will follow */ } return; }
  if (t === 'EOSE') { if (!armed) { armed = true; coldBoot = false; log('armed — now live, backlog skipped'); } return; }
  if (t === 'OK' || t === 'NOTICE') return;
}

// ── connection with reconnect ───────────────────────────────────────────────
let ws;
function connect() {
  ws = new WS(relayUrl);
  // Only a cold boot skips the relay's stored batch (could be ~2 days of gift-wrap
  // history). A reconnect stays armed: the process-global `seen` set already dedupes
  // everything handled this run, so re-fetched history is ignored while a command
  // sent during the disconnect gap — not yet seen — is dispatched, not dropped.
  ws.on('open', () => { if (coldBoot) armed = false; log('connected', relayUrl); subscribe(ws); });
  ws.on('message', (d) => onMessage(ws, typeof d === 'string' ? d : d.toString('utf8')));
  ws.on('close', () => { log('closed; reconnect in 5s'); setTimeout(connect, 5000); });
  ws.on('error', (e) => { log('ws error', e.message); try { ws.close(); } catch { /* noop */ } });
}
// Keep the Cloudflare Durable Object warm. DOs hibernate on idle and can drop
// the in-memory subscription, so a live-pushed 1059 would never reach us
// (the relay serves no stored gift wraps on a later REQ). A periodic re-REQ is
// a Nostr-level message that both wakes the DO's message handler and re-arms the
// filter — unlike ws.ping(), a control frame the Hibernation API may swallow.
setInterval(() => { try { if (ws && ws.readyState === 1) { subscribe(ws, true); ws.ping(); } } catch { /* noop */ } }, 15000);
connect();
log(`gateway up · recv ${pub.slice(0, 12)}… · commander ${commanderPub.slice(0, 12)}… · reply→ ${replyTo.slice(0, 12)}… · relay ${relayUrl}`);
