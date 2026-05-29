# PRD-014: Embodied Agent Loop — Voice-to-Ontology Gap Closure

**Status:** In progress (Tier A done; Tier B WS5 Stage 1–3a done — producer convergence, Phase-1 mirror, and the authenticated `/wss/agent-events` ingest seam, all cargo-verified; render + `:9500` state cutover = Stage 3b pending — see §8 Progress log)
**Date:** 2026-05-28 (progress log appended 2026-05-29)
**Author:** DreamLab AI
**Related:** ADR-005 (Pluggable Adapters), ADR-009 (Embedded Nostr Relay), ADR-010 (Rust Solid Pod), ADR-012 (JSON-LD Federation), ADR-013 (Canonical URI Grammar), ADR-014 (Bidirectional Graph-State Ingress), ADR-017 (Multi-Tenant did:nostr Pods), ADR-023 (Ontology Bridge), PRD-006 (Linked-Data Interfaces), PRD-011 (Ontology Bridge)
**Drives:** ADR-026 (Cross-Substrate Agent-Loop Seams), DDD-012 (Sovereign Knowledge Elevation Domain — BC22)

## TL;DR for newcomers

The DreamLab ecosystem already builds every component of one flagship user journey — **speak to an agent, have it act on your sovereign data pod, watch a personal knowledge graph grow, and see selected concepts elevated into the shared ontology, all visualised as living agent actors in the XR graph** — but the journey does not run end to end because **every seam between the five substrates is broken**. This PRD closes those seams.

The flow and its five seams:

```
[VisionClaw] voice (PTT→Whisper→Kokoro)
   │  SEAM A — voice carries no selected-actor context, never reaches agentbox
   ▼
[agentbox] agent actor (did:nostr, ACSP 31400-31405)
   │  SEAM B — no voice/intent ingress wired; /v1/agent-events/emit unsigned; intent-queue needs a spec
   ▼
[solid-pod-rs] write personal KG to pod
   │  SEAM C — PATCH destroys prior triples; adapter sends no NIP-98; no delegation/mandate
   ▼
[agentbox→VisionClaw] elevate personal KG → shared ontology
   │  SEAM D — no personal-KG→proposal extractor; bridge bypasses Whelk/PR governance
   ▼
[VisionClaw] visualise as agent actors + elevation
      SEAM E — BC20 anti-corruption layer is paper-only; agents rendered from mock polling;
               ACSP not spoken here; no ConceptElevated event
```

