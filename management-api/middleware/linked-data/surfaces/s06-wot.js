'use strict';

/**
 * S6 — MCP capability descriptors (W3C Web of Things Thing Description 1.1).
 *
 * Direction: emit. Form: Compacted. Vocabulary: WoT TD + Schema.org +
 * agbx. Manifest gate: [linked_data].capability_descriptors.
 *
 * Builds a Thing Description per MCP server: the server is a Thing,
 * each MCP tool is an Action, each MCP resource is a Property, each
 * MCP notification kind is an Event. Forms describe the transport
 * binding (stdio over `docker exec -i` or HTTP/SSE).
 */

const WOT_CONTEXT = 'https://www.w3.org/2022/wot/td/v1.1';
const AGBX_CONTEXT = 'https://agentbox.dreamlab-ai.systems/ns/v1#';

module.exports = {
  id: 'S6',
  slot: 'orchestrator',                  // Things are advertised through orchestrator dispatch
  gateKey: 'capability_descriptors',
  prerequisiteAdapter: null,
  form: 'compacted',
  direction: 'emit',
  operations: ['describe'],
  canonicalisation: 'none',
  vocabularyBinding: ['td:', 'schema:', 'agbx:'],
  contextIri: WOT_CONTEXT,

  async encode(payload, { manifest, agentDid }) {
    if (!payload || !payload.serverId) {
      throw new Error('S6 encode: payload.serverId required');
    }
    const sid = payload.serverId;

    const doc = {
      '@context': [WOT_CONTEXT, AGBX_CONTEXT, 'http://schema.org/'],
      '@type': ['Thing', 'Capability', 'schema:SoftwareApplication'],
      id: `urn:agentbox:mcp:${sid}`,
      title: payload.title || sid,
      description: payload.description || `MCP server ${sid}`,
      version: payload.version || '0.0.0',
      properties: _mapProperties(payload.properties),
      actions: _mapActions(payload.actions),
      events: _mapEvents(payload.events),
      forms: _mapForms(payload.forms || _defaultForms(sid, payload, manifest)),
      securityDefinitions: _securityDefinitions(payload.security),
      security: payload.securityScheme ? [payload.securityScheme] : ['nosec_sc'],
    };

    if (agentDid) doc.wasAttributedTo = agentDid;
    return { document: doc, contextIri: WOT_CONTEXT };
  },
};

function _mapProperties(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [name, p] of Object.entries(props)) {
    out[name] = {
      type: p.type || 'string',
      description: p.description || '',
      readOnly: !!p.readOnly,
      writeOnly: !!p.writeOnly,
      forms: _mapForms(p.forms || []),
    };
  }
  return out;
}

function _mapActions(actions) {
  if (!actions || typeof actions !== 'object') return {};
  const out = {};
  for (const [name, a] of Object.entries(actions)) {
    out[name] = {
      description: a.description || '',
      input: a.input || { type: 'object' },
      output: a.output || { type: 'object' },
      forms: _mapForms(a.forms || []),
    };
  }
  return out;
}

function _mapEvents(events) {
  if (!events || typeof events !== 'object') return {};
  const out = {};
  for (const [name, e] of Object.entries(events)) {
    out[name] = {
      description: e.description || '',
      data: e.data || { type: 'object' },
      forms: _mapForms(e.forms || []),
    };
  }
  return out;
}

function _mapForms(forms) {
  return forms.map((f) => ({
    href: f.href,
    op: f.op || 'invokeaction',
    contentType: f.contentType || 'application/json',
    'agbx:transport': f.transport || 'stdio',
  }));
}

function _defaultForms(sid, payload, manifest) {
  // Default form: stdio over `docker exec -i agentbox node /opt/agentbox/mcp/servers/<sid>.js`.
  const forms = [{
    href: `agentbox-stdio:///${sid}`,
    op: 'invokeaction',
    contentType: 'application/json',
    transport: 'stdio',
  }];
  // If the server has an HTTP form (e.g. management-api), add it.
  if (payload.httpHref) {
    forms.push({
      href: payload.httpHref,
      op: 'invokeaction',
      contentType: 'application/json',
      transport: 'http',
    });
  }
  return forms;
}

function _securityDefinitions(security) {
  if (!security) return { nosec_sc: { scheme: 'nosec' } };
  if (security === 'nip98') {
    return {
      nip98_sc: {
        scheme: 'auto',
        'agbx:protocol': 'nip98',
      },
    };
  }
  return security;
}
