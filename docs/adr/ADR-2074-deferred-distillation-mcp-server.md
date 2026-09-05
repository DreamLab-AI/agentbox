---
id: ADR-2074
title: Build the ADR-051 deferred-distillation tools as a discrete, separately gated MCP server
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: ADR-051 moving off proposed, a second distillation provider landing (the N=1 to platform threshold), or any agent hand-rolling a distillation pipeline
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-051 D2/D3 (deferred-distillation tools, job URN kind, distill/recombine beads) — the design this record schedules; ADR-2023 (Loom façade) "Remaining" names the absence and is its ORIGIN, referenced with `see`, superseded by nothing here
---

# ADR-2074 — Build the deferred-distillation tools as a discrete MCP server

## Context

Two diagrams record the same gap. **AB-26.7**
(`agentbox/26-headroom-beads-spawn-brain.md:310`) records that only beads substrate
primitives exist and ADR-051's deferred-distillation MCP tools are not yet a discrete
server; **AB-24.9** (`agentbox/24-loom-facade.md:395`) restates it from the Loom side.
Nothing of ADR-051 D2/D3 is built: `grep` across `mcp/servers/` finds no
`ontology_distill_submit`, `_await` or `_fetch` and no `ontology-distilled` namespace;
`management-api/lib/uris.js:87-...` has no `job` kind; no `job_urn` field exists anywhere
outside `node_modules`. ADR-051 D2 proposed hanging the three tools off
`mcp/servers/ontology-bridge.js`. ADR-2023's "Remaining" list names the absence and is
the **origin** of this gap, not its resolution.

## Decision

**Proposed.** The deferred-distillation surface ships as its own MCP server, not as three
extra tools on `ontology-bridge`. When taken:

1. **A discrete server** — `mcp/servers/ontology-distill.js` — registers
   `ontology_distill_submit`, `ontology_distill_await` and `ontology_distill_fetch` with
   the semantics ADR-051 D2 specifies unchanged: RFC 8785 JCS canonicalisation of the
   identity core (`kind`, `corpusSha`, `scope`, `budget_tokens` only), a `job` URN minted
   through `management-api/lib/uris.js`, harness-key BIP-340 signing so no agent touches a
   key, a `distill` bead plus a `recombine` bead blocked by it, and dedupe-on-create via
   the unique `job_urn` index.
2. **This ADR amends ADR-051 D2 on the hosting question only.** The reason is custody and
   gating, not tidiness: this server holds the harness machine signing key, and
   `ontology-bridge` is a read-pervasive, fail-open, always-registered surface. A
   key-holding, network-egressing, spend-bearing surface must not inherit fail-open
   registration from a retrieval server, and must be independently disableable without
   removing ontology retrieval from every agent.
3. **It is manifest-gated with an honest apply class** (ADR-039): a
   `[skills.ontology.distillation]` gate wraps both the Nix package set and the
   `.mcp.json` registration, defaulting **off**, with a `system-manifest.js` catalogue
   entry. Gate off means the tools are not registered and no key is loaded.
4. **The `job` kind is registered properly** in `uris.js` — owner-scoped,
   scope-required, content-addressed — with the per-kind JCS canonical form ADR-051 D3
   requires, registered as a per-kind form rather than changing the existing kinds'
   serialisation. Ad-hoc `format!()`/template-literal job URNs stay prohibited.
5. **The no-synchronous-await law is preserved.** `_await` polls a rendezvous filled by a
   separate provider across a caller-supplied deadline and returns a labelled timeout; it
   never holds a turn open on a model. A missing, unverified or expired distillate is
   fail-labelled, never fail-open.

## Consequences

- Agents stop being able to hand-roll a distillation pipeline, and no agent ever holds the
  signing key — the property ADR-051 D2 exists for.
- Cost: a new supervised surface, a new gate, a new URN kind with a per-kind canonical
  form, two bead types with a dependency edge, and a unique index — this is the largest of
  the five Loom-adjacent records and should not be attempted as a bounded fix.
- A separate server is one more registration to keep in sync with `.mcp.json` and one more
  thing that can silently fail to register; the ADR-2057 residual applies — a gate turned
  off cannot retract a `.mcp.json` entry an earlier boot wrote.
- Deviating from ADR-051 D2's hosting choice must be recorded in ADR-051 itself when this
  lands, so the two records do not disagree.
- Until this ships, the beads substrate primitives remain the only thing that exists, and
  any claim that deferred distillation is available is false.

## Verification

`implementation_status: none`. Verified at `e070514d808b218574403377fb75e0e1a0a256b3`:
`grep -rn 'distill_submit|distill_await|distill_fetch|ontology-distilled' mcp/servers/`
returns nothing; `grep -n "'job'" management-api/lib/uris.js` returns nothing and the
`KINDS` registry (`:87`) has no `job` entry; `grep -rn job_urn` outside `node_modules`
returns nothing. ADR-2023's "Remaining" list and GOVERNANCE-capabilities' shipped-vs-paper
inventory both record the absence.

**Acceptance test for the landing change.**

1. With `[skills.ontology.distillation]` **off**: the three tools are absent from
   `.mcp.json` and from a live `tools/list`; no signing key is read; ontology retrieval
   via `ontology-bridge` is unaffected.
2. With the gate **on**: `ontology_distill_submit` returns a `jobUrn` of the form
   `urn:agentbox:job:<64-hex>:sha256-12-<12hex>`, minted through `uris.js` — a grep for a
   template-literal job URN in the server returns nothing.
3. Resubmitting a request whose identity core is byte-identical under RFC 8785 JCS returns
   the **same** `jobUrn` with `deduped: true`, creates no second bead and re-signs nothing.
4. Changing only `budget_tokens` produces a **different** `jobUrn`; changing only
   `deadline`, `model_policy` or requester produces the **same** one.
5. Submission creates a `distill` bead carrying `job_urn` and a `recombine` bead blocked
   by it; the work-DAG readiness query does not surface `recombine` until `distill` closes.
6. `ontology_distill_await` with a 2 s deadline against an unfilled rendezvous returns a
   labelled timeout within ~2 s and holds no model turn.
7. `ontology_distill_fetch` on a result with a bad provider signature returns a typed
   verification failure and no content.
