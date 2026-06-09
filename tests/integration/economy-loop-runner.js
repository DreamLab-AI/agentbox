#!/usr/bin/env node
'use strict';

/**
 * economy-loop-runner — the REAL cross-repo economy loop, run as a standalone
 * node process (NOT a jest test).
 *
 * Why a separate process: nostr-tools v2 pulls in pure-ESM transitive deps
 * (@noble/curves) that jest's CommonJS sandbox cannot parse without a babel
 * transform the management-api test config does not ship. Plain `node` handles
 * the ESM interop fine, so the genuinely end-to-end signed-read + debit flow
 * runs here and the jest suite (economy-loop.test.js) spawns this and asserts
 * on its JSON result. This mirrors how the harness already spawns the
 * solid-pod-rs server as a child process.
 *
 * It performs the full loop against a REAL solid-pod-rs binary:
 *   1. seed an FS-backed pod: Web Ledger (100 sats) + a 30-sat paid-read ACL;
 *   2. read the gated resource through the REAL LocalSolidRsPodsAdapter with a
 *      REAL NIP-98 token  → solid-pod-rs grants and DEBITS (100 → 70);
 *   3. mint receipt + activity + bead URNs through lib/uris.js;
 *   4. cross activity + bead through bc20.crossOutbound into a durable JSONL
 *      UrnMapping store, assert the round-trip and the crossings counter.
 *
 * Output: a single JSON line on stdout — `{ ok, ... }` on success, or
 * `{ ok:false, skip|error }` so the jest parent can skip vs fail precisely.
 * Never throws to the process boundary; always prints one JSON line.
 *
 * @see docs/developer/economy-loop.md
 */

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const MGMT = path.join(REPO, 'management-api');

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

let nostr;
try { nostr = require(path.join(MGMT, 'node_modules', 'nostr-tools')); }
catch (e) { emit({ ok: false, skip: `nostr-tools unloadable: ${e.message}` }); process.exit(0); }

const uris = require(path.join(MGMT, 'lib', 'uris'));
const bc20 = require(path.join(MGMT, 'lib', 'bc20-provenance-bridge'));
const { LocalSolidRsPodsAdapter } = require(path.join(MGMT, 'adapters', 'pods', 'local-solid-rs'));

let promClient = null;
try { promClient = require(path.join(MGMT, 'node_modules', 'prom-client')); } catch { /* optional */ }

const NIP98_KIND = 27235;
const RESOURCE = '/premium/feed';
const COST_SATS = 30;
const START_BALANCE = 100;
const BODY = '{"headline":"paid content"}';

function findServerBinary() {
  const candidates = [
    process.env.SOLID_POD_RS_SERVER_BIN,
    path.join(REPO, '..', '..', 'solid-pod-rs', 'target', 'debug', 'solid-pod-rs-server'),
    path.join(REPO, '..', '..', 'solid-pod-rs', 'target', 'release', 'solid-pod-rs-server'),
    '/home/devuser/workspace/solid-pod-rs/target/debug/solid-pod-rs-server',
    '/home/devuser/workspace/solid-pod-rs/target/release/solid-pod-rs-server',
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function waitForServer(baseUrl, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${baseUrl}/.well-known/solid`); if (r.status) return true; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function nip98Originator(sk) {
  return async (method, url, body) => {
    const q = String(url).indexOf('?');
    const uTag = q === -1 ? String(url) : String(url).slice(0, q);
    const tags = [['u', uTag], ['method', String(method).toUpperCase()]];
    if (body) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      if (buf.length) tags.push(['payload', crypto.createHash('sha256').update(buf).digest('hex')]);
    }
    const signed = nostr.finalizeEvent({ kind: NIP98_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, sk);
    return `Nostr ${Buffer.from(JSON.stringify(signed), 'utf8').toString('base64')}`;
  };
}

function ledgerDoc(did, sats) {
  const now = Math.floor(Date.now() / 1000);
  return { '@context': 'https://w3id.org/webledgers', type: 'WebLedger', name: 'Economy-Loop Test Credits', description: 'Paid API balance ledger', defaultCurrency: 'satoshi', created: now, updated: now, entries: [{ type: 'Entry', url: did, amount: String(sats) }] };
}

function paidReadAcl(did) {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n\n<#paid-read> a acl:Authorization ;\n    acl:agent <${did}> ;\n    acl:accessTo <${RESOURCE}> ;\n    acl:mode acl:Read ;\n    acl:condition [ a acl:PaymentCondition ; acl:costSats ${COST_SATS} ] .\n`;
}

function readBalance(root, did) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, '.well-known', 'webledgers', 'webledgers.json'), 'utf8'));
  const e = (doc.entries || []).find((x) => x.url === did);
  return e ? parseInt(e.amount, 10) : null;
}

async function counterValue(name, labels) {
  if (!promClient) return null;
  const m = promClient.register.getSingleMetric(name);
  if (!m) return 0;
  const snapshot = await m.get(); // prom-client Counter.get() is async in v15
  const hit = (snapshot.values || []).find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return hit ? hit.value : 0;
}

