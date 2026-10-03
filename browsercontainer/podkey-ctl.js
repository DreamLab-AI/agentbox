#!/usr/bin/env node
/**
 * podkey-ctl — load and inspect the pinned Podkey extension in the sidecar's Chrome.
 *
 * Why this exists: Google Chrome (branded, 137+) ignores --load-extension, and on
 * Chrome beta 151 --disable-extensions-except still applies and disables even an
 * extension loaded over CDP (both observed in this sidecar, 2026-10-03). Branded
 * Chrome therefore gets Podkey via the CDP call Extensions.loadUnpacked, which
 * needs --enable-unsafe-extension-debugging. Chromium still honours the flags,
 * and launch-chromium.sh uses them there. launch-chromium.sh records which path it
 * took in $RUN_DIR/podkey-mode (cdp | flag | none).
 *
 * Load exactly once per Chrome process. Re-loading an unpacked extension in the
 * same process clears chrome.storage.session, which is where Podkey keeps the
 * unlocked private key, so a second load would silently lock it. The browser's
 * websocket URL (unique per process) is recorded in $RUN_DIR/podkey-loaded-for,
 * so a restarted loader does not reload a live browser.
 *
 * Commands
 *   load [--watch]   load Podkey (once per Chrome process); --watch keeps following
 *                    Chrome restarts (supervisord program `podkey-loader`)
 *   status           print {extension_id, version, state, publicKey, did} as JSON
 *   pubkey           print the 64-hex public key (exit 1 if there is no identity)
 *   unlock           read the vault passphrase from stdin (no echo on a TTY) and
 *                    unlock Podkey for this browser session
 *
 * Nothing here creates, imports or exports a private key. The identity is minted
 * in Podkey's own popup (owner step, browsercontainer/README.md). status, pubkey
 * and unlock speak to Podkey through one of its own pages
 * (chrome-extension://<id>/popup/popup.html), because Podkey only accepts key
 * operations from its extension UI.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_EXT_DIR = '/opt/browsercontainer/extensions/podkey';
const EXT_DIR = process.env.PODKEY_EXT_DIR || DEFAULT_EXT_DIR;
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const RUN_DIR = process.env.BROWSERCONTAINER_RUN_DIR || '/tmp/browsercontainer';
const MODE_FILE = path.join(RUN_DIR, 'podkey-mode');
const STATE_FILE = path.join(RUN_DIR, 'podkey-loaded-for');
const POLL_MS = 3000;

const log = (msg) => process.stderr.write(`[podkey-ctl] ${msg}\n`);

/**
 * Chrome's id for an unpacked extension without a manifest `key`: the first 16
 * bytes of SHA-256 over the absolute path, each hex nibble mapped 0-f -> a-p.
 */
