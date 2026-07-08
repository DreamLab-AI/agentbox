'use strict';

/**
 * agent-identity — mint (or load) a per-agent did:nostr at spawn.
 *
 * COM-14 / ADR-037 D6. Before this module, config/entrypoint-unified.sh
 * exported the placeholder `AGENTBOX_AGENT_DID=did:nostr:local`, a default
 * nobody set, so every spawned agent presented an unverifiable identity. This
 * module derives a real per-agent BIP-340 secp256k1 keypair at spawn time,
 * persists the private key per profile (600 perms, so a restart of the same
 * profile keeps the same identity), and prints the public `did:nostr:<hex>`
 * for the entrypoint to export. VisionClaw keys a node by the minted DID and
 * verifies it before trust (the consumer side, D4/M1).
 *
 * Key handling (invariants):
 *   - The 64-char hex private key is written to the profile key file with 0600
 *     perms and is NEVER printed to stdout, logged, or placed in a spawn
 *     payload. Only the public did:nostr / x-only pubkey / Multikey leave here.
 *   - The keypair derive path mirrors junkiejarvis-agent.js `signerFromHex`
 *     (`getPublicKey(skBytes)` → BIP-340 x-only hex); fresh keys use
 *     nostr-tools `generateSecretKey()`.
 *   - The DID string is `did:nostr:<64-hex>` — the canonical identity, left
 *     unchanged by ADR-033 (I1). The Multikey `publicKeyMultibase`
 *     (`fe70102<hex>`, ADR-033 D3′/I2) is offered alongside for a downstream
 *     that verifies against the DID-document verification method.
 *
 * Fail-open: any error returns null so the entrypoint falls back to the
 * historic `did:nostr:local` placeholder rather than aborting the bootstrap.
 */

const fs = require('fs');
const path = require('path');

let nostrTools = null;
function getNostrTools() {
  if (!nostrTools) nostrTools = require('nostr-tools');
  return nostrTools;
}

// did-nostr Multikey prefix (ADR-033 D3′): f(base16-lower) ‖ e701(varint
// secp256k1-pub) ‖ 02(SEC1 compressed even-y prefix) ‖ x-only hex. The `02`
// is load-bearing multicodec payload, not a separator — BIP-340 lift_x always
// yields even-y so it is invariantly `02`. Fixed 71-char publicKeyMultibase
// that round-trips to the identical key. Mirrors scripts/sovereign-bootstrap.py.
const MULTIKEY_PREFIX = 'fe70102';

const HEX64 = /^[0-9a-f]{64}$/;

/** did-nostr CG Multikey encoding of a 32-byte BIP-340 x-only pubkey. */
function multikeyFromXonly(xOnlyHex) {
  return `${MULTIKEY_PREFIX}${String(xOnlyHex).trim().toLowerCase()}`;
}

/**
 * Derive the BIP-340 x-only (even-y) pubkey hex from a 64-char private key hex.
 * Mirrors junkiejarvis-agent.js signerFromHex — same getPublicKey path.
 * @param {string} privHex
 * @returns {string|null} 64-char lowercase x-only hex, or null if invalid.
 */
function deriveXonly(privHex) {
  if (typeof privHex !== 'string' || !HEX64.test(privHex.trim().toLowerCase())) return null;
  const { getPublicKey } = getNostrTools();
  const skBytes = Uint8Array.from(Buffer.from(privHex.trim(), 'hex'));
  return getPublicKey(skBytes);
}

/**
 * Resolve the per-profile private-key file path.
 *
 * The profile identifier keys the file, so distinct profiles get distinct
 * durable identities and a restart of the same profile reuses its key. The
 * default state root matches the sovereign identity root
 * (scripts/sovereign-bootstrap.py).
 *
 * @param {object} [opts]
 * @param {string} [opts.profile]     - explicit profile id.
 * @param {string} [opts.identityDir] - explicit state directory.
 * @returns {string}
 */
