'use strict';

/**
 * zone-keys — end-to-end encrypted forum zones for agentbox's Nostr identities
 * (forum kit ADR-2016). The single JS home of the zone-key wire format: the
 * JunkieJarvis forum agent (junkiejarvis-agent.js) and the nightly
 * forum-suggestions tenant (scripts/dream-forum-suggestions.mjs) both use this
 * module; the dream-engine's Rust twin is services/dream-engine/src/zone_crypto.rs.
 *
 * No cryptography is implemented here. Every primitive is nostr-tools:
 * `nip44` (v2) for message and seal encryption, `verifyEvent` for the seal's
 * id + BIP-340 signature. This file only composes them into the kit's format.
 *
 * Wire format (must match nostr-rust-forum crates/nostr-bbs-forum-client/src/zone_crypto):
 *   - Gate: `ENCRYPTION_ENABLED` — only the exact string "true" is on. A zone
 *     is encrypted only when the gate is on, its ZONE_CONFIG entry has
 *     `"encrypted": true`, and it is not public (anonymous readers can never
 *     hold a key — the relay applies the same rule).
 *   - Message: a kind-42 whose content is NIP-44 v2 `encrypt(author_sk,
 *     zone_epoch_pk, text)`, carrying `["zk", <zone>, "<epoch>", <zone pk hex>]`.
 *     Any holder of the zone secret decrypts with ECDH(zone_sk, author_pk).
 *   - Grant: a NIP-59 gift wrap (1059) → seal (13, signed by an ADMIN) →
 *     rumor kind 21453 with content {"zone","epoch","secret","pubkey","created_at"}.
 *     Accepted only when the verified seal author is an admin and the secret
 *     derives to the stated pubkey.
 *
 * Key file (shared with the Rust digest; format owned here and in
 * docs/developer/dream-engine.md): `$WORKSPACE/.agentbox/zone-keys.json`
 * (override `ZONE_KEYS_FILE`), mode 0600, never in git:
 *   { "version": 1, "owner": "<holder pubkey hex>",
 *     "keys": [ { "zone", "epoch", "secret", "pubkey", "granted_by", "received_at" } ] }
 * A file whose `owner` is not the running identity is ignored, never merged.
 *
 * Secrets are never logged: callers log zone/epoch only.
 */

const fs = require('fs');
const path = require('path');

let nostrTools = null;
function getNostrTools() {
  if (!nostrTools) nostrTools = require('nostr-tools');
  return nostrTools;
}

const KIND_ZONE_KEY_GRANT = 21453;
const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;
const KIND_CHANNEL_CREATE = 40;
const ZK_TAG = 'zk';
const KEY_FILE_VERSION = 1;

const DEFAULT_WORKSPACE = '/home/devuser/workspace';
const DEFAULT_FORUM_RELAY = 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';
const ADMIN_CACHE_MS = 10 * 60 * 1000;

// ─── Settings (env first, then the agentbox .env file) ──────────────────────

function envFilePath(env = process.env) {
  if (env.AGENTBOX_ENV_FILE) return env.AGENTBOX_ENV_FILE;
  const dir = env.AGENTBOX_DIR || path.join(env.WORKSPACE || DEFAULT_WORKSPACE, 'project/agentbox');
  return path.join(dir, '.env');
}

/**
 * Read a non-secret setting: the process env when set and non-empty, else the
 * `NAME=value` line of the agentbox .env file (surrounding quotes stripped).
 * management-api's compose environment only forwards listed variables, so the
 * .env fallback lets the operator add the two encryption lines without a
 * compose change; the Rust digest reads the same file the same way.
 */
