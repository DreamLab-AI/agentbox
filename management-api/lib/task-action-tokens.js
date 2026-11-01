'use strict';

/**
 * lib/task-action-tokens — short-lived, per-task credential for in-task agent
 * action posts (`POST /v1/agent-events/emit|batch`).
 *
 * A running Management API task must be able to report its own actions without
 * the Management API key ever entering the task (IR3, process-manager.js). The
 * task gets an opaque bearer instead:
 *
 *   - 256 bits from `crypto.randomBytes`, base64url. No signature, no claims,
 *     no envelope: the token carries nothing, the server holds the meaning.
 *   - The store keys on SHA-256(token), so the raw token is never retained and
 *     lookup is a hash-map hit on a digest the caller cannot steer. The stored
 *     digest is still re-compared with `crypto.timingSafeEqual`.
 *   - It maps to `{ taskId, expiresAt }` in process memory only. A restart
 *     drops every token (fail closed), and tasks do not outlive the process
 *     manager's bookkeeping anyway.
 *   - Revoked on task exit / error / stop; a hard TTL is the backstop.
 *
 * The token is a secret, not a durable identifier, so it is deliberately NOT
 * minted through lib/uris.js (that is for URNs/DIDs that get stored and shown).
 * It must never be logged; nothing in this module logs.
 */

const crypto = require('crypto');

const TOKEN_BYTES = 32; // 256 bits
// spawnTask has no task timeout of its own (only the 10 s SIGTERM->SIGKILL
// grace in stopTask), so the TTL is this module's own backstop. It is a
// credential lifetime, not a task limit: normal revocation happens on exit.
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

function digest(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest();
}

class TaskActionTokenStore {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now] - clock, injectable for tests.
   * @param {number} [opts.ttlMs]
   */
  constructor(opts = {}) {
    this._now = opts.now || Date.now;
    this._ttlMs = opts.ttlMs || envTtl() || DEFAULT_TTL_MS;
    /** @type {Map<string, {hash: Buffer, taskId: string, expiresAt: number}>} */
    this._byHash = new Map();
  }

  /**
   * Mint a token scoped to one task.
   * @param {string} taskId
   * @param {number} [ttlMs]
   * @returns {string} the raw token (returned once, never stored)
   */
  mint(taskId, ttlMs) {
    if (typeof taskId !== 'string' || !taskId) throw new Error('taskId required');
    this._sweep();
    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const hash = digest(token);
    this._byHash.set(hash.toString('hex'), {
      hash,
      taskId,
      expiresAt: this._now() + (ttlMs > 0 ? ttlMs : this._ttlMs),
    });
    return token;
  }

  /**
   * @param {string} token
   * @returns {{taskId: string}|null} null for unknown, expired or revoked.
   */
  verify(token) {
    if (typeof token !== 'string' || !token) return null;
    const hash = digest(token);
    const key = hash.toString('hex');
    const rec = this._byHash.get(key);
    if (!rec) return null;
    if (rec.hash.length !== hash.length || !crypto.timingSafeEqual(rec.hash, hash)) return null;
    if (this._now() >= rec.expiresAt) {
      this._byHash.delete(key);
      return null;
    }
    return { taskId: rec.taskId };
  }

  /** Revoke one token. @param {string} token */
  revoke(token) {
    if (typeof token !== 'string' || !token) return false;
    return this._byHash.delete(digest(token).toString('hex'));
  }

  /** Revoke every token of a task. @param {string} taskId */
  revokeTask(taskId) {
    let n = 0;
    for (const [k, rec] of this._byHash) {
      if (rec.taskId === taskId) { this._byHash.delete(k); n++; }
    }
    return n;
  }

  get size() { return this._byHash.size; }

  _sweep() {
    const t = this._now();
    for (const [k, rec] of this._byHash) if (t >= rec.expiresAt) this._byHash.delete(k);
  }
}

function envTtl() {
  const n = Number(process.env.TASK_ACTION_TOKEN_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Process-wide store shared by the auth gate and the process manager. */
const taskActionTokens = new TaskActionTokenStore();

module.exports = { TaskActionTokenStore, taskActionTokens, DEFAULT_TTL_MS };