(async () => {
  const bin = findServerBinary();
  if (!bin) { emit({ ok: false, skip: 'no debit-capable solid-pod-rs binary found' }); return; }

  const sk = nostr.generateSecretKey();
  const pubkey = nostr.getPublicKey(sk);
  const did = `did:nostr:${pubkey}`;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-economy-'));
  fs.mkdirSync(path.join(root, '.well-known', 'webledgers'), { recursive: true });
  fs.writeFileSync(path.join(root, '.well-known', 'webledgers', 'webledgers.json'), JSON.stringify(ledgerDoc(did, START_BALANCE)));
  fs.mkdirSync(path.join(root, 'premium'), { recursive: true });
  fs.writeFileSync(path.join(root, 'premium', 'feed'), BODY);
  fs.writeFileSync(path.join(root, 'premium', 'feed.acl'), paidReadAcl(did));
  fs.writeFileSync(path.join(root, 'premium', 'feed.acl.meta.json'), JSON.stringify({ content_type: 'text/turtle', links: [] }));

  const port = await freePort();
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ server: { host: '127.0.0.1', port }, storage: { type: 'fs', root } }));
  const proc = spawn(bin, ['-c', path.join(root, 'config.json'), '--host', '127.0.0.1', '-p', String(port)], { env: { ...process.env, RUST_LOG: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  const cleanup = () => { try { proc.kill('SIGTERM'); } catch { /* noop */ } try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ } };

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    if (!await waitForServer(baseUrl)) { emit({ ok: false, skip: `solid-pod-rs did not start: ${log.slice(0, 300)}` }); cleanup(); return; }

    const result = { ok: true, did, pubkey };

    // Anonymous read must be denied (WAC deny-by-default).
    const anon = new LocalSolidRsPodsAdapter({ baseUrl, probeCapabilities: false });
    try { await anon.read(RESOURCE); result.anonDenied = false; }
    catch (e) { result.anonDenied = e.name === 'PermissionDenied'; result.anonError = e.name; }

    result.balanceBefore = readBalance(root, did);

    // Signed read → grant + debit.
    const adapter = new LocalSolidRsPodsAdapter({ baseUrl, nip98: nip98Originator(sk), probeCapabilities: false });
    const read = await adapter.read(RESOURCE);
    result.readBody = read.body;
    result.balanceAfter = readBalance(root, did);

    // Mint receipt + activity + bead, cross activity + bead durably.
    const receiptUrn = uris.mint({ kind: 'receipt', pubkey, payload: { kind: 'paid-read', resource: RESOURCE, cost_sats: COST_SATS, body_sha256: crypto.createHash('sha256').update(read.body).digest('hex') } });
    const activityUrn = uris.mint({ kind: 'activity', pubkey, payload: { verb: 'read', receipt: receiptUrn } });
    const beadUrn = uris.mint({ kind: 'bead', pubkey, payload: { title: `paid read ${RESOURCE}`, activity: activityUrn } });

    const mappingPath = path.join(root, 'bc20-mappings.jsonl');
    const store = new bc20.JsonlUrnMappingStore(mappingPath);
    const before = await counterValue('agentbox_bc20_crossings_total', { kind: 'activity', direction: 'outbound' });

    const activityCross = bc20.crossOutbound(activityUrn, store);
    const beadCross = bc20.crossOutbound(beadUrn, store);
    const after = await counterValue('agentbox_bc20_crossings_total', { kind: 'activity', direction: 'outbound' });

    // receipt is an unmapped BC20 kind — must not cross.
    const receiptCrosses = bc20.toVisionclaw(receiptUrn, { onDrop: () => {} }) !== null;

    // Durable round-trip via a freshly-reopened store.
    const reopened = new bc20.JsonlUrnMappingStore(mappingPath);

    Object.assign(result, {
      receiptUrn,
      activityUrn,
      beadUrn,
      receiptCanonical: uris.isCanonical(receiptUrn),
      activityVc: activityCross && activityCross.visionclaw_urn,
      activityOwnerDid: activityCross && activityCross.owner_did,
      beadVc: beadCross && beadCross.visionclaw_urn,
      beadLocal: uris.parse(beadUrn).local,
      receiptCrosses,
      activityRoundTrip: bc20.toAgentbox(activityCross.visionclaw_urn, { store }) === activityUrn,
      beadRoundTrip: bc20.toAgentbox(beadCross.visionclaw_urn, { store }) === beadUrn,
      mappingFileExists: fs.existsSync(mappingPath),
      reopenedActivity: reopened.getByAgentbox(activityUrn) && reopened.getByAgentbox(activityUrn).visionclaw_urn,
      counterBefore: before,
      counterAfter: after,
      promAvailable: !!promClient,
    });

    emit(result);
  } catch (err) {
    emit({ ok: false, error: `${err.name}: ${err.message}`, log: log.slice(0, 300) });
  } finally {
    cleanup();
  }
})().catch((err) => { emit({ ok: false, error: `fatal ${err && err.message}` }); process.exit(0); });
