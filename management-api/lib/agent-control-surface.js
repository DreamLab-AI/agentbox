'use strict';

/**
 * agent-control-surface — the missing PRODUCER for the Agent Control Surface
 * Protocol (ACSP). Pure builders that mint unsigned NIP-33 Nostr events an
 * agent uses to project an interactive control panel into the nostr-rust-forum
 * forum-client (which dreamlab-ai-website shallow-clones at build time).
 *
 * The rest of the pipeline already existed before this module:
 *   relay      — nostr-bbs-relay-worker accepts kinds 31400-31405 ONLY from
 *                pubkeys in its agent_registry table; ActionRequest (31402) is
 *                projected into the broker_cases governance inbox.
 *   consumer   — nostr-bbs-forum-client `panel_registry` ingests the same kinds
 *                and renders them on the GovernancePage.
 *   website    — dreamlab-ai-website embeds the forum-client at build time.
 * The single missing hop was an agentbox producer that mints/publishes these
 * events. This module is that producer — builders only; publication is a thin
 * delegate over an ALREADY-CONNECTED NostrBridge (no in-request relay I/O).
 *
 * Wire contract (mirrors nostr-bbs-core::governance, serde-exact):
 *   - content JSON keys are snake_case (field_type, refresh_secs, context_url)
 *   - enum values are kebab-case (schema/layout/field-type/style/capability)
 *   - every event is a parameterised-replaceable NIP-33 event keyed by its
 *     `["d", panelId]` tag (kind, pubkey, d-tag) — re-publishing the same
 *     panelId replaces the prior state.
 *   - ActionRequest priority travels as a `["priority", <label>]` TAG, not in
 *     content; broker-case projection reads category/subject-kind/subject-id/
 *     title tags too, all optional with relay-side defaults.
 *
 * The `kinds` enum is imported from nostr-bridge.js — single source of truth,
 * never re-declared here.
 */

const { kinds } = require('../../mcp/servers/nostr-bridge');

// ─── Enum domains (kebab-case, mirrors governance.rs serde rename_all) ──────────

const PANEL_SCHEMAS      = Object.freeze(['action-inbox', 'dashboard', 'config-form', 'status-board', 'chat-bridge']);
const FIELD_TYPES        = Object.freeze(['string', 'int', 'float', 'bool', 'json', 'enum', 'timestamp']);
const ACTION_STYLES      = Object.freeze(['primary', 'secondary', 'destructive']);
const LAYOUT_HINTS       = Object.freeze(['inbox-table', 'kanban', 'card-grid', 'split-detail']);
const PANEL_CAPABILITIES = Object.freeze(['bulk-action', 'filter', 'search', 'sort', 'export']);
const ACTION_PRIORITIES  = Object.freeze(['critical', 'high', 'medium', 'low']);

// ─── Validation helpers ─────────────────────────────────────────────────────────

function reqStr(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} is required and must be a non-empty string`);
  }
  return value;
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of [${allowed.join(', ')}]; got ${JSON.stringify(value)}`);
  }
  return value;
}

function nowSecs() {
  return Math.floor(Date.now() / 1000);
}

