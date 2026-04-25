/**
 * dcat-pane.js — render DCAT-3 catalogues (S9), e.g. memory namespaces.
 *
 * Attribution
 * -----------
 * DCAT-3 © W3C; editors: Riccardo Albertoni, David Browning, Simon
 * Cox, Alejandra Gonzalez Beltran, Andrea Perego, Peter Winstanley.
 * Pane shape from linkedobjects/browser (Melvin Carvalho, AGPL-3.0).
 */

import { html, render } from '../losos/html.js';

const DCAT_TYPES = [
  'dcat:Catalog',
  'dcat:Dataset',
  'http://www.w3.org/ns/dcat#Catalog',
  'http://www.w3.org/ns/dcat#Dataset',
];

export default {
  id: 'dcat',
  label: 'Datasets',
  icon: '\u{1F5C2}',
  surface: 'S9',
  matches: DCAT_TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) => DCAT_TYPES.includes(t) || String(t).endsWith('#Catalog') || String(t).endsWith('#Dataset'));
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const datasets = doc['dcat:dataset'] || (doc['@type'] && String(doc['@type']).includes('Dataset') ? [doc] : []);
    const list = Array.isArray(datasets) ? datasets : [datasets];
    const title = doc['dcterms:title'] || 'Catalogue';
    const publisher = doc['dcterms:publisher'] || null;

    render(container, html`
      <article class="lo-dcat">
        <header>
          <h1>${title}</h1>
          ${publisher ? html`<p>Publisher: <code class="lo-did">${publisher}</code></p>` : ''}
        </header>
        <table class="lo-table">
          <thead><tr><th>Dataset</th><th>Identifier</th><th>Modified</th><th>Size</th><th>Access</th></tr></thead>
          <tbody>
            ${list.map((d) => html`
              <tr>
                <td>${d['dcterms:title'] || '—'}</td>
                <td><code>${d['dcterms:identifier'] || '—'}</code></td>
                <td>${d['dcterms:modified'] || ''}</td>
                <td>${d['dcat:byteSize'] != null ? String(d['dcat:byteSize']) : '—'}</td>
                <td>${d['dcterms:accessRights'] || '—'}</td>
              </tr>
            `)}
          </tbody>
        </table>
        <footer class="lo-attrib">
          Pane: agentbox <code>dcat-pane</code>. Vocabulary:
          <a href="https://www.w3.org/TR/vocab-dcat-3/">W3C DCAT-3</a>.
        </footer>
      </article>
    `);
  },
};