function extensionIdForPath(p) {
  const hex = crypto.createHash('sha256').update(p).digest('hex').slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

const PODKEY_ID = extensionIdForPath(DEFAULT_EXT_DIR);
const EXT_ID = extensionIdForPath(EXT_DIR);

function readMode(file = MODE_FILE) {
  try {
    const m = fs.readFileSync(file, 'utf8').trim();
    return ['cdp', 'flag', 'none'].includes(m) ? m : 'none';
  } catch { return 'none'; }
}

function readState(file = STATE_FILE) {
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}

function writeState(file, key) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${key}\n`);
}

/** 'wait' (no browser yet) | 'load' | 'skip' */
function decideLoad({ mode, browserKey, lastLoadedKey }) {
  if (!browserKey) return 'wait';
  if (mode !== 'cdp') return 'skip';
  return browserKey === lastLoadedKey ? 'skip' : 'load';
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Reduce a Podkey status/unlock reply to the fields that may be printed. */
function sanitiseStatus(r) {
  if (!r || typeof r !== 'object') return { state: 'error', error: 'no reply from Podkey', publicKey: null, did: null };
  if (r.error) return { state: 'error', error: String(r.error), publicKey: null, did: null };
  const publicKey = typeof r.publicKey === 'string' && HEX64.test(r.publicKey) ? r.publicKey : null;
  const state = ['unlocked', 'locked', 'none'].includes(r.state) ? r.state : (publicKey ? 'unlocked' : 'none');
  return { state, publicKey, did: publicKey ? `did:nostr:${publicKey}` : null };
}

function statusExpression() {
  return "chrome.runtime.sendMessage({ type: 'GET_KEYPAIR_STATUS' })";
}

function unlockExpression(passphrase) {
  return `chrome.runtime.sendMessage({ type: 'UNLOCK_VAULT', passphrase: ${JSON.stringify(passphrase)} })`;
}

// ── CDP plumbing ──────────────────────────────────────────────────────────────
const WS = globalThis.WebSocket || require('ws');

async function browserWsUrl() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return (await res.json()).webSocketDebuggerUrl || null;
  } catch { return null; }
}

function cdpSession(url) {
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    let next = 1;
    const pending = new Map();
    const onMessage = (data) => {
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
      const p = msg.id && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
    const session = {
      send(method, params = {}, timeoutMs = 10000) {
        const id = next++;
        return new Promise((res, rej) => {
          const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, timeoutMs);
          pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { try { ws.close(); } catch { /* already closed */ } },
    };
    if (ws.addEventListener) {
      ws.addEventListener('open', () => resolve(session));
      ws.addEventListener('message', (e) => onMessage(e.data));
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)));
    } else {
      ws.on('open', () => resolve(session));
      ws.on('message', onMessage);
      ws.on('error', reject);
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extensionManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')); } catch { return null; }
}

/** Wait for Podkey's service worker target to appear (it starts on install). */
async function waitForWorker(browser, ms = 10000) {
  const prefix = `chrome-extension://${EXT_ID}/`;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { targetInfos } = await browser.send('Target.getTargets');
    if (targetInfos.some((t) => t.type === 'service_worker' && t.url.startsWith(prefix))) return true;
    await sleep(500);
  }
  return false;
}

async function loadOnce(browserKey) {
  const browser = await cdpSession(browserKey);
  try {
    const { id } = await browser.send('Extensions.loadUnpacked', { path: EXT_DIR });
    if (id !== EXT_ID) log(`WARN: Chrome assigned id ${id}, expected ${EXT_ID} (policy allowlist names ${PODKEY_ID})`);
    writeState(STATE_FILE, browserKey);
    const running = await waitForWorker(browser);
    log(running ? `loaded Podkey ${id}; service worker running` : `loaded Podkey ${id}; WARN: service worker not seen within 10s`);
  } finally { browser.close(); }
}

async function cmdLoad(watch) {
  let lastLogged = '';
  const note = (m) => { if (m !== lastLogged) { log(m); lastLogged = m; } };
  const deadline = Date.now() + 30000;
  for (;;) {
    const browserKey = await browserWsUrl();
    const mode = readMode();
    const decision = decideLoad({ mode, browserKey, lastLoadedKey: readState() });
    if (decision === 'wait') {
      note(`waiting for Chrome CDP on 127.0.0.1:${CDP_PORT}`);
      if (!watch && Date.now() > deadline) { log('Chrome CDP not reachable; giving up'); return 1; }
    } else if (decision === 'skip') {
      if (mode === 'cdp') note('Podkey already loaded in this Chrome process');
      else if (mode === 'flag') note('Podkey loaded by --load-extension (Chromium); no CDP load');
      else note('launch-chromium.sh started Chrome without Podkey (mode none); nothing to load');
      if (!watch) return 0;
    } else if (!extensionManifest()) {
      note(`no manifest.json in ${EXT_DIR}; Podkey not installed in this image, nothing to load`);
      if (!watch) return 0;
    } else {
      try {
        await loadOnce(browserKey);
        lastLogged = '';
        if (!watch) return 0;
      } catch (e) {
        note(`load failed: ${e.message} (will retry)`);
        if (!watch && Date.now() > deadline) return 1;
      }
    }
    await sleep(POLL_MS);
  }
}