/** Build the base unsigned event: NIP-33 d-tag + any extra tags, no id/sig/pubkey. */
function baseEvent(kind, panelId, content, createdAt, extraTags) {
  reqStr(panelId, 'panelId');
  const tags = [['d', panelId]];
  if (extraTags) {
    if (!Array.isArray(extraTags)) throw new TypeError('extraTags must be an array of [name, ...] tags');
    for (const t of extraTags) {
      if (!Array.isArray(t) || t.length === 0) throw new TypeError('each extra tag must be a non-empty array');
      tags.push(t.map(String));
    }
  }
  return {
    kind,
    created_at: typeof createdAt === 'number' ? createdAt : nowSecs(),
    tags,
    content,
  };
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * Kind 31400 — declare an interactive control panel (schema + actions).
 * @param {object} p
 * @param {string} p.panelId          NIP-33 `d` tag; re-use to replace the panel.
 * @param {string} p.title
 * @param {string} p.description
 * @param {string} p.schema           one of PANEL_SCHEMAS
 * @param {string} p.layout           one of LAYOUT_HINTS
 * @param {Array<{name,fieldType,label}>} [p.fields=[]]
 * @param {Array<{id,label,style}>}        [p.actions=[]]
 * @param {string[]} [p.capabilities=[]] subset of PANEL_CAPABILITIES
 * @param {string} [p.version='1.0.0']
 * @param {number} [p.refreshSecs=30]
 * @param {number} [p.createdAt]       unix seconds (defaults to now)
 * @param {string[][]} [p.extraTags]
 * @returns {object} unsigned Nostr event
 */
function buildPanelDefinition(p = {}) {
  reqStr(p.title, 'title');
  reqStr(p.description, 'description');
  assertEnum(p.schema, PANEL_SCHEMAS, 'schema');
  assertEnum(p.layout, LAYOUT_HINTS, 'layout');

  const fields = (p.fields || []).map((f, i) => ({
    name: reqStr(f && f.name, `fields[${i}].name`),
    field_type: assertEnum(f && f.fieldType, FIELD_TYPES, `fields[${i}].fieldType`),
    label: reqStr(f && f.label, `fields[${i}].label`),
  }));

  const actions = (p.actions || []).map((a, i) => ({
    id: reqStr(a && a.id, `actions[${i}].id`),
    label: reqStr(a && a.label, `actions[${i}].label`),
    style: assertEnum(a && a.style, ACTION_STYLES, `actions[${i}].style`),
  }));

  const capabilities = (p.capabilities || []).map((c, i) =>
    assertEnum(c, PANEL_CAPABILITIES, `capabilities[${i}]`));

  const content = JSON.stringify({
    title: p.title,
    description: p.description,
    version: typeof p.version === 'string' && p.version ? p.version : '1.0.0',
    schema: p.schema,
    fields,
    actions,
    layout: p.layout,
    capabilities,
    refresh_secs: Number.isFinite(p.refreshSecs) ? p.refreshSecs : 30,
  });

  return baseEvent(kinds.PANEL_DEFINITION, p.panelId, content, p.createdAt, p.extraTags);
}

/**
 * Kind 31401 — publish the current panel data snapshot (arbitrary JSON object).
 * @param {object} p
 * @param {string} p.panelId
 * @param {object} p.state            JSON-serialisable snapshot object
 * @param {number} [p.createdAt]
 * @param {string[][]} [p.extraTags]
 */
function buildPanelState(p = {}) {
  if (p.state === null || typeof p.state !== 'object' || Array.isArray(p.state)) {
    throw new TypeError('state must be a JSON object');
  }
  return baseEvent(kinds.PANEL_STATE, p.panelId, JSON.stringify(p.state), p.createdAt, p.extraTags);
}

/**
 * Kind 31402 — request a human decision. Priority is a TAG, not content.
 * Optional broker-case projection tags (category/subjectKind/subjectId/title)
 * populate the relay's broker_cases governance inbox row.
 * @param {object} p
 * @param {string} p.panelId
 * @param {object} [p.fields={}]       arbitrary JSON value rendered in the request
 * @param {string} [p.reasoning]
 * @param {string} [p.contextUrl]
 * @param {string} [p.priority='medium'] one of ACTION_PRIORITIES
 * @param {string} [p.category]        broker_cases category tag
 * @param {string} [p.subjectKind]     broker_cases subject-kind tag
 * @param {string} [p.subjectId]       broker_cases subject-id tag
 * @param {string} [p.title]           broker_cases title tag
 * @param {number} [p.createdAt]
 * @param {string[][]} [p.extraTags]
 */
function buildActionRequest(p = {}) {
  const priority = p.priority === undefined ? 'medium' : p.priority;
  assertEnum(priority, ACTION_PRIORITIES, 'priority');

  const fields = p.fields === undefined ? {} : p.fields;

  const content = JSON.stringify({
    fields,
    reasoning: typeof p.reasoning === 'string' ? p.reasoning : null,
    context_url: typeof p.contextUrl === 'string' ? p.contextUrl : null,
  });

  const brokerTags = [['priority', priority]];
  if (typeof p.category === 'string')    brokerTags.push(['category', p.category]);
  if (typeof p.subjectKind === 'string') brokerTags.push(['subject-kind', p.subjectKind]);
  if (typeof p.subjectId === 'string')   brokerTags.push(['subject-id', p.subjectId]);
  if (typeof p.title === 'string')       brokerTags.push(['title', p.title]);
  if (Array.isArray(p.extraTags))        brokerTags.push(...p.extraTags);

  return baseEvent(kinds.ACTION_REQUEST, p.panelId, content, p.createdAt, brokerTags);
}

/**
 * Kind 31404 — incremental state diff merged into the panel's last snapshot.
 * @param {object} p
 * @param {string} p.panelId
 * @param {object} p.diff             JSON object; keys shallow-merged by consumer
 * @param {number} [p.createdAt]
 * @param {string[][]} [p.extraTags]
 */
function buildPanelUpdate(p = {}) {
  if (p.diff === null || typeof p.diff !== 'object' || Array.isArray(p.diff)) {
    throw new TypeError('diff must be a JSON object');
  }
  return baseEvent(kinds.PANEL_UPDATE, p.panelId, JSON.stringify(p.diff), p.createdAt, p.extraTags);
}

/**
 * Kind 31405 — retire a panel. Consumer removes by `d` tag; content is empty.
 * @param {object} p
 * @param {string} p.panelId
 * @param {number} [p.createdAt]
 * @param {string[][]} [p.extraTags]
 */
function buildPanelRetired(p = {}) {
  return baseEvent(kinds.PANEL_RETIRED, p.panelId, '', p.createdAt, p.extraTags);
}

// ─── Publication (injected, already-connected bridge) ───────────────────────────

/**
 * Sign and publish a built panel event over an ALREADY-CONNECTED NostrBridge.
 * Deliberately does NOT open/close relay connections — the bridge lifecycle is
 * owned by management-api boot (NostrBridge.connect() under the
 * sovereign_mesh.nostr_bridge gate). Keeping connection management out of the
 * call path is what makes this safe to invoke from request handlers later.
 *
 * @param {{ publish(event, signer): Promise<object> }} bridge - connected NostrBridge
 * @param {{ sign(event): Promise<object> }} signer            - from loadSigner()
 * @param {object} unsignedEvent                               - from a build* fn
 * @returns {Promise<object>} the signed event
 */
function publishPanelEvent(bridge, signer, unsignedEvent) {
  if (!bridge || typeof bridge.publish !== 'function') {
    throw new TypeError('publishPanelEvent: bridge must be a connected NostrBridge with publish()');
  }
  if (!signer || typeof signer.sign !== 'function') {
    throw new TypeError('publishPanelEvent: signer must have a sign(event) method');
  }
  if (!unsignedEvent || typeof unsignedEvent.kind !== 'number') {
    throw new TypeError('publishPanelEvent: unsignedEvent must be a built panel event');
  }
  return bridge.publish(unsignedEvent, signer);
}

module.exports = {
  buildPanelDefinition,
  buildPanelState,
  buildActionRequest,
  buildPanelUpdate,
  buildPanelRetired,
  publishPanelEvent,
  // exposed for tests / introspection
  kinds,
  PANEL_SCHEMAS,
  FIELD_TYPES,
  ACTION_STYLES,
  LAYOUT_HINTS,
  PANEL_CAPABILITIES,
  ACTION_PRIORITIES,
};
