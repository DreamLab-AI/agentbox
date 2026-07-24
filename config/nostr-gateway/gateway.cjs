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
 *   4. De-dup by event id → a re-broadcast cannot re-fire.
 *   5. Sigil — only messages starting with '/' are commands; ordinary thread
 *      text (and our own replies, which never start with '/') are ignored.
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
 * Token model: /tabs and /peek are ZERO-token. /report and instruction-routing
 * each spend ONE bounded headless Sonnet call (Sonnet minimum — Haiku misreads
 * noisy pane scrollback). Idle cost is a WebSocket, nothing more.
 *
 * Observability model: reporting is READ-ONLY by construction — /tabs, /peek and
 * /report only ever capture-pane, never send keys, so a busy agent can be
 * interrogated without injecting into its prompt. Only an explicit instruction
 * (routed, or /tab // /say) ever sends keys, and the reply always shows the
 * target's pre-send state badge.
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
const MODEL = process.env.NOSTR_GATEWAY_MODEL || 'claude-sonnet-5'; // C2 reporter: Sonnet minimum (operator requirement — Haiku misreads pane state)
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

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
  '                   picks the tab and sends it, asking only if unsure',
  '  /tab <n> <text>  force a specific tab (skips routing)',
  '  /say <text>      broadcast to every Claude tab',
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
function claudeWindows() { return allWindows().filter((p) => /claude|node/i.test(p[2] || '')); }
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
  const rumor = { kind: KIND_DM_RUMOR, created_at: nowSec(), tags: [['p', replyTo]], content: String(text).slice(0, MAX_BODY), pubkey: pub };
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
      const wins = claudeWindows();
      if (!wins.length) return reply(ws, 'no active Claude tabs');
      wins.forEach((p) => sendKeys(p[0], instr));
      const states = wins.map((p) => `  tab ${p[0]} ${STATE_BADGE[paneState(p[0])]}`).join('\n');
      return reply(ws, `✔ broadcast → tabs ${wins.map((p) => p[0]).join(',')}: "${instr}"\n${states}`);
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
  const flag = st === 'waiting' ? `🛑 tab was ⏸ WAITING on a dialog — text may have answered it; /peek ${idx} to check\n` : '';
  return reply(ws, `${flag}✔ tab ${idx} ${win[1]} ← "${clean}"  ${STATE_BADGE[st]}${why ? '\n↳ ' + String(why).slice(0, 120) : ''}`);
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
  const wins = claudeWindows();
  if (!wins.length) return reply(ws, '📋 no active Claude tabs to instruct');
  const blocks = wins.map(([idx, name]) => `### tab ${idx} — ${name} [${STATE_BADGE[paneState(idx)]}]\n${capture(idx, 40, 30)}`).join('\n\n');
  const prior = pendingRoute && (nowSec() - pendingRoute.at < CONFIRM_TTL) ? pendingRoute.instr : null;
  const prompt = [
    'You are the command-and-control dispatcher for a tmux fleet of Claude Code agents,',
    "relaying for an operator on their phone. Decide what to do with the operator's message.",
    'Return ONLY one JSON object — no prose, no markdown fences — in one of these shapes:',
    '{"action":"send","tab":<index>,"message":"<exact instruction to type into that tab>","why":"<short reason>"}',
    "  when one tab clearly owns this instruction. Put the operator's intent, faithfully, in \"message\".",
    '{"action":"clarify","ask":"<one short question naming the candidate tabs>"}',
    '  when it is genuinely ambiguous, no tab fits, or the best-match tab is ⏸ WAITING on a',
    '  permission dialog (typing would answer the dialog — never send blindly, ask first).',
    '{"action":"report","question":"<the operator\'s question>"}',
    '  when the message is really a QUESTION about the fleet, not an instruction to run.',
    prior ? `\nThe operator has an UNRESOLVED earlier instruction: "${prior}". Their new message may be the clarification — if so, resolve it and "send".` : '',
    '\nOPERATOR MESSAGE: ' + instr,
    '\nFLEET (one block per Claude tab: index, name, live state badge, recent scrollback):\n' + blocks,
  ].filter(Boolean).join('\n');
  reply(ws, '⏳ routing…');
  execFile(CLAUDE_BIN, ['-p', '--model', MODEL, prompt],
    { timeout: 90000, maxBuffer: 1 << 20, env: { ...process.env, AGENTBOX_LIVE_MIRROR: '0', AGENTBOX_NOSTR_GATEWAY: '0' } },
    (err, stdout) => {
      if (err) { log('route err', err.message); return reply(ws, '⚠ routing failed: ' + err.message.slice(0, 120)); }
      const d = parseDecision(stdout);
      if (!d || !d.action) { pendingRoute = { instr, at: nowSec() }; return reply(ws, "🤔 couldn't decide — rephrase, or force it with /tab <n> <text>"); }
      if (d.action === 'report') { pendingRoute = null; return doReport(ws, String(d.question || instr).trim()); }
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
function doReport(ws, arg) {
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
    const wins = claudeWindows();
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
  reply(ws, single ? `⏳ compiling deep report on tab ${single}…` : question ? '⏳ checking the fleet…' : '⏳ compiling fleet report…');
  execFile(CLAUDE_BIN, ['-p', '--model', MODEL, prompt],
    { timeout: 90000, maxBuffer: 1 << 20, env: { ...process.env, AGENTBOX_LIVE_MIRROR: '0', AGENTBOX_NOSTR_GATEWAY: '0' } },
    (err, stdout) => {
      if (err) { log('report err', err.message); return reply(ws, '⚠ report failed: ' + err.message.slice(0, 120)); }
      reply(ws, `📋 report${single ? ' · tab ' + single : ''}\n` + String(stdout).trim().slice(0, MAX_BODY));
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
function handleWrap(ws, wrap) {
  if (!wrap || wrap.kind !== KIND_GIFT_WRAP) return;
  if (!markSeen(wrap.id)) return;                                     // already handled
  let rumor; try { rumor = tools.nip59.unwrapEvent(wrap, sk); } catch { return; } // not ours to decrypt (e.g. signup DMs) — silent
  if (!rumor) return;
  if (String(rumor.pubkey || '').toLowerCase() !== commanderPub) return; // only the operator may command
  const text = String(rumor.content || '').trim();
  if (!text.startsWith('/')) return;                                 // no sigil → not a command (also skips our own replies)
  // Replay guard: gift-wrap timestamps are randomized, so freshness can't gate.
  // The initial query returns up to WRAP_LOOKBACK of history; those pre-EOSE
  // wraps are marked seen but NOT executed, so a restart never replays days of
  // commands. Only commands arriving after the first EOSE (genuinely new) run.
  if (!armed) { log('backlog cmd skipped:', text.slice(0, 40)); return; }
  audit(text);
  dispatch(ws, text);
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
