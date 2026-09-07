---
id: ADR-2022
title: Governed ontology writes only — the ungoverned axiom-load backdoor stays disabled outside bootstrap
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 1b43b70ff09b971b440c9964743402aec45ef515
verified_paths: [agentbox.toml, mcp/servers/ontology-bridge.js, mcp/servers/ontology-propose.js, mcp/servers/lib/ontology-local.js, mcp/servers/lib/ontology-authoring-authority.js]
owner: jjohare
review_trigger: any change to direct_axiom_load default, or the authority-class of ontology_axiom_load
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-023 (ontology bridge), ADR-054 (ontology-bridge write-path findings), PRD-014 Seam D/D2
---

# ADR-2022 — Governed ontology writes only — the ungoverned axiom-load backdoor stays disabled outside bootstrap

## Context

The shared ontology has two write paths. The governed one (PRD-014 Seam D/D2):
`ontology_propose` → Whelk consistency check → staged result or PR → human review/merge. The legacy
ungoverned one: a raw `POST /api/ontology/load` reachable through
`ontology_axiom_add`, which writes axioms with no consistency gate and no human
in the loop. The ontology-bridge write-path review (ADR-054) flagged this as an
unguarded backdoor into a shared, consistency-critical resource.

## Decision

`direct_axiom_load` defaults **false**, so `ontology_axiom_add` refuses and
redirects the caller to the governed path. Personal-KG concepts reach the shared
ontology only through `ontology_propose → Whelk → PR → human review/merge`. The raw
`POST /api/ontology/load` backdoor is classified **zero-tolerance** in the
authority table — set the flag true only for admin/bootstrap, where a signed
authorisation is required. The named invariant lives in
`docs/GOVERNANCE-capabilities.md`.

## Consequences

- The remote direct-load default prevents that descriptor from issuing an
  ungoverned load, and since 2026-09-05 the local path is gated too: forced-local
  dispatch selects a *backend*, not an authority to author, and every local write
  passes `assertAuthoringAuthority` before reaching the Markdown writer
  (`mcp/servers/lib/ontology-authoring-authority.js`). Local authoring needs both
  `skills.ontology.local_authoring = true` and `ONTOLOGY_LOCAL_AUTHORING`, so a
  single flag or env var cannot open it.
- Bootstrap/admin bulk-load still exists but is an explicit, signed,
  zero-tolerance action — deliberately slow and auditable.
- Cost: routine enrichment is gated behind a PR round-trip; there is no fast
  path for high-volume trusted writes, by design.

## Verification

At `cbe7335b9`, `agentbox.toml`: `direct_axiom_load = false` (:638) with rationale
at :634-637 ("Default off = ontology_axiom_add refuses + redirects");
`ontology_axiom_load = "zero-tolerance"` in `[skills.authority.classes]` (:724),
commented "ungoverned KG write backdoor".

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `894e31fc7` ("explicit local-authoring gate for governed writes"): `mcp/servers/ontology-bridge.js` +60/-13 and `mcp/servers/lib/ontology-local.js` +48. The decision still holds and the gap its own Consequences named is now closed. Re-checked at HEAD: `agentbox.toml:637` `direct_axiom_load = false` and `:759` `ontology_axiom_load = "zero-tolerance"` in `[skills.authority.classes]`, commented "ungoverned KG write backdoor" (the previously cited `:638`/`:724` have drifted). New: `agentbox.toml:644` declares `local_authoring = false` explicitly, with the rationale at `:640-643` that a deny existing only as an omission is not reviewable. `mcp/servers/ontology-bridge.js:28-33` states that `FORCE_LOCAL` selects a backend and is not an authority to author; `:41-45` makes `localWriter()` the only route to the Markdown-writing helper; `:47` scopes `LOCAL_WRITE_TOOLS` to `ontology_axiom_add` and `ontology_propose`; both dispatch through `assertAuthoringAuthority` in `mcp/servers/lib/ontology-authoring-authority.js:255`, which requires **both** `env:ONTOLOGY_LOCAL_AUTHORING` (`:303`) and `manifest:skills.ontology.local_authoring` (`:304`) and otherwise denies with `ontology_local_authoring_not_authorised` (`:138`, `:306`). Live run: `node --test tests/integration/ontology-authoring-authority.test.mjs` → **24 pass, 0 fail**. **Record correction made by this pass:** the Consequences bullet still said forced-local dispatch "precedes the remote guard and can edit the authored corpus directly" — that hole is closed by construction, so the bullet has been corrected in place, and `mcp/servers/lib/ontology-authoring-authority.js` added to `verified_paths` as the file the gate now lives in. `implementation_status` stays `partial` pending the governed round-trip (Whelk → PR → merge) being exercised end to end against a live ontology. Commands: `git diff --stat 89301ec7..HEAD -- mcp/servers/`, `grep -n 'direct_axiom_load\|local_authoring' agentbox.toml`, `node --test tests/integration/ontology-authoring-authority.test.mjs`.

## Closeout extension — 2026-09-04

**Work package:** CP-02 / CP-04 / CP-05. **Owner:** existing owner above, with
VisionClaw and authored-corpus maintainers at the promotion boundary.

**Status correction:** prior `implementation_status: complete` was supported
only by manifest defaults. Current source at `89301ec7c911eab270c00a0cf81596d0d4f15535` retains
`direct_axiom_load = false`, but `FORCE_LOCAL` dispatch occurs before the remote
axiom descriptor and calls a Markdown-writing helper. The [actual helper probe](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/agent-snapshot.json)
edited a temporary corpus without a Whelk or human gate. This establishes local
authoring, not a demonstrated remote shared-store bypass on default network
failure. The broad invariant now has partial implementation; activation of the
existing paths is not newly verified by this review.

