/**
 * handoff-pane.js — render Nostr-envelope verbs from S2 (HandoffClaim,
 * RequestBriefing, DeliverArtefact) using the agbx extension vocabulary.
 *
 * Attribution
 * -----------
 * `agbx:HandoffClaim`, `agbx:RequestBriefing`, `agbx:DeliverArtefact`
 * are documented in docs/reference/_vocab/agbx.md. The underlying
 * ActivityStreams 2.0 vocabulary is © W3C, edited by James M Snell
 * and Evan Prodromou. Pane shape from linkedobjects/browser
 * (Melvin Carvalho, AGPL-3.0).
 */

import { html, render } from '../losos/html.js';

const TYPES = [
  'HandoffClaim',
  'RequestBriefing',
  'DeliverArtefact',
  'agbx:HandoffClaim',
  'agbx:RequestBriefing',
  'agbx:DeliverArtefact',
];

export default {
  id: 'handoff',
  label: 'Handoff',
  icon: '\u{1F91D}',
  surface: 'S2',
  matches: TYPES.map((t) => ({ '@type': t })),

  canHandle(subject, store) {
    const type = store.type ? store.type(subject.value) : null;
    if (!type) return false;
    const arr = Array.isArray(type) ? type : [type];
    return arr.some((t) => TYPES.includes(t));
  },

  render(subject, store, container, raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const verb = doc['@type'] || doc.type || 'agbx:Activity';
    const actor = doc['as:actor'] || doc.actor || null;
    const recipients = doc['as:to'] || doc.to || [];
    const content = doc['as:content'] || doc.content || '';
    const summary = doc['as:summary'] || doc.summary || '';
    const target = doc['as:target'] || doc.target || null;

    render(container, html`
      <article class="lo-handoff">
        <header>
          <h1>${verb}</h1>
          ${summary ? html`<p class="lo-summary">${summary}</p>` : ''}
        </header>
        <dl>
          ${actor ? html`<dt>Actor</dt><dd><code class="lo-did">${actor}</code></dd>` : ''}
          ${recipients.length ? html`
            <dt>Recipients</dt>
            <dd><ul>${[].concat(recipients).map((r) => html`<li><code>${r}</code></li>`)}</ul></dd>
          ` : ''}
          ${target ? html`<dt>Target</dt><dd><a href="${target['@id'] || target}">${target['@id'] || target}</a></dd>` : ''}
          ${content ? html`<dt>Content</dt><dd>${content}</dd>` : ''}
        </dl>
        ${doc['agbx:redacted'] ? html`<p class="lo-redacted">⚠️ Privacy filter redacted one or more spans.</p>` : ''}
        <footer class="lo-attrib">
          Pane: agentbox <code>handoff-pane</code>. Vocabulary:
          <a href="/docs/reference/_vocab/agbx.md">agbx</a> +
          <a href="https://www.w3.org/TR/activitystreams-vocabulary/">AS 2.0</a>.
        </footer>
      </article>
    `);
  },
};
