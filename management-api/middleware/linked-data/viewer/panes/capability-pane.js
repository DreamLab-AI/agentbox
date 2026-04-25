/**
 * capability-pane.js — render WoT Thing Descriptions (S6).
 *
 * Attribution
 * -----------
 * W3C Web of Things Thing Description 1.1 © W3C; editors: Sebastian
 * Käbisch, Victor Charpenay, Matthias Kovatsch, Daniel Peintner.
 * Pane shape from linkedobjects/browser (Melvin Carvalho, AGPL-3.0).
 */

import { html, render } from '../losos/html.js';

const TD_TYPES = [
  'Thing',
  'Capability',
  'agbx:Capability',
  'https://www.w3.org/2019/wot/td#Thing',
];

export default {
  id: 'capability',
  label: 'Capability',
  icon: '\u{1F4E1}',
  surface: 'S6',
  matches: TD_TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) => TD_TYPES.includes(t) || String(t).endsWith('#Thing'));
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const title = doc.title || doc['schema:name'] || subject.value;
    const properties = doc.properties || {};
    const actions = doc.actions || {};
    const events = doc.events || {};
    const forms = doc.forms || [];

    render(container, html`
      <article class="lo-td">
        <header>
          <h1>${title}</h1>
          <p class="lo-desc">${doc.description || ''}</p>
          <code class="lo-id">${doc.id || subject.value}</code>
        </header>
        <section>
          <h2>Forms (transports)</h2>
          <ul>${forms.map((f) => html`<li><code>${f.op || 'invokeaction'}</code> → ${f.href} <small>(${f['agbx:transport'] || 'http'})</small></li>`)}</ul>
        </section>
        <section>
          <h2>Actions (${Object.keys(actions).length})</h2>
          <dl>${Object.entries(actions).map(([k, v]) => html`<dt>${k}</dt><dd>${v.description || '—'}</dd>`)}</dl>
        </section>
        <section>
          <h2>Properties (${Object.keys(properties).length})</h2>
          <dl>${Object.entries(properties).map(([k, v]) => html`<dt>${k}</dt><dd>${v.type || '—'} ${v.readOnly ? '(read-only)' : ''}${v.writeOnly ? '(write-only)' : ''}</dd>`)}</dl>
        </section>
        <section>
          <h2>Events (${Object.keys(events).length})</h2>
          <dl>${Object.entries(events).map(([k, v]) => html`<dt>${k}</dt><dd>${v.description || '—'}</dd>`)}</dl>
        </section>
        <footer class="lo-attrib">
          Pane: agentbox <code>capability-pane</code>. Vocabulary:
          <a href="https://www.w3.org/TR/wot-thing-description11/">W3C WoT TD 1.1</a>.
        </footer>
      </article>
    `);
  },
};
