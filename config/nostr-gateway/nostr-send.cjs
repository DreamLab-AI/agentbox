#!/usr/bin/env node
'use strict';
/**
 * nostr-send — deliberate one-shot DM to the operator's phone.
 *
 *   node nostr-send.cjs "text to send"
 *   echo "text" | node nostr-send.cjs
 *
 * Gift-wraps (NIP-59) a self-DM on the mirror child key and publishes it to the
 * cloud relay on a short-lived connection, then exits. This is the crisp,
 * on-purpose counterpart to the per-turn live mirror: an agent in any tmux tab
 * can call it to push a targeted status line to Amethyst. Same child-key
 * derivation and relay as the gateway; no new deps; fail-open (exit 0).
 */
const crypto = require('crypto');
const path = require('path');

const DEFAULT_RELAY = 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';
const KIND_DM_RUMOR = 14;
const KIND_AUTH = 22242;
const AB = path.resolve(__dirname, '..', '..');
const nowSec = () => Math.floor(Date.now() / 1000);
const req = (c) => { for (const p of c) { try { return require(p); } catch { /* next */ } } return null; };
const tools = req([path.join(AB, 'management-api', 'node_modules', 'nostr-tools'), path.join(AB, 'mcp', 'node_modules', 'nostr-tools'), 'nostr-tools']);
const WS = req([path.join(AB, 'management-api', 'node_modules', 'ws'), path.join(AB, 'mcp', 'node_modules', 'ws'), 'ws']);
if (!tools || !WS) process.exit(0);

const envFirst = (...ks) => { for (const k of ks) { const v = process.env[k]; if (v && String(v).trim()) return String(v).trim(); } return ''; };
// Same identity selection as the gateway: default to the whitelisted operator/
// admin key so replies reach the recipient the relay accepts (and your phone reads).
function loadIdentity() {
  const hex = envFirst('AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY');
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const mode = (envFirst('AGENTBOX_GATEWAY_IDENTITY') || 'operator').toLowerCase();
  try {
    if (mode === 'child') {
      const tag = envFirst('AGENTBOX_MIRROR_KEY_TAG') || 'agentbox-mirror-v1';
      return Uint8Array.from(crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(tag).digest());
    }
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  } catch { return null; }
}
const sk = loadIdentity();
if (!sk) process.exit(0);
const pub = tools.getPublicKey(sk);
const relay = /^wss?:\/\//i.test(process.env.NOSTR_MIRROR_RELAY || '') ? process.env.NOSTR_MIRROR_RELAY.trim() : DEFAULT_RELAY;

function readInput() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) return Promise.resolve(arg);
  return new Promise((res) => { let b = ''; process.stdin.on('data', (d) => (b += d)); process.stdin.on('end', () => res(b.trim())); setTimeout(() => res(b.trim()), 2000); });
}

(async () => {
  const text = (await readInput()) || '(empty)';
  const rumor = { kind: KIND_DM_RUMOR, created_at: nowSec(), tags: [['p', pub]], content: text.slice(0, 3500), pubkey: pub };
  const wrap = tools.nip59.wrapEvent(rumor, sk, pub);
  const ws = new WS(relay);
  const done = (code) => { try { ws.close(); } catch { /* noop */ } process.exit(code); };
  const timer = setTimeout(() => done(0), 8000);
  ws.on('open', () => ws.send(JSON.stringify(['EVENT', wrap])));
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(typeof d === 'string' ? d : d.toString('utf8')); } catch { return; }
    if (m[0] === 'AUTH') { try { const e = tools.finalizeEvent({ kind: KIND_AUTH, created_at: nowSec(), tags: [['relay', relay], ['challenge', String(m[1])]], content: '' }, sk); ws.send(JSON.stringify(['AUTH', e])); ws.send(JSON.stringify(['EVENT', wrap])); } catch { /* noop */ } }
    if (m[0] === 'OK' && m[1] === wrap.id) { clearTimeout(timer); process.stdout.write(m[2] ? 'sent\n' : ('rejected: ' + (m[3] || '') + '\n')); done(m[2] ? 0 : 1); }
  });
  ws.on('error', () => done(0));
})();
