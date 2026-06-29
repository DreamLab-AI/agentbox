---
id: ADR-035
title: "Project tracking: port-bound telemetry + addressable kind-30841"
status: accepted
date: 2026-06-28
type: observability
author: Dr John O'Hare
depends_on: [ADR-005, ADR-009, ADR-013, ADR-015]
related: [ADR-008, ADR-012, ADR-029, ADR-030, PRD-008, PRD-017, DDD-015]
review_trigger: a seventh project-tracking URN shape is needed (forces a new-kind vs reuse re-evaluation); the shared Prometheus registry is split or a second metrics port is proposed; the kind-30841 d-tag semantics or its dual-write targets change; or project tracking acquires durable state that does not fit an existing adapter slot
"@context": https://schema.org
"@type": TechArticle
---

# ADR-035 — Project tracking: port-bound telemetry + addressable kind-30841

**Related:** ADR-005 (Pluggable adapter architecture + observability middleware), ADR-008 (Privacy filter routing), ADR-009 (Embedded Nostr relay), ADR-012 (JSON-LD encoder), ADR-013 (Canonical URI grammar), ADR-015 (MCP RuVector mandate), ADR-029 (Session-mirror live egress), ADR-030 (Sovereign-mesh manifest boundary), PRD-008 (Code-as-Harness URN reuse precedent), PRD-017 (Sovereign project tracking), DDD-015 (Project-tracking domain)

## TL;DR for newcomers
*Skip if you already know that project tracking adds no new URN kinds, no new port, and one new addressable nostr kind.*

PRD-017 brings helm-grade project tracking — a status grid, 30-day commit charts, AI primers/synopses, GitHub + local repo sync — into agentbox. Rather than import helm's Fastify/React stack, we re-express its tracking model on the three substrates agentbox already owns: the canonical URN grammar (ADR-013), the port-bound Prometheus telemetry (ADR-005 observability), and the custom-kind nostr mesh (ADR-009/029/030). This ADR records the four substrate decisions that keep that re-expression sovereign and additive rather than a parallel stack.

The shape of the answer: **reuse the existing 18 URN kinds** (six mappings, no new kinds — the Code-as-Harness precedent from PRD-008); **extend the shared Prometheus registry** behind the existing `/metrics` port (no new port); **add one addressable nostr kind-30841**, sibling of the kind-30840 session-summary, NIP-33-keyed on the project slug so a re-publish replaces the prior digest; and route every byte of durable state through the **existing adapter slots** (memory for primers, events for scans) rather than minting a sixth slot. Everything is manifest-gated under `[project_tracking]`, default-off, fail-open on the optional nostr egress, and privacy-careful on labels (slug, never an absolute host path).

**If you remember only one thing:** project tracking is additive observability, not a new subsystem — no new URN kind, no new port, one new nostr kind, zero new adapter slots.

For the deep version, keep reading.

## Context

helm is an external Fastify/React project dashboard: it aggregates GitHub repositories and local git checkouts, generates AI primers and synopses via the Claude CLI, renders 30-day commit-activity charts, and indexes repo/crate libraries. It has no telemetry surface and no nostr presence — it is a self-contained web app. We want its *tracking model* (the status grid, the commit window, the primer pipeline, the GitHub/local sync) and explicitly reject its *stack*. agentbox already has the three primitives helm lacks, and project tracking is the kind of read-mostly observability workload those primitives were built for.

That leaves four substrate questions, each with an obvious wrong answer that would fork agentbox into a second architecture:

1. **Identity.** A tracked project, a scan, a commit window, a primer, a synopsis, and a published digest each need a durable, resolvable identifier. The wrong answer is six new URN kinds (or, worse, ad-hoc template-literal URNs); ADR-013 has 18 kinds already and PRD-008 set the precedent that new capabilities map onto them rather than extend the grammar.
2. **Telemetry transport.** Project gauges need to reach Prometheus. The wrong answer is a second metrics server on a new port with its own registry and its own `collectDefaultMetrics()` call — the exact duplication R-011 collapsed in `observability/metrics.js`.
3. **Mesh presence.** A project status digest should be readable on the phone, the way the kind-30840 session summary is. The wrong answer is reusing kind-30840 (conflating two unrelated digest streams on one addressable slot) or inventing a non-addressable kind that accretes one event per scan forever.
4. **Durable state.** Primers, synopses, and scan receipts must persist. The wrong answer is a sixth adapter slot — the five-slot pattern (ADR-005) exists precisely so new capabilities compose onto `memory`/`events` instead of growing the taxonomy.

The framing tension across all four: project tracking is genuinely *new behaviour*, but it must land as *additive use of existing substrate*, not a parallel stack. Each decision below is the additive option, with the parallel-stack option named and rejected.

