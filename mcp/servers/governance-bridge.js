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
// ADR-2011 / PRD-augmentation-conditions FR3.4: every ActionRequest this server
// publishes carries the TASK-PROPERTY TRIPLE as tags (`tp-verifiability`,
// `tp-reversibility`, `tp-stakes`). The triple is derived from the operator's
// manifest — `authority_class` seeds reversibility — and a caller-supplied
// `task_properties` may only TIGHTEN it. The forum's `effective_tier()` reads
// these tags; a request with none folds to the panel default, which is exactly
// the silent under-tiering ADR-2011 removes, so they are never omitted.
//
// FR7.1 adds `governance_manual_continue`: the operator's path when the mesh is
// down and an already-approved action must be executed by hand.
//
// Environment:
//   AGENTBOX_PUBKEY        — 64-char hex pubkey of the agent
//   AGENTBOX_POD_ROOT      — pod root directory (default: /var/lib/agentbox)
//   AGENTBOX_MANIFEST_PATH — agentbox.toml (default: /etc/agentbox.toml)
//   FORUM_AUTH_API         — forum auth worker base URL (receipt mirroring)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const require = createRequire(import.meta.url);

const PUBKEY = process.env.AGENTBOX_PUBKEY || '';
const POD_ROOT = process.env.AGENTBOX_POD_ROOT || '/var/lib/agentbox';

// ── governance libraries (CJS, shared with management-api) ──────────────────
// These are the SAME modules the authority gate uses, so a triple derived here
// and a triple stamped by the gate can never disagree.
const taskProperties = require('../../management-api/lib/task-properties');
const { ApplicationReceiptStore } = require('../../management-api/lib/governance-application-receipts');
const { manualContinue } = require('../../management-api/lib/governance-manual-continue');
const { buildReceiptPublisher } = require('../../management-api/lib/governance-receipt-publisher');

/**
 * The parsed manifest, loaded once and cached. A missing/unreadable manifest is
 * NOT fatal: `derive()` then falls back to its own fail-closed defaults
 * (partial / irreversible / significant), which is a tighter boundary than any
 * manifest would set, never a looser one.
 */
let _manifest;
function manifest() {
  if (_manifest !== undefined) return _manifest;
  try {
    _manifest = require('../../management-api/adapters/manifest-loader').loadManifest();
  } catch (err) {
    console.error(`[governance-bridge] manifest unavailable (${err.message}); task properties fall back to fail-closed defaults`);
    _manifest = null;
  }
  return _manifest;
}

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
        action_class: {
          type: 'string',
          description: 'Action-class key from agentbox.toml [skills.authority.classes]. Seeds the task-property triple (zero-tolerance => irreversible, recoverable => compensable). Omitted or unknown => escalation-required, which derives the tightest triple.',
        },
        task_properties: {
          type: 'object',
          description: 'ADR-2011 task-property triple. TIGHTENING ONLY: a value looser than the operator-declared default for this action class is ignored. Omit to publish the operator default.',
          properties: {
            verifiability: { type: 'string', enum: ['inspectable', 'partial', 'opaque'] },
            reversibility: { type: 'string', enum: ['reversible', 'compensable', 'irreversible'] },
            stakes: { type: 'string', enum: ['bounded', 'significant', 'critical'] },
          },
          additionalProperties: false,
        },
      },
      required: ['panel_id', 'title', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'governance_manual_continue',
    description: 'Record that a HUMAN operator executed an already-approved action by hand during a mesh outage (PRD-augmentation-conditions FR7.1). Writes an `applied-manually` application receipt bound to the approved operation digest, mints a PROV-O activity associated with the human, and mirrors the receipt to the forum (queued if unreachable). Refuses any case that was not approved, whose operation digest differs, that already reached a terminal stage, or whose executor is an agent identity.',
    inputSchema: {
      type: 'object',
      properties: {
        case_id: { type: 'string', description: 'The approved case being continued by hand' },
        executed_by: { type: 'string', description: 'The HUMAN operator who performed the action, as did:nostr:<64 lower-case hex>. Never an agent DID.' },
        evidence: { type: 'string', description: "What the operator actually did, in their own words — the receipt's only human-authored content. Mandatory." },
        operation: {
          type: 'object',
          description: 'The operation as executed. When supplied its canonical digest must equal the approved one; omit to bind to the recorded approval.',
          additionalProperties: true,
        },
      },
      required: ['case_id', 'executed_by', 'evidence'],
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

      // ADR-2011 — derive the triple from the OPERATOR's manifest. A caller's
      // own `task_properties` is merged on the tightening lattice, so a request
      // can raise the boundary for its own action but never lower it.
      const properties = taskProperties.derive(args.action_class, {
        manifest: manifest(),
        requested: args.task_properties,
      });

      const requestPayload = {
        case_id: caseId,
        panel_id: args.panel_id,
        title: args.title,
        description: args.description,
        priority: args.priority || 'medium',
        // Carried in the content as well as the tags: the tags are what the
        // relay projects, the content is what the reviewer's card renders.
        task_properties: properties,
        ...(args.action_class ? { action_class: args.action_class } : {}),
        ...(args.context ? { context: args.context } : {}),
      };

      const event = {
        kind: 31402,
        content: JSON.stringify(requestPayload),
        tags: [
          ['d', caseId],
          ['e', args.panel_id],
          // ALWAYS all three. An absent tag reads as "legacy, use the panel
          // default", which is indistinguishable from deliberate under-tiering.
          ...taskProperties.toTags(properties),
        ],
        created_at: nowUnix(),
      };

      const dir = outboxDir();
      const outboxPath = writeEvent(dir, `${caseId}.json`, event);

      return {
        published: true, case_id: caseId, outbox_path: outboxPath,
        task_properties: properties,
      };
    }

    case 'governance_manual_continue': {
      const caseErr = validateString(args.case_id, 'case_id', 256);
      if (caseErr) return caseErr;
      const execErr = validateString(args.executed_by, 'executed_by', 128);
      if (execErr) return execErr;
      const evidenceErr = validateString(args.evidence, 'evidence', 4096);
      if (evidenceErr) return evidenceErr;

      const result = await manualContinue(
        {
          case_id: args.case_id,
          executed_by: args.executed_by,
          evidence: args.evidence,
          ...(args.operation ? { operation: args.operation } : {}),
        },
        {
          receipts: new ApplicationReceiptStore(),
          publisher: buildReceiptPublisher({ manifest: manifest() }),
          // This server's own identity: it publishes the record, it can never
          // be its subject.
          agentDid: PUBKEY ? `did:nostr:${PUBKEY}` : null,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        },
      );

      if (!result.ok) {
        return { error: result.error, message: result.message };
      }
      return result;
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

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleTool(name, args || {});
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
});

// Connect ONLY when this file is the process entrypoint. Importing it (from a
// test, or another server that wants the tool table) must not open a stdio
// transport or claim the MCP channel.
const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[governance-bridge] Connected to MCP, pubkey=${PUBKEY.slice(0, 8)}…, pod_root=${POD_ROOT}`);
}

export { TOOLS, handleTool, server };
