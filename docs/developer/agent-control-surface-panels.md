# Agent Control Surface Protocol (ACSP) — Panel Schema Reference

Agent-facing reference for constructing Nostr events of kinds **31400-31405**
so that interactive control panels render on the DreamLab forum governance
page (`/community/governance`). Read this top to bottom and you can emit a
valid panel on the first try.

Ground truth, in priority order:

| Layer | File |
|-------|------|
| Producer (this repo) | [`management-api/lib/agent-control-surface.js`](../../management-api/lib/agent-control-surface.js) |
| Wire contract (consumer serde) | `nostr-rust-forum` → `crates/nostr-bbs-core/src/governance.rs` |
| Relay gate + broker projection | `nostr-rust-forum` → `crates/nostr-bbs-relay-worker/src/relay_do/nip_handlers.rs` |
| Rendering | `nostr-rust-forum` → `crates/nostr-bbs-forum-client/src/pages/governance.rs` + `stores/panel_registry.rs` |
| Contract tests (19) | [`tests/sovereign/agent-control-surface.test.js`](../../tests/sovereign/agent-control-surface.test.js) |

If this document and the code ever disagree, the code wins — file a docs bug.

---

## 1. Event kinds

| Kind  | Name            | Publisher | Builder | Purpose |
|-------|-----------------|-----------|---------|---------|
| 31400 | PanelDefinition | Agent     | `buildPanelDefinition` | Declare a control panel (schema, fields, actions) |
| 31401 | PanelState      | Agent     | `buildPanelState`      | Publish the current panel data snapshot |
| 31402 | ActionRequest   | Agent     | `buildActionRequest`   | Request a human decision (governance inbox) |
| 31403 | ActionResponse  | **Human (admin-only)** | — (forum UI publishes it) | Approve/reject an action request |
| 31404 | PanelUpdate     | Agent     | `buildPanelUpdate`     | Incremental state diff (shallow-merged) |
| 31405 | PanelRetired    | Agent     | `buildPanelRetired`    | Retire a panel (removed from the page) |

All six are **NIP-33 parameterised-replaceable** events addressed by the
`["d", panelId]` tag. Re-publishing the same `(kind, pubkey, d)` triple
replaces the prior event. The kind numbers are sourced from the single frozen
`kinds` enum in `mcp/servers/nostr-bridge.js` — never re-declare them.

### Invariants that apply to every kind

- The first tag is `["d", "<panelId>"]` and the value MUST be non-empty
  (relay/core reject `MissingDTag` / `EmptyDTag`).
- Content JSON keys are **snake_case**: `field_type`, `refresh_secs`,
  `context_url`. CamelCase keys fail consumer serde and the event is
  silently dropped from rendering.
- Enum values are **kebab-case**: `action-inbox`, `inbox-table`,
  `bulk-action`, …. An unknown enum value fails the *whole* parse.
- Builders emit **unsigned** events: `{ kind, created_at, tags, content }`
  with no `id`/`pubkey`/`sig` — the signer adds those.
- Relay hard limits: content ≤ 64 KiB, ≤ 2000 tags, each tag value ≤ 1024
  bytes; `id` 64 hex, `pubkey` 64 hex, `sig` 128 hex after signing.

---

## 2. Kind 31400 — PanelDefinition

Declares the panel. Content is a JSON **string** with this exact shape
(serde struct `PanelDefinition` in `governance.rs`):

```json
{
  "kind": 31400,
  "created_at": 1700000000,
  "tags": [["d", "agent-inbox"]],
  "content": "{\"title\":\"Agent Inbox\",\"description\":\"Pending agent decisions\",\"version\":\"1.0.0\",\"schema\":\"action-inbox\",\"fields\":[{\"name\":\"entity\",\"field_type\":\"string\",\"label\":\"Entity URN\"}],\"actions\":[{\"id\":\"approve\",\"label\":\"Approve\",\"style\":\"primary\"}],\"layout\":\"inbox-table\",\"capabilities\":[\"bulk-action\",\"filter\"],\"refresh_secs\":30}"
}
```

Decoded content (this is the object you serialise):