function profileKeyPath(opts = {}) {
  const dir = opts.identityDir
    || process.env.AGENTBOX_AGENT_IDENTITY_DIR
    || '/var/lib/agentbox/identities';
  const profileRaw = opts.profile
    || process.env.AGENTBOX_PROFILE
    || process.env.AGENTBOX_STACK
    || process.env.AGENTBOX_AGENT_ID
    || 'default';
  const profile = String(profileRaw).replace(/[^A-Za-z0-9._-]/g, '_') || 'default';
  return path.join(dir, `agent-did-${profile}.key`);
}

/**
 * Mint or load a per-agent did:nostr, persisting the private key per profile.
 *
 * Precedence for the private key: (1) an explicit
 * `AGENTBOX_AGENT_PRIVKEY_HEX` env override (stable-identity injection), then
 * (2) the persisted profile key file, then (3) a freshly generated key.
 *
 * @param {object} [opts]
 * @param {string} [opts.keyPath]     - override the persisted key-file path.
 * @param {string} [opts.profile]     - profile id (see profileKeyPath).
 * @param {string} [opts.identityDir] - state dir (see profileKeyPath).
 * @returns {{did:string, pubkey:string, multikey:string, keyPath:string,
 *            minted:boolean, persisted:boolean}|null}
 */
function loadOrMint(opts = {}) {
  try {
    const keyPath = opts.keyPath || profileKeyPath(opts);
    let privHex = null;
    let minted = false;

    const envHex = String(process.env.AGENTBOX_AGENT_PRIVKEY_HEX || '').trim().toLowerCase();
    if (HEX64.test(envHex)) {
      privHex = envHex;
    }

    if (!privHex) {
      try {
        const stored = fs.readFileSync(keyPath, 'utf8').trim().toLowerCase();
        if (HEX64.test(stored)) privHex = stored;
      } catch (_) {
        // No persisted key yet — fall through to mint.
      }
    }

    if (!privHex) {
      const { generateSecretKey } = getNostrTools();
      privHex = Buffer.from(generateSecretKey()).toString('hex');
      minted = true;
    }

    const xOnly = deriveXonly(privHex);
    if (!xOnly || !HEX64.test(xOnly)) return null;

    // Persist with 0600 so the key survives a restart of this profile and no
    // other uid can read it. Never emit privHex anywhere else.
    let persisted = false;
    try {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, `${privHex}\n`, { mode: 0o600 });
      fs.chmodSync(keyPath, 0o600);
      persisted = true;
    } catch (_) {
      // Persistence failure is non-fatal: the DID is still valid for this run,
      // it just will not be stable across a restart. The caller logs this.
    }

    return {
      did: `did:nostr:${xOnly}`,
      pubkey: xOnly,
      multikey: multikeyFromXonly(xOnly),
      keyPath,
      minted,
      persisted,
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  loadOrMint,
  deriveXonly,
  multikeyFromXonly,
  profileKeyPath,
  MULTIKEY_PREFIX,
};

// ─── CLI (env-gated shell integration) ──────────────────────────────────────
//
// `node agent-identity.js mint` prints shell `export` lines to stdout for the
// entrypoint to eval, and a single status line to stderr. The private key is
// never printed. Exit 0 on success; exit 1 (with no exports) on any failure so
// the entrypoint keeps its `${VAR:-did:nostr:local}` fallback.
if (require.main === module) {
  const cmd = process.argv[2] || 'mint';
  if (cmd !== 'mint') {
    process.stderr.write(`agent-identity: unknown command '${cmd}' (expected: mint)\n`);
    process.exit(1);
  }
  const id = loadOrMint();
  if (!id) {
    process.stderr.write('agent-identity: could not derive a did:nostr (fail-open; caller keeps did:nostr:local)\n');
    process.exit(1);
  }
  process.stdout.write(
    `export AGENTBOX_AGENT_DID=${id.did}\n`
    + `export AGENTBOX_AGENT_PUBKEY=${id.pubkey}\n`
    + `export AGENTBOX_AGENT_DID_MULTIKEY=${id.multikey}\n`
  );
  process.stderr.write(
    `agent-identity: ${id.minted ? 'minted' : 'loaded'} ${id.did} `
    + `(persisted=${id.persisted}, keyfile=${id.keyPath})\n`
  );
  process.exit(0);
}
