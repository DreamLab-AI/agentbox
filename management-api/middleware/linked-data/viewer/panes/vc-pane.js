/**
 * vc-pane.js — render Verifiable Credentials (S3) and payment receipts (S8).
 *
 * Pane contract: linkedobjects/browser/panes/*.js shape
 *   default export { id, label, icon, surface, matches, canHandle, render }
 *
 * Attribution
 * -----------
 * Pane render shape borrowed from linkedobjects/browser
 * (Melvin Carvalho, AGPL-3.0). LOSOS html/render helpers are imported
 * from the bundle the pane is loaded from. VC v2 vocabulary terms are
 * from the W3C VC Data Model 2.0 (Sporny, Longley, Sabadello, Steele,
 * Allen).
 */

import { html, render } from '../losos/html.js';

const VC_TYPES = [
  'VerifiableCredential',
  'https://www.w3.org/ns/credentials/v2#VerifiableCredential',
  'PaymentMandate',
  'PaymentReceipt',
];

export default {
  id: 'vc',
  label: 'Credential',
  icon: '\u{1FAAA}',
  surface: 'S3/S8',
  matches: VC_TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) => VC_TYPES.includes(t) || t.endsWith('VerifiableCredential'));
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const id = doc.id || doc['@id'] || subject.value;
    const types = doc.type || doc['@type'] || [];
    const issuer = doc.issuer || doc['vc:issuer'] || 'unknown';
    const validFrom = doc.validFrom || '';
    const validUntil = doc.validUntil || '';
    const subj = doc.credentialSubject || doc['vc:credentialSubject'] || {};
    const evidence = doc.evidence || [];
    const proof = doc.proof || null;

    render(container, html`
      <article class="lo-vc">
        <header>
          <h1>${_titleFor(types)}</h1>
          <code class="lo-id">${id}</code>
        </header>
        <dl>
          <dt>Type</dt>
          <dd>${[].concat(types).join(', ')}</dd>
          <dt>Issuer</dt>
          <dd><a href="${_resolveDid(issuer)}">${issuer.id || issuer}</a></dd>
          <dt>Valid from</dt>
          <dd>${validFrom || '—'}</dd>
          ${validUntil ? html`<dt>Valid until</dt><dd>${validUntil}</dd>` : ''}
          <dt>Subject</dt>
          <dd><pre class="lo-json">${JSON.stringify(subj, null, 2)}</pre></dd>
          ${Array.isArray(evidence) && evidence.length ? html`
            <dt>Evidence</dt>
            <dd><ul>${evidence.map((e) => html`<li><a href="${e.id || e}">${e.id || e}</a></li>`)}</ul></dd>
          ` : ''}
          ${proof ? html`
            <dt>Proof</dt>
            <dd><pre class="lo-json">${JSON.stringify(proof, null, 2)}</pre></dd>
          ` : html`<dt>Proof</dt><dd><em>none — credential is unsigned</em></dd>`}
        </dl>
        <footer class="lo-attrib">
          Pane: agentbox <code>vc-pane</code>. Vocabulary:
          <a href="https://www.w3.org/TR/vc-data-model-2.0/">W3C VC Data Model 2.0</a>.
        </footer>
      </article>
    `);
  },
};

function _titleFor(types) {
  const arr = [].concat(types || []);
  if (arr.some((t) => String(t).includes('PaymentMandate'))) return 'Payment Mandate';
  if (arr.some((t) => String(t).includes('PaymentReceipt'))) return 'Payment Receipt';
  return 'Verifiable Credential';
}

function _resolveDid(issuer) {
  const v = issuer && issuer.id ? issuer.id : issuer;
  if (typeof v !== 'string') return '#';
  if (v.startsWith('did:nostr:')) return `/lo/?resource=${encodeURIComponent('/.well-known/did.json')}`;
  if (v.startsWith('did:')) return `https://uniresolver.io/#${encodeURIComponent(v)}`;
  return v;
}
