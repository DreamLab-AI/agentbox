'use strict';

/**
 * lib/mandate-registry — the durable mandate state machine (AB-11).
 *
 * `<state>/mandates/registry.json` is the local index of every mandate the
 * operator has granted and the single source the pod sidecar is rendered from.
 * Each entry is `{ record, state, signed, signed_event_id, grant_created_at, … }`:
 *
 *   granting ──▶ active ──▶ revoking ──▶ revoked            (tombstone)
 *      │            │           └────▶ revoked_unpublished ─▶ revoked
 *      ▼            └──▶ expired
 *    failed
 *
 * Only `active` (and not past its expiry) is ENFORCEABLE: voice-intent and
 * `ensureMandate` deny from `granting` onwards, so a mandate that is being
 * revoked stops counting before the pod has been touched.
 *
 * Durability and concurrency:
 *   - writes are atomic (tmp file in the same directory, fsync, rename) at 0600;
 *   - read-modify-write is serialised behind an in-process mutex ({@link update});
 *     one management-api process owns the registry, so no file lock is needed;
 *   - a corrupt registry THROWS ({@link RegistryError}). The old reader returned
 *     `{}` on any parse error, which silently forgot every revocation;
 *   - lifecycle operations additionally hold a per-container lock
 *     ({@link withContainerLock}) across the whole render → PUT → verify →
 *     sign/publish → mark span, because the sidecar is rendered from every
 *     active mandate on that container and two unserialised grants would each
 *     PUT a sidecar missing the other.
 *
 * Every transition is appended to `<state>/mandates/audit.jsonl` through the
 * journal writer and its cross-process lock (ADR-2211).
 *
 * @see lib/mandate-grant.js  @see lib/mandate-revocation.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const mandateLib = require('./mandate');
const journalAppend = require('./journal-append');
const journalLock = require('./journal-lock');

const STATES = Object.freeze([
  'granting', 'active', 'revoking', 'revoked_unpublished', 'revoked', 'failed', 'expired',
]);

/** The registry could not be read or written. Fail closed: callers return 5xx. */
class RegistryError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RegistryError';
    if (cause) this.cause = cause;
  }
}

function stateDir() {
  return process.env.AGENTBOX_STATE_DIR || '/var/lib/agentbox';
}
function mandatesDir() { return path.join(stateDir(), 'mandates'); }
function registryPath() { return path.join(mandatesDir(), 'registry.json'); }
function auditPath() { return path.join(mandatesDir(), 'audit.jsonl'); }

/** Registry key: one mandate per agent and container. */
function keyFor(agent, container) {
  const agentHex = mandateLib.normalisePubkey(agent);
  const c = String(container || '');
  return `${agentHex}|${c.endsWith('/') ? c : `${c}/`}`;
}

// ── mutex ────────────────────────────────────────────────────────────────────

const chains = new Map();

/**
 * Run `fn` after every earlier call under the same name has finished.
 * A throwing `fn` does not wedge the queue.
 *
 * @template T
 * @param {string} name
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
function withLock(name, fn) {
  const prev = chains.get(name) || Promise.resolve();
  const run = prev.then(() => fn());
  const tail = run.catch(() => {});
  chains.set(name, tail);
  tail.then(() => { if (chains.get(name) === tail) chains.delete(name); });
  return run;
}

/** Create `mandates/` at 0700, and tighten one that already exists with looser bits. */
function ensureDir() {
  const dir = mandatesDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { if ((fs.statSync(dir).mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700); } catch (_) { /* not ours to change */ }
  return dir;
}

/**
 * The per-container lifecycle lock (see module doc): serialised in-process first,
 * then a cross-process lockfile (journal-lock's O_EXCL + stale-holder takeover)
 * held across the whole awaited operation, so a CLI or a second process cannot
 * interleave a sidecar rewrite with ours.
 */
function withContainerLock(container, fn) {
  const c = String(container);
  return withLock(`container:${c}`, async () => {
    const lockPath = path.join(ensureDir(), `.container-${crypto.createHash('sha256').update(c).digest('hex').slice(0, 16)}.lock`);
    const token = journalLock.acquire(lockPath, 15000);
    try { return await fn(); } finally { journalLock.release(lockPath, token); }
  });
}

// ── migration ────────────────────────────────────────────────────────────────

/**
 * Bring registry entries written before AB-11 up to the current shape, in place.
 * Idempotent. The URN is kept (it is content-addressed over the old record);
 * nothing is re-minted.
 *
 *   - `record.pod` is derived from `issuer`;
 *   - `/proj/…` containers move under `/pods/<pod>/proj/…` and are re-keyed;
 *   - no `state`: a record already marked revoked is a `revoked` tombstone; any
 *     other was never enforced at a pod (no ACL was ever PUT) so it becomes
 *     `failed`, which `ensureMandate` re-grants properly on next use. The pod is
 *     not touched for it: nothing of ours was ever written there.
 *
 * @param {object} raw
 * @returns {object} the same object
 */
function migrate(raw) {
  const out = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || !entry.record) continue;
    const rec = entry.record;
    const pod = mandateLib.podOf(rec);
    if (pod && !rec.pod) rec.pod = pod;
    let newKey = key;
    if (pod && typeof rec.container === 'string' && !rec.container.startsWith('/pods/')) {
      const moved = `/pods/${pod}${rec.container.startsWith('/') ? '' : '/'}${rec.container}`;
      try {
        rec.container = mandateLib.containerInPod(moved, pod);
        newKey = keyFor(rec.agent, rec.container);
      } catch (_) {
        entry.last_error = entry.last_error || 'legacy container could not be moved into the pod';
      }
    }
    if (!STATES.includes(entry.state)) {
      if (rec.revoked === true) {
        entry.state = 'revoked';
      } else {
        entry.state = 'failed';
        entry.last_error = entry.last_error || 'legacy-unenforced: minted before mandates were enforced at the pod';
      }
    }
    // Two entries can land on one key (a legacy `/proj/x/` and an already-migrated
    // `/pods/<pod>/proj/x/`). Keep the MORE RESTRICTIVE state, whatever the key order.
    const rival = out[newKey];
    if (!rival || RESTRICTIVENESS[entry.state] > RESTRICTIVENESS[rival.state]) out[newKey] = entry;
  }
  for (const k of Object.keys(raw)) delete raw[k];
  return Object.assign(raw, out);
}

