---
id: ADR-2025
title: "Cross-repo federation contract: sha12 content address, urn:agentbox grammar, closed inbound kind-map"
date: 2026-08-31
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: [management-api/lib/bc20-provenance-bridge.js, management-api/lib/uris.js]
owner: jjohare
review_trigger: any change to the sha12 truncation, the urn:agentbox mint/parse grammar, or the closed inbound kind-map on either repo
repo: agentbox
domain: PROTOCOL-registry
---

# ADR-2025 — Cross-repo federation contract: sha12 content address, urn:agentbox grammar, closed inbound kind-map

## Context
The agentbox↔visionclaw federation seam is pinned from the visionclaw side only.
visionclaw ADR-2023 declares its content address "byte-identical to the agentbox
`sha12()` contract"; visionclaw ADR-2025 maps inbound `urn:agentbox:*` kinds;
visionclaw ADR-2022 converges with agentbox ADR-2011 on hex-canonical identity.
No agentbox record owns `sha12()`, the `urn:agentbox:<type>` grammar, or the
closed inbound kind-map — agentbox ADR-2011 concedes that convergence was
"parallel, not deduped". Each repo's CI validates only its own tree, so an
agentbox helper change passes agentbox CI and silently breaks the visionclaw
join. Governing doc: `docs/PROTOCOL-registry.md`.

## Decision
This record owns, on the agentbox side, the federation primitives visionclaw
depends on: (1) the content-address truncation length — 12 hex characters — and
lowercase hex casing; (2) the `urn:agentbox:<type>[:<scope>]:<local>` mint/parse
grammar; (3) the closed inbound kind-map. It declares a typed cross-repo
dependency on **visionclaw ADR-2022** (hex-canonical identity convergence),
**visionclaw ADR-2023** (`sha12` byte-parity content address), and **visionclaw
ADR-2025** (inbound `urn:agentbox:*` kind mapping) — cited explicitly in prose
because the `supersedes`/`superseded_by` schema has no repo qualifier yet. A
shared conformance fixture asserting `sha12` byte-parity and hex-canonical
identity MUST run in BOTH repos' CI before any change to these primitives merges;
neither repo may alter a governed primitive on a green single-tree build alone.

## Consequences
The federation seam gains a single governed contract and a cross-repo CI gate:
changes to the truncation length, hex casing, URN grammar, or kind-map become
co-ordinated across both repos instead of silent. Cost: a new shared fixture must
be authored and wired into both CI pipelines, and the two-sided dependency is
carried in prose until the ADR schema grows a repo-qualified cross-reference.
Follow-on: promote the prose dependency to a typed field once the schema supports
it, and register this contract in the domain routing table.

## Verification

The 2026-09-04 estate fixture executes both current helper implementations. Five string inputs agree on hash output; agent/activity/thing crossings agree; bead support differs, and both return unmapped for memory without elevation options. Rust precomputed KG addresses are only prefix-checked. A local review fixture now exists, but no shared two-repository CI gate is established by this pass. Implementation changes from none to partial for the existing primitives and paired evidence; decision remains proposed and activation inactive for the complete contract.

## Closeout extension — 2026-09-04

CP-01/02/04/05. Owner remains jjohare with both identifier maintainers. **Acceptance condition:** agree exact byte/serialisation and address grammar, reconcile supported kinds and elevation, persist recoverable mappings, and run versioned positive/negative fixtures in both CI pipelines. Reopen on either helper, parser or mapped-kind change. See the [protocol registry](../PROTOCOL-registry.md), [estate review](../../../../VisionFlow/docs/estate-review/federation-identifiers.md) and [paired receipt](../../../../VisionFlow/docs/estate-review/evidence/federation-identity-probe.json). No live ingest or mapping-store mutation ran.

## Acceptance progress — 2026-09-05

**Implemented — a versioned, two-language fixture.**
`tests/fixtures/federation-identity.v1.json` is now the frozen acceptance
artefact the ADR asked for. It pins, in one place: the **input byte encoding**
(UTF-8, no normalisation on either side — the composed and decomposed forms of
the same grapheme have different addresses, and that is the recorded contract
rather than an accident); the **serialisation** distinction between the BC20
bridge hashing an incoming URN string and `uris.js` stable-serialising a
structured payload; the **exact grammar** (`^sha256-12-[0-9a-f]{12}$`, twelve
lowercase hex, so a prefix-only check is not conformance); the **supported
kinds** with an `expected_rust` column beside the JavaScript expectation;
**elevation**; and the **explicit unmapped outcomes** — because `None` must
surface as a visible refusal, never a fabricated identity.

**Implemented — a CI-runnable check.**
`scripts/ci/federation-fixture-check.mjs` runs the agentbox side: **35 checks,
all passing**. It asserts the content addresses and their grammar, that the two
Unicode forms still *differ* (a silent start of normalisation would
re-identify existing records), each mapped crossing, each unmapped refusal, that
a crossing returns a recoverable mapping record, the precomputed-address
admission table including the empty, non-hex, uppercase and overlong suffixes the
review found being accepted by a prefix check, the owner-scope grammar, and — in
both directions — that the fixture's kinds and the bridge's declared kind map
agree, so shipping a new kind without extending the fixture fails here.

**Bead divergence — decision recorded.** The JavaScript bridge crosses `bead` by
structural pass-through (agentbox bead locals are already `sha256-12` content
addresses, identical to VisionClaw's bead shape); the Rust ordinary crossing has
no bead arm and refuses it via the wildcard. The reconciliation is **resolved in
favour of crossing**, matching the JavaScript bridge, and is recorded in
[the protocol registry](../PROTOCOL-registry.md) against **ADR-2061**, which owns
the Rust arm. Until that lands, a bead that crosses one way and not the other
must be reported as an explicit unmapped result on the refusing side — the
fixture marks the row `divergent` rather than pretending parity.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2025-federation-fixture.json` (the check's
own machine-readable output, including its honest `rust_side_status`).

**Governed paths changed.** `tests/fixtures/federation-identity.v1.json` (new),
`scripts/ci/federation-fixture-check.mjs` (new), `docs/PROTOCOL-registry.md`.

**Remaining.** This gate covers **one side**. The contract is not closed until
VisionClaw's pipeline executes the same file against `src/uri/mod.rs`, which is
outside this repository; the check says so in its own output rather than
implying two-sided coverage. Durable mapping persistence, replay and recovery
remain untested — these are pure helper calls. `decision_status` stays
`proposed`.
