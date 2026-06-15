'use strict';

/**
 * S4 — DID Documents (did:nostr method, did-nostr CG single Multikey form).
 *
 * Direction: emit. Form: Compacted. Vocabulary: did v1 + did:nostr context.
 * Manifest gate: [linked_data].did_documents. Prerequisite:
 * sovereign_mesh.solid_pod = true (the document is published at
 * /.well-known/did.json via solid-pod-rs).
 *
 * Builds the DID Document for `did:nostr:<hex-pubkey>` — the agent's primary
 * sovereign identifier. Emits the canonical did-nostr Community Group single
 * form (ground truth: melvincarvalho/create-agent index.js,
 * nostrcg.github.io/did-nostr): a single `Multikey` verification method whose
 * `publicKeyMultibase` is `fe70102` + the 64-char lowercase x-only hex.
 *
 * `fe70102<hex>` decodes as `f` (base16-lower multibase) ‖ `e701`
 * (varint(0xe7) = secp256k1-pub) ‖ `02` (SEC1 compressed even-y prefix —
 * load-bearing multicodec payload, the first byte of the 33-byte compressed
 * point, NOT a separator) ‖ `<hex>` (the 32-byte x-only X). BIP-340 lift_x
 * always selects even-y, so the parity byte is invariantly `02`. Fixed length:
 * total multibase string = 71 chars (`f` + 4 + 2 + 64). The `02` byte changes
 * no key bytes (ADR-033 I2) — round-trips to the identical did:nostr:<hex>.
 *
 * The old SchnorrSecp256k1VerificationKey2019 / publicKeyHex shape (ADR-074 D2)
 * is superseded by ADR-033; ADR-074 D1 (x-only hex = canonical identity)
 * stays. NIP-98 auth verifies the RAW pubkey in the event and never reads this
 * verificationMethod (ADR-033 I3), so re-encoding the VM cannot touch auth.
 */

const DID_CONTEXT = 'https://w3id.org/did';
const NOSTR_CONTEXT = 'https://w3id.org/nostr/context';

// did-nostr Multikey: f(base16-lower) e701(secp256k1-pub varint) 02(even-y).
const MULTIKEY_PREFIX = 'fe70102';

module.exports = {
  id: 'S4',
  slot: 'pods',                          // DID Doc is served from the pod's .well-known
  gateKey: 'did_documents',
  prerequisiteAdapter: 'sovereign_mesh.solid_pod',
  form: 'compacted',
  direction: 'emit',
  operations: ['publish'],
  canonicalisation: 'none',
  vocabularyBinding: ['did:', 'nostr:'],
  contextIri: DID_CONTEXT,

  async encode(payload, { manifest, agentDid }) {
    const did = payload?.did || agentDid;
    if (!did) throw new Error('S4 encode: did required (set agentDid or payload.did)');
    if (!did.startsWith('did:nostr:')) {
      throw new Error(`S4 encode: only did:nostr: methods are currently emitted (got ${did})`);
    }
    const pubkey = did.slice('did:nostr:'.length);
    // Identity is the BIP-340 x-only (even-y) hex pubkey carried in the DID
    // method-specific id (ADR-033 I1). payload.xOnlyHex is accepted as an
    // explicit override; if absent the x-only hex is read from the DID body.
    // The legacy payload.pubkeyHex name remains accepted as an alias.
    const xOnlyHex = (payload?.xOnlyHex || payload?.pubkeyHex || pubkey || '').toLowerCase();
    if (xOnlyHex && !/^[0-9a-f]{64}$/.test(xOnlyHex)) {
      throw new Error(`S4 encode: x-only pubkey must be 64 lowercase hex chars (got ${xOnlyHex.length})`);
    }

    // did-nostr CG single Multikey form. publicKeyMultibase = fe70102 + x-only
    // hex. The `02` parity byte is the SEC1 compressed-point even-y prefix (the
    // first byte of the 33-byte multicodec payload), NOT a separator — it is
    // load-bearing (ADR-033 I2). Output is a fixed 71 chars and round-trips to
    // the identical key with no key-byte change.
    const publicKeyMultibase = xOnlyHex ? `${MULTIKEY_PREFIX}${xOnlyHex}` : undefined;

    const verificationMethod = [];
    if (publicKeyMultibase) {
      verificationMethod.push({
        id: `${did}#key1`,
        type: 'Multikey',
        controller: did,
        publicKeyMultibase,
      });
    }

    const doc = {
      '@context': [DID_CONTEXT, NOSTR_CONTEXT],
      id: did,
      type: 'DIDNostr',
      verificationMethod,
      authentication: publicKeyMultibase ? ['#key1'] : [],
      assertionMethod: publicKeyMultibase ? ['#key1'] : [],
      // The canonical create-agent / did-nostr CG reference output is the empty
      // service array. Populated service[] (SolidWebID, NostrRelay, …) are
      // agentbox extensions, layered by callers, not the canonical form.
      service: [],
    };

    // agentbox extension: callers MAY attach service endpoints (pod, relay,
    // WebID). These are permitted by the optional `service` field but are NOT
    // part of the canonical create-agent shape.
    const ld = manifest && manifest.linked_data && manifest.linked_data.did;
    const enabled = ld?.service_endpoints || [];
    if (enabled.includes('pod')) {
      const sp = (manifest?.integrations?.solid_pod_rs) || {};
      doc.service.push({
        id: `${did}#pod`,
        type: 'SolidStorage',
        serviceEndpoint: sp.base_url || `http://${sp.bind || '127.0.0.1'}:${sp.port || 8484}`,
      });
    }
    if (enabled.includes('relay')) {
      const r = (manifest?.sovereign_mesh?.relay) || {};
      const port = r.port || 7777;
      const bind = r.bind || '127.0.0.1';
      doc.service.push({
        id: `${did}#relay`,
        type: 'NostrRelay',
        serviceEndpoint: `ws://${bind}:${port}`,
      });
    }

    if (payload?.alsoKnownAs) doc.alsoKnownAs = payload.alsoKnownAs;
    if (payload?.controller) doc.controller = payload.controller;

    return { document: doc, contextIri: DID_CONTEXT, pubkey };
  },
};
