#!/usr/bin/env node
// ontology-bridge.js — MCP server bridging agentbox agents to VisionClaw's
// Oxigraph ontology + knowledge graph via REST API (ADR-023, PRD-011).
//
// Reads VISIONCLAW_API_URL from env (default: http://visionclaw-server:4000).
// Fail-open: returns structured errors when VisionClaw is unreachable.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const API_URL = (process.env.VISIONCLAW_API_URL || 'http://visionclaw-server:4000').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.ONTOLOGY_TIMEOUT_MS || '10000', 10);

const SPARQL_PROLOGUE = `PREFIX vc: <https://narrativegoldmine.com/ns/v1#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`;

async function vcFetch(path, opts = {}) {
  const url = `${API_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `visionclaw_http_${res.status}`, message: body || res.statusText };
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      return { error: 'ontology_timeout', message: `VisionClaw did not respond within ${TIMEOUT_MS}ms` };
    }
    return { error: 'ontology_unavailable', message: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const TOOLS = [
  {
    name: 'ontology_health',
    description: 'Check VisionClaw ontology service health (class count, axiom count, last inference).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontology_search',
    description: 'Search knowledge graph nodes by label substring. Returns paginated results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Label substring to search for' },
        limit: { type: 'number', description: 'Max results (default 20)', default: 20 },
        offset: { type: 'number', description: 'Pagination offset (default 0)', default: 0 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_class_get',
    description: 'Get OWL class metadata by IRI or slug. Returns class hierarchy, properties, quality scores.',
    inputSchema: {
      type: 'object',
      properties: {
        iri: { type: 'string', description: 'Full IRI (vc:onto/slug) or just the slug' },
      },
      required: ['iri'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_class_list',
    description: 'List OWL classes, optionally filtered by domain.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Filter by source_domain (optional)' },
        limit: { type: 'number', description: 'Max results (default 50)', default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_axiom_add',
    description: 'Submit a new OWL axiom for reasoning. Axiom is validated before insertion.',
    inputSchema: {
      type: 'object',
      properties: {
        axiom_type: {
          type: 'string',
          enum: ['SubClassOf', 'EquivalentClass', 'DisjointWith', 'ObjectPropertyAssertion',
                 'DataPropertyAssertion', 'SubPropertyOf', 'TransitiveProperty',
                 'SymmetricProperty', 'InverseProperties', 'SomeValuesFrom'],
        },
        subject: { type: 'string', description: 'Subject IRI' },
        object: { type: 'string', description: 'Object IRI' },
      },
      required: ['axiom_type', 'subject', 'object'],
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_validate',
    description: 'Validate ontology consistency. Returns validation report with errors and warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['Quick', 'Full', 'Incremental'], default: 'Quick' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontology_graph_query',
    description: 'Execute a read-only SPARQL SELECT query against VisionClaw\'s Oxigraph store. Standard prefixes (vc:, rdf:, rdfs:, owl:, xsd:) are auto-injected.',
    inputSchema: {
      type: 'object',
      properties: {
        sparql: { type: 'string', description: 'SPARQL SELECT query (no UPDATE/INSERT/DELETE)' },
      },
      required: ['sparql'],
      additionalProperties: false,
    },
  },
  {
    name: 'kg_node_search',
    description: 'Search knowledge graph nodes by label, metadata, or node type.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Label substring (optional)' },
        node_type: { type: 'string', description: 'Filter by node_type (page, linked_page, owl_class, agent)' },
        limit: { type: 'number', default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kg_neighbors',
    description: 'Get immediate neighbors of a knowledge graph node with edge metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'number', description: 'Node ID (u32)' },
        depth: { type: 'number', description: 'Traversal depth (default 1, max 3)', default: 1 },
      },
      required: ['node_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'kg_pathfind',
    description: 'Find shortest path between two knowledge graph nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'number', description: 'Source node ID' },
        target_id: { type: 'number', description: 'Target node ID' },
      },
      required: ['source_id', 'target_id'],
      additionalProperties: false,
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case 'ontology_health':
      return vcFetch('/api/ontology/health');

    case 'ontology_search': {
      const params = new URLSearchParams({
        search: args.query,
        limit: String(args.limit ?? 20),
        offset: String(args.offset ?? 0),
      });
      return vcFetch(`/api/graph/paginated?${params}`);
    }

    case 'ontology_class_get': {
      let iri = args.iri;
      if (!iri.includes(':') && !iri.includes('/')) {
        iri = `https://narrativegoldmine.com/ns/v1#onto/${iri}`;
      }
      const sparql = `${SPARQL_PROLOGUE}
SELECT ?p ?o WHERE { <${iri}> ?p ?o } LIMIT 100`;
      return vcFetch('/api/ontology/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sparql }),
      });
    }

    case 'ontology_class_list': {
      let filter = '';
      if (args.domain) filter = `FILTER(str(?domain) = "${args.domain}")`;
      const sparql = `${SPARQL_PROLOGUE}
SELECT ?class ?label ?domain ?quality WHERE {
  GRAPH <urn:ngm:graph:ontology:assert> {
    ?class a owl:Class .
    OPTIONAL { ?class rdfs:label ?label }
    OPTIONAL { ?class vc:sourceDomain ?domain }
    OPTIONAL { ?class vc:qualityScore ?quality }
  }
  ${filter}
} LIMIT ${args.limit ?? 50}`;
      return vcFetch('/api/ontology/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sparql }),
      });
    }

    case 'ontology_axiom_add':
      return vcFetch('/api/ontology/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'agentbox-bridge',
          format: 'axiom',
          validate_immediately: true,
          axioms: [{
            axiom_type: args.axiom_type,
            subject: args.subject,
            object: args.object,
          }],
        }),
      });

    case 'ontology_validate':
      return vcFetch('/api/ontology/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: args.mode ?? 'Quick' }),
      });

    case 'ontology_graph_query': {
      const q = args.sparql.trim();
      if (/\b(INSERT|DELETE|DROP|CLEAR|LOAD|CREATE|COPY|MOVE|ADD)\b/i.test(q)) {
        return { error: 'sparql_readonly', message: 'Only SELECT/ASK/DESCRIBE/CONSTRUCT queries are permitted.' };
      }
      const fullQuery = q.startsWith('PREFIX') ? q : SPARQL_PROLOGUE + q;
      return vcFetch('/api/ontology/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: fullQuery }),
      });
    }

    case 'kg_node_search': {
      const params = new URLSearchParams({ limit: String(args.limit ?? 20) });
      if (args.label) params.set('search', args.label);
      if (args.node_type) params.set('node_type', args.node_type);
      return vcFetch(`/api/graph/paginated?${params}`);
    }

    case 'kg_neighbors': {
      const depth = Math.min(args.depth ?? 1, 3);
      const sparql = `${SPARQL_PROLOGUE}
SELECT ?neighbor ?edge_type ?weight ?label WHERE {
  { <urn:ngm:node:${args.node_id}> ?edge_type ?neighbor }
  UNION
  { ?neighbor ?edge_type <urn:ngm:node:${args.node_id}> }
  OPTIONAL { ?neighbor rdfs:label ?label }
  OPTIONAL { ?edge_type vc:weight ?weight }
} LIMIT 100`;
      return vcFetch('/api/ontology/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sparql }),
      });
    }

    case 'kg_pathfind': {
      const sparql = `${SPARQL_PROLOGUE}
SELECT ?path_node ?step WHERE {
  GRAPH <urn:ngm:graph:cache:sssp> {
    ?entry vc:sourceNode <urn:ngm:node:${args.source_id}> ;
           vc:targetNode <urn:ngm:node:${args.target_id}> ;
           vc:pathNode ?path_node ;
           vc:step ?step .
  }
} ORDER BY ?step`;
      return vcFetch('/api/ontology/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sparql }),
      });
    }

    default:
      return { error: 'unknown_tool', message: `Tool ${name} not found` };
  }
}

const server = new Server(
  { name: 'ontology-bridge', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler({ method: 'tools/list' }, async () => ({ tools: TOOLS }));

server.setRequestHandler({ method: 'tools/call' }, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleTool(name, args || {});
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[ontology-bridge] Connected to MCP, proxying to ${API_URL}`);
