---
id: ADR-026
title: Cross-Substrate Agent-Loop Seams
status: accepted (partially realised — WS5 producer convergence + ADR-059 Phase-1 mirror done 2026-05-29)
date: 2026-05-28
type: integration
author: Dr John O'Hare
depends_on: [ADR-005, ADR-009, ADR-010, ADR-013, ADR-014, ADR-017, ADR-023, ADR-059]
review_trigger: VisionClaw ingest schema change, ACSP kind range change, or WAC/NIP-26 delegation spec change
supersedes_consideration: the ADR-014 "egress port :9500→:3001" item is RETRACTED under D1 consequences — implementation proved it a misdiagnosis (both sides agree on :9500; the gap is push-vs-poll ingest, owned by BC20). Refined 2026-05-29: the ingest converges on the ADR-014/ADR-059 /wss/agent-events WS contract and retires :9500 entirely — one transport, one envelope.
---

# ADR-026 — Cross-Substrate Agent-Loop Seams

## Context

PRD-014 (`docs/reference/prd/PRD-014-embodied-agent-loop.md`) documents one flagship
journey the DreamLab ecosystem has already built piece by piece but cannot run end to
end: **speak to an agent → the agent acts on the user's Solid pod → a personal knowledge
graph grows → selected concepts are elevated into the shared ontology → everything renders
as living agent actors in the XR graph.** Five repositories share a single
`did:nostr:<hex-pubkey>` identity spine (BIP-340 x-only Schnorr; NIP-98 HTTP auth;
NIP-42 relay write): VisionFlow (canon), VisionClaw (`/project`, the GPU KG / OWL 2 / XR
visualiser), agentbox (`/project/agentbox`, the sovereign agent runtime), solid-pod-rs
(the personal data store), and nostr-rust-forum + dreamlab-ai-website (the messaging
backbone and public surface).

PRD-014's gap ledger (§3) identifies five broken seams in the flow:

- **Seam A — voice → selected actor (VisionClaw).** The voice plane is fully wired
  (`VoiceOrchestrator.ts:45-184`) but an STT command carries no clicked-actor context, so
  voice hits the generic swarm channel and never names a specific agent
  (`VoiceOrchestrator.ts:160`; `crates/visionclaw-contracts/src/agent_action.rs:185`).
- **Seam B — actor ingress + identity (agentbox).** There is no voice/intent ingress
  wired; `POST /v1/agent-events/emit` has no per-agent `did:nostr` auth, so `source_urn`
  is caller-asserted and unsigned (`management-api/routes/agent-events.js:188`;
  `agent-event-publisher.js:62`). The agent actor model itself is sound — ACSP kinds
  31400-31405 and PROV-O Activity URNs exist (`management-api/lib/uris.js:71-89`).
- **Seam C — pod write (solid-pod-rs + adapter).** N3/SPARQL PATCH seeds an empty graph,
  destroying all prior triples on every incremental write
  (`solid-pod-rs/.../lib.rs:651,654,680-685`); the agentbox pods adapter sends no NIP-98
  Authorization header (`management-api/adapters/pods/_solid-http-base.js:44-82`); and an
  agent can only write by holding the user's nsec — there is no delegation/mandate path.
- **Seam D — personal KG → shared ontology elevation.** Nothing reads pod triples and
  emits a proposal; the agentbox bridge's `ontology_axiom_add` POSTs to the ungoverned
  `/api/ontology/load` backdoor (`mcp/servers/ontology-bridge.js:217-231`), bypassing the
  governed `propose → Whelk → PR` path that already exists in VisionClaw
  (`ontology_mutation_service.rs:104-123`).
- **Seam E — elevation → visualisation (VisionClaw + BC20).** The BC20 anti-corruption
  layer is paper-only — zero `urn:agentbox` references exist anywhere in `project/{src,
  crates,client/src}` (PRD-014 E1; VisionFlow `docs/ecosystem-map.md:88` already flags
  this). Agent nodes render from polled mock data, ACSP is not spoken, and there is no
  `ConceptElevated` event. The server binary protocol does already define the
  `0x23 AGENT_ACTION` frame and the `agent-action` WS event
  (`project/src/utils/binary_protocol.rs:1187-1463`).

