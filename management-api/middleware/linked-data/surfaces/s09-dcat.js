'use strict';

/**
 * S9 — Memory namespace catalogues (DCAT-3 + PROV-O).
 *
 * Direction: emit. Form: Compacted. Vocabulary: DCAT-3 + PROV-O + agbx.
 * Manifest gate: [linked_data].memory_catalogue.
 *
 * Publishes RuVector namespaces as DCAT Datasets without leaking
 * individual entries. Per PRD-006 §S9, only namespace name, owner DID,
 * last-modified timestamp, count, and access policy are emitted —
 * never entry content.
 */

const DCAT_CONTEXT = 'https://www.w3.org/ns/dcat#';
const PROV_CONTEXT = 'http://www.w3.org/ns/prov-o#';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
const uris = require('../../../lib/uris');

module.exports = {
  id: 'S9',
  slot: 'memory',
  gateKey: 'memory_catalogue',
  prerequisiteAdapter: 'adapters.memory',
  form: 'compacted',
  direction: 'emit',
  operations: ['publish-catalogue'],
  canonicalisation: 'none',
  vocabularyBinding: ['dcat:', 'prov:', 'agbx:'],
  contextIri: DCAT_CONTEXT,

  async encode(payload, { agentDid }) {
    if (!payload || !Array.isArray(payload.namespaces)) {
      throw new Error('S9 encode: payload.namespaces (array) required');
    }
    const datasets = payload.namespaces.map((ns) => {
      if (!ns.name) throw new Error('S9 encode: every namespace must have a name');
      const ds = {
        '@id': uris.mint({ kind: 'dataset', pubkey: ns.owner || agentDid, localId: ns.name }),
        '@type': 'dcat:Dataset',
        'dcterms:title': ns.name,
        'dcterms:identifier': uris.mint({ kind: 'memory', localId: ns.name }),
        'dcterms:modified': ns.modifiedAt || new Date().toISOString(),
      };
      if (ns.description) ds['dcterms:description'] = ns.description;
      if (typeof ns.count === 'number') ds['dcat:byteSize'] = ns.count;
      if (ns.accessPolicy) ds['dcterms:accessRights'] = ns.accessPolicy;
      if (ns.owner || agentDid) ds['dcterms:publisher'] = ns.owner || agentDid;
      return ds;
    });

    const doc = {
      '@context': [DCAT_CONTEXT, PROV_CONTEXT, AGBX_CONTEXT],
      '@type': 'dcat:Catalog',
      'dcterms:title': payload.title || 'Agentbox memory namespace catalogue',
      'dcterms:publisher': agentDid || null,
      'dcterms:modified': new Date().toISOString(),
      'dcat:dataset': datasets,
    };
    return { document: doc, contextIri: DCAT_CONTEXT };
  },
};