```json
{
  "title": "Agent Inbox",
  "description": "Pending agent decisions",
  "version": "1.0.0",
  "schema": "action-inbox",
  "fields": [
    { "name": "entity", "field_type": "string", "label": "Entity URN" }
  ],
  "actions": [
    { "id": "approve", "label": "Approve", "style": "primary" }
  ],
  "layout": "inbox-table",
  "capabilities": ["bulk-action", "filter"],
  "refresh_secs": 30
}
```

| Content key | Type | Required | Default | Domain |
|-------------|------|----------|---------|--------|
| `title` | string | yes | — | non-empty |
| `description` | string | yes | — | non-empty |
| `version` | string | no | `"1.0.0"` | semver string |
| `schema` | string | yes | — | `action-inbox` \| `dashboard` \| `config-form` \| `status-board` \| `chat-bridge` |
| `fields` | array | yes (builder emits `[]`) | — | array of FieldDef |
| `fields[].name` | string | yes | — | non-empty |
| `fields[].field_type` | string | yes | — | see §7 field_type catalogue |
| `fields[].label` | string | yes | — | non-empty |
| `actions` | array | yes (builder emits `[]`) | — | array of ActionDef |
| `actions[].id` | string | yes | — | non-empty; echoed by future responses |
| `actions[].label` | string | yes | — | button text |
| `actions[].style` | string | yes | — | `primary` \| `secondary` \| `destructive` |
| `layout` | string | yes | — | `inbox-table` \| `kanban` \| `card-grid` \| `split-detail` |
| `capabilities` | array | no | `[]` | subset of `bulk-action`, `filter`, `search`, `sort`, `export` |
| `refresh_secs` | number (u32) | no | `30` | suggested client refresh cadence |

Note: in the JS builder, field/action inputs use camelCase parameter names
(`fieldType`) — the builder converts to wire snake_case (`field_type`). If
you build content by hand, use snake_case on the wire.

## 3. Kind 31401 — PanelState

Content is an **arbitrary JSON object** — your panel's full data snapshot.
Arrays and scalars are rejected by the builder (and merge poorly downstream);
the top level MUST be an object.

```json
{
  "kind": 31401,
  "created_at": 1700000060,
  "tags": [["d", "agent-inbox"]],
  "content": "{\"rows\":[{\"entity\":\"urn:agentbox:bead:abc\",\"status\":\"pending\"}],\"total\":1}"
}
```

The consumer stores this verbatim under the panel's `d` tag
(`panel_states[d_tag]`) and bumps the panel's `last_updated`.

## 4. Kind 31402 — ActionRequest

Requests a human decision. **The split between content and tags matters:**

- **Content** (snake_case, serde struct `ActionRequest`):

```json
{
  "fields": { "entity": "urn:agentbox:bead:abc" },
  "reasoning": "needs human sign-off",
  "context_url": "https://example/ctx"
}
```

  `fields` is any JSON value (object recommended); `reasoning` and
  `context_url` are `string | null`. The builder emits explicit `null` for
  absent optionals. **`priority` must NOT appear in content** — it is a tag.

- **Tags** — priority and the broker-case projection fields travel as tags
  because the relay projects them into the D1 `broker_cases` table without
  parsing content:

```json
{
  "kind": 31402,
  "created_at": 1700000120,
  "tags": [
    ["d", "case-42"],
    ["priority", "high"],
    ["category", "workflow_review"],
    ["subject-kind", "work_artifact"],
    ["subject-id", "art-1"],
    ["title", "Review artifact"]
  ],
  "content": "{\"fields\":{\"entity\":\"urn:agentbox:bead:abc\"},\"reasoning\":\"needs human sign-off\",\"context_url\":\"https://example/ctx\"}"
}
```

| Tag | Required | Default (relay-side) | Domain |
|-----|----------|----------------------|--------|
| `d` | yes | — | case id; becomes `broker_cases.id` |
| `priority` | no | `medium` (UI badge) / `50` (broker row) | `critical` \| `high` \| `medium` \| `low` |
| `category` | no | `manual_submission` | snake_case `CaseCategory`: `contributor_mesh_share`, `workflow_review`, `policy_exception`, `trust_alert`, `manual_submission`, `knowledge_enrichment` |
| `subject-kind` | no | `opaque` | snake_case `SubjectKind`: `work_artifact`, `skill_package`, `automation_proposal`, `policy_exception`, `opaque` |
| `subject-id` | no | `""` | free-form subject identifier (URN recommended) |
| `title` | no | `Untitled` | broker-case headline shown in the inbox |

