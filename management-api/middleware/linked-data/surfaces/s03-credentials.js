'use strict';

/**
 * S3 — Verifiable Credentials (W3C VC Data Model 2.0).
 *
 * Direction: emit. Form: Compacted. Vocabulary: VC v2 + agbx.
 * Manifest gate: [linked_data].credentials. Canonicalisation: JCS.
 *
 * Used to wrap bead-claim work receipts, agent-identity attestations,
 * and consultant-tier per-call receipts as Verifiable Credentials. The
 * proof block is constructed elsewhere (the signer is the AgentIdentity
 * aggregate from DDD-003); this surface produces the unsigned credential
 * body that the signer canonicalises with JCS and signs.
 */

const VC_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';

module.exports = {
  id: 'S3',
  slot: 'pods',                          // VCs land in pods/<npub>/credentials/
  gateKey: 'credentials',
  prerequisiteAdapter: 'adapters.pods',
  form: 'compacted',
  direction: 'emit',
  operations: ['issue'],
  canonicalisation: 'jcs',
  vocabularyBinding: ['vc:', 'agbx:'],
  contextIri: VC_CONTEXT,

  async encode(payload, { agentDid }) {
    if (!payload) throw new Error('S3 encode: payload required');
    if (!payload.credentialSubject && !payload.subject) {
      throw new Error('S3 encode: payload.credentialSubject (or .subject) required');
    }

    const id = payload.id ||
      `urn:uuid:${_uuidV4()}`;

    const doc = {
      '@context': [
        VC_CONTEXT,
        AGBX_CONTEXT,
      ],
      id,
      type: ['VerifiableCredential'].concat(payload.type || []),
      issuer: payload.issuer || agentDid || null,
      validFrom: payload.validFrom || new Date().toISOString(),
      credentialSubject: payload.credentialSubject || payload.subject,
    };

    if (payload.validUntil) doc.validUntil = payload.validUntil;
    if (payload.evidence) doc.evidence = payload.evidence;
    if (payload.termsOfUse) doc.termsOfUse = payload.termsOfUse;
    if (payload.refreshService) doc.refreshService = payload.refreshService;
    if (payload.credentialStatus) doc.credentialStatus = payload.credentialStatus;
    if (payload.credentialSchema) doc.credentialSchema = payload.credentialSchema;

    if (!doc.issuer) {
      throw new Error('S3 encode: cannot issue VC without an issuer DID');
    }

    return { document: doc, contextIri: VC_CONTEXT };
  },
};

function _uuidV4() {
  // RFC 4122 v4 uuid via crypto.randomUUID where available, fallback for
  // older Node. Matches Node 16+ behaviour.
  try {
    return require('crypto').randomUUID();
  } catch {
    const b = require('crypto').randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
}
