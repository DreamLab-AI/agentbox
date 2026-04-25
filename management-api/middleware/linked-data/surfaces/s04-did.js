'use strict';

/**
 * S4 — DID Documents (W3C DID Core 1.0).
 *
 * Direction: emit. Form: Compacted. Vocabulary: DID v1 + did:nostr method.
 * Manifest gate: [linked_data].did_documents. Prerequisite:
 * sovereign_mesh.solid_pod = true (the document is published at
 * /.well-known/did.json via solid-pod-rs).
 *
 * Builds the DID Document for `did:nostr:<npub>` — the agent's primary
 * sovereign identifier — including verification methods (Schnorr public
 * key) and service endpoints (pod base URL, embedded relay URL).
 */

const DID_CONTEXT = 'https://www.w3.org/ns/did/v1';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';

module.exports = {
  id: 'S4',
  slot: 'pods',                          // DID Doc is served from the pod's .well-known
  gateKey: 'did_documents',
  prerequisiteAdapter: 'sovereign_mesh.solid_pod',
  form: 'compacted',
  direction: 'emit',
  operations: ['publish'],
  canonicalisation: 'none',
  vocabularyBinding: ['did:', 'agbx:'],
  contextIri: DID_CONTEXT,

  async encode(payload, { manifest, agentDid }) {
    const did = payload?.did || agentDid;
    if (!did) throw new Error('S4 encode: did required (set agentDid or payload.did)');
    if (!did.startsWith('did:nostr:')) {
      throw new Error(`S4 encode: only did:nostr: methods are currently emitted (got ${did})`);
    }
    const pubkey = did.slice('did:nostr:'.length);
    // The DID itself is the BIP-340 x-only pubkey hex; payload.pubkeyHex
    // is kept as an explicit input for callers that want to attach a
    // verification method without inferring it from the DID method.
    const pubkeyHex = payload?.pubkeyHex || pubkey;

    const services = [];
    const ld = manifest && manifest.linked_data && manifest.linked_data.did;
    const enabled = ld?.service_endpoints || ['pod', 'relay'];

    if (enabled.includes('pod')) {
      const sp = (manifest?.integrations?.solid_pod_rs) || {};
      services.push({
        id: `${did}#pod`,
        type: 'SolidPod',
        serviceEndpoint: sp.base_url || `http://${sp.bind || '127.0.0.1'}:${sp.port || 8484}`,
      });
    }
    if (enabled.includes('relay')) {
      const r = (manifest?.sovereign_mesh?.relay) || {};
      const port = r.port || 7777;
      const bind = r.bind || '127.0.0.1';
      services.push({
        id: `${did}#relay`,
        type: 'NostrRelay',
        serviceEndpoint: `ws://${bind}:${port}`,
      });
    }

    const verificationMethods = [];
    if (pubkeyHex) {
      verificationMethods.push({
        id: `${did}#schnorr-pubkey`,
        type: 'SchnorrSecp256k1VerificationKey2025',
        controller: did,
        publicKeyHex: pubkeyHex,
      });
    }

    const doc = {
      '@context': [DID_CONTEXT, AGBX_CONTEXT],
      id: did,
      verificationMethod: verificationMethods,
      service: services,
      authentication: pubkeyHex ? [`${did}#schnorr-pubkey`] : [],
      assertionMethod: pubkeyHex ? [`${did}#schnorr-pubkey`] : [],
    };

    if (payload?.alsoKnownAs) doc.alsoKnownAs = payload.alsoKnownAs;
    if (payload?.controller) doc.controller = payload.controller;

    return { document: doc, contextIri: DID_CONTEXT, pubkey };
  },
};
