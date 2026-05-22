#!/usr/bin/env node
// governance-bridge.js — MCP server providing governance tools for the
// Judgment Broker.  Agents use these tools to publish PanelDefinition
// (kind 31400), ActionRequest (kind 31402), PanelUpdate (kind 31404),
// and PanelRetire (kind 31405) events, and to read back ActionResponse
// (kind 31403) decisions from human operators.
//
// Events are written as unsigned JSON to the pod outbox directory;
// relay-consumer's outbox flusher adds pubkey, id, and sig before
// publishing to relays.
//
// Environment:
//   AGENTBOX_PUBKEY   — 64-char hex pubkey of the agent
//   AGENTBOX_POD_ROOT — pod root directory (default: /var/lib/agentbox)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const require = createRequire(import.meta.url);

const PUBKEY = process.env.AGENTBOX_PUBKEY || '';
const POD_ROOT = process.env.AGENTBOX_POD_ROOT || '/var/lib/agentbox';

// ── npub derivation ─────────────────────────────────────────────────────────
// Pod directories use bech32 npub (npub1…).  Defer to nostr-tools when
// available; fall back to raw hex so the server still starts in test
// environments without the dependency.

function hexToNpub(hex) {
  try {
    const nostrTools = require('nostr-tools');
    return nostrTools.nip19.npubEncode(hex);
  } catch {
    return hex;
  }
}

// ── filesystem helpers ──────────────────────────────────────────────────────

function outboxDir() {
  const npub = hexToNpub(PUBKEY);
  return path.join(POD_ROOT, 'pods', npub, 'events', 'outbox');
}

function governanceDir() {
  const npub = hexToNpub(PUBKEY);
  return path.join(POD_ROOT, 'pods', npub, 'events', 'governance');
}

/**
 * Atomic write: tmp file + rename to avoid partial reads by the outbox
 * flusher.  Mirrors relay-consumer.js _writePaymentEvent pattern.
 */
