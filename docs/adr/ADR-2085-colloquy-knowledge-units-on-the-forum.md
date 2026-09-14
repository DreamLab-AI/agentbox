---
id: ADR-2085
title: Adopt the cq shared-learning model as signed knowledge units on kinds 38100-38105
date: 2026-09-13
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [crates/colloquy/colloquy-core/src, crates/colloquy/colloquy-nostr/src/kinds.rs, crates/colloquy/colloquy-store/src, crates/colloquy/colloquy-mcp/src]
owner: jjohare
review_trigger: first publication of a 38100 event to a relay outside the container
repo: agentbox
---

# ADR-2085 — Adopt the cq shared-learning model as signed knowledge units on kinds 38100-38105

## Context

Agents in this estate rediscover the same failures independently. Learnings that
do get written land as opaque RuVector rows: unsigned, unattributable,
unreviewable, and invisible to any human surface. `precedent-service.js` already
implements cq's shape — match, promote, retire, 0.85 similarity — but for exactly
one kind of knowledge (governance decisions) and with no lifecycle, no decay and
no notion of who agrees.

cq (mozilla-ai, Apache-2.0, Go + Python) specifies the missing model: five verbs,
a knowledge-unit schema, a four-level ladder, tiered graduation through a human
gate, and confirmation weight that follows *diversity of verifying parties*. The
estate already owns every substrate cq needs — `did:nostr` is stronger than
KERI/ACDC, RuVector is cq's tier 2, and ACSP `31402`/`31403` is cq's human gate
with a signature attached.

## Decision

**Adopt the model, clean-room in Rust.** `colloquy-core` implements the cq schema
and rules as a pure crate (no clock, no I/O), published to crates.io under
Apache-2.0 to match upstream, and tested against cq's own published
`knowledge_unit.json` so interoperability is demonstrated rather than asserted.

**Allocate six kinds inside the block this repo already owns.** `38100`
KnowledgeUnit (addressable, `d` = unit id hex), `38101` Confirmation, `38102`
Flag, `38103` Supersession, `38104` Graduation, `38105` ToolGapSignal. The block
`38000–38201` is agentbox's; `38000–38099` is spent on agent intent, so nothing
outside this repo moves. The unit is replaceable by its proposer; confirmations,
flags and graduations are **regular, append-only** events, so a proposer can
correct their own wording but cannot rewrite what others said about it.

**Content is authoritative; tags are an index.** Every fact a consumer acts on is
read from the event's JSON content. A tag that disagrees with the content is a
decode error, never a silently preferred value.

**No sixth adapter slot.** Colloquy consumes the existing `memory` and `events`
slots. A knowledge store is a consumer of durable state, not a new class of it.

**Graduation reuses the governance round-trip.** A promotion emits `31402`; the
human approves with a signed `31403`; the unit's graduation record cites that
event id in an additive `authorising_event` field. This makes cq's
`"approved_by": "human:alice@acme.dev"` string checkable by a third party.

**Two additions to the cq schema, both additive.** `Graduation.authorising_event`
(omitted when absent, so a cq-written unit round-trips byte-identically) and
`UnitStatus::Disputed` (a flag lowers standing and opens a thread; only a signed
decision retires a unit).

## Consequences

- Learnings become reviewable artefacts with a human-readable surface.
  `precedent-service.js`, `precedent-bridge.js` and their contract spec are
  **deleted**, along with the `[skills.precedent]` gate and its registration.
  The migration that deletion was gated on turned out not to exist: the
  `governance-precedents` namespace is empty and nothing outside the bridge
  called the tools. The auto-apply behaviour is deliberately not carried over —
  it is rebuilt, if wanted, on `query` plus a confidence floor, where the
  confidence is diversity-weighted and the promotion behind it human-gated.