## Decision

### D1: Reuse the existing 18 URN kinds — no new kinds

Every project-tracking entity maps onto an existing ADR-013 kind. Six mappings, all minted through `management-api/lib/uris.js` `mint()` with `<scope>` = the 64-character BIP-340 x-only hex pubkey (`AGENTBOX_PUBKEY`), `owner_did = did:nostr:<hex>`:

| Entity | URN | Kind rationale |
|---|---|---|
| TrackedProject | `urn:agentbox:thing:<scope>:project-<sha256-12>` | A tracked repo is a `thing` (content-addressed on remote URL or absolute path) |
| ProjectScan | `urn:agentbox:activity:<scope>:projscan-<sha256-12>` | A scan is a PROV-O action receipt → `activity` |
| CommitWindow | `urn:agentbox:dataset:<scope>:commits-<projsha>-30d` | A 30-day commit series is a `dataset` |
| ProjectPrimer | `urn:agentbox:memory:<scope>:primer-<sha256-12>` | A generated primer is retrievable agent `memory` |
| ProjectSynopsis | `urn:agentbox:memory:<scope>:synopsis-<sha256-12>` | A synopsis is retrievable agent `memory` |
| TrackingDigest | `urn:agentbox:event:<scope>:projtrack-<sha256-12>` | A published digest is an `event` |

*Rationale:* this is the **Code-as-Harness precedent** (PRD-008 / CLAUDE.md "Code-as-Harness URN Allocation") applied verbatim — that work introduced kernel sessions, execution traces, distilled lessons and verified skills entirely under `thing`/`activity`/`memory`/`skill`/`receipt` without a single new kind. The grammar's value is in its closure: anything addressable across the mesh resolves through one of 18 kinds and one `/v1/uri/<urn>` route. Adding kinds would force every consumer (the BC20 anti-corruption bridge in `lib/bc20-provenance-bridge.js`, the linked-data encoder, the resolver) to learn new shapes. Reusing kinds also **keeps the BC20 bridge total unchanged** — the cross-namespace importer (B05) still maps the same five owner-scoped kinds at the federation boundary; project tracking adds no new mapping surface there. The `dataset` kind for the commit window is the one mapping worth flagging: the window is genuinely a derived time series (30 daily counts), not an action or a memory, and `dataset` is the kind ADR-013 reserves for exactly that.

### D2: Extend the shared Prometheus registry on the existing port-bound /metrics

Project metrics register on the **same `prom-client` registry** exported by `observability/metrics.js` — they do not stand up a second server. The new module `observability/project-metrics.js` does `const { register } = require('./metrics')` and registers every series against it, so the gauges appear on the existing scrape endpoints unchanged: in-process on `9090` and standalone on `9091`, bound `0.0.0.0`. The series, prefixed `agentbox_project_`:

| Series | Type | Labels |
|---|---|---|
| `agentbox_project_tracked_total` | Gauge | — |
| `agentbox_project_info` | Gauge (=1) | `project, language, source, owner_did, urn` |
| `agentbox_project_commits_30d` | Gauge | `project` |
| `agentbox_project_open_issues` | Gauge | `project` |
| `agentbox_project_stars` | Gauge | `project` |
| `agentbox_project_last_commit_age_seconds` | Gauge | `project` |
| `agentbox_project_primer_status` | Gauge (1 for active status) | `project, status` |
| `agentbox_project_scan_duration_seconds` | Histogram | — |
| `agentbox_project_scans_total` | Counter | `outcome` (success\|error) |
| `agentbox_project_nostr_publish_total` | Counter | `outcome` (success\|error\|skipped) |

*Rationale:* R-011 (recorded in `observability/metrics.js`) deliberately collapsed agentbox to **exactly one Prometheus registry and one `collectDefaultMetrics()` call**; a second port would resurrect the duplication that change removed, and E013 (ADR-005 validation) forbids a metrics port colliding with any other compose-assigned port — a dedicated project-tracking port would be a new collision surface to validate. The "info gauge set to 1 with descriptive labels" pattern matches the existing `agentbox_build_info` and `agentbox_adapter_health` precedent. The metrics are **scrape-on-trusted-network**: the `0.0.0.0` bind is identical to the existing adapter metrics — Prometheus reaches them over the internal compose network, never the public internet, and the surface carries no secrets. The privacy posture is enforced at the label boundary (see D5): the `project` label is the slug (basename), and `owner_did` is the public pubkey, so even a leaked scrape exposes only what the public mesh already exposes.

### D3: A new addressable kind-30841, sibling of kind-30840

