/**
 * provenance-pane.js — render PROV-O Activity records (S5).
 *
 * Attribution
 * -----------
 * PROV-O vocabulary © W3C, edited by Timothy Lebo, Satya Sahoo, Deborah
 * McGuinness. Pane shape from linkedobjects/browser (Melvin Carvalho,
 * AGPL-3.0). The agentbox-specific `agbx:action`, `agbx:slot`,
 * `agbx:operation` extension terms are documented in
 * docs/reference/_vocab/agbx.md.
 */

import { html, render } from '../losos/html.js';

const PROV_TYPES = [
  'prov:Activity',
  'http://www.w3.org/ns/prov#Activity',
  'agbx:AgentEventStream',
];

export default {
  id: 'provenance',
  label: 'Provenance',
  icon: '\u{1F50D}',
  surface: 'S5/S11',
  matches: PROV_TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) => PROV_TYPES.includes(t) || String(t).endsWith('#Activity'));
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const events = doc['agbx:events'] || (Array.isArray(doc) ? doc : [doc]);
    const list = Array.isArray(events) ? events : [events];

    render(container, html`
      <article class="lo-prov">
        <header><h1>Provenance — ${list.length} record${list.length === 1 ? '' : 's'}</h1></header>
        <table class="lo-table">
          <thead><tr><th>Time</th><th>Action</th><th>Slot</th><th>Op</th><th>Agent</th><th>Used</th><th>Generated</th></tr></thead>
          <tbody>
            ${list.map((a) => html`
              <tr>
                <td><code>${a['prov:startedAtTime'] || a.startedAtTime || ''}</code></td>
                <td>${a['agbx:action'] || a.action || '—'}</td>
                <td>${a['agbx:slot'] || a.slot || '—'}</td>
                <td>${a['agbx:operation'] || a.operation || '—'}</td>
                <td>${_did((a['prov:wasAssociatedWith'] || a.wasAssociatedWith || {})['@id'] || '—')}</td>
                <td>${_entityList(a['prov:used'] || a.used)}</td>
                <td>${_entityList(a['prov:generated'] || a.generated)}</td>
              </tr>
            `)}
          </tbody>
        </table>
        <footer class="lo-attrib">
          Pane: agentbox <code>provenance-pane</code>. Vocabulary:
          <a href="https://www.w3.org/TR/prov-o/">W3C PROV-O</a> +
          <a href="/docs/reference/_vocab/agbx.md">agbx</a>.
        </footer>
      </article>
    `);
  },
};

function _did(s) {
  if (typeof s !== 'string') return '—';
  if (s.startsWith('did:nostr:')) return html`<code class="lo-did">${s}</code>`;
  return s;
}

function _entityList(v) {
  if (!v) return '—';
  const arr = Array.isArray(v) ? v : [v];
  return html`<ul class="lo-list">${arr.map((e) => {
    const id = (e && e['@id']) || e;
    return html`<li><a href="${id}">${id}</a></li>`;
  })}</ul>`;
}
