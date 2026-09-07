'use strict';

const { createHash } = require('node:crypto');

function content(event) {
  try { return typeof event?.content === 'string' ? JSON.parse(event.content) : (event?.content || {}); }
  catch { return {}; }
}
function tag(event, name) {
  return (event?.tags || []).find(t => Array.isArray(t) && t[0] === name)?.[1] || null;
}

// A signed event id commits to the exact NIP-01 content and tags. Case/panel
// labels may corroborate that identity, but can never substitute for it.
function requestReference(event) {
  const refs = (event?.tags || []).filter(t => Array.isArray(t) && t[0] === 'e'
    && typeof t[1] === 'string' && t[1] && (!t[3] || t[3] === 'request'));
  const ids = new Set(refs.map(t => t[1]));
  return ids.size === 1 ? [...ids][0] : null;
}
function responseMatchesRequest(response, request) {
  if (response?.kind !== 31403 || request?.kind !== 31402 || !request.id
      || requestReference(response) !== request.id) return false;
  const d = tag(response, 'd');
  if (d && d !== tag(request, 'd')) return false;
  const responseCase = content(response).case_id;
  const requestCase = content(request).case_id;
  if (responseCase && requestCase && responseCase !== requestCase) return false;
  return true;
}

function canonicalOperation(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalOperation).join(',') + ']';
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalOperation(value[k])).join(',') + '}';
  }
  throw new TypeError('Operation must contain only finite JSON values');
}
function operationDigest(operation) {
  return createHash('sha256').update(canonicalOperation(operation)).digest('hex');
}
module.exports = { content, tag, requestReference, responseMatchesRequest, canonicalOperation, operationDigest };
