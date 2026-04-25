'use strict';

/**
 * S8 — Agentic-payment mandates and receipts.
 *
 * Direction: bidirectional. Form: Compacted. Vocabulary: VC v2 + ODRL
 * 2.2 + Schema.org + agbx. Manifest gate: [linked_data].payments.
 * Canonicalisation: JCS.
 *
 * Mandates are signed by the human principal's DID (wraps an ODRL
 * Permission set as the credentialSubject). Receipts are signed by the
 * agent's DID and reference the mandate by `evidence.id`. Both round-trip
 * and JCS-canonicalise; the proof block is constructed elsewhere.
 */

const VC_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
const ODRL_CONTEXT = 'http://www.w3.org/ns/odrl/2/';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S8',
  slot: 'pods',
  gateKey: 'payments',
  prerequisiteAdapter: 'adapters.pods',
  form: 'compacted',
  direction: 'both',
  operations: ['issue-mandate', 'issue-receipt'],
  canonicalisation: 'jcs',
  vocabularyBinding: ['vc:', 'odrl:', 'schema:', 'agbx:'],
  contextIri: VC_CONTEXT,

  async encode(payload, { agentDid, operation }) {
    if (!payload) throw new Error('S8 encode: payload required');

    if (operation === 'issue-mandate' || payload.kind === 'mandate') {
      return _encodeMandate(payload, agentDid);
    }
    if (operation === 'issue-receipt' || payload.kind === 'receipt') {
      return _encodeReceipt(payload, agentDid);
    }
    throw new Error(`S8 encode: unknown operation ${operation || payload.kind}`);
  },
};

function _encodeMandate(payload, agentDid) {
  const principal = payload.principal || payload.issuer;
  if (!principal) throw new Error('S8 mandate: principal/issuer DID required');
  const id = uris.isCanonical(payload.id)
    ? payload.id
    : uris.mint({
        kind: 'mandate',
        npub: principal,
        payload: {
          assignee: payload.assignee || agentDid,
          target: payload.target || null,
          action: payload.action || 'odrl:use',
          constraints: payload.constraints || [],
        },
      });

  const permission = payload.permission || {};
  const mandate = {
    '@context': [VC_CONTEXT, ODRL_CONTEXT, AGBX_CONTEXT, 'http://schema.org/'],
    id,
    type: ['VerifiableCredential', 'PaymentMandate'],
    issuer: principal,
    validFrom: payload.validFrom || new Date().toISOString(),
    credentialSubject: {
      '@type': 'odrl:Permission',
      'odrl:assignee': payload.assignee || agentDid,
      'odrl:assigner': principal,
      'odrl:target': payload.target || null,
      'odrl:action': payload.action || 'odrl:use',
      'odrl:constraint': payload.constraints || [],
    },
  };
  if (permission.duties) mandate.credentialSubject['odrl:duty'] = permission.duties;
  if (payload.validUntil) mandate.validUntil = payload.validUntil;

  return { document: mandate, contextIri: VC_CONTEXT };
}

function _encodeReceipt(payload, agentDid) {
  const issuer = payload.issuer || agentDid;
  if (!issuer) throw new Error('S8 receipt: issuer DID required');
  const id = uris.isCanonical(payload.id)
    ? payload.id
    : uris.mint({
        kind: 'receipt',
        npub: issuer,
        payload: {
          mandateId: payload.mandateId || null,
          amount: payload.amount || null,
          customer: payload.customer || null,
          datePaid: payload.datePaid || null,
        },
      });

  const subject = {
    '@type': 'schema:Invoice',
    'schema:totalPaymentDue': payload.amount || null,
    'schema:paymentMethod': payload.paymentMethod || null,
    'schema:provider': payload.provider || null,
    'schema:customer': payload.customer || null,
    'schema:datePaid': payload.datePaid || new Date().toISOString(),
  };

  const receipt = {
    '@context': [VC_CONTEXT, AGBX_CONTEXT, 'http://schema.org/'],
    id,
    type: ['VerifiableCredential', 'PaymentReceipt'],
    issuer,
    validFrom: payload.validFrom || new Date().toISOString(),
    credentialSubject: subject,
  };
  if (payload.mandateId) {
    receipt.evidence = [{
      id: payload.mandateId,
      '@type': 'PaymentMandate',
    }];
  }
  return { document: receipt, contextIri: VC_CONTEXT };
}

