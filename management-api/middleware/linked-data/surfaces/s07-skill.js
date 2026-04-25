'use strict';

/**
 * S7 — Skill metadata (Schema.org HowTo + agbx).
 *
 * Direction: emit. Form: Compacted. Manifest gate:
 * [linked_data].skill_metadata. Build-time emit only.
 *
 * Each SKILL.md frontmatter document describes one agentbox skill (one
 * of the 96 in the corpus). The build step walks `skills/`, calls this
 * encoder per skill, and writes a `<script type="application/ld+json">`
 * block into the rendered SKILL.html for external discovery.
 */

const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S7',
  slot: null,                            // build-time only
  gateKey: 'skill_metadata',
  prerequisiteAdapter: null,
  form: 'compacted',
  direction: 'emit',
  operations: ['build-emit'],
  canonicalisation: 'none',
  vocabularyBinding: ['schema:', 'agbx:'],
  contextIri: AGBX_CONTEXT,

  async encode(payload) {
    if (!payload || !payload.id) throw new Error('S7 encode: payload.id required');
    const id = uris.isCanonical(payload.id) ? payload.id : uris.mint({ kind: 'skill', localId: payload.id });
    const doc = {
      '@context': [AGBX_CONTEXT, 'http://schema.org/'],
      '@type': ['Skill', 'schema:HowTo'],
      id,
      name: payload.name || payload.id,
      description: payload.description || '',
      version: payload.version || '0.0.0',
      progressiveDisclosure: payload.progressiveDisclosure !== false,
      invocationTrigger: payload.invocationTrigger || '',
    };
    if (payload.tags) doc['schema:keywords'] = payload.tags;
    if (payload.requires) {
      doc.requires = (Array.isArray(payload.requires) ? payload.requires : [payload.requires])
        .map((id) => ({ '@id': id }));
    }
    if (payload.steps) {
      doc['schema:step'] = payload.steps.map((s, i) => ({
        '@type': 'schema:HowToStep',
        position: i + 1,
        text: s.text || s,
      }));
    }
    if (payload.tools) {
      doc['schema:tool'] = payload.tools.map((t) => ({
        '@type': 'schema:HowToTool',
        name: typeof t === 'string' ? t : t.name,
      }));
    }
    if (payload.supplies) {
      doc['schema:supply'] = payload.supplies.map((s) => ({
        '@type': 'schema:HowToSupply',
        name: typeof s === 'string' ? s : s.name,
      }));
    }
    return { document: doc, contextIri: AGBX_CONTEXT };
  },
};