**Acceptance:** name and enforce the authority for local authoring separately
from shared-ontology promotion. Test forced-local, remote-disabled, bootstrap
and governed-proposal modes; require correlation from validation through PR,
approval, merge and served corpus generation. A policy-table classification
alone does not prove that every caller invokes the authority gate. Close this
record only when those routes satisfy the declared policy or an explicit
revision bounds the decision.

## Acceptance progress — 2026-09-05

- **Implemented**
  - New `mcp/servers/lib/ontology-authoring-authority.js`: a single named gate,
    `assertAuthoringAuthority({mode, manifest, env, target, operation})`, plus
    `createAuthoredCorpusWriter()` — the ONLY sanctioned route from any caller to the
    Markdown-writing helper (`ontology-local.js` `axiomAdd`/`propose`). Both writer entry
    points call the gate before touching the backend.
  - Four enforced modes. `forced-local` requires `AGENTBOX_ONTOLOGY_LOCAL` **and** an
    explicit opt-in `ONTOLOGY_LOCAL_AUTHORING=1` **and** manifest
    `skills.ontology.local_authoring = true`, and is confined to the local authored corpus.
    `remote-disabled` requires the same opt-in minus the selector — an outage withdraws the
    governed write path, it does not grant a local one. `bootstrap` is zero-tolerance:
    `AGENTBOX_ONTOLOGY_BOOTSTRAP=1`, a recorded authorisation reference, and
    `direct_axiom_load = true`. `governed-proposal` is the only mode that may target the
    shared ontology, and only via the proposal/PR route (it writes no local file).
  - Deny by default. An unknown or absent mode is denied; an absent manifest key is `false`.
    Every denial is a typed `OntologyAuthorityError` carrying `missing_authority[]` naming the
    exact authorities that were absent — never a silent no-op and never a silent write.
  - `direct_axiom_load = false` now actually blocks a direct axiom load in `forced-local`,
    `remote-disabled` and `bootstrap`; in `governed-proposal` the request is **converted** into
    a proposal rather than executed. The local-authoring opt-in does not unlock the backdoor.
  - Correlation: every authorised write carries an id (`ont-auth-<ts>-<12 hex>`, `node:crypto`)
    returned to the caller with the chain `validation → proposal → approval → merge →
    served-corpus`, and stamped into the artefact's V2 frontmatter
    (`ontology-authoring-correlation` / `-mode` / `-stage`) via `lib/vault-frontmatter`.
  - `mcp/servers/ontology-bridge.js`: `ontology_axiom_add` and `ontology_propose` dispatch
    through `handleLocalWrite` → the gated writer, in both the FORCE_LOCAL branch and the
    network-failure fallback branch (each passing its own named mode). No direct
    `L.axiomAdd` / `L.propose` call remains in the bridge.

- **Tests and results**
  - `node --test tests/integration/ontology-authoring-authority.test.mjs` — **24 tests, 24
    pass, 0 fail** (hermetic: temp corpus, injected env + manifest, no network). Covers
    forced-local without opt-in (typed denial, corpus byte-identical), forced-local with
    opt-in (write allowed, correlation id in the return value *and* the artefact),
    remote-disabled both ways, bootstrap denied/authorised, governed-proposal targeting the
    shared store, direct axiom load blocked in every non-governed mode under
    `direct_axiom_load = false`, deny-by-default on an unknown mode, a gate spy proving both
    writer entry points invoke the gate exactly once and that a denying gate never reaches the
    Markdown helper, and a static guard pinning the complete set of direct callers of the
    writing helper across `mcp/servers/**`.
  - Regression: `node --test mcp/servers/lib/__tests__/*.test.js` — 20/20 pass (vault
    frontmatter, unchanged); `node --test mcp/servers/lib/ontology-push.test.js` — 5/5 pass.

- **Receipts**
  - `docs/estate-closeout/2026-09-05/adr-2022-authoring-authority.json` (source hashes, mode
    table, enforcement rules, fixture list, limitations).

- **Remaining**
  - `mcp/servers/ontology-local.cjs:69` still calls `onto.axiomAdd(...)` directly — a
    standalone CLI front-end outside this change's edit scope. The static-guard test pins the
    complete caller set so it cannot grow and the bridge cannot regress into it; routing the
    CLI through the gate is the next step.
  - `skills.ontology.local_authoring` does not exist in `agentbox.toml`, so local authoring is
    denied in every mode as shipped. Enabling it is a deliberate, reviewable manifest edit.
  - The remote `ontology_axiom_add` path keeps its existing `ontology-propose.js` guard and was
    not re-routed through this gate, to avoid changing the admin/bootstrap remote-load contract
    in the same change.
  - The bootstrap authorisation reference is recorded, not verified, here; signature
    verification remains the management-api authority consumer's job. Carrying one correlation
    id through a real Whelk validation → PR → approval → merge → served corpus still requires
    the VisionClaw-side stages to accept and echo it.
  - `implementation_status` stays `partial`: the local-authoring authority is now named and
    enforced for the bridge, but the end-to-end correlated promotion chain is not demonstrated.

- **Governed paths changed**
  - `ontology_axiom_add` and `ontology_propose` on the local route are now authority-gated at
    the bridge; both return an explicit authorisation verdict (`authorised`, `mode`,
    `governed`, `route`, `correlation_id`) or a typed denial. Callers can recognise the
    authority change before acting on the result — local authoring reports `governed: false`.
  - No change to the remote governed path (`/api/ontology-agent/propose`), to
    `direct_axiom_load`'s default, or to the `ontology_axiom_load` authority class.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: agentbox.toml: a new `[skills.podcast_ingest]` section (ADR-2057) only; every section this record governs is untouched. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: agentbox.toml. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.
