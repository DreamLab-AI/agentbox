#!/usr/bin/env node
'use strict';

/**
 * Dispatch a management-api task NIP-98-signed by a demo agent's own identity
 * key (owner decision 2026-10-02: the rehearsal signs as demo-a / demo-b; no
 * scope change to POST /v1/tasks).
 *
 *   node scripts/sidechain/dispatch-as.js demo-a "summarise the brief" \
 *        [--agent coder] [--api http://127.0.0.1:9090] [--identity-dir DIR]
 *
 * Why this exists: GET /v1/tasks echoes `didNostr` as the DID the task was
 * dispatched as — the verified NIP-98 signer, else the container's DID. A task
 * sent with the operator Bearer therefore carries the container DID and
 * VisionClaw draws no payment edge for it. Signing as the demo agent is the
 * honest path: the edge exists because that agent's key authorised the task.
 *
 * Key handling:
 *   - reads <identity-dir>/agent-did-<profile>.key, written 0600 by
 *     scripts/sidechain/demo-accounts.js; refuses a missing, malformed or
 *     group/world-readable file and NEVER mints (a fresh key would be a
 *     fresh, unfunded identity, silently);
 *   - deliberately bypasses agent-identity.loadOrMint, whose
 *     AGENTBOX_AGENT_PRIVKEY_HEX override would sign as the container instead;
 *   - signs with NostrBridge.buildNip98Header (u, method, payload = sha256 of
 *     the exact body bytes sent) via nostr-tools finalizeEvent; the secret
 *     stays in this closure and is never printed.
 *
 * After dispatch it reads GET /v1/tasks/<id> and fails unless `didNostr`
 * equals the signer's DID, so a stale management-api image (pre-d35e89b82,
 * no didNostr) or a Bearer fallback is reported rather than passed off.
 * Output: one JSON line {profile, did, taskId, didNostr, attributed}.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const MA = path.join(REPO, 'management-api');
const { finalizeEvent, getPublicKey } = require(path.join(MA, 'node_modules', 'nostr-tools'));
const { NostrBridge } = require(path.join(REPO, 'mcp', 'servers', 'nostr-bridge.js'));

const HEX64 = /^[0-9a-f]{64}$/;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function defaultIdentityDir() {
  const ws = process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
  return path.join(ws, 'sidestr', 'agents', 'demo');
}

/**
 * Load a demo agent's identity key without ever minting one.
 * @returns {{profile:string, did:string, pubkey:string,
 *            nip98:(method:string, url:string, body?:Buffer)=>Promise<string>}}
 */
function loadDemoIdentity({ profile, identityDir = defaultIdentityDir() } = {}) {
  if (!PROFILE.test(String(profile || ''))) throw new Error(`invalid profile name: ${profile}`);
  const keyPath = path.join(identityDir, `agent-did-${profile}.key`);
  let st;
  try { st = fs.statSync(keyPath); } catch {
    throw new Error(`no identity key for ${profile} at ${keyPath}; run scripts/sidechain/demo-accounts.js first (this script never mints)`);
  }
  if ((st.mode & 0o077) !== 0) throw new Error(`${keyPath} must be mode 0600 (is ${(st.mode & 0o777).toString(8)})`);
  const hex = fs.readFileSync(keyPath, 'utf8').trim().toLowerCase();
  if (!HEX64.test(hex)) throw new Error(`${keyPath} is not a 64-hex secret key`);
  const pubkey = getPublicKey(Buffer.from(hex, 'hex'));
  const signer = {
    async sign(unsigned) {
      const sk = Buffer.from(hex, 'hex');
      try { return finalizeEvent(unsigned, sk); } finally { sk.fill(0); }
    },
  };
  return {
    profile,
    did: `did:nostr:${pubkey}`,
    pubkey,
    nip98: (method, url, body) => NostrBridge.buildNip98Header(signer, method, url, { body }),
  };
}

async function signedFetch(id, method, url, body) {
  const headers = { authorization: await id.nip98(method, url, body) };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* reported below */ }
  if (!res.ok) {
    const p = new URL(url).pathname;
    throw new Error(`${method} ${p} -> ${res.status}: ${(json && (json.error || json.message)) || text.slice(0, 200)}`);
  }
  return json;
}

/**
 * Create a task as the demo agent and confirm the task is attributed to it.
 */
async function dispatch({ profile, identityDir, apiUrl = 'http://127.0.0.1:9090', agent = 'coder', task, provider } = {}) {
  if (!task) throw new Error('a task text is required');
  const id = loadDemoIdentity({ profile, identityDir });
  const base = String(apiUrl).replace(/\/+$/, '');
  const payload = { agent, task };
  if (provider) payload.provider = provider;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const created = await signedFetch(id, 'POST', `${base}/v1/tasks`, body);
  if (!created || !created.taskId) throw new Error('POST /v1/tasks returned no taskId');
  const info = await signedFetch(id, 'GET', `${base}/v1/tasks/${encodeURIComponent(created.taskId)}`);
  const didNostr = (info && (info.didNostr ?? info.did_nostr)) ?? null;
  if (didNostr !== id.did) {
    throw new Error(`task ${created.taskId}: didNostr ${didNostr} is not the signer ${id.did} (management-api predates d35e89b82, or the request fell back to Bearer)`);
  }
  return { profile, did: id.did, taskId: created.taskId, didNostr, attributed: true };
}

function parseArgs(argv) {
  const out = { profile: argv[0], task: argv[1] };
  for (let i = 2; i < argv.length; i += 2) {
    const v = argv[i + 1];
    if (argv[i] === '--agent') out.agent = v;
    else if (argv[i] === '--api') out.apiUrl = v;
    else if (argv[i] === '--identity-dir') out.identityDir = v;
    else if (argv[i] === '--provider') out.provider = v;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!out.profile || !out.task) throw new Error('usage: dispatch-as.js <profile> "<task>" [--agent A] [--api URL] [--identity-dir DIR] [--provider P]');
  if (!out.apiUrl && process.env.MANAGEMENT_API_PORT) out.apiUrl = `http://127.0.0.1:${process.env.MANAGEMENT_API_PORT}`;
  return out;
}

if (require.main === module) {
  dispatch(parseArgs(process.argv.slice(2)))
    .then((r) => { process.stdout.write(`${JSON.stringify(r)}\n`); })
    .catch((e) => { process.stderr.write(`dispatch-as: ${e.message}\n`); process.exit(1); });
}

module.exports = { loadDemoIdentity, dispatch, parseArgs };
