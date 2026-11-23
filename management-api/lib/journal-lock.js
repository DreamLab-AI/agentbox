'use strict';

/**
 * journal-lock — cross-process mutual exclusion for the events journal.
 *
 * The hash chain (ADR-039) is one linear sequence, but every process that
 * builds a record needs the current tail first: read tail, compute the hash,
 * append. Two processes doing that at once both extend the same head and fork
 * `prev_hash` (JOURNAL-LOCK). `withLock` serialises the whole read-compute-
 * append span.
 *
 * Mechanism: an `O_EXCL` lockfile (`<eventsDir>/.journal.lock`). Node has no
 * `flock(2)` binding without a native dependency, so crash safety comes from
 * stale-lock handling instead of the kernel: the file holds `{pid, token, ts}`
 * and a waiter takes it over when the holder's pid is gone (`ESRCH`), when the
 * file is unreadable for longer than {@link TORN_MS} (a crash between create
 * and write), or when it is older than {@link MAX_HOLD_MS} (a pid recycled by
 * an unrelated process, or a hung holder; the critical section is a few
 * milliseconds). Takeover is `rename(2)` to a unique name, which only one
 * waiter can win; if the renamed file is not the one that was judged stale the
 * live lock is put back.
 *
 * Residual window: a takeover that displaces a *live* lock and loses the race
 * to restore it can let two holders overlap once. The verifier would then
 * report the fork, so it stays detectable; it needs two simultaneous takeovers
 * of one dead lock plus a third creator inside the same few microseconds.
 *
 * Synchronous on purpose: the caller's critical section is synchronous, so
 * within one process the lock is never held across an await.
 *
 * @see adapters/events/local-jsonl.js
 * @see lib/audit-chain.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_NAME = '.journal.lock';
const TORN_MS = 2000;
const MAX_HOLD_MS = 30000;
const DEFAULT_TIMEOUT_MS = 15000;

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
/** Block the thread for `ms` without spinning. */
function pause(ms) { Atomics.wait(sleepCell, 0, 0, ms); }

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, owned by someone else
  }
}

/** @returns {string|null} raw lockfile content, null when absent */
function readRaw(lockPath) {
  try { return fs.readFileSync(lockPath, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function isStale(raw, lockPath, now) {
  let meta = null;
  try { meta = JSON.parse(raw); } catch (_) { /* torn */ }
  if (meta && Number.isInteger(meta.pid) && typeof meta.ts === 'number') {
    if (now - meta.ts > MAX_HOLD_MS) return true;
    return !pidAlive(meta.pid);
  }
  // Empty or half-written: only a crash between create and write leaves this
  // behind for long, so give a live creator TORN_MS to finish.
  try { return now - fs.statSync(lockPath).mtimeMs > TORN_MS; } catch (_) { return false; }
}

/** Take over a lock judged stale (`raw` is what was judged). */
function breakStale(lockPath, raw) {
  const aside = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(lockPath, aside); } catch (err) {
    if (err.code === 'ENOENT') return; // someone else got there first
    throw err;
  }
  let moved = null;
  try { moved = fs.readFileSync(aside, 'utf8'); } catch (_) { /* gone */ }
  if (moved !== null && moved !== raw) {
    // We displaced a lock that was not the stale one: put it back.
    try { fs.linkSync(aside, lockPath); } catch (_) { /* another creator won; see header */ }
  }
  try { fs.unlinkSync(aside); } catch (_) { /* best effort */ }
}

function acquire(lockPath, timeoutMs) {
  const token = crypto.randomBytes(8).toString('hex');
  const body = () => JSON.stringify({ pid: process.pid, token, ts: Date.now() });
  const deadline = Date.now() + timeoutMs;
  let delay = 1;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeSync(fd, body());
      } catch (werr) {
        // Never leave an empty lockfile behind: every waiter would sit out TORN_MS.
        try { fs.unlinkSync(lockPath); } catch (_) { /* best effort */ }
        throw werr;
      } finally {
        fs.closeSync(fd);
      }
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const raw = readRaw(lockPath);
    if (raw !== null && isStale(raw, lockPath, Date.now())) {
      breakStale(lockPath, raw);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`journal-lock: timed out after ${timeoutMs} ms waiting for ${lockPath}`);
    }
    pause(delay);
    delay = Math.min(delay * 2, 20);
  }
}

function release(lockPath, token) {
  const raw = readRaw(lockPath);
  if (raw === null) return;
  let meta = null;
  try { meta = JSON.parse(raw); } catch (_) { /* not ours */ }
  if (meta && meta.token === token) {
    try { fs.unlinkSync(lockPath); } catch (_) { /* already gone */ }
  }
}

/**
 * Run `fn` while holding the journal lock for `dir`. `fn` must be synchronous.
 * It receives `{ assertHeld }`; call that immediately before writing, so a holder
 * that stalled and was taken over throws instead of appending from an old head.
 *
 * @template T
 * @param {string} dir - the events directory (created if missing)
 * @param {(lock: {assertHeld: () => void}) => T} fn
 * @param {{timeoutMs?: number}} [opts]
 * @returns {T}
 * @throws {Error} when the lock is not obtained in time, or whatever `fn` throws
 */
function withLock(dir, fn, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, LOCK_NAME);
  const token = acquire(lockPath, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  // A holder stalled past MAX_HOLD_MS (SIGSTOP, a paused VM) can be taken over
  // while it is still alive. `assertHeld` lets it notice before it writes.
  const assertHeld = () => {
    let meta = null;
    try { meta = JSON.parse(readRaw(lockPath) || ''); } catch (_) { /* gone or torn */ }
    if (!meta || meta.token !== token) {
      throw new Error(`journal-lock: lost ${lockPath} while holding it (taken over after a stall)`);
    }
  };
  try {
    return fn({ assertHeld });
  } finally {
    release(lockPath, token);
  }
}

/**
 * Lower-level pair for a caller that must hold the lock across an `await`
 * (`withLock` releases when its callback returns, so it cannot). Same lockfile
 * format and stale-holder takeover. The wait is synchronous, so callers
 * serialise in-process first and only ever block against ANOTHER process.
 */
module.exports = { withLock, LOCK_NAME, acquire, release };