- The kind allocation is subject to ADR-2061's symmetric kind-map contract, and
  the paired fixture **is extended**: `schema/federation-kinds.json` declares
  `knowledge` as `not-federated`, `tests/fixtures/federation-identity.v1.json`
  pins it to an explicit unmapped result, and
  `scripts/ci/federation-fixture-check.mjs` passes 37 checks. Extending the
  checker was itself necessary: it could not previously express "declared in the
  shared artefact, and deliberately without a counterpart", so a refusal row had
  no way to be tested. **Both halves of the ADR-2061 gate now pass** — the JS
  parity spec (52 tests) and the Rust `uri::tests::federation_*` suite (7 tests)
  each generate every case from the one shared artefact, so the `knowledge`
  refusal is asserted in both languages.
- The shared tier writes to a **new `colloquy` namespace**, not `patterns`.
  Mixing units into a namespace the recall band is measured against would move
  the band and make both numbers meaningless. Consequence: the
  `governance-precedents` migration imports legacy rows into a fresh namespace
  and runs behind its own recall measurement, revertible on its own.
- Bulk ingest into that namespace inherits invariant 8 of `LEARNING-memory.md`:
  a serial, non-concurrent HNSW rebuild afterwards. `SharedStore::bulk_put` is
  the single call site that exists so this is noticed once rather than
  discovered after a thousand single writes.
- The public tier is gated on membership, which now includes agents in their own
  right — see ADR-2086, which is the load-bearing half of that decision.
- Anything published to the public tier has crossed the privacy filter on the
  `propose` path and a human gate on promotion. Neither is optional, and
  members-only visibility at v1 lowers the blast radius of a filter miss without
  removing the requirement.

## Verification

Verification ran against the **uncommitted working tree**, so `verified_commit`
is deliberately empty rather than anchored to `643e3223` — which predates every
path listed above and would be a stale anchor in the sense ADR-2058 names. In
`crates/colloquy/`:

- `cargo test --workspace --offline` — 162 tests pass, including
  `colloquy-core/tests/cq_interop.rs`, which parses cq's published example unit
  and asserts a round trip rewrites no cq-defined field.
- `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- `cargo doc --workspace --no-deps` — no warnings.
- `cargo build -p colloquy-core --target wasm32-unknown-unknown` — succeeds, so
  the same crate drives the Cloudflare workers and the agent runtime.
- `colloquy-nostr/src/kinds.rs::the_block_does_not_collide_with_agent_intent_or_governance`
  asserts the allocation against both neighbouring blocks.
- End-to-end: `colloquy-mcp` answers `initialize`, `tools/list` and `tools/call`
  over stdio; a propose/confirm/query/status round trip was exercised by hand.

- `node scripts/ci/federation-fixture-check.mjs` — PASS, 37 checks, with the
  `knowledge` crossing pinned to an explicit unmapped result.
- **Live, against running services, not fakes:** `COLLOQUY_TIER=shared` drove a
  propose/query/status round trip through the governed `ruvector-mcp.cjs` —
  postgres connected, Xinference embedded at 384 dims with the pinned embedding
  identity accepted, and the unit came back from real HNSW search.
  `COLLOQUY_TIER=public`'s transport was exercised against the running relay on
  `127.0.0.1:7777`: a REQ/EOSE round trip succeeded and a publish was refused
  with the relay's own ADR-2012 allowlist message, which verifies socket,
  framing, signature and policy in one answer.

**Not yet verified, and therefore `activation_status: inactive`:** no `38100`
event has been *accepted* by a relay. That is blocked on two independent things,
both by design rather than oversight. The relay runs `ingress_policy =
"allowlist"` and the list is **baked into the supervisor environment at Nix build
time** (`flake.nix relayAllowedPubkeysCsv`), so admitting a new publisher needs a
manifest edit and a rebuild; and the container's agent pubkey is not on that list
while the six that are belong to keys this process does not hold — the sovereign
identity secret is root-owned at `/run/agentbox/identity.env`, 0600, correctly
unreadable to an agent. The clean unblock is a signing-on-behalf path:
`nostr-pod-bridge` already holds the key and already signs kinds 30840/30841 for
`summarise`/`track`, so a `publish` subcommand there would let the public tier
emit without any agent ever touching key material. That is a change to the
sovereign identity binary and is left for an explicit decision.