function readSetting(name, env = process.env, fsImpl = fs) {
  const direct = env[name];
  if (typeof direct === 'string' && direct.trim() !== '') return direct;
  let text;
  try { text = fsImpl.readFileSync(envFilePath(env), 'utf8'); } catch { return null; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith(`${name}=`)) continue;
    let v = line.slice(name.length + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return null;
}

/** Deployment master gate: only the exact string "true" is on. */
function gateEnabled(env = process.env, fsImpl = fs) {
  return readSetting('ENCRYPTION_ENABLED', env, fsImpl) === 'true';
}

/** ZONE_CONFIG as an array of zone objects (empty on absence or bad JSON). */
function loadZones(env = process.env, fsImpl = fs) {
  const raw = readSetting('ZONE_CONFIG', env, fsImpl);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((z) => z && typeof z.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Channel section → zone id. The kit's canonical resolver
 * (stores/zones.rs `section_to_zone`): exact id, then `<id>-` prefix, then the
 * first zone as a catch-all.
 */
function sectionToZone(section, zones) {
  const sec = String(section || '').toLowerCase();
  const exact = zones.find((z) => z.id.toLowerCase() === sec);
  if (exact) return exact.id;
  const prefixed = zones.find((z) => sec.startsWith(`${z.id.toLowerCase()}-`));
  if (prefixed) return prefixed.id;
  return zones.length > 0 ? zones[0].id : null;
}

/** Whether writes into `zoneId` must be encrypted. */
function zoneIsEncrypted(zoneId, { gate, zones }) {
  if (!gate || !zoneId) return false;
  const z = zones.find((x) => x.id === zoneId);
  if (!z || z.encrypted !== true) return false;
  const isPublic = z.visibility === 'public'
    && (!Array.isArray(z.required_cohorts) || z.required_cohorts.length === 0);
  return !isPublic;
}

/** Whether any zone is encrypted under this config. */
function anyZoneEncrypted({ gate, zones }) {
  return zones.some((z) => zoneIsEncrypted(z.id, { gate, zones }));
}

// ─── zk tag ─────────────────────────────────────────────────────────────────

const isHex64 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
const hexToBytes = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

function zkTag(key) {
  return [ZK_TAG, key.zone, String(key.epoch), key.pubkey];
}

/** First well-formed zk tag (the shape the relay enforces), or null. */
function parseZk(tags) {
  for (const t of Array.isArray(tags) ? tags : []) {
    if (!Array.isArray(t) || t.length < 4 || t[0] !== ZK_TAG || !t[1]) continue;
    if (!/^[0-9]+$/.test(String(t[2]))) continue;
    const epoch = Number(t[2]);
    if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 0xffffffff) continue;
    if (!isHex64(t[3])) continue;
    return { zone: t[1], epoch, pubkey: t[3].toLowerCase() };
  }
  return null;
}

function hasZkTag(tags) {
  return (Array.isArray(tags) ? tags : []).some((t) => Array.isArray(t) && t[0] === ZK_TAG);
}

// ─── Key file / store ───────────────────────────────────────────────────────

function keyFilePath(env = process.env) {
  return env.ZONE_KEYS_FILE
    || path.join(env.WORKSPACE || DEFAULT_WORKSPACE, '.agentbox/zone-keys.json');
}

function emptyKeyFile(owner) {
  return { version: KEY_FILE_VERSION, owner, keys: [] };
}

function validStoredKey(k) {
  return k && typeof k.zone === 'string' && k.zone
    && Number.isSafeInteger(k.epoch) && k.epoch >= 1
    && isHex64(k.secret) && isHex64(k.pubkey);
}

function loadKeyFile(file, owner, fsImpl = fs) {
  let data;
  try { data = JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return emptyKeyFile(owner); }
  if (!data || data.version !== KEY_FILE_VERSION || data.owner !== owner || !Array.isArray(data.keys)) {
    return emptyKeyFile(owner);
  }
  return { version: KEY_FILE_VERSION, owner, keys: data.keys.filter(validStoredKey) };
}

/** Atomic 0600 write: temp file created 0600, then renamed over the target. */
function saveKeyFile(file, data, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fsImpl.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fsImpl.chmodSync(tmp, 0o600);
  fsImpl.renameSync(tmp, file);
}

class ZoneKeyStore {
  /**
   * @param {{ owner: string, file?: string, fsImpl?: object, persist?: boolean }} opts
   */
  constructor({ owner, file = keyFilePath(), fsImpl = fs, persist = true } = {}) {
    this.owner = owner;
    this.file = file;
    this.fs = fsImpl;
    this.persist = persist;
    this.data = persist ? loadKeyFile(file, owner, fsImpl) : emptyKeyFile(owner);
  }

  keys() { return this.data.keys.slice(); }

  get(zone, epoch) {
    return this.data.keys.find((k) => k.zone === zone && k.epoch === epoch) || null;
  }

  /** Highest-epoch key held for `zone`. */
  latest(zone) {
    return this.data.keys
      .filter((k) => k.zone === zone)
      .reduce((best, k) => (!best || k.epoch > best.epoch ? k : best), null);
  }

  /** Insert or replace a key. Returns true when the store changed. */
  upsert(key) {
    if (!validStoredKey(key)) return false;
    const existing = this.get(key.zone, key.epoch);
    if (existing && existing.pubkey === key.pubkey && existing.secret === key.secret) return false;
    this.data.keys = this.data.keys.filter((k) => !(k.zone === key.zone && k.epoch === key.epoch));
    this.data.keys.push(key);
    if (this.persist) saveKeyFile(this.file, this.data, this.fs);
    return true;
  }
}

// ─── Grants ─────────────────────────────────────────────────────────────────

/**
 * Validate a decrypted grant rumor sealed by `sealer` (the kit's
 * `validate_grant`). `isAdmin` is the relay's check-whitelist answer, injected
 * so the rule is testable. Returns { ok: true, key } or { ok: false, error }.
 */
function validateGrant(rumor, sealer, isAdmin, now) {
  if (!rumor || rumor.kind !== KIND_ZONE_KEY_GRANT) {
    return { ok: false, error: `not a zone-key grant (rumor kind ${rumor && rumor.kind})` };
  }
  let p;
  try { p = JSON.parse(rumor.content); } catch { return { ok: false, error: 'grant content is malformed' }; }
  if (!p || typeof p.zone !== 'string' || !p.zone || !Number.isSafeInteger(p.epoch) || p.epoch < 1
      || !isHex64(p.pubkey) || !isHex64(p.secret)) {
    return { ok: false, error: 'grant content is malformed' };
  }
  let derived;
  try { derived = getNostrTools().getPublicKey(hexToBytes(p.secret)); } catch {
    return { ok: false, error: 'grant content is malformed' };
  }
  if (derived.toLowerCase() !== p.pubkey.toLowerCase()) {
    return { ok: false, error: 'grant secret does not derive to its stated pubkey' };
  }
  if (!isAdmin) return { ok: false, error: `grant was not sealed by an admin (${sealer})` };
  return {
    ok: true,
    key: {
      zone: p.zone,
      epoch: p.epoch,
      secret: p.secret.toLowerCase(),
      pubkey: derived.toLowerCase(),
      granted_by: sealer,
      received_at: now,
    },
  };
}

/**
 * Open a kind-1059 addressed to `skBytes`, accepting any rumor kind (the
 * kit's `unwrap_any`). Unlike nostr-tools' `nip59.unwrapEvent`, this verifies
 * the seal's id + signature and that the rumor's author is the seal's author,
 * so the returned `sealer` is authenticated. Throws on any failure.
 */
function unwrapAny(wrap, skBytes) {
  const { nip44, verifyEvent } = getNostrTools();
  if (!wrap || wrap.kind !== KIND_GIFT_WRAP) throw new Error('not a gift wrap');
  const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(skBytes, wrap.pubkey)));
  if (!seal || seal.kind !== KIND_SEAL) throw new Error('not a seal');
  if (!verifyEvent(seal)) throw new Error('seal signature invalid');
  const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(skBytes, seal.pubkey)));
  if (!rumor || rumor.pubkey !== seal.pubkey) throw new Error('rumor author does not match seal author');
  return { sealer: seal.pubkey, rumor };
}

