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
 *   3. Freshness — |now - rumor.created_at| <= FRESH_WINDOW → no replay of an
 *      old command.
 *   4. De-dup by event id → a re-broadcast cannot re-fire.
 *   5. Sigil — only messages starting with '/' are commands; ordinary thread
 *      text is ignored.
 *   6. Two-step confirm — any WRITE into a worker tab (/tab, /say) is staged
 *      and only executes on a following /confirm.
 *
 * Token model: everything deterministic (auth/unwrap/dispatch/tmux) costs ZERO
 * model tokens. Only /report spends a single bounded headless Haiku call to
 * summarise pane captures. Idle cost is a WebSocket, nothing more.
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
const CONFIRM_TTL = 300;   // staged write expires after 5 min
const HOME = os.homedir();
const INBOX = path.join(HOME, '.claude', 'nostr-inbox');
const LOCK = path.join(INBOX, 'gateway.lock');
const AUDIT = path.join(INBOX, 'commands.jsonl');
const MODEL = process.env.NOSTR_GATEWAY_MODEL || 'claude-haiku-4-5-20251001';
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
let pending = null;      // staged write action
let armed = false;       // true after the first EOSE — gates out the initial history batch
let coldBoot = true;     // cleared after the first arm; reconnects then stay armed (seen-set dedupes)

const HELP = [
  '🛰 agentbox control gateway',
  '/tabs            list the tmux fleet',
  '/report          Haiku summary of what each Claude tab is doing',
  '/tab <n> <text>  send an instruction to tab n (needs /confirm)',
  '/say <text>      broadcast to all Claude tabs (needs /confirm)',
  '/confirm         execute the staged write',
  '/cancel          drop the staged write',
  '/help            this message',
].join('\n');

// ── shell helpers ───────────────────────────────────────────────────────────
function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000 }); } catch (e) { return String((e && e.stdout) || ''); } }
function stripAnsi(s) { return String(s).replace(/\[[0-9;?]*[a-zA-Z]/g, ''); }
function sanitize(s) { return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[`$\\]/g, '').trim().slice(0, 500); }

function listTabs() {
  const out = sh('tmux', ['list-windows', '-a', '-F', '#{window_index}: #{window_name} [#{pane_current_command}]']);
  return '🖥 tabs\n' + (out.trim() || '(none)');
}
function claudeWindows() {
  const out = sh('tmux', ['list-windows', '-a', '-F', '#{window_index}\t#{window_name}\t#{pane_current_command}']);
  return out.trim().split('\n').filter(Boolean).map((l) => l.split('\t')).filter((p) => /claude|node/i.test(p[2] || ''));
}
function capture(idx) { return stripAnsi(sh('tmux', ['capture-pane', '-p', '-t', idx, '-S', '-45'])).split('\n').slice(-40).join('\n'); }
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
    if (verb === 'report') return doReport(ws);
    if (verb === 'tab') {
      const idx = (after.split(/\s+/)[0] || '');
      const instr = sanitize(after.replace(/^\S+\s*/, ''));
      if (!/^\d+$/.test(idx) || !instr) return reply(ws, 'usage: /tab <n> <instruction>');
      pending = { type: 'tab', idx, text: instr, at: nowSec() };
      return reply(ws, `⚠ staged → tab ${idx}:\n"${instr}"\n\n/confirm to send · /cancel to drop`);
    }
    if (verb === 'say') {
      const instr = sanitize(after);
      if (!instr) return reply(ws, 'usage: /say <text>');
      const idxs = claudeWindows().map((p) => p[0]);
      pending = { type: 'say', idxs, text: instr, at: nowSec() };
      return reply(ws, `⚠ staged broadcast → tabs ${idxs.join(',')}:\n"${instr}"\n\n/confirm · /cancel`);
    }
    if (verb === 'confirm') return doConfirm(ws);
    if (verb === 'cancel') { pending = null; return reply(ws, '✖ cancelled'); }
    return reply(ws, `? unknown: /${verb}\n\n${HELP}`);
  } catch (e) { log('dispatch error', e.message); reply(ws, '⚠ ' + e.message.slice(0, 120)); }
}

function doConfirm(ws) {
  if (!pending) return reply(ws, 'nothing staged');
  if (nowSec() - pending.at > CONFIRM_TTL) { pending = null; return reply(ws, 'staged action expired — re-issue it'); }
  const p = pending; pending = null;
  if (p.type === 'tab') { sendKeys(p.idx, p.text); return reply(ws, `✔ sent → tab ${p.idx}`); }
  if (p.type === 'say') { p.idxs.forEach((i) => sendKeys(i, p.text)); return reply(ws, `✔ broadcast → tabs ${p.idxs.join(',')}`); }
}

function doReport(ws) {
  const wins = claudeWindows();
  if (!wins.length) return reply(ws, '📋 no active Claude tabs');
  const blocks = wins.map(([idx, name]) => `### tab ${idx} (${name})\n${capture(idx)}`).join('\n\n');
  const prompt = 'You are a terse ops dispatcher. For each tmux tab below, output exactly ONE line: '
    + '"tab <n> <project>: <what it is doing / BLOCKED on X / idle>". No preamble, no markdown, max 14 words per line.\n\n' + blocks;
  reply(ws, '⏳ compiling report…');
  execFile(CLAUDE_BIN, ['-p', '--model', MODEL, prompt],
    { timeout: 60000, maxBuffer: 1 << 20, env: { ...process.env, AGENTBOX_LIVE_MIRROR: '0', AGENTBOX_NOSTR_GATEWAY: '0' } },
    (err, stdout) => {
      if (err) { log('report err', err.message); return reply(ws, '⚠ report failed: ' + err.message.slice(0, 120)); }
      reply(ws, '📋 report\n' + String(stdout).trim().slice(0, MAX_BODY));
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