function writeEvent(dir, filename, event) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, filename);
  const tmp = path.join(dir, `.${filename}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(event, null, 2));
  fs.renameSync(tmp, target);
  return target;
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

// ── validation helpers ──────────────────────────────────────────────────────

function validatePubkey() {
  if (!PUBKEY || !/^[0-9a-f]{64}$/i.test(PUBKEY)) {
    return { error: 'config_error', message: 'AGENTBOX_PUBKEY must be a 64-char hex pubkey' };
  }
  return null;
}

function validateString(value, name, maxLen = 1024) {
  if (typeof value !== 'string' || value.length === 0) {
    return { error: 'validation_error', message: `${name} must be a non-empty string` };
  }
  if (value.length > maxLen) {
    return { error: 'validation_error', message: `${name} exceeds max length of ${maxLen}` };
  }
  return null;
}

// ── tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'governance_publish_panel',
    description: 'Publish a PanelDefinition (kind 31400) to the governance outbox. Defines a decision panel with fields and actions for human operators.',
    inputSchema: {
      type: 'object',
      properties: {
        panel_id: { type: 'string', description: 'Unique panel identifier (used as NIP-33 d-tag)' },
        title: { type: 'string', description: 'Human-readable panel title' },
        description: { type: 'string', description: 'Optional panel description' },
        fields: {
          type: 'array',
          description: 'Form fields presented to the human operator',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', description: 'Field type (text, number, boolean, select, textarea)' },
              label: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['name', 'type', 'label'],
          },
        },
        actions: {
          type: 'array',
          description: 'Action buttons available on the panel',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              label: { type: 'string' },
              style: { type: 'string', description: 'Visual style hint (primary, danger, secondary)' },
            },
            required: ['name', 'label'],
          },
        },
      },
      required: ['panel_id', 'title', 'fields', 'actions'],
      additionalProperties: false,
    },
  },
  {
    name: 'governance_request_action',
    description: 'Publish an ActionRequest (kind 31402) requesting a human governance decision. References a panel via e-tag.',
    inputSchema: {
      type: 'object',
      properties: {
        panel_id: { type: 'string', description: 'Panel ID this request targets' },
        case_id: { type: 'string', description: 'Unique case identifier (auto-generated if omitted)' },
        title: { type: 'string', description: 'Request title' },
        description: { type: 'string', description: 'Detailed description of the decision needed' },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Request priority (default: medium)',
        },
        context: {
          type: 'object',
          description: 'Arbitrary context data for the human operator',
          additionalProperties: true,
        },
      },
      required: ['panel_id', 'title', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'governance_update_panel',
    description: 'Publish a PanelUpdate (kind 31404) with incremental changes to an existing panel definition.',
    inputSchema: {
      type: 'object',
      properties: {
        panel_id: { type: 'string', description: 'Panel ID to update' },
        updates: {
          type: 'object',
          description: 'Incremental diff — keys to add/replace in the panel definition',
          additionalProperties: true,
        },
      },
      required: ['panel_id', 'updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'governance_retire_panel',
    description: 'Retire a governance panel (kind 31405), signalling it should no longer accept requests.',
    inputSchema: {
      type: 'object',
      properties: {
        panel_id: { type: 'string', description: 'Panel ID to retire' },
        reason: { type: 'string', description: 'Optional reason for retirement' },
      },
      required: ['panel_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'governance_list_decisions',
    description: 'List received ActionResponse (kind 31403) governance decisions from the pod governance inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)', default: 20 },
      },
      additionalProperties: false,
    },
  },
];

// ── tool handlers ───────────────────────────────────────────────────────────

async function handleTool(name, args) {
  // All tools require a valid pubkey except governance_list_decisions which
  // can still be useful in degraded mode, but needs the pod path anyway.
  const pubkeyErr = validatePubkey();
  if (pubkeyErr) return pubkeyErr;

  switch (name) {
    case 'governance_publish_panel': {
      const idErr = validateString(args.panel_id, 'panel_id', 256);
      if (idErr) return idErr;
      const titleErr = validateString(args.title, 'title', 512);
      if (titleErr) return titleErr;

      if (!Array.isArray(args.fields) || args.fields.length === 0) {
        return { error: 'validation_error', message: 'fields must be a non-empty array' };
      }
      if (!Array.isArray(args.actions) || args.actions.length === 0) {
        return { error: 'validation_error', message: 'actions must be a non-empty array' };
      }

      const panelPayload = {
        panel_id: args.panel_id,
        title: args.title,
        ...(args.description ? { description: args.description } : {}),
        fields: args.fields,
        actions: args.actions,
      };

      const event = {
        kind: 31400,
        content: JSON.stringify(panelPayload),
        tags: [['d', args.panel_id]],
        created_at: nowUnix(),
      };

      const dir = outboxDir();
      const outboxPath = writeEvent(dir, `${args.panel_id}.json`, event);

      return { published: true, panel_id: args.panel_id, outbox_path: outboxPath };
    }

    case 'governance_request_action': {
      const panelErr = validateString(args.panel_id, 'panel_id', 256);
      if (panelErr) return panelErr;
      const titleErr = validateString(args.title, 'title', 512);
      if (titleErr) return titleErr;
      const descErr = validateString(args.description, 'description', 4096);
      if (descErr) return descErr;

      const caseId = args.case_id || crypto.randomUUID();

      const requestPayload = {
        case_id: caseId,
        panel_id: args.panel_id,
        title: args.title,
        description: args.description,
        priority: args.priority || 'medium',
        ...(args.context ? { context: args.context } : {}),
      };

      const event = {
        kind: 31402,
        content: JSON.stringify(requestPayload),
        tags: [
          ['d', caseId],
          ['e', args.panel_id],
        ],
        created_at: nowUnix(),
      };

      const dir = outboxDir();
      const outboxPath = writeEvent(dir, `${caseId}.json`, event);

      return { published: true, case_id: caseId, outbox_path: outboxPath };
    }

    case 'governance_update_panel': {
      const panelErr = validateString(args.panel_id, 'panel_id', 256);
      if (panelErr) return panelErr;

      if (!args.updates || typeof args.updates !== 'object' || Array.isArray(args.updates)) {
        return { error: 'validation_error', message: 'updates must be a non-empty object' };
      }

      const updatePayload = {
        panel_id: args.panel_id,
        updates: args.updates,
      };

      const event = {
        kind: 31404,
        content: JSON.stringify(updatePayload),
        tags: [
          ['d', args.panel_id],
          ['e', args.panel_id],
        ],
        created_at: nowUnix(),
      };

      const dir = outboxDir();
      const filename = `${args.panel_id}-update-${nowUnix()}.json`;
      writeEvent(dir, filename, event);

      return { published: true, panel_id: args.panel_id };
    }

    case 'governance_retire_panel': {
      const panelErr = validateString(args.panel_id, 'panel_id', 256);
      if (panelErr) return panelErr;

      const retirePayload = {
        panel_id: args.panel_id,
        ...(args.reason ? { reason: args.reason } : {}),
      };

      const event = {
        kind: 31405,
        content: JSON.stringify(retirePayload),
        tags: [
          ['d', args.panel_id],
          ['e', args.panel_id],
        ],
        created_at: nowUnix(),
      };

      const dir = outboxDir();
      const filename = `${args.panel_id}-retire.json`;
      writeEvent(dir, filename, event);

      return { retired: true, panel_id: args.panel_id };
    }

    case 'governance_list_decisions': {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 200);
      const govDir = governanceDir();

      if (!fs.existsSync(govDir)) {
        return { decisions: [] };
      }

      const files = fs.readdirSync(govDir).filter(f => f.endsWith('.json'));
      const decisions = [];

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(govDir, file), 'utf-8');
          const evt = JSON.parse(raw);

          // Filter for ActionResponse (kind 31403) only
          if (evt.kind !== 31403) continue;

          let content = {};
          try { content = JSON.parse(evt.content); } catch { /* non-JSON content */ }

          decisions.push({
            event_id: evt.event_id || evt.id || file.replace('.json', ''),
            case_id: content.case_id || _tagValue(evt.tags, 'e') || '',
            outcome: content.outcome || content.action || '',
            reason: content.reason || '',
            decided_by: evt.pubkey || evt.signer_pubkey || '',
            decided_at: evt.created_at
              ? new Date(typeof evt.created_at === 'number' && evt.created_at < 1e12
                  ? evt.created_at * 1000
                  : evt.created_at).toISOString()
              : '',
          });
        } catch {
          // Skip malformed files silently
        }
      }

      // Sort by decided_at descending
      decisions.sort((a, b) => (b.decided_at || '').localeCompare(a.decided_at || ''));

      return { decisions: decisions.slice(0, limit) };
    }

    default:
      return { error: 'unknown_tool', message: `Tool ${name} not found` };
  }
}

/**
 * Extract the first value for a given tag name from a Nostr event tags array.
 */
function _tagValue(tags, name) {
  if (!Array.isArray(tags)) return '';
  const tag = tags.find(t => Array.isArray(t) && t[0] === name);
  return tag ? tag[1] || '' : '';
}

// ── MCP server wiring ───────────────────────────────────────────────────────

const server = new Server(
  { name: 'governance-bridge', version: '0.1.0' },
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
console.error(`[governance-bridge] Connected to MCP, pubkey=${PUBKEY.slice(0, 8)}…, pod_root=${POD_ROOT}`);
