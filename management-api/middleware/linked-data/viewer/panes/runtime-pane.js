/**
 * runtime-pane.js — render the agentbox runtime contract (S11) including
 * adapters, observability bindings, readiness, and bootstrap state.
 *
 * Attribution
 * -----------
 * `agbx:RuntimeContract` and the related agbx extension terms are
 * documented in docs/reference/_vocab/agbx.md. The Schema.org
 * `SoftwareApplication` mapping is part of S11 (PRD-006 §3). Pane
 * shape from linkedobjects/browser (Melvin Carvalho, AGPL-3.0).
 */

import { html, render } from '../losos/html.js';

const RC_TYPES = [
  'agbx:RuntimeContract',
  'RuntimeContract',
  'schema:SoftwareApplication',
];

export default {
  id: 'runtime',
  label: 'Runtime',
  icon: '\u{2699}\u{FE0F}',
  surface: 'S11',
  matches: RC_TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) => RC_TYPES.includes(t));
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const adapters = doc['agbx:adapters'] || {};
    const obs      = doc['agbx:observability'] || {};
    const ready    = doc['agbx:readiness'] || [];
    const did      = doc.wasAttributedTo || doc['prov:wasAttributedTo'] || null;

    render(container, html`
      <article class="lo-rc">
        <header>
          <h1>${doc['schema:name'] || 'Runtime'}  <small>v${doc['schema:softwareVersion'] || ''}</small></h1>
          ${did ? html`<p>Agent: <code class="lo-did">${did}</code></p>` : ''}
        </header>
        <section>
          <h2>Bootstrap</h2>
          <p>${doc['agbx:bootstrapCompleted'] ? '✅ Completed' : '⏳ Pending'}</p>
        </section>
        <section>
          <h2>Adapters</h2>
          <table class="lo-table">
            <thead><tr><th>Slot</th><th>Implementation</th></tr></thead>
            <tbody>${Object.entries(adapters).map(([k, v]) => html`<tr><td>${k}</td><td><code>${v}</code></td></tr>`)}</tbody>
          </table>
        </section>
        <section>
          <h2>Observability</h2>
          <ul>${Object.entries(obs).map(([k, v]) => html`<li><strong>${k}</strong>: <code>${String(v)}</code></li>`)}</ul>
        </section>
        <section>
          <h2>Readiness requirements</h2>
          <ul>${[].concat(ready).map((r) => html`<li>${r['@id'] || r}</li>`)}</ul>
        </section>
        <footer class="lo-attrib">
          Pane: agentbox <code>runtime-pane</code>. Surface: S11
          (<a href="/docs/reference/prd/PRD-006-linked-data-interfaces.md">PRD-006</a>).
        </footer>
      </article>
    `);
  },
};
