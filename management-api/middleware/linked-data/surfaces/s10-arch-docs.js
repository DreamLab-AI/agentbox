'use strict';

/**
 * S10 — Architecture documentation cross-references.
 *
 * Direction: emit. Form: Framed. Vocabulary: dcterms + SKOS + agbx.
 * Manifest gate: [linked_data].architecture_docs. Build-time emit only.
 *
 * Each ADR / PRD / DDD markdown carries a JSON-LD frontmatter frame that
 * names the document class, its `dcterms:references`, `dcterms:supersedes`,
 * and `agbx:status`. The build step walks docs/reference/{adr,prd,ddd}/
 * and writes the frame as a `<script type="application/ld+json">` block
 * at the top of each rendered HTML page.
 */

const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S10',
  slot: null,                            // build-time only
  gateKey: 'architecture_docs',
  prerequisiteAdapter: null,
  form: 'framed',
  direction: 'emit',
  operations: ['build-emit'],
  canonicalisation: 'none',
  vocabularyBinding: ['dcterms:', 'skos:', 'agbx:'],
  contextIri: AGBX_CONTEXT,

  async encode(payload) {
    if (!payload || !payload.id || !payload.docClass) {
      throw new Error('S10 encode: payload.id and payload.docClass required (adr|prd|ddd)');
    }
    const classMap = { adr: 'ADR', prd: 'PRD', ddd: 'DDD' };
    const klass = classMap[payload.docClass.toLowerCase()];
    if (!klass) throw new Error(`S10 encode: unknown docClass ${payload.docClass}`);

    const id = uris.isCanonical(payload.id)
      ? payload.id
      : uris.mint({ kind: payload.docClass.toLowerCase(), localId: payload.id });
    const doc = {
      '@context': [AGBX_CONTEXT, 'http://purl.org/dc/terms/'],
      '@type': klass,
      id,
      'dcterms:title': payload.title || payload.id,
      'dcterms:date': payload.date || null,
      'agbx:status': payload.status || 'Draft',
    };

    if (payload.author) doc['dcterms:creator'] = payload.author;
    if (payload.references) {
      doc['dcterms:references'] = (Array.isArray(payload.references) ? payload.references : [payload.references])
        .map((r) => ({ '@id': r }));
    }
    if (payload.supersedes) {
      doc['dcterms:replaces'] = (Array.isArray(payload.supersedes) ? payload.supersedes : [payload.supersedes])
        .map((r) => ({ '@id': r }));
    }
    if (payload.supersededBy) {
      doc['dcterms:isReplacedBy'] = { '@id': payload.supersededBy };
    }
    if (payload.tags) doc['skos:related'] = payload.tags;
    if (payload.summary) doc['dcterms:abstract'] = payload.summary;
    return { document: doc, contextIri: AGBX_CONTEXT };
  },
};