/** Higher = more denying. Used only to resolve a migration key collision. */
const RESTRICTIVENESS = Object.freeze({
  active: 1, granting: 2, failed: 3, expired: 3, revoking: 4, revoked_unpublished: 5, revoked: 6,
});

// ── read / write ─────────────────────────────────────────────────────────────

/**
 * Read the registry (migrated). Absent file → `{}`.
 *
 * @returns {object} flat map of key → entry
 * @throws {RegistryError} when the file exists but cannot be parsed or read
 */
function load() {
  let text;
  try {
    text = fs.readFileSync(registryPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new RegistryError(`cannot read the mandate registry: ${err.message}`, err);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new RegistryError(`the mandate registry is corrupt (${registryPath()}); refusing to treat it as empty`, err);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new RegistryError('the mandate registry is not a JSON object; refusing to treat it as empty');
  }
  return migrate(obj);
}

function fsyncDir(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch (_) { /* best effort on filesystems that refuse */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ignore */ }
  }
}

/** Write the registry atomically: tmp + fsync + rename, mode 0600. */
function save(reg) {
  const dir = mandatesDir();
  const finalPath = registryPath();
  const tmpPath = path.join(dir, `.registry.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    ensureDir();
    const fd = fs.openSync(tmpPath, 'wx', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(reg, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, finalPath);
    fsyncDir(dir);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* may not exist */ }
    throw new RegistryError(`cannot write the mandate registry: ${err.message}`, err);
  }
}

/**
 * Serialised read-modify-write. `fn` receives the migrated registry and mutates
 * it in place (or returns a replacement); the result is saved atomically and
 * `fn`'s return value is returned.
 *
 * @template T
 * @param {(reg: object) => T} fn
 * @returns {Promise<T>}
 */
function update(fn) {
  return withLock('registry', () => {
    ensureDir();
    // Cross-process exclusion for the read-modify-write (the critical section is synchronous).
    return journalLock.withLock(mandatesDir(), () => {
      const reg = load();
      const out = fn(reg);
      save(reg);
      return out;
    });
  });
}

// ── queries ──────────────────────────────────────────────────────────────────

/**
 * Is this entry enforceable right now? Only an `active` mandate that has not
 * passed its expiry. Every other state, and a missing entry, is inactive.
 *
 * @param {object|undefined} entry
 * @param {number} [nowSec]
 */
function isEnforceable(entry, nowSec) {
  if (!entry || entry.state !== 'active' || !entry.record) return false;
  return mandateLib.isMandateActive(entry.record, nowSec);
}

/** `{ key, entry }` for a mandate URN, or null. */
function findByUrn(reg, urn) {
  for (const [key, entry] of Object.entries(reg)) {
    if (entry && entry.record && entry.record.urn === urn) return { key, entry };
  }
  return null;
}

/** Entries on `container`, optionally restricted by a predicate. */
function onContainer(reg, container, pred = () => true) {
  const c = container.endsWith('/') ? container : `${container}/`;
  return Object.entries(reg).filter(([, e]) => e && e.record && e.record.container === c && pred(e));
}

/** Records that must appear in `container`'s sidecar: the enforceable ones. */
function activeRecords(reg, container, nowSec) {
  return onContainer(reg, container, (e) => isEnforceable(e, nowSec)).map(([, e]) => e.record);
}

// ── audit ────────────────────────────────────────────────────────────────────

/**
 * Append one transition to `mandates/audit.jsonl` through the journal writer
 * (single O_APPEND write, torn-tail repair) under the cross-process journal lock.
 * Best effort by design: the pod has already been changed when a late audit
 * write fails, and refusing then would leave a half-applied revoke. A failure is
 * returned, not thrown, so the caller can log it.
 *
 * @param {object} fields - `action` plus whatever identifies the change
 * @param {{ now?: number }} [opts]
 * @returns {boolean} whether the line was written
 */
function audit(fields, opts = {}) {
  try {
    const line = `${JSON.stringify({ ts: new Date((opts.now || Math.floor(Date.now() / 1000)) * 1000).toISOString(), ...fields })}\n`;
    ensureDir();
    journalLock.withLock(mandatesDir(), () => journalAppend.appendLine(auditPath(), line));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  STATES,
  RegistryError,
  keyFor,
  load,
  save,
  update,
  ensureDir,
  migrate,
  withLock,
  withContainerLock,
  isEnforceable,
  findByUrn,
  onContainer,
  activeRecords,
  audit,
  registryPath,
  auditPath,
  stateDir,
};