/** Open a background tab on Podkey's own popup page, evaluate, close the tab. */
async function inExtensionPage(expression) {
  const browserKey = await browserWsUrl();
  if (!browserKey) throw new Error(`Chrome CDP not reachable on 127.0.0.1:${CDP_PORT}`);
  const browser = await cdpSession(browserKey);
  let targetId;
  try {
    ({ targetId } = await browser.send('Target.createTarget', {
      url: `chrome-extension://${EXT_ID}/popup/popup.html`, background: true,
    }));
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = list.find((t) => t.id === targetId);
    if (!page || !page.webSocketDebuggerUrl) throw new Error('cannot attach to the Podkey page');
    const tab = await cdpSession(page.webSocketDebuggerUrl);
    try {
      let ready = false;
      for (let i = 0; i < 20 && !ready; i++) {
        const { result } = await tab.send('Runtime.evaluate', {
          expression: 'typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id || ""', returnByValue: true,
        });
        ready = result.value === EXT_ID;
        if (!ready) await sleep(250);
      }
      if (!ready) throw new Error(`Podkey (${EXT_ID}) is not loaded in this Chrome`);
      const { result, exceptionDetails } = await tab.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, 60000);
      if (exceptionDetails) throw new Error('Podkey page raised an exception');
      return result.value;
    } finally { tab.close(); }
  } finally {
    if (targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    browser.close();
  }
}

async function cmdStatus() {
  const m = extensionManifest();
  const s = sanitiseStatus(await inExtensionPage(statusExpression()));
  process.stdout.write(`${JSON.stringify({ extension_id: EXT_ID, version: m && m.version, ...s }, null, 2)}\n`);
  return s.state === 'error' ? 1 : 0;
}

async function cmdPubkey() {
  const s = sanitiseStatus(await inExtensionPage(statusExpression()));
  if (!s.publicKey) { log(`no Podkey identity yet (state ${s.state}); mint it in the Podkey popup first`); return 1; }
  process.stdout.write(`${s.publicKey}\n`);
  return 0;
}

function readPassphrase() {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      let buf = '';
      input.setEncoding('utf8');
      input.on('data', (c) => { buf += c; });
      input.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      input.on('error', reject);
      return;
    }
    process.stderr.write('Podkey passphrase: ');
    input.setRawMode(true);
    input.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { done(); return; }
        if (c === '\u0003') { input.setRawMode(false); process.stderr.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    const done = () => { input.setRawMode(false); input.removeListener('data', onData); input.pause(); process.stderr.write('\n'); resolve(buf); };
    input.on('data', onData);
  });
}

async function cmdUnlock() {
  const passphrase = await readPassphrase();
  if (!passphrase) { log('empty passphrase; nothing sent'); return 2; }
  const s = sanitiseStatus(await inExtensionPage(unlockExpression(passphrase)));
  if (s.state === 'error') { log(`unlock failed: ${s.error}`); return 1; }
  process.stdout.write(`${JSON.stringify({ extension_id: EXT_ID, state: 'unlocked', publicKey: s.publicKey, did: s.did }, null, 2)}\n`);
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'load': return cmdLoad(rest.includes('--watch'));
    case 'status': return cmdStatus();
    case 'pubkey': return cmdPubkey();
    case 'unlock': return cmdUnlock();
    case 'id': process.stdout.write(`${EXT_ID}\n`); return 0;
    default:
      process.stderr.write('usage: podkey-ctl.js load [--watch] | status | pubkey | unlock | id\n');
      return 2;
  }
}

module.exports = {
  DEFAULT_EXT_DIR, PODKEY_ID, extensionIdForPath, decideLoad, readMode, readState, writeState,
  sanitiseStatus, statusExpression, unlockExpression,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { log(e.message); process.exit(1); });
}