ADR-023 D1 established that VisionClaw owns the Oxigraph store under a single-writer model
and that the HTTP API — not a shared volume — is the contract. ADR-023 D5 named the BC20
anti-corruption layer but left it as a forward reference. ADR-014 added the inbound WS
subscriber and recorded a supposed egress port bug (the agentbox bridge dialing `:9500`
while VisionClaw's MCP "listens on `:3001`"); D1 below retracts that — the two sides agree
on `:9500` and the real gap is push-vs-poll ingest. ADR-013 fixed identity once and for all:
`did:nostr:<pubkey>` plus `urn:agentbox:<kind>:[<scope>:]<local>`, every `@id` minted
through `management-api/lib/uris.js`, no ad-hoc IDs. ADR-010 brought in the Rust Solid pod
and ADR-009 the embedded Nostr relay; ADR-017 scoped multi-tenant did:nostr pods.

This ADR records the four architectural decisions that close the five seams **coherently
on the existing spine** — no new identity primitives, no new URN kinds, no sixth adapter
slot. It is the architectural counterpart to PRD-014 §4 and is implemented across the
PRD-014 workstreams WS1-WS14; the new bounded context (BC22 — Sovereign Knowledge
Elevation) is modelled in DDD-012.

## Decision

### D1 — BC20 is a real, owned, bidirectional anti-corruption component

The BC20 anti-corruption layer is implemented as a real, owned, **bidirectional**
component — not the paper reference ADR-023 D5 left it as. It maps the agentbox kinds
that cross the federation boundary onto VisionClaw's **actual converged `urn:visionclaw`
grammar** (`concept | group | kg | bead | execution | did` — see `project/src/uri/kinds.rs`,
converged across worktrees, pending merge to main which still carries the legacy `urn:ngm`
scheme):

| agentbox | VisionClaw | note |
|---|---|---|
| `urn:agentbox:activity:<pubkey>:<verb>-<id>` | `urn:visionclaw:execution:<sha256-12>` | content-addressed; owner travels in `owner_did` + the `UrnMapping` |
| `urn:agentbox:agent:<pubkey>:<name>` | `did:nostr:<pubkey>` | **no `urn:visionclaw:agent` kind** — an agent's identity *is* its DID |
| `urn:agentbox:thing:<pubkey>:proposal-<id>` | `urn:visionclaw:kg:<pubkey>:<sha256-12>` | owner-scoped, content-addressed |
| `urn:agentbox:memory:<pubkey>:lesson-<hash>` | `urn:visionclaw:concept:<domain>:<slug>` | domain-scoped; emitted post-elevation |

preserving both directions:

- `owner_did = did:nostr:<hex>` is carried through unchanged (the identity spine is shared).
  For the `agent` crossing the DID *is* the VisionClaw identifier; for the content-addressed
  kinds (`execution`, `kg`) the owner rides alongside in the `UrnMapping`, since those
  VisionClaw kinds are addressed by content hash, not by a relabelled URN.
- The PROV-O `action_urn = urn:agentbox:activity:<pubkey>:<verb>-<id>` round-trips: an
  agentbox Activity re-identified as a `urn:visionclaw:execution` node is recovered to the
  exact source `urn:agentbox:activity` through the durable `UrnMapping` table (injective per
  `owner_did`); zero identity loss.

The bidirectional crossing is defined by an **executable reference** in agentbox
(`management-api/lib/bc20-provenance-bridge.js` — the single module importing the
cross-namespace grammar, with the closed kind map, the `UrnMapping` value object, and the
round-trip proof). Until VisionClaw's `src/uri` minter merges to main, this reference *is*
the contract the VisionClaw ingest path conforms to. BC20 then lives at the **VisionClaw
ingest path**, consuming agentbox Activity/PROV-O records via the **JSON `/wss/agent-events`
envelope** (ADR-059 §2; landed Phase 2a 2026-05-29 at `project/src/agent_events/ingest.rs`).
*Correction (2026-05-29):* identity rides this JSON ingest envelope, **not** the `0x23`
binary frame (`project/src/utils/binary_protocol.rs:1187-1463`), which is identity-blind by
design and is a downstream server→browser projection — and currently latent (dead broadcast,
unstarted actor). Every `urn:agentbox` `@id` is
parsed/validated through `lib/uris.js`; every `urn:visionclaw` `@id` is minted through the
`src/uri/` minter (per ADR-013) once merged. The reference never fabricates an ad-hoc
identifier.

**Rationale.** PRD-014 E1 proves BC20 is absent in code: zero `urn:agentbox` references in
`project/{src,crates,client/src}`, and VisionFlow `docs/ecosystem-map.md:88` already flags
it paper-only. Without a real bidirectional ACL, agentbox Activity never reaches the graph
(G5 fails) and provenance continuity is broken at the only boundary that matters. The
`/wss/agent-events` ingest transport now exists (ADR-059 Phase 2a, cargo-verified), so the
cost is the mapping logic, not new transport. (E6 correction: the `0x23` frame is *defined*
but its render path is latent — it is not the ingest transport.)

**Rejected alternatives.**
- *A shared graph store* (mount Oxigraph into agentbox, or a common KG database). Violates
  the single-writer model that ADR-023 D1 made non-negotiable; reintroduces the data
  duplication ADR-023 D1 rejected.
- *Ad-hoc per-surface ID invention* at the boundary. Violates ADR-013 — every `@id` must be
  minted through the canonical library; surfaces never invent IDs.
- *Leaving BC20 paper-only.* Breaks provenance continuity end to end; this is precisely the
  state VisionFlow `ecosystem-map.md:88` flags and PRD-014 G5 exists to close.

**Consequences.** The ADR-014 "egress port" item is **retracted, not corrected** — verifying
the wiring during implementation showed there is no port bug. The agentbox egress bridge
dials its own MCP TCP relay on `:9500` (`management-api/utils/agent-event-bridge.js:39-51`),
which broadcasts `notifications/agent_action` to subscribers (`mcp/servers/mcp-tcp-server.js:144-150`);
VisionClaw's `AgentMonitorActor` dials the same `:9500` (`project/src/app_state.rs:895-907`).
`:3001` is VisionClaw's HTTP/WS API, never an agent-action TCP ingest. The real Seam-E gap
(PRD-014 X2) is that VisionClaw *polls* request/response (`project/src/utils/mcp_tcp_client.rs:297`,
one `read_line` per call) and never reads the pushed notification, and the `0x23 AGENT_ACTION`
binary frame has no decoder (`project/src/utils/binary_protocol.rs:1334`). BC20 therefore
also owns the **agent-action ingest** (PRD-014 WS5, absorbing the former WS2).

**Better idea, adopted 2026-05-29:** do *not* bolt a push-subscription onto the deprecated
`:9500` MCP-TCP relay. Converge instead on the already-accepted **ADR-014 (agentbox) +
ADR-059 (VisionClaw)** WebSocket contract — one `/wss/agent-events` socket carrying both
directions — and **retire `:9500`** (ADR-014 deprecates the MCP-TCP bridge and rejects an
MCP-TCP listener, Alt C). The producer half is converged (single canonical builder; identity
no longer dropped — agentbox commit `8005fc3f`); the VisionClaw Phase-1 canonical schema
mirror has landed (`project/src/agent_events/schema.rs`). The `:9500` relay survives Phase 1
behind `ENABLE_MCP_BRIDGE` (default off) only until the WS cutover. This keeps one transport
and one envelope — the debt-free outcome the re-engineering pass targeted. **Fail-open** on an
unreachable peer, matching ADR-023 D4: if VisionClaw is down, the agentbox publisher's
broadcast simply has no live subscriber, and agentbox Activity records remain durable locally
and re-ingest when VisionClaw reconnects — agent startup and execution never block on the peer.

### D2 — Pod writes use a scoped, revocable mandate; the agent writes as its OWN did:nostr

An autonomous agent writes to a user's pod **as itself** — under its own `did:nostr:AGENT`
— never by holding the user's nsec. The mechanism reuses primitives that already exist:

- **Authorisation grant (pod side).** The user grants
  `acl:agent <did:nostr:AGENT>; acl:mode acl:Write | acl:Append` on one KG container. WAC
  already supports `acl:agent`; no new pod primitive is needed.
- **Wire authentication (adapter side).** The agentbox pods adapter **originates a signed
  NIP-98 Authorization header per request**, signing with the acting identity's key. It
  currently sends none — it only forwards the caller header
  (`management-api/adapters/pods/_solid-http-base.js:44-82`; `routes/payments.js:123`).
  Single-tenant signs with the box key; multi-tenant signs with the per-user key via
  ADR-017.
- **Mandate record.** The grant is backed by a signed, **revocable**
  `urn:agentbox:mandate` record (an existing kind in the ADR-013 grammar; minted through
  `lib/uris.js`). Revoking the mandate revokes the agent's write capability.
- **Speak-as-the-user is the narrow exception.** NIP-26 delegation tokens are the wire form
  **only** where the agent must literally speak as the user (e.g. a write that must appear
  authored by the user's pubkey). The default path is the agent writing as itself under an
  `acl:agent` grant.

**Rationale.** PRD-014 C2/C3 show the de-facto state: anonymous adapter writes (401 on
default-deny pods) and "an agent can only write as itself holding the user's nsec"
(`solid-pod-rs` has zero `delegat|mandate|ucan|capability` references;
`agent_uri()` = the signer's own pubkey, `server/lib.rs:252-254`). Sharing the user's nsec
is catastrophic and must be eliminated. WAC `acl:agent` + NIP-26 already give us a scoped,
revocable capability without inventing anything.

**Rejected alternatives.**
- *Share the user's nsec with the agent.* Catastrophic — full identity compromise, no
  scoping, no revocation. This is the current de-facto state per the audit (C3).
- *Unauthenticated writes.* Hit 401 on any default-deny pod (C2) and carry no attribution.
- *A new capability primitive (UCAN).* Unnecessary: WAC `acl:agent` covers the grant and
  NIP-26 covers speak-as-the-user; adding UCAN would fork the identity spine ADR-013/ADR-017
  deliberately keep single.

**Consequences.** Pod writes **fail closed** on a missing or revoked mandate — no mandate,
no signed NIP-98, the pod returns 401 and the adapter surfaces a typed error rather than
silently degrading. The privacy filter (ADR-008) and JSON-LD encoder (ADR-012) still wrap
the dispatch in that order (ADR-005 middleware contract). This depends on solid-pod-rs's
PATCH data-loss fix (PRD-014 C1/WS1) and Schnorr-verify being enabled in the server build
(C6) for writes to be both non-destructive and authenticated.

### D3 — Personal-KG → shared-ontology elevation MUST route through the governed path

No personal-KG concept reaches the shared ontology except through the governed pipeline, in
this fixed order:

```
extract candidate (BC22 extractor)
  → /ontology-agent/propose
  → Whelk EL++ consistency gate        (correctness)
  → ACSP human approval                (policy; kinds 31400 / 31402 / 31403)
  → GitHub PR → merge
  → ConceptElevated
```

The ungoverned backdoor is closed: the agentbox bridge's `ontology_axiom_add`, which POSTs
to `/api/ontology/load` (`mcp/servers/ontology-bridge.js:217-231`), is **removed or guarded**
so it can no longer write the shared ontology directly. The bridge gains an
`ontology_propose` tool mirroring the governed contract
(`project/src/handlers/ontology_agent_handler.rs:172-201`).

Two distinct gates, both required for any shared write:

- **Whelk EL++ = the correctness gate.** It proves the candidate axioms keep the ontology
  logically consistent. It says nothing about whether the concept *should* be public.
- **ACSP human approval = the policy gate.** Kinds 31400 (PanelDefinition) / 31402
  (ActionRequest) raise the candidate; kind 31403 (approval) authorises the PR. This is the
  "should this be shared" decision a reasoner cannot make.

**Rationale.** PRD-014 D2 shows the bridge bypasses governance; D3 shows the governed
pipeline already exists inside VisionClaw (`ontology_mutation_service.rs:73-130,384-412`);
D5 shows there is no social governance for "should this be shared" — Whelk checks logical
consistency only and the ACSP plane is unwired to proposals. Routing through both gates is
the only path that satisfies G4 (governed) and G8 (governed loop) simultaneously.

**Rejected alternatives.**
- *Direct Oxigraph load* (the `/api/ontology/load` backdoor). Bypasses governance and
  violates the single-writer model (ADR-023 D1); this is the bug D3 closes.
- *Auto-merge on Whelk-pass alone.* Consistency is necessary but not sufficient — logical
  consistency ≠ "this concept belongs in the shared ontology". Conflates correctness with
  policy.
- *A bespoke voting mechanism.* ACSP already provides the human-in-the-loop primitive
  (31400/31402/31403); a parallel voting scheme would fork governance.

**Consequences.** Elevation **fails closed**: a candidate that fails Whelk is rejected
(never proposed), and a proposal that lacks ACSP approval is never merged — there is no path
to the shared ontology that skips either gate. The front-half extractor is the BC22
aggregate (DDD-012); it treats pod RDF as the canonical personal-KG source (PRD-014 D6) and
adds entity-alignment/dedup against existing `vc:` classes before proposing (D4) so
elevation does not mint duplicate classes. On merge, the `ConceptElevated` event (D4 of
PRD-014 §4.4) is what BC20 (D1 above) carries into the graph for the elevation animation.

### D4 — ACSP (nostr kinds 31400-31405) is the single agent-action/governance protocol

ACSP (the Agent Control & Steering Protocol, nostr kinds 31400-31405) is the **single**
agent-action and governance protocol across all five substrates. VisionClaw's divergent,
unwired, one-way `AgentActionEnvelope`
(`crates/visionclaw-contracts/src/agent_action.rs`, four variants, no client dispatcher) is
mapped onto — or replaced by — ACSP, and the VisionClaw client gains a real 31402 dispatcher
so clicking an agent node emits a genuine `ActionRequest` to the addressed agent's
`did:nostr`. The closure introduces no new identity primitives and no new URN kinds: it
reuses `did:nostr`, the 18 `urn:agentbox` kinds (ADR-013), PROV-O Activity records, and
ACSP. Ecosystem alignment happens at source (PRD-014 §4.5): nostr-rust-forum advertises the
kinds in NIP-11 (X3); dreamlab-ai-website wires or removes its dead relay config (X5/X6).

**Rationale.** PRD-014 E3 shows ACSP kinds 31400-31405 are entirely absent in VisionClaw
(`grep 3140[0-5]` = 0) and have been displaced by an unwired one-way contract. PRD-014 B5
confirms the agent actor model and ACSP already exist on the agentbox side. The forum relay
already supports the kinds but does not advertise them (X3). One protocol spoken everywhere
is the only way to get a continuous chain from a VisionClaw click through agentbox to a
governed elevation.

**Rejected alternatives.**
- *Maintain two parallel agent-action contracts* (ACSP + `AgentActionEnvelope`). Guarantees
  drift, double the surface to keep in sync, and the dead contract already has no dispatcher
  (E3) — keeping it is pure liability.
- *Invent a sixth adapter slot for the loop.* The loop is **cross-cutting**, not a
  durable-state backend. Per ADR-005 it follows the shape of observability, the privacy
  filter, and the JSON-LD encoder — one hook point, one policy per slot, explicit
  fail-closed/fail-open semantics — exactly as ADR-023 D2 declined to make the ontology
  bridge a sixth slot.

**Consequences.** The loop is cross-cutting middleware over the existing five adapter slots
(beads, pods, memory, events, orchestrator), not a new slot — the ADR-005 contract test
harness in `tests/contract/` must still pass for all three implementation classes per slot.
ACSP governance composes with the existing middleware order (privacy filter → JSON-LD
encoder → adapter dispatch). The G8 governed-loop goal depends on the VisionFlow Judgment
Broker `handleGovernanceDecision()` work (PRD-014 X1), which is called out as a dependency
here but owned in VisionFlow, not by this ADR.

## Consequences

### Positive

- One continuous provenance chain — `urn:agentbox:activity` ↔ `urn:visionclaw` — across the
  whole journey, with `owner_did = did:nostr:<hex>` constant at every hop (D1, G5).
- Autonomous pod writes become safe and revocable: scoped `acl:agent` mandate, signed
  NIP-98, the user's nsec never leaves the user (D2, G2).
- No shared-ontology write is possible without both the Whelk correctness gate and ACSP
  policy approval (D3, G4/G8).
- One agent-action protocol (ACSP) spoken by every substrate; the divergent dead contract is
  retired (D4, G6/G7).
- Zero new identity primitives, zero new URN kinds, zero new adapter slots — the closure
  rides entirely on ADR-005/009/010/013/014/017/023 surfaces already in place.
- Agent-action egress becomes *consumed* once BC20 ingests it over the ADR-014/ADR-059
  `/wss/agent-events` WS contract — closing X2 with **one** transport (the deprecated `:9500`
  MCP-TCP relay is retired, not extended). No new port; identity (`source_urn`/`pubkey`)
  reaches the wire intact.

### Negative

- BC20 is now real, owned, bidirectional code that must be maintained on both sides of the
  federation boundary; an ingest-schema change on either side triggers a review (see
  `review_trigger`).
- Pod writes failing closed on a missing mandate is a behaviour change for any caller that
  relied on anonymous/forwarded-header writes; those callers must acquire a mandate first.
- The governed elevation path adds latency (Whelk consistency + human ACSP approval) between
  a personal-KG concept and its appearance in the shared ontology; this is intentional but
  is a real cost versus the removed direct-load backdoor.
- Cross-repo coordination: closing the seams touches five repos (WS1-WS14); the ACSP and
  BC20 schemas become shared contracts whose evolution must be coordinated.

### Neutral

- The optional native voice ingress (echoloop STT → intent path, WS14) is manifest-gated and
  default off; VisionClaw remains the canonical front end (PRD-014 §4.1).
- NIP-26 delegation is retained as a narrow wire form (speak-as-the-user) rather than the
  default, so the delegation surface stays small.
- BC22 (the elevation bounded context, DDD-012) treats pod RDF as the canonical personal-KG
  store; the VisionClaw-markdown and RuVector-memory stores become projections, not
  competing sources of truth.

## Status of dependent work

This ADR is realised by PRD-014's workstreams. Tier A (correctness preconditions): WS1
(solid-pod-rs non-destructive PATCH), WS3 (GET content-negotiation). (The former WS2
"egress port `:9500`→`:3001`" is VOID — a misdiagnosis retracted under D1 consequences; its
real concern, agent-action ingest, moves into WS5.) Tier B (the seam closures owned here): WS4
(signed NIP-98 + agent mandate — D2), WS5 (real BC20 ✅ + producer convergence ✅ + ADR-059
Phase-1 schema mirror ✅; agent-action ingest converges on the ADR-014/ADR-059
`/wss/agent-events` WS contract and retires `:9500`, absorbing the former WS2 — D1), WS6 (governed elevation routing
+ extractor + alignment — D3), WS7 (voice→selected-actor binding + ACSP dispatcher — D4),
WS8 (`ConceptElevated` + owner field + animation — D3/D4), WS9 (default intentSpec +
per-agent did:nostr auth on ingress). Tier C (source-repo alignment and optional ingress):
WS10 (read-only SPARQL query), WS11 (nostr-rust-forum NIP-11 advertise 31400-31405 — D4),
WS12 (dreamlab-ai-website relay config — D4), WS13 (VisionFlow canon docs), WS14 (optional
echoloop STT ingress). The new bounded context for the elevation front-half is **DDD-012
(BC22 — Sovereign Knowledge Elevation)**. G8 (governed loop) additionally depends on the
VisionFlow Judgment Broker `handleGovernanceDecision()` work (PRD-014 X1), which is a
dependency, not owned here.

## Cross-references

- **PRD-014** — `docs/reference/prd/PRD-014-embodied-agent-loop.md` (driving PRD; §3 gap
  ledger, §4 design, §5 workstreams).
- **DDD-012** — Sovereign Knowledge Elevation domain (BC22; the elevation extractor
  aggregate).
- **ADR-005** — Pluggable adapter architecture (five slots; cross-cutting middleware order;
  the loop is middleware, not a sixth slot — cf. D4).
- **ADR-009** — Embedded Nostr relay (durable cross-session ACSP/mandate channel).
- **ADR-010** — Rust Solid pod adoption (the pod D2 writes to; WAC `acl:agent`).
- **ADR-013** — Canonical URI grammar (`did:nostr:<pubkey>`, `urn:agentbox:<kind>:…`, all
  minted via `management-api/lib/uris.js`; no ad-hoc IDs, no new kinds — binds D1/D2/D4).
- **ADR-014** — Bidirectional graph-state ingress (`0x23 AGENT_ACTION` frame; its "egress port
  `:9500`→`:3001`" item is retracted under D1 — no port bug, the gap is push-vs-poll ingest).
- **ADR-017** — Multi-tenant did:nostr pods (per-user signing key for D2 multi-tenant
  NIP-98).
- **ADR-023** — VisionClaw ontology bridge (D1 single-writer; D2 query-surface-not-a-slot;
  D4 fail-open; D5 BC20 forward reference now realised in D1).
