'use strict';

/**
 * operator-key — the operator (sovereign) signing key for the live-mirror hook,
 * the nostr-gateway and nostr-send (custody X-1 step 1, W2, bypass 3).
 *
 * Under [security].role_isolation the key comes through the shared ROLE-secret
 * loader (management-api/lib/role-secret.js): `<NAME>_FILE` only; a bare
 * variable is reported as ROLE-ISOLATION-LEAK and ignored. The entrypoint
 * delivers AGENTBOX_PRIVKEY_HEX_FILE / OPERATOR_NOSTR_PRIVKEY_FILE, and
 * identity.env exports AGENTBOX_BRIDGE_SK_FILE.
 *
 * With the flag off the read is the pre-W2 one, unchanged: the first non-empty
 * of the three variables. The mirror child key and the gateway identity derive
 * from this key and must not move, and AGENTBOX_BRIDGE_SK_FILE is exported with
 * the flag off too, so a file-first read there would change which key wins.
 */

const path = require('path');

const OPERATOR_KEY_VARS = Object.freeze(['AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY']);
const LOADER_CANDIDATES = Object.freeze([
  path.resolve(__dirname, '..', '..', '..', 'management-api', 'lib', 'role-secret.js'),
  '/opt/agentbox/management-api/lib/role-secret.js',
]);

let cached;
function roleSecretLoader(candidates = LOADER_CANDIDATES) {
  if (cached !== undefined && candidates === LOADER_CANDIDATES) return cached;
  let found = null;
  for (const c of candidates) {
    try { found = require(c); break; } catch { /* next */ }
  }
  if (candidates === LOADER_CANDIDATES) cached = found;
  return found;
}

function envFirst(env, keys) {
  for (const k of keys) {
    const v = env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * The operator key as hex ('' when none). Never throws, never logs a value.
 *
 * @param {object} [opts]
 * @param {Function} [opts.log] - receives one line per problem (names/paths only)
 * @param {object} [opts.env=process.env]
 * @param {string[]} [opts.loaderCandidates] - test seam
 * @returns {string}
 */
function operatorKeyHex(opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || (() => {});
  if (String(env.AGENTBOX_ROLE_ISOLATION || '') !== '1') return envFirst(env, OPERATOR_KEY_VARS);
  const rs = roleSecretLoader(opts.loaderCandidates || LOADER_CANDIDATES);
  if (!rs) {
    log('role-secret loader unavailable: no operator key under role isolation');
    return '';
  }
  try {
    return rs.readRoleSecretFirst(OPERATOR_KEY_VARS, { env, log }).value;
  } catch (err) {
    log(err.message);
    return '';
  }
}

module.exports = { operatorKeyHex, OPERATOR_KEY_VARS };
