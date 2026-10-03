'use strict';

/**
 * role-secret — the one JS loader for ROLE secrets (custody X-1 step 1, W2,
 * bypass 3). Re-exported by agent-identity.js; hooks and scripts that live
 * outside management-api require this file directly.
 *
 * A ROLE variable (the ROLE set of config/custody/env-classes.json) holds a
 * signing or join key that must not sit in every process's environment. Under
 * [security].role_isolation the entrypoint writes each one to a file, exports
 * `<NAME>_FILE`, and unsets `<NAME>` before supervisord starts.
 *
 * Precedence, identical to the Rust loader
 * (services/nostr-pod-bridge/src/role_secret.rs):
 *   1. `<NAME>_FILE`, when set and non-empty, wins. Its contents are read
 *      (bounded, trimmed). An unreadable file throws, naming the path, never
 *      falling back.
 *   2. `$AGENTBOX_SECRETS_DIR/<NAME>`, when that file exists. W1's isolated
 *      supervisor config sets AGENTBOX_SECRETS_DIR for each role program to its
 *      /run/secrets/<role>, where the delivery plan writes env-sourced secrets
 *      under their variable's name (config/role-accounts.json).
 *   3. `opts.defaultFile`, when it exists.
 *   4. `<NAME>` itself, ONLY while the flag is off. Under the flag a ROLE
 *      variable present at all is reported as `ROLE-ISOLATION-LEAK <NAME>` and
 *      ignored.
 *
 * The flag is AGENTBOX_ROLE_ISOLATION=1, exported by the entrypoint from the
 * manifest. Nothing here ever logs, returns in an error, or prints a value.
 */

const fs = require('fs');
const path = require('path');

const FLAG_VAR = 'AGENTBOX_ROLE_ISOLATION';
const SECRETS_DIR_VAR = 'AGENTBOX_SECRETS_DIR';
/** Keys and tokens are far below this; a bigger file is a misconfiguration. */
const MAX_SECRET_FILE_BYTES = 4096;

const reported = new Set();

function roleIsolation(env = process.env) {
  return String(env[FLAG_VAR] ?? '') === '1';
}

function fileVar(name) {
  return `${name}_FILE`;
}

/**
 * Read a secret file: a regular file of at most MAX_SECRET_FILE_BYTES, UTF-8,
 * trimmed. Errors name the path only.
 *
 * @param {string} file
 * @param {object} [fsImpl] - injectable fs (tests)
 * @returns {string}
 */
function readSecretFile(file, fsImpl = fs) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
  } catch (err) {
    throw new Error(`secret file ${file} cannot be opened (${err.code || 'error'})`);
  }
  try {
    const st = fsImpl.fstatSync(fd);
    if (!st.isFile()) throw new Error(`secret file ${file} is not a regular file`);
    if (st.size > MAX_SECRET_FILE_BYTES) {
      throw new Error(`secret file ${file} is larger than ${MAX_SECRET_FILE_BYTES} bytes`);
    }
    const buf = Buffer.alloc(MAX_SECRET_FILE_BYTES + 1);
    const n = fsImpl.readSync(fd, buf, 0, buf.length, 0);
    if (n > MAX_SECRET_FILE_BYTES) {
      throw new Error(`secret file ${file} is larger than ${MAX_SECRET_FILE_BYTES} bytes`);
    }
    const text = buf.subarray(0, n).toString('utf8').trim();
    buf.fill(0);
    return text;
  } finally {
    fsImpl.closeSync(fd);
  }
}

function defaultLog(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Resolve `name` without logging.
 *
 * @param {string} name
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {string} [opts.defaultFile]
 * @param {object} [opts.fs]
 * @returns {{value:string, source:('file'|'env'|null), file:(string|null), leaked:boolean}}
 */
function resolveRoleSecret(name, opts = {}) {
  const env = opts.env || process.env;
  const fsImpl = opts.fs || fs;
  const isolated = roleIsolation(env);
  const leaked = isolated && Object.prototype.hasOwnProperty.call(env, name);
  let file = String(env[fileVar(name)] ?? '').trim() || null;
  const isFile = (p) => { try { return fsImpl.statSync(p).isFile(); } catch (_) { return false; } };
  const secretsDir = String(env[SECRETS_DIR_VAR] ?? '').trim();
  if (!file && secretsDir && isFile(path.join(secretsDir, name))) file = path.join(secretsDir, name);
  if (!file && opts.defaultFile) {
    try {
      if (fsImpl.statSync(opts.defaultFile).isFile()) file = opts.defaultFile;
    } catch (_) { /* absent default: fall through */ }
  }
  if (file) {
    let value;
    try {
      value = readSecretFile(file, fsImpl);
    } catch (err) {
      throw new Error(`resolving ${name}: ${err.message}`);
    }
    return { value, source: value ? 'file' : null, file, leaked };
  }
  if (isolated) return { value: '', source: null, file: null, leaked };
  const value = String(env[name] ?? '').trim();
  return { value, source: value ? 'env' : null, file: null, leaked: false };
}

function reportLeak(name, log) {
  const key = name;
  if (reported.has(key)) return;
  reported.add(key);
  log(`[role-secret] ROLE-ISOLATION-LEAK ${name} is set in the environment under role isolation; ignored (deliver it as ${fileVar(name)})`);
}

/**
 * The value of ROLE variable `name` ('' when none), reporting a leak once per
 * process. Throws when `<NAME>_FILE` is set but unreadable.
 *
 * @param {string} name
 * @param {object} [opts] - see resolveRoleSecret; opts.log replaces stderr.
 * @returns {string}
 */
function readRoleSecret(name, opts = {}) {
  const r = resolveRoleSecret(name, opts);
  if (r.leaked) reportLeak(name, opts.log || defaultLog);
  return r.value;
}

/**
 * The first of `names` that resolves, with the name that supplied it. Every
 * name is checked for a leak.
 *
 * @param {string[]} names
 * @param {object} [opts]
 * @returns {{value:string, name:(string|null)}}
 */
function readRoleSecretFirst(names, opts = {}) {
  let found = { value: '', name: null };
  for (const name of names) {
    const r = resolveRoleSecret(name, opts);
    if (r.leaked) reportLeak(name, opts.log || defaultLog);
    if (!found.name && r.value) found = { value: r.value, name };
  }
  return found;
}

/** Test seam: forget which leaks were already reported. */
function _resetReported() {
  reported.clear();
}

module.exports = {
  FLAG_VAR,
  SECRETS_DIR_VAR,
  MAX_SECRET_FILE_BYTES,
  roleIsolation,
  fileVar,
  readSecretFile,
  resolveRoleSecret,
  readRoleSecret,
  readRoleSecretFirst,
  _resetReported,
};