function relayHttpBase(env = process.env) {
  return String(env.FORUM_RELAY_URL || DEFAULT_FORUM_RELAY).replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

/**
 * `(pubkey) => Promise<boolean>` backed by the relay's public
 * `GET /api/check-whitelist`, cached per pubkey. Fails closed (false).
 */
function makeAdminCheck({ fetchImpl = globalThis.fetch, baseUrl = relayHttpBase(), ttlMs = ADMIN_CACHE_MS } = {}) {
  const cache = new Map();
  return async function isAdmin(pubkey) {
    if (!isHex64(pubkey)) return false;
    const hit = cache.get(pubkey);
    if (hit && Date.now() - hit.at < ttlMs) return hit.admin;
    let admin = false;
    try {
      const res = await fetchImpl(`${baseUrl}/api/check-whitelist?pubkey=${pubkey}`);
      if (res && res.ok) admin = (await res.json()).isAdmin === true;
    } catch { admin = false; }
    cache.set(pubkey, { admin, at: Date.now() });
    return admin;
  };
}

/**
 * Handle an already-opened gift wrap: store it when it is a valid grant.
 * Returns { status: 'not-grant' | 'known' | 'granted' | 'rejected', key?, error? }.
 */
async function acceptGrant({ sealer, rumor }, { store, isAdmin, now = Math.floor(Date.now() / 1000) }) {
  if (!rumor || rumor.kind !== KIND_ZONE_KEY_GRANT) return { status: 'not-grant' };
  let payload;
  try { payload = JSON.parse(rumor.content); } catch { payload = null; }
  const held = payload && store.get(payload.zone, payload.epoch);
  if (held && payload && typeof payload.pubkey === 'string' && held.pubkey === payload.pubkey.toLowerCase()) {
    return { status: 'known', key: held };
  }
  const v = validateGrant(rumor, sealer, await isAdmin(sealer), now);
  if (!v.ok) return { status: 'rejected', error: v.error };
  store.upsert(v.key);
  return { status: 'granted', key: v.key };
}

// ─── Read / write ───────────────────────────────────────────────────────────

function decryptWith(ev, key) {
  const { nip44 } = getNostrTools();
  return nip44.decrypt(ev.content, nip44.getConversationKey(hexToBytes(key.secret), ev.pubkey));
}

/**
 * Classify a kind-42 for reading. `lookup(zone, epoch)` returns a held key.
 * @returns {{ type: 'plain'|'decrypted'|'missing-key'|'failed', text: string|null }}
 */
function readOutcome(ev, lookup) {
  if (!ev || !hasZkTag(ev.tags)) return { type: 'plain', text: ev && typeof ev.content === 'string' ? ev.content : '' };
  const zk = parseZk(ev.tags);
  if (!zk) return { type: 'failed', text: null };
  const key = lookup(zk.zone, zk.epoch);
  if (!key) return { type: 'missing-key', text: null };
  if (key.pubkey.toLowerCase() !== zk.pubkey) return { type: 'failed', text: null };
  try {
    return { type: 'decrypted', text: decryptWith(ev, key) };
  } catch {
    return { type: 'failed', text: null };
  }
}

/**
 * How to publish into `zoneId`: { type: 'plain' } | { type: 'encrypt', key } |
 * { type: 'refuse', reason }. An encrypted zone without a held key is refused —
 * never a plaintext fallback.
 */
function writePlan(zoneId, { gate, zones, store }) {
  if (!zoneIsEncrypted(zoneId, { gate, zones })) return { type: 'plain' };
  const key = store ? store.latest(zoneId) : null;
  if (!key) return { type: 'refuse', reason: `no zone key held for encrypted zone ${zoneId}` };
  return { type: 'encrypt', key };
}

/** Encrypt an unsigned kind-42 under `plan` (author secret × zone pubkey). */
function applyWritePlan(unsigned, plan, skBytes) {
  if (!plan || plan.type === 'plain') return unsigned;
  if (plan.type !== 'encrypt') throw new Error(plan.reason || 'refused');
  if (!unsigned.content) throw new Error('an encrypted message cannot be empty');
  const { nip44 } = getNostrTools();
  const content = nip44.encrypt(unsigned.content, nip44.getConversationKey(skBytes, plan.key.pubkey));
  const tags = (unsigned.tags || []).filter((t) => !(Array.isArray(t) && t[0] === ZK_TAG));
  tags.push(zkTag(plan.key));
  return { ...unsigned, content, tags };
}

/** First e tag with a `root` marker, else the first e tag — the channel. */
function channelOf(ev) {
  const eTags = (Array.isArray(ev && ev.tags) ? ev.tags : []).filter((t) => Array.isArray(t) && t[0] === 'e' && t[1]);
  const root = eTags.find((t) => t[3] === 'root') || eTags[0];
  return root ? root[1] : null;
}

/**
 * One-shot query over a NostrBridge-shaped `{ subscribe, unsubscribe }`:
 * resolves with every event seen until `quietMs` passes without a new one.
 */
function queryOnce(bridge, filter, { quietMs = 1500, maxMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const events = new Map();
    let timer = null;
    let subId = null;
    const finish = () => {
      clearTimeout(timer);
      clearTimeout(hard);
      if (subId) { try { bridge.unsubscribe(subId); } catch { /* closing */ } }
      resolve([...events.values()]);
    };
    const bump = () => { clearTimeout(timer); timer = setTimeout(finish, quietMs); };
    const hard = setTimeout(finish, maxMs);
    subId = bridge.subscribe(filter, (ev) => { if (ev && ev.id) events.set(ev.id, ev); bump(); });
    bump();
  });
}