**If you remember only one thing:** the pieces all exist; the work is wiring the five seams with a single coherent identity (`did:nostr`), provenance (PROV-O Activity URNs), and governance (ACSP human-in-the-loop) spine, plus fixing the pod PATCH data-loss correctness bug that silently breaks the chain. (An earlier draft of this PRD listed a second "egress port" bug — `:9500`→`:3001`. Implementation revealed that diagnosis was wrong: the agentbox egress relay and VisionClaw's subscriber both agree on `:9500`. The real Seam-E gap is that VisionClaw *polls* request/response and never consumes the *pushed* `notifications/agent_action` broadcast — a BC20 ingest concern, see X2 and WS5, not a port change.)

---

## 1. Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Voice from the XR graph drives a *specific* agent actor in agentbox | A PTT command issued with an agent node selected reaches agentbox carrying that actor's `did:nostr`/`urn:agentbox:agent` identity, end to end |
| G2 | An autonomous agent can write a personal KG to a Solid pod under delegated authority | Agent issues a signed NIP-98 write on behalf of a user via a scoped mandate; the pod accepts it against a WAC `acl:agent` grant; the row persists on disk |
| G3 | Incremental RDF KG writes are non-destructive | An N3/SPARQL PATCH inserting one triple preserves all pre-existing triples in the resource (regression test passes) |
| G4 | Personal-KG concepts route through the *governed* elevation path | The agentbox bridge proposes via `/ontology-agent/propose` (Whelk consistency gate → human approval → PR), never the ungoverned `/api/ontology/load` backdoor |
| G5 | Agent actions and elevations cross the federation boundary with continuous provenance | A `urn:agentbox:activity` PROV-O record is re-identified as a `urn:visionclaw` graph node via a real BC20 anti-corruption layer; zero identity loss |
| G6 | The XR graph renders live, authenticated agent actors (not mock polling) and shows elevation | An agent's action ingested from agentbox renders on its actor node; a `ConceptElevated` event animates a personal-KG node migrating to shared-ontology styling |
| G7 | Ecosystem comms are aligned at the source repos, not patched into agentbox | nostr-rust-forum advertises the agent-control kinds in NIP-11; dreamlab-ai-website's relay config is wired or removed; agentbox config remains the canonical superset |
| G8 | The closed loop is governed | Pod writes and ontology elevations triggered by an agent are subject to ACSP human-in-the-loop approval where policy requires it (the Judgment Broker decision→application loop is closed) |

---

## 2. Background: the ecosystem and the journey

Five repositories share a single `did:nostr:<hex-pubkey>` identity spine (BIP-340 x-only Schnorr; NIP-98 HTTP auth; NIP-42 relay write):

- **VisionFlow** (`/VisionFlow`) — coordination/meta repo, canonical ecosystem docs.
- **VisionClaw** (`/project`) — GPU knowledge-graph / OWL 2 / XR visualiser. agentbox is a submodule.
- **agentbox** (`/project/agentbox`) — sovereign agent runtime; 5-slot adapter architecture (ADR-005), MCP servers, management-api, eleven JSON-LD federation surfaces.
- **solid-pod-rs** (`/solid-pod-rs`) — sovereign personal data store (LDP/Solid + WAC + NIP-98).
- **nostr-rust-forum** (`/nostr-rust-forum`) + **dreamlab-ai-website** (`/dreamlab-ai-website`) — the messaging backbone and public surface.

VisionFlow's own canon names the journey's destination ("federated human-AI intelligence… sovereign agents act, humans govern via a Judgment Broker, every mutation cryptographically attributed", `VisionFlow/README.md:5,39-48,476`) but is **silent** on voice ingress and on the personal-KG→shared-ontology *elevation* semantics — both return zero hits in canonical docs. The BC20 anti-corruption layer is explicitly flagged "paper-only" (`VisionFlow/docs/ecosystem-map.md:88`).

---

## 3. Current State — the gap ledger

Evidence is cited as `repo path:line`. Each row is **IMPLEMENTED / PARTIAL / DOC-ONLY / ABSENT** and maps to a seam.

### Seam A — Voice → selected actor (VisionClaw)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| A1 | Voice plane fully wired: PTT (Space) → `/ws/speech` → Turbo Whisper STT → agent commands → Kokoro TTS | IMPLEMENTED | `project/client/src/.../VoiceOrchestrator.ts:45-184`, `project/src/handlers/speech_socket_handler.rs:39` |
| A2 | STT command carries no clicked-actor context (`agent_id`/`NodeClass::Agent`) — voice hits the generic swarm channel | ABSENT | `VoiceOrchestrator.ts:160`; `crates/visionclaw-contracts/src/agent_action.rs:185` (NodeClass::Agent = 0x80000000) |
| A3 | No route from a VisionClaw voice command into agentbox's agent runtime | ABSENT | (no agentbox ingress referenced from client) |

### Seam B — Actor ingress + identity (agentbox)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| B1 | No voice/STT ingress in agentbox; `echoloop` skill (faster-whisper/Deepgram) is unwired | ABSENT | `agentbox/skills/echoloop/README.md:36-37` (no surface binding) |
| B2 | Nearest existing ingress is a signed Nostr intent event → `pods/<npub>/events/intent-queue/` | PARTIAL | `agentbox/mcp/nostr-bridge/relay-consumer.js:51-75,~320` |
| B3 | Inbound event → responder spawn requires operator-supplied `intentSpec`, else warns `intent-spec-missing-command` | PARTIAL | `relay-consumer.js ~320` |
| B4 | `POST /v1/agent-events/emit` has no per-agent did:nostr auth — `source_urn` is caller-supplied and unsigned | PARTIAL | `agentbox/management-api/routes/agent-events.js:188`; `agent-event-publisher.js:62` |
| B5 | Agent actor model is sound: `urn:agentbox:agent`, ACSP kinds 31400-31405, PROV-O Activity URNs | IMPLEMENTED | `agentbox/management-api/lib/uris.js:71-89`; `mcp/servers/nostr-bridge.js:59-65` |

### Seam C — Pod write (solid-pod-rs + agentbox adapter)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| C1 | **PATCH data-loss**: N3/SPARQL PATCH seeds an *empty* graph, discarding all prior triples on every incremental write | BUG | `solid-pod-rs/crates/solid-pod-rs-server/src/lib.rs:651,654,680-685` |
| C2 | Agentbox pod adapter sends no NIP-98 / Authorization — autonomous agent presents anonymous → 401 on default-deny pods | ABSENT | `agentbox/management-api/adapters/pods/_solid-http-base.js:44-82`; forwards caller header only (`routes/payments.js:123`) |
| C3 | No delegation/mandate — an agent can only write as itself (holding the user's nsec) | ABSENT | `solid-pod-rs` (no `delegat\|mandate\|ucan\|capability` anywhere); `agent_uri()` = signer's own pubkey (`server/lib.rs:252-254`) |
| C4 | GET has no content negotiation — converters exist but `handle_get` never calls them | PARTIAL | `solid-pod-rs/.../lib.rs:485-498`; converters `ldp.rs:308,808` |
| C5 | No SPARQL query endpoint (only SPARQL Update via PATCH) — agent cannot read-before-write | ABSENT | route table `lib.rs:2731-2745` |
| C6 | Schnorr verify + did:nostr off in stock server build (agentbox Nix enables them) | RISK | `solid-pod-rs-server/Cargo.toml:87,95`; `auth/nip98.rs:135` |
| C7 | Adapter PUT/PATCH/DELETE path itself is real and typed | IMPLEMENTED | `_solid-http-base.js:47-96`; WAC `solid-pod-rs/.../wac/` |

### Seam D — Personal KG → shared ontology elevation (the flagged major gap)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| D1 | No personal-KG → proposal extraction: nothing reads pod triples and emits a `NoteProposal` | ABSENT | `project/src/services/ontology_mutation_service.rs` (zero pod/solid/webid refs) |
| D2 | agentbox bridge's `ontology_axiom_add` POSTs to `/api/ontology/load`, bypassing the propose→Whelk→PR governance path | BUG/GAP | `agentbox/mcp/servers/ontology-bridge.js:217-231` vs governed path `ontology_mutation_service.rs:104-123` |
| D3 | Governed elevation pipeline exists inside VisionClaw: `ontology_propose` → Whelk EL++ consistency → GitHub PR → merge → git versioning | IMPLEMENTED | `project/src/handlers/ontology_agent_handler.rs:172-201`; `ontology_mutation_service.rs:73-130,384-412` |
| D4 | No dedup / entity-alignment before elevation; `new_subsumptions` is stubbed | PARTIAL | `ontology_mutation_service.rs:401` ("simplified") |
| D5 | No social governance for "should this be shared" — Whelk checks logical consistency only; ACSP plane unwired to proposals | ABSENT | `ontology_mutation_service.rs:384-412`; ACSP `agentbox/docs/user/nostr-relay.md:169-183` |
| D6 | Three disjoint "personal KG" stores with no shared schema (pod RDF / VisionClaw Logseq md / agentbox RuVector memory) | ABSENT | `code-harness.ttl:76-122` vs `ontology-core/SKILL.md:41-65` vs `solid-pod-rs/.../mashlib.rs:85` |

### Seam E — Elevation → visualisation (VisionClaw + BC20)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| E1 | **BC20 anti-corruption layer (urn:agentbox↔urn:visionclaw) absent in code** — agentbox Activity/PROV-O never reaches the graph | ABSENT | zero `urn:agentbox` refs in `project/{src,crates,client/src}`; doc-only in CLAUDE.md |
| E2 | Agent nodes rendered richly (geometry-by-type, breathing animation) but from **polled mock** `/api/bots/agents`, not authenticated live data | PARTIAL | `project/client/src/.../AgentNodesLayer.tsx:187-344,447`; `CommandInput.tsx:435` |
| E3 | ACSP kinds 31400-31405 entirely absent in VisionClaw; replaced by an unwired one-way `AgentActionEnvelope` (4 variants) | ABSENT | `grep 3140[0-5]` = 0; `crates/visionclaw-contracts/src/agent_action.rs:75-166` (no client dispatcher) |
| E4 | No `ConceptElevated` domain event → no elevation animation hook | ABSENT | DDD-008 events = Queried/AxiomSubmitted/BridgeHealthChanged only |
| E5 | knowledge-vs-ontology node distinction exists (mode-aware colouring, IRI-bit classes); **personal-vs-shared (owner) distinction does not** | PARTIAL | `project/client/src/.../useGraphNodeColors.ts:100-144`; `validator.rs:505-507` |
| E6 | Server binary protocol *defines* `0x23 AGENT_ACTION` frames, but the path is **latent, not wired** (correction 2026-05-29): the outbound `encode`/broadcast is dead code never called; `MultiMcpVisualizationActor` is never `.start()`ed and is absent from `AppState`; the only live agent-viz WS (`/visualization/agents/ws`) emits an empty `Vec<AgentStatus>` placeholder. The frame type exists; nothing renders it. | PARTIAL (was mis-marked IMPLEMENTED) | `project/src/utils/binary_protocol.rs:1187-1463` (defined); dead broadcast `:1334`; dead actor `project/src/actors/multi_mcp_visualization_actor.rs`; empty live path `project/src/handlers/bots_visualization_handler.rs:525-560` |

### Cross-cutting — identity, governance, comms alignment

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| X1 | Judgment Broker ~65%: `handleGovernanceDecision()` missing; BrokerActor branch-only (`crashbug`), not on main; decisions persisted but not applied; no PROV-O linkage | PARTIAL | `VisionFlow/docs/.../DDD-judgment-broker-context.md:181-189`; `status-reconciliation.md:34` |
| X2 | Agent-action egress reached VisionClaw but was never consumed: the agentbox bridge pushes `notifications/agent_action` to the agentbox MCP TCP relay (`:9500`); VisionClaw connected to the same `:9500` but **polled request/response** and never read the pushed notification. **Consume-side closed 2026-05-29 (Phase 2a):** VisionClaw now has an authenticated `/wss/agent-events` ingest (`project/src/agent_events/ingest.rs`) that parses + validates the pushed envelope and publishes it to a broadcast hub (`hub.rs`); cargo-verified, 7/7 tests. **Still open:** the render of those events (beam+gluon, ADR-059 §2b) and retiring the `:9500` *state* poll (`bots_client`, a separate payload). (NB: the original "wrong port `:9500`→`:3001`" diagnosis was incorrect — both sides agree on `:9500`.) | PARTIAL (was GAP) | ingest `project/src/agent_events/ingest.rs`, hub `…/hub.rs`, schema `…/schema.rs`; remaining: dead binary `project/src/utils/binary_protocol.rs:1334`, state poll `project/src/services/bots_client.rs` |
| X3 | nostr-rust-forum relay supports 31400-31405 (registered-agent gated) but **NIP-11 does not advertise** the capability | GAP | `nostr-rust-forum/crates/nostr-bbs-relay-worker/src/nip11.rs:28`; routing `nip_handlers.rs:218-232` |
| X4 | Forum relay has no dedicated handler for the 38xxx kinds agentbox federates | GAP | `nip11.rs:50` (generic PRE only) vs `agentbox.toml:96,157` |
| X5 | dreamlab-ai-website declares `VITE_RELAY_URL`/`VITE_ADMIN_PUBKEY` but never reads them (HTTP-only, no relay client) | GAP | `dreamlab-ai-website/src/vite-env.d.ts:9,15` (unused); `src/lib/forum-api.ts` |
| X6 | website agent-key roster comment says "placeholder… replace at deployment" yet real keys are seeded | GAP | `dreamlab-ai-website/forum-config/dreamlab.toml:179` vs `:191-196,213-258` |
| X7 | VisionFlow canon is silent on voice ingress and personal→shared elevation; BC20 grammar undocumented | DOC-GAP | `VisionFlow/docs/ecosystem-map.md:88` |

---

## 4. Design — closing the seams

The closure introduces **no new identity primitives and no new URN kinds**. It uses `did:nostr` for identity, the existing 18 `urn:agentbox` kinds, PROV-O Activity records for provenance, and ACSP (31400-31405) as the single agent-action/governance protocol. Three architectural decisions are recorded in **ADR-026**; the new bounded context is modelled in **DDD-012 (BC22 — Sovereign Knowledge Elevation)**.

### 4.1 Seam A+B — Voice → actor → agentbox ingress

- **VisionClaw**: extend the voice command envelope so PTT captures the currently-selected `NodeClass::Agent` node and attaches its `agent_id` and (where known) `did:nostr`. When an agent is selected, the STT result is dispatched as a **scoped agent command** rather than a generic swarm intent.
- **Transport**: the scoped command is published as a signed Nostr **ACSP `ActionRequest` (kind 31402)** addressed to the target agent's `did:nostr`, OR posted to agentbox's ingress. Reuse the existing relay; do not invent a new channel.
- **agentbox**: ship a **default `intentSpec`** so an inbound voice-origin ActionRequest deterministically spawns/dispatches to the addressed actor (closes B3). Add per-agent **did:nostr verification** on `/v1/agent-events/emit` and on the intent path so `source_urn` is provably the acting agent, not caller-asserted (closes B4).
- **agentbox (optional native ingress)**: wire the `echoloop` STT skill to the same intent path so agentbox can accept audio directly when VisionClaw is not the front end (closes B1). Default off, manifest-gated.

### 4.2 Seam C — Pod write made real

- **solid-pod-rs (bug C1)**: in the PATCH handler, parse the *existing resource body* into the working graph before applying N3/SPARQL inserts/deletes, instead of seeding `Graph::new()`. Add a regression test: insert one triple, assert prior triples survive.
- **solid-pod-rs (C4)**: call the existing converters in `handle_get` to honour `Accept` (Turtle↔JSON-LD↔N-Triples).
- **solid-pod-rs (C5)**: add a read-only SPARQL **query** endpoint (SELECT/ASK) so an agent can read-before-write. Read-only mirrors the ontology-bridge's read-only stance.
- **agentbox adapter (C2)**: the pods adapter **originates a signed NIP-98** `Authorization` header per request, signing with the acting identity's key (single-tenant: the box key; multi-tenant: the per-user key via ADR-017).
- **Delegation/mandate (C3)**: introduce a **scoped agent mandate** — the user grants an agent `acl:agent <did:nostr:AGENT>; acl:mode acl:Write/acl:Append` on one KG container (WAC already supports this). The agent then writes under *its own* `did:nostr`, never the user's nsec. The mandate is itself a signed, revocable record (`urn:agentbox:mandate`, an existing kind). NIP-26 delegation tokens are the wire form where the agent must *speak as* the user.

### 4.3 Seam D — Governed elevation framework (the flagged major gap)

- **agentbox bridge (D2)**: route concept contribution through VisionClaw's **`/ontology-agent/propose`** (Whelk consistency → human approval → PR), and **remove/guard** the ungoverned `/api/ontology/load` backdoor in `ontology_axiom_add`. The bridge gains an `ontology_propose` tool mirroring the governed contract.
- **Extraction front-half (D1, D6)**: add a **personal-KG → proposal extractor** that reads a pod KG container (Turtle/JSON-LD via the now-working GET negotiation), selects candidate concepts, and emits a `NoteProposal`. This is the BC22 aggregate. It unifies the three stores by treating the **pod RDF as the canonical personal-KG source** and projecting from memory/markdown into it.
- **Alignment (D4)**: add entity-alignment/dedup against existing shared classes before proposing (string + embedding similarity over `vc:` labels) so elevation does not mint duplicate classes.
- **Governance (D5)**: gate "should this be shared" through **ACSP** — an elevation candidate raises a `PanelDefinition`/`ActionRequest` (31400/31402) to the forum; human approval (31403) authorises the PR. Whelk remains the *correctness* gate; ACSP becomes the *policy* gate.

### 4.4 Seam E — Visualisation with continuous provenance

- **BC20 made real (E1)**: implement the anti-corruption layer mapping `urn:agentbox:{activity,agent,memory,...}` ↔ `urn:visionclaw:{execution,agent,concept,...}` at the federation boundary. Live in VisionClaw's ingest path — consumes agentbox Activity/PROV-O records via the **JSON `/wss/agent-events` envelope** (ADR-059 §2; the `source_urn`/`target_urn`/`pubkey` identity rides in this JSON, *not* in the identity-blind `0x23` binary frame, which is a downstream server→browser projection — E6 correction) and round-tripped in agentbox's BC20 reference. Provenance is preserved both directions.
- **Live actors (E2)**: replace the mock `/api/bots/agents` polling source for *real* agents with the BC20-ingested live agent identities; keep mock injection behind a dev flag.
- **Single protocol (E3)**: make VisionClaw speak **ACSP 31400-31405** — either by mapping the existing `AgentActionEnvelope` onto ACSP kinds or by adopting ACSP directly and wiring a client dispatcher (clicking an agent node emits a real 31402). This removes the divergent dead contract.
- **Elevation visual (E4, E5)**: emit a `ConceptElevated` domain event when a proposal merges; add an **owner/origin field** to graph nodes so personal-vs-shared is renderable; animate a node migrating from personal-KG styling to shared-ontology depth-spectrum on elevation.

### 4.5 Cross-cutting alignment (fix at source, not in agentbox)

- **nostr-rust-forum (X3, X4)**: advertise the agent-control capability in NIP-11 (`supported_kinds`/custom field); decide and document 38xxx handling (route+project, or declare out-of-scope).
- **dreamlab-ai-website (X5, X6)**: either wire a minimal relay client subscribing 31400-31405 for the declared `/governance` route, or remove the dead `VITE_RELAY_URL`/`VITE_ADMIN_PUBKEY` config; reconcile the placeholder-vs-seeded agent-key roster.
- **VisionFlow (X7)**: document the voice→actor→pod→KG→ontology→viz flow and the BC20 namespace grammar in canon (`docs/architecture/`, `docs/protocol/`).
- **Agent-action ingest (X2)**: this is **not** a port fix (the `:9500`→`:3001` diagnosis was wrong; both sides agree on `:9500`). The gap is that VisionClaw *polls* request/response and never consumes the *pushed* `notifications/agent_action`, and the `0x23` binary frame has no server-side decoder. **Refined close (2026-05-29):** rather than bolt a subscription onto the deprecated `:9500` MCP-TCP relay, converge on the already-accepted **ADR-014 (agentbox) + ADR-059 (VisionClaw)** WebSocket contract — one `/wss/agent-events` socket carrying both directions — and **retire `:9500`** (ADR-014 deprecates the MCP-TCP bridge and explicitly rejects standing up an MCP-TCP listener, Alt C). The `:9500` relay keeps working in Phase 1 behind `ENABLE_MCP_BRIDGE` (default off) only until the WS cutover. This is the debt-free path: no second transport, no divergent envelope. Producer-side convergence is already done (one canonical builder; identity no longer dropped — agentbox commit `8005fc3f`); consumer-side Phase-1 schema mirror landed (`project/src/agent_events/schema.rs`); **Phase-2a authenticated ingest landed & cargo-verified 2026-05-29** (`project/src/agent_events/ingest.rs` + `hub.rs`, 7/7 tests). What remains is render (beam+gluon, ADR-059 §2b) and the `:9500` *state*-poll cutover — a refinement surfaced during implementation: `:9500` carries two unrelated payloads (agent **state** snapshots via `bots_client`, and the agent **action** push), so retiring it fully needs the WS to also carry state, tracked as ADR-059 Phasing 2b.
- **Judgment Broker (X1)**: the broker `handleGovernanceDecision()` / BrokerActor-to-main work is tracked in VisionFlow but is a dependency of G8 (called out, not owned here).

---

## 5. Workstreams (cross-repo)

| WS | Repo | Scope | Seam | Tier |
|----|------|-------|------|------|
| WS1 | solid-pod-rs | PATCH non-destructive fix + regression test | C1 | A |
| WS2 | ~~agentbox~~ VisionClaw | ~~egress port `:9500`→`:3001`~~ **VOID — misdiagnosis.** Port `:9500` is correct on both sides; agentbox egress unchanged. The real X2 gap (VisionClaw polls, never reads the pushed `agent_action`) folds into WS5 (BC20 ingest). | X2 | ~~A~~ → B (WS5) |
| WS3 | solid-pod-rs | GET content-negotiation | C4 | A |
| WS4 | agentbox | pod adapter signed NIP-98 + agent mandate model | C2, C3 | B |
| WS5 | agentbox + VisionClaw | BC20 anti-corruption layer (real) + agent-action ingest via the **ADR-014/ADR-059 `/wss/agent-events` WS contract** (absorbs former WS2). Stage 1 (BC20 + docs) ✅; Stage 2 producer convergence ✅ + VisionClaw Phase-1 schema mirror ✅; **Stage 3a `/wss/agent-events` authenticated ingest handler + broadcast hub ✅ cargo-verified (2026-05-29)**; Stage 3b = beam+gluon render actor (ADR-059 §2b) + `:9500` *state*-poll cutover (pending — render substrate found latent, see ADR-059 Design log Finding 4) | E1, X2 | B |
| WS6 | agentbox + VisionClaw | governed elevation routing + extractor + alignment | D1, D2, D4, D5 | B |
| WS7 | VisionClaw | voice→selected-actor binding + ACSP dispatcher | A2, A3, E3 | B |
| WS8 | VisionClaw | `ConceptElevated` event + owner field + elevation animation | E4, E5 | B |
| WS9 | agentbox | default intentSpec + per-agent did:nostr auth on ingress | B3, B4 | B |
| WS10 | solid-pod-rs | read-only SPARQL query endpoint | C5 | C |
| WS11 | nostr-rust-forum | NIP-11 advertise 31400-31405 + 38xxx decision | X3, X4 | C |
| WS12 | dreamlab-ai-website | wire/remove relay config + reconcile key roster | X5, X6 | C |
| WS13 | VisionFlow | document flow + BC20 grammar in canon | X7 | C |
| WS14 | agentbox (optional) | echoloop STT → intent ingress, manifest-gated | B1 | C |

---

## 6. Out of scope

- The Judgment Broker `handleGovernanceDecision()` implementation and BrokerActor merge-to-main live in VisionFlow/VisionClaw broker work (X1) — this PRD depends on them for G8 but does not own them.
- Multi-tenant per-user pod auto-provisioning (NIP-42 first-touch) remains QUEUED under ADR-017/PRD-007; the mandate model (WS4) works single-tenant first.
- Whelk reasoner internals; OWL profile expansion beyond EL++.
- Voice biometrics / speaker identity binding to `did:nostr` (future).

---

## 7. Success metrics (end-to-end acceptance)

1. **E2E smoke**: with an agent node selected in the XR graph, a spoken instruction ("remember that X relates to Y") results in: a signed ActionRequest → agentbox actor → NIP-98 pod write of the triple → personal-KG node appears → ACSP elevation prompt → on approval, a governed PR proposes the shared class → on merge, `ConceptElevated` animates the node into shared-ontology styling — with one continuous provenance chain (`urn:agentbox:activity` ↔ `urn:visionclaw`).
2. **Regression**: pod PATCH preserves prior triples (G3). **Ingest (X2)**: a `notifications/agent_action` emitted by agentbox is consumed by VisionClaw over the ADR-014/ADR-059 `/wss/agent-events` socket — carrying its `source_urn`/`pubkey` identity intact — and updates the corresponding live agent-actor node (delivered via BC20/WS5 on the WS contract, with `:9500` retired — not a port change, not a second transport).
3. **Governance**: no path writes shared ontology without the Whelk gate AND, where policy requires, ACSP approval (G4, G8).
4. **Alignment**: forum NIP-11 advertises agent-control kinds; website has no dead relay config (G7).
5. **Contract**: all three adapter implementation classes still pass `tests/contract/` (ADR-005 non-negotiable).

---

## 8. Progress log

### 2026-05-29 — WS5 producer convergence + ADR-059 Phase 1 mirror

- **WS5 Stage 1 (done, agentbox commit `e3ecfb3c`)**: BC20 anti-corruption layer
  is real code (`management-api/lib/bc20-provenance-bridge.js`, 20 tests); closed
  kind map `activity→execution`, `agent→did:nostr`, `thing→kg`, `memory→concept`;
  DDD-012 §A4 + `CLAUDE.md` aligned to VisionClaw's real `urn:visionclaw` grammar.
- **WS5 Stage 2 (done, agentbox commit `8005fc3f`)**: producer convergence — one
  canonical wire-envelope builder (`agent-event-publisher.js::createMcpNotification`);
  the deprecated bridge no longer hand-rolls a divergent literal that dropped the
  ADR-013 identity. Guarded by `tests/sovereign/agent-event-notification.test.js`.
- **WS5 Stage 2 (done, VisionClaw)**: ADR-059 Phase-1 canonical schema mirror
  landed at `project/src/agent_events/schema.rs` (round-trip + cross-repo fixture
  tests). Awaiting a host build (tmux tab 6) to compile-verify before Stage 3.
- **Design refinements folded in (ADR-014, ADR-059, this PRD)**: (a) X2 closes via
  the `/wss/agent-events` WS contract, **retiring `:9500`** — not a subscription
  on the deprecated relay; (b) the inbound path was *absent*, not merely lossy —
  Phase-1 attach point is a new ingest module, not the outbound viz protocol;
  (c) the binary `0x23` frame is identity-blind **by design** — identity rides
  the JSON ingest envelope and is resolved server-side to numeric ids before the
  GPU frame.
### 2026-05-29 — WS5 Stage 3a: authenticated ingest landed & verified

- **WS5 Stage 3a (done, VisionClaw)**: `/wss/agent-events` authenticated ingest
  handler (`project/src/agent_events/ingest.rs`) + process-global broadcast hub
  (`hub.rs`), registered in `main.rs` beside `/wss`. Token-validated upgrade
  (`NostrService::get_session`), subprotocol `vc-agent-events.v1`, parse →
  `is_canonical()` → publish to hub. **Verified** via `docker exec
  visionclaw_container`: `cargo check --lib`/`--bins` clean (zero new warnings),
  `cargo test --lib agent_events` → 7/7 (4 schema + 3 ingest). **Closes the X2
  consume-side debt** — VisionClaw now consumes the pushed `agent_action`.
- **Finding 4 (re-scope; E6 correction)**: the agent-action *render* substrate is
  **latent, not implemented** — the `0x23` outbound broadcast is dead code,
  `MultiMcpVisualizationActor` is never started, and the live agent-viz WS emits
  empty placeholder data. The live agent **state** path is the deprecated `:9500`
  poll (`bots_client`), a *different* payload from `agent_action`. So Phase 2 was
  split: **2a (ingest seam, done here)** vs **2b (beam+gluon render + `:9500`
  state cutover, pending)**. The PRD §3 E6 row is corrected IMPLEMENTED → PARTIAL.
  Escape hatch respected: no speculative GPU/actor wiring against dead substrate.
- **Next (WS5 Stage 3b)**: hub-subscribing beam+gluon render actor (ADR-059 §2b,
  transient `Edge` flag + `class_charge` modulation + despawn reaper);
  did:nostr-keyed live actor nodes (closes E2); `:9500` *state* cutover (needs WS
  to also carry state snapshots). Then agentbox ADR-014 Phase-2 legacy-bridge removal.

### 2026-05-29 — WS5 producer convergence + ADR-059 Phase 1 mirror