Project digests publish as a **new addressable nostr kind, `KIND_PROJECT_TRACKING = 30841`** — the next slot above the kind-30840 session-summary, in the NIP-33 parameterised-replaceable (30000–39999) range. It is signed by the **agent key** (the agent is the author, exactly as `publish_session_summary` authors the 30840), NIP-33-keyed with **`d`-tag = project slug**, and **dual-written to the pod + relay** by the Rust bridge's new `track` subcommand. Tags: `["d", slug]`, `["p", recipient_hex]`, `["t", "agentbox-project"]`, `["r", remote]` (when known), `["l", language]` (when known), `["alt", "Project status: <name>"]`. Content is a human-readable digest (name, synopsis, language, last commit, 30-day commit count, open issues, stars, primer status, project URN). 30841 is added to `[sovereign_mesh.relay].allowed_kinds`.

*Rationale:* **addressable so re-publish replaces.** A project's status is a *current-state* fact, not an append-only log — the next scan should overwrite the last digest, not accrete a new event. NIP-33 addressability keyed on the slug gives exactly that: re-publishing the same slug replaces the prior digest at the relay and at `projects/<id>.jsonld` in the pod, so a phone client always shows one current card per project. This is the same reasoning the kind-30840 session summary uses (its `d`-tag is the session id "so re-summarising the same session replaces the prior digest", per `lib.rs`), which is why 30841 is its sibling rather than a fork of it: same authorship model (agent-signed, not gift-wrapped), same dual-write-to-pod-then-best-effort-relay durability, same self-authored-skip handling in the ingress consumer. A **distinct kind**, not a reuse of 30840, because the two streams have different addressing keys (slug vs session id) and different audiences (a persistent project roster vs an ephemeral session record); collapsing them onto one kind would make a project digest and a session summary collide whenever a slug equalled a session id, and would muddy any relay-side filter. Choosing the adjacent integer keeps the mesh's kind map legible.

### D4: Durable state through existing adapter slots, not a new slot

Project tracking adds **no sixth adapter slot**. Its durable state routes through the two existing slots whose contracts already fit:

- **Primers and synopses → `memory` slot** (RuVector, mandated external-pg or embedded per ADR-015), namespace `project-tracking-primers`. A primer is retrievable agent memory by definition.
- **Scan activity → `events` slot** (the existing agent-event publisher). A scan is a lifecycle event.

Both dispatches flow through the standard three-layer middleware unchanged: observability (ADR-005 `wrapDispatch`) → privacy filter (ADR-008) → JSON-LD encoder (ADR-012), in that order, with privacy redaction completing before the encoder runs (DDD-004 §L08). The `/v1/projects*` routes emit JSON-LD when `[linked_data]` is on, via the encoder, exactly like every other adapter-backed surface.

*Rationale:* **adapter-contract adherence.** The five-slot pattern (ADR-005) exists so that new capabilities compose onto the existing slots rather than grow the taxonomy — "hardcoding a backend is never the right answer", and minting a slot is the same anti-pattern one level up. Routing primers through `memory` and scans through `events` means project tracking inherits all three implementation classes (`local-*`, `external`, `off`) and the contract-test harness for free, and works identically in standalone and client federation modes with no second codepath. It also means project tracking inherits the privacy filter and JSON-LD encoder automatically — no bespoke redaction or serialisation logic to audit. The MCP RuVector mandate (ADR-015) applies as-is: the primer namespace is a normal memory namespace, fail-closed if PostgreSQL is unreachable in client mode.

### D5: Manifest-gated, fail-open, privacy on labels

The whole feature self-gates at runtime on `[project_tracking].enabled` in `agentbox.toml` (default `false`): the `/v1/projects*` routes return `503 {error:'project_tracking disabled'}` when the gate is off, mirroring how every optional surface self-gates. The nostr egress is **fail-open**: the `config/hooks/project-tracking-publish.cjs` hook is gated on the bridge secrets being present (exactly as `nostr-session-summary.py` is), and any failure exits 0 — a publish failure is recorded as `agentbox_project_nostr_publish_total{outcome="skipped"}` or `"error"` and never blocks a scan. GitHub enrichment is similarly guarded (optional `GITHUB_TOKEN` + `gh` CLI; absent → no enrichment, not an error), and scanning is fail-open per repository (one unreadable checkout never aborts the scan). **Privacy on labels:** every metric `project` label and every nostr `d`-tag is the project **slug** (`basename`), never an absolute host path, and `owner_did` is the public pubkey — the telemetry and mesh surfaces expose only public-safe identifiers.

