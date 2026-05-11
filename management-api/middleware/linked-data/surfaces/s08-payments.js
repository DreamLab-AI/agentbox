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

  /**
   * Decode and validate an incoming mandate or receipt document.
   *
   * Performs structural validation:
   *   - Checks @context includes VC_CONTEXT
   *   - Checks type array contains PaymentMandate or PaymentReceipt
   *   - Validates required credentialSubject fields
   *
   * Returns { kind: 'mandate'|'receipt', document, valid: true, errors: [] }
   * or { valid: false, errors: [...] }.
   */
  async decode(document) {
    if (!document) return { valid: false, errors: ['document required'] };

    const errors = [];

    // Context check
    const contexts = Array.isArray(document['@context'])
      ? document['@context']
      : [document['@context']];
    if (!contexts.includes(VC_CONTEXT)) {
      errors.push(`Missing required @context: ${VC_CONTEXT}`);
    }

    const types = Array.isArray(document.type) ? document.type : [document.type];
    const isMandate = types.includes('PaymentMandate');
    const isReceipt = types.includes('PaymentReceipt');

    if (!isMandate && !isReceipt) {
      errors.push('Document type must include PaymentMandate or PaymentReceipt');
      return { valid: false, errors };
    }

    if (!document.issuer) {
      errors.push('issuer is required');
    }

    const subject = document.credentialSubject;
    if (!subject) {
      errors.push('credentialSubject is required');
      return { valid: false, errors, kind: isMandate ? 'mandate' : 'receipt' };
    }

    if (isMandate) {
      if (!subject['odrl:assignee'] && !subject.assignee) {
        errors.push('mandate credentialSubject must include odrl:assignee');
      }
      if (!subject['odrl:assigner'] && !subject.assigner) {
        errors.push('mandate credentialSubject must include odrl:assigner');
      }
      // Validate extended payment fields when present
      if (subject['agbx:amount_sats'] !== undefined && typeof subject['agbx:amount_sats'] !== 'number') {
        errors.push('agbx:amount_sats must be a number');
      }
      if (subject['agbx:currency'] !== undefined && typeof subject['agbx:currency'] !== 'string') {
        errors.push('agbx:currency must be a string');
      }
      if (subject['agbx:rate'] !== undefined && typeof subject['agbx:rate'] !== 'number') {
        errors.push('agbx:rate must be a number');
      }
      if (subject['agbx:token_ticker'] !== undefined && typeof subject['agbx:token_ticker'] !== 'string') {
        errors.push('agbx:token_ticker must be a string');
      }
    }

    if (isReceipt) {
      if (!subject['schema:datePaid'] && !subject.datePaid) {
        errors.push('receipt credentialSubject must include schema:datePaid');
      }
      // Validate extended receipt fields when present
      if (subject['agbx:settled_sats'] !== undefined && typeof subject['agbx:settled_sats'] !== 'number') {
        errors.push('agbx:settled_sats must be a number');
      }
      if (subject['agbx:refund_sats'] !== undefined && typeof subject['agbx:refund_sats'] !== 'number') {
        errors.push('agbx:refund_sats must be a number');
      }
      if (subject['agbx:job_id'] !== undefined && typeof subject['agbx:job_id'] !== 'string') {
        errors.push('agbx:job_id must be a string');
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, kind: isMandate ? 'mandate' : 'receipt' };
    }

    return {
      valid: true,
      errors: [],
      kind: isMandate ? 'mandate' : 'receipt',
      document,
    };
  },
};

function _encodeMandate(payload, agentDid) {
  const principal = payload.principal || payload.issuer;
  if (!principal) throw new Error('S8 mandate: principal/issuer DID required');
  const id = uris.isCanonical(payload.id)
    ? payload.id
    : uris.mint({
        kind: 'mandate',
        pubkey: principal,
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
  // Extended payment fields for Web Ledger integration
  if (payload.amount_sats !== undefined) mandate.credentialSubject['agbx:amount_sats'] = payload.amount_sats;
  if (payload.currency) mandate.credentialSubject['agbx:currency'] = payload.currency;
  if (payload.rate !== undefined) mandate.credentialSubject['agbx:rate'] = payload.rate;
  if (payload.token_ticker) mandate.credentialSubject['agbx:token_ticker'] = payload.token_ticker;
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
        pubkey: issuer,
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
  // Extended receipt fields for Web Ledger integration
  if (payload.settled_sats !== undefined) subject['agbx:settled_sats'] = payload.settled_sats;
  if (payload.refund_sats !== undefined) subject['agbx:refund_sats'] = payload.refund_sats;
  if (payload.job_id) subject['agbx:job_id'] = payload.job_id;

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