/**
 * Resolve a channel id to its zone: the channel's kind-40 `section` tag
 * through `sectionToZone`. `query(filter)` returns events. Cached per store
 * instance by the caller. Returns null when the channel cannot be found.
 */
async function resolveChannelZone(channelId, { query, zones }) {
  if (!isHex64(channelId) || zones.length === 0) return null;
  const found = await query({ kinds: [KIND_CHANNEL_CREATE], ids: [channelId] });
  const create = (found || []).find((e) => e && e.id === channelId && e.kind === KIND_CHANNEL_CREATE);
  if (!create) return null;
  const section = ((create.tags || []).find((t) => Array.isArray(t) && t[0] === 'section' && t[1]) || [])[1];
  return sectionToZone(section || '', zones);
}

module.exports = {
  KIND_ZONE_KEY_GRANT,
  KIND_SEAL,
  KIND_GIFT_WRAP,
  ZK_TAG,
  KEY_FILE_VERSION,
  readSetting,
  gateEnabled,
  loadZones,
  sectionToZone,
  zoneIsEncrypted,
  anyZoneEncrypted,
  zkTag,
  parseZk,
  hasZkTag,
  keyFilePath,
  loadKeyFile,
  saveKeyFile,
  ZoneKeyStore,
  validateGrant,
  unwrapAny,
  relayHttpBase,
  makeAdminCheck,
  acceptGrant,
  decryptWith,
  readOutcome,
  writePlan,
  applyWritePlan,
  channelOf,
  queryOnce,
  resolveChannelZone,
};