*Rationale:* this is agentbox's default-secure posture (ADR-027) and the optional-feature gating rule (CLAUDE.md "Optional features must remain manifest-gated") applied to a new capability. The fail-open egress matches the live-mirror (ADR-029 D4) and session-summary precedent exactly: observability and mesh publication must degrade to "no digest this scan" rather than "scan stalls" — an egress that can block is a denial-of-service on the tracker. The slug-not-path rule is the one genuinely new privacy obligation project tracking introduces (helm freely logs absolute paths); absolute host paths leak filesystem layout and operator workspace structure, so they are stripped to the basename at the metric/tag boundary, which is the same boundary the privacy filter (ADR-008) governs for adapter dispatch.

## Relationship to the session-summary digest (explicit)

kind-30841 is a deliberate sibling of kind-30840, not a generalisation of it. The two share authorship and durability mechanics and differ on cadence, addressing, and audience:

| Axis | Project digest (this ADR, kind-30841) | Session summary (kind-30840, ADR-029 / upstream ADR-095) |
|---|---|---|
| Subject | a tracked repository's current status | a finished Claude Code session |
| Trigger | per scan / explicit publish (POST `/v1/projects/:id/publish`) | once, at `SessionEnd` |
| `d`-tag (addressing key) | project slug | session id |
| Replace semantics | next scan of the slug replaces the digest | re-summarising the session replaces the digest |
| Content | name, synopsis, language, last commit, commits30d, issues, stars, primer status, URN | summary + actions + actionable questions |
| External hop | none (primer is generated in-box via the Z.AI-shaped `/v1/messages`, then the digest is rendered locally) | one (Z.AI/GLM summarisation) |
| Identity | agent key (agent is author) | agent key (agent is author) |
| Durability | dual-written to pod (`projects/<id>.jsonld`) + best-effort relay | dual-written to pod (inbox + sessions) + best-effort relay |
| Manifest gate | `[project_tracking]` (D5) | `[sovereign_mesh.mobile_bridge]` (ADR-030) |

Both are agent-authored addressable events on the same relay, distinct from the per-turn gift-wrapped live mirror (ADR-029), which is recipient-sealed and ephemeral. The mesh's manifest boundary and its single external data hop are recorded in ADR-030; 30841 adds an addressable kind to that boundary, not a new egress class.

## Consequences

### Positive
- Project tracking lands as additive use of existing substrate: zero new URN kinds, zero new metrics ports, zero new adapter slots, one new nostr kind. The grammar's closure (18 kinds, one resolver) and the single-registry invariant (R-011) both survive intact.
- Phone clients gain a persistent, self-replacing project roster (one card per slug) alongside the existing session summaries, on the same relay with the same authorship and durability model — no new client behaviour to learn.
- Primers, synopses, and scans inherit all three adapter implementation classes, the contract-test harness, and the privacy + JSON-LD middleware for free; the feature works identically standalone and federated with no second codepath.
- The whole surface is default-off and fail-open: a default agentbox tracks nothing, exposes nothing, and a hung egress can never stall a scan.

### Negative
- Six entities now share the existing kinds with other capabilities (`memory` holds primers *and* distilled lessons; `activity` holds scans *and* execution traces). Disambiguation rests on the local-part prefix (`primer-`, `projscan-`), which is a naming convention, not a type-system guarantee — a consumer that filters by prefix must keep its prefix list current.
- The `agentbox_project_info` and per-project gauges are unbounded in cardinality by the number of tracked projects; a runaway scan of a directory of hundreds of repos would inflate the registry. The scan-dir manifest gate and the slug label (one series per repo, not per path) bound this in practice but it is a real cardinality surface.
- Two agent-authored addressable kinds (30840, 30841) must be kept conceptually distinct on the relay; a relay-side consumer that assumes "agent-authored addressable event ⇒ session summary" will mis-handle a project digest.

### Risks
- kind-30841 is hardcoded across three artefacts (the Rust bridge `track` subcommand, the relay `allowed_kinds`, and any phone-client filter). If the relay allowlist omits 30841, digests are silently dropped (fail-open: no error, no card). Documented as a manifest precondition, validated alongside the other relay kinds.
- The slug-not-path privacy rule is enforced at the emit boundary; a future code path that constructs a metric label or `d`-tag from a project's absolute path rather than its slug would leak filesystem layout. The single mint/emit point (`observability/project-metrics.js` + the tracker's tag construction) is the control point and must remain the only producer of those labels.
- The primer pipeline's in-box LLM call (Z.AI-shaped `/v1/messages`) is the one place project tracking touches an external model. Unlike the session digest's external summarisation hop, this produces *durable memory*, not an egress payload — but if the primer model is misconfigured to a non-sovereign endpoint, project content would leave the box. The `configured()` guard (false → null primer, status `none`) and the manifest `primer_model` pin are the controls; this is the surface to watch on any review trigger.