Broker projection details (relay-worker `project_action_request`): the event
content string becomes `broker_cases.summary`, your pubkey becomes
`created_by`, state starts at `open`. **Known quirk:** the broker row's
numeric `priority` column is parsed from the `priority` tag with
`parse::<u32>()` — the label form (`"high"`) does not parse, so builder-made
events always land with broker priority `50`. The governance UI badge reads
the *label* directly, so the visible priority is still correct.

## 5. Kind 31403 — ActionResponse (you do NOT publish this)

Human admins answer 31402 requests via the forum UI. Agents only need to
recognise the shape when subscribing for answers:

```json
{
  "kind": 31403,
  "tags": [
    ["d", "case-42"],
    ["e", "<31402 event id>"]
  ],
  "content": "{\"action\":\"approve\",\"reasoning\":\"Human approve via governance UI\"}"
}
```

Content serde struct `ActionResponse`: `action` (string — `approve`,
`reject`, or any `DecisionOutcome.action_str()`: `amend`, `delegate`,
`promote`, `precedent`) and `reasoning` (string, required). The relay accepts
31403 **only from admins** and projects it into `broker_decisions`, updating
the case state: `approve` → `resolved`, `reject` → `rejected`, anything else
→ `under_review`. A 31403 from a registered agent is still rejected —
agents cannot approve their own (or anyone's) requests.

## 6. Kind 31404 — PanelUpdate and 31405 — PanelRetired

**31404 PanelUpdate** — content is a JSON object whose top-level keys are
**shallow-merged** into the panel's last 31401 snapshot by the consumer
(nested objects are replaced wholesale, not deep-merged):

```json
{
  "kind": 31404,
  "created_at": 1700000180,
  "tags": [["d", "agent-inbox"]],
  "content": "{\"total\":3}"
}
```

**31405 PanelRetired** — empty content, `d` tag only. The consumer removes
the panel and its state:

```json
{
  "kind": 31405,
  "created_at": 1700000240,
  "tags": [["d", "agent-inbox"]],
  "content": ""
}
```

Caution: `nostr-bbs-core` also defines 31405 as `KIND_GOVERNANCE_AUDIT_LOG`
with **append-only `d`-tag semantics** in `validate_governance_event` — where
that validator is enforced, a second 31405 with the same `d` is rejected as a
replay (`DuplicateAuditEntry`). Retire a given `panelId` once; to bring the
panel back, re-publish its 31400 definition.

---

## 7. field_type catalogue

`FieldType` enum, kebab-case on the wire (all single lowercase words):

| `field_type` | Meaning |
|--------------|---------|
| `string` | free text |
| `int` | integer |
| `float` | floating point |
| `bool` | true/false |
| `json` | opaque JSON blob (rendered raw) |
| `enum` | one of a closed set (set itself travels in your 31401 state) |
| `timestamp` | unix seconds |

Any other value (e.g. `text`, `number`, `date`) fails the consumer parse and
the panel will not render — even though the relay stored the event.

## 8. The registry gate — getting your pubkey registered

The relay accepts kinds 31400/31401/31402/31404/31405 **only from pubkeys in
its `agent_registry` D1 table with `active = 1`**. Anything else gets
`OK false "blocked: pubkey not in agent registry"`. Kind 31403 is exempt
from the agent gate but is **admin-only**.

Registration is an admin operation against the auth-worker governance API
(all endpoints NIP-98 gated):

| Method | Path | Gate | Purpose |
|--------|------|------|---------|
| GET  | `/api/governance/agents` | any authed | List registered agents |
| POST | `/api/governance/agents/register` | admin | Register an agent pubkey |
| POST | `/api/governance/agents/revoke` | admin | Deactivate (`active = 0`) |
| GET  | `/api/governance/cases` | any authed | List broker cases (`?state=` filter) |
| GET  | `/api/governance/cases/:id` | any authed | Single broker case |

Registration body:

```json
{
  "pubkey": "<64 lowercase hex chars — BIP-340 x-only pubkey>",
  "name": "agentbox-orchestrator",
  "description": "Agentbox management-api control surface",
  "rate_limit_per_min": 60
}
```

`pubkey` must be exactly 64 hex chars (not npub bech32, not `did:nostr:`
prefixed); `name` is required; `rate_limit_per_min` defaults to 60.
`INSERT OR REPLACE` semantics — re-registering updates the row and
re-activates a revoked agent.

## 9. Identity and NIP-98

- Agent identity is `did:nostr:<hex-pubkey>` — the same 64-char BIP-340
  x-only hex pubkey that signs your events and sits in `agent_registry`.
  No separate API key: **registration + your Schnorr signature IS the
  authorisation** for relay publishes.
- The governance HTTP API (registration, case queries) requires **NIP-98**
  (kind 27235 `Authorization: Nostr <base64-event>` headers).
  `mcp/servers/nostr-bridge.js` exposes `buildNip98Header(url, method,
  signer, body)` for this.
- In agentbox, the per-profile key lives encrypted at
  `/workspace/profiles/<stack>/nostr.key.enc` (AES-256-GCM, passphrase
  derived from `MANAGEMENT_API_KEY` + profile salt). `loadSigner(stack)`
  decrypts it and returns a `{ sign(event) }` closure — the raw key never
  leaves the module.

## 10. Publish path — minimal working panel

The bridge lifecycle is owned by management-api boot under the
`[sovereign_mesh] nostr_bridge = true` gate in `agentbox.toml`; relays come
from `NOSTR_RELAYS` (comma-separated). `publishPanelEvent` deliberately never
connects/disconnects — pass an **already-connected** bridge.

```js
const acs = require('./management-api/lib/agent-control-surface');
const { NostrBridge, loadSigner } = require('./mcp/servers/nostr-bridge');

const bridge = new NostrBridge({ relays: ['wss://relay.dreamlab-ai.com'] });
await bridge.connect();                 // boot-time, once
const signer = loadSigner('claude');    // profile stack name

// 1. Declare the panel (31400)
const definition = acs.buildPanelDefinition({
  panelId: 'demo-status',
  title: 'Demo Status',
  description: 'Liveness of the demo agent',
  schema: 'status-board',
  layout: 'card-grid',
  fields: [{ name: 'uptime', fieldType: 'int', label: 'Uptime (s)' }],
  actions: [{ id: 'restart', label: 'Restart', style: 'destructive' }],
});
await acs.publishPanelEvent(bridge, signer, definition);

// 2. Seed its state (31401)
await acs.publishPanelEvent(bridge, signer, acs.buildPanelState({
  panelId: 'demo-status',
  state: { uptime: 12, healthy: true },
}));

// 3. Later: incremental update (31404)
await acs.publishPanelEvent(bridge, signer, acs.buildPanelUpdate({
  panelId: 'demo-status',
  diff: { uptime: 600 },
}));

// 4. Need a human? (31402)
await acs.publishPanelEvent(bridge, signer, acs.buildActionRequest({
  panelId: 'case-demo-1',
  fields: { subject: 'urn:agentbox:bead:abc' },
  reasoning: 'Threshold exceeded; require sign-off',
  priority: 'high',
  category: 'workflow_review',
  subjectKind: 'work_artifact',
  subjectId: 'urn:agentbox:bead:abc',
  title: 'Sign off threshold breach',
}));

// 5. Done with the panel (31405)
await acs.publishPanelEvent(bridge, signer, acs.buildPanelRetired({
  panelId: 'demo-status',
}));
```

The builders throw `TypeError`/`RangeError` on any out-of-domain input
(unknown schema/layout/fieldType/style/capability/priority, empty required
string) — so an event that builds is an event that parses on the other side.

## 11. How it renders

The forum client subscribes to kinds 31400-31405 (limit 200) and feeds
events into the reactive `PanelRegistry` store. The governance page
(`/governance` in the forum SPA; `/community/governance` on
dreamlab-ai.com) renders:

- **Stats** — active panel count, pending action count, distinct agent count.
- **Pending Actions** — one row per 31402: priority badge (colour-coded
  from the `priority` tag label), title, reasoning, the agent's resolved
  display name (kind-0 metadata > shortened pubkey), and Approve/Reject
  buttons that publish 31403 as the signed-in human.
- **Agent Panels** — one card per 31400: title, schema badge, description,
  field/action counts, action buttons styled by `style`
  (`destructive` red, `primary` amber, `secondary` grey).

Publish a kind-0 metadata event for your agent pubkey (with `name` /
`display_name`) so the page shows a friendly name instead of truncated hex.

## 12. Dos and don'ts

**Do**

- Mint one stable `panelId` per logical panel and reuse it — that is your
  NIP-33 replacement key.
- Use snake_case content keys, kebab-case enum values — serde-exact.
- Send `priority`/`category`/`subject-kind`/`subject-id`/`title` as **tags**
  on 31402 — the broker projection reads tags only.
- Use a fresh `d` per action request (it becomes the broker case id) and a
  URN (minted via `management-api/lib/uris.js`) as `subject-id`.
- Keep 31401 snapshots small and lean on 31404 diffs; the whole event must
  stay under 64 KiB.
- Subscribe to kind 31403 filtered on your case `d` tags to learn the
  human's decision.

**Don't**

- Don't put `priority` in content — the UI defaults to `medium` and the
  broker row to `50` if the tag is missing.
- Don't publish 31403 — it is admin-only and will be rejected.
- Don't invent field types, schemas, or layouts — unknown enum values make
  the consumer drop the event silently after the relay said OK.
- Don't open relay connections inside request handlers — build, then
  delegate to the boot-owned bridge via `publishPanelEvent`.
- Don't re-declare the kind numbers — import `kinds` from
  `mcp/servers/nostr-bridge.js`.
- Don't send arrays or scalars as 31401/31404 content — top level must be a
  JSON object.

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `OK false "blocked: pubkey not in agent registry"` | Your pubkey is not in `agent_registry` (or `active = 0`) | Ask a relay admin to `POST /api/governance/agents/register` your 64-hex pubkey (§8) |
| `OK false "blocked: admin-only governance action response"` | You published kind 31403 | Don't — only human admins respond; subscribe to 31403 instead |
| Relay says OK but the panel never appears | Content failed consumer serde: camelCase keys, unknown enum value, missing required key (`title`, `description`, `schema`, `fields`, `actions`, `layout`) | Match §2 exactly; build via `buildPanelDefinition` so bad input throws locally |
| Action shows priority `medium` though you set `critical` | Priority was placed in content, not tags | Move it to a `["priority", "critical"]` tag (the builder does this) |
| `broker_cases.priority` is `50` despite a `high` tag | Relay parses the tag numerically; labels don't parse | Known behaviour — the UI badge uses the label; numeric broker priority needs a numeric tag value |
| `OK false "invalid: ..."` / event dropped pre-gate | Structural limits: content > 64 KiB, > 2000 tags, tag value > 1024 B, malformed id/pubkey/sig | Shrink the snapshot, split into 31404 diffs |
| Panel vanished unexpectedly | Another event with the same `(kind, pubkey, d)` replaced it, or a 31405 retired it | Use distinct `panelId`s per panel; one keypair per agent |
| 31405 rejected as duplicate | Append-only audit semantics on 31405 reject a reused `d` | Retire each `panelId` at most once; re-publish 31400 to resurrect |
| Page shows raw hex instead of agent name | No kind-0 metadata for your pubkey | Publish kind 0 with `name`/`display_name` from the same key |
| `loadSigner` throws | `MANAGEMENT_API_KEY` unset or `nostr.key.enc`/`nostr.salt` missing for the stack | Run sovereign bootstrap for the profile; check env |
| `publishPanelEvent` throws about bridge/signer | Bridge not connected/injected, or signer lacks `sign()` | Use the management-api boot bridge; `loadSigner(stack)` |

## 14. Related documents

- Operator/consumer view: `dreamlab-ai-website` →
  `docs/architecture/agent-panels.md`
- Integration note in the host project →
  `docs/architecture/agent-control-surface-panels.md`
- Identity mesh: [`identity-mesh.md`](identity-mesh.md)
- Sovereign mesh (bridge boot gate): [`sovereign-mesh.md`](sovereign-mesh.md)
- Canonical URN minting: ADR-013 + `management-api/lib/uris.js`
