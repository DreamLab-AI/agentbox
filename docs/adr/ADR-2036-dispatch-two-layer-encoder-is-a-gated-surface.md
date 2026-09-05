---
id: ADR-2036
title: The adapter dispatch wrap is two layers; JSON-LD encoding is a gated surface that enforces its own ordering
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: [ADR-2005]
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: A fourth cross-cutting concern proposed for the dispatch path, or any proposal to move the Linked-Data encoder into wrapDispatch
repo: agentbox
domain: BASELINE-container
lineage: supersedes ADR-2005 (three-layer positional wrap); legacy ADR-005 (observability), ADR-008 (privacy filter), ADR-012 (jsonld grammar), ADR-031 (middleware-bypass coverage), DDD-004 §L08
---

# ADR-2036 — The adapter dispatch wrap is two layers; JSON-LD encoding is a gated surface that enforces its own ordering

## Context
ADR-2005 states every adapter call passes a fixed three-layer wrap: observability → privacy → JSON-LD.
The code wraps **two**. `wrapDispatch` (`observability/metrics.js:125`) composes Layer 1 around
Layer 2 only (`:127`, `:140`); its own docblock at `:110-112` says Layer 3 is ADR-012 and "the caller
must invoke `encoder.dispatch` after this wrapper returns". Layer 3 cannot live in `wrapDispatch`:
`instrumentAdapter` (`adapters/index.js:131`) wraps every public method generically as `(...args)`,
whereas `LinkedDataEncoder.dispatch` requires `{slot, operation, payload, context, adapterCall}`
(`middleware/linked-data/encoder.js:117`) and is opt-in per surface (`_surfaceEnabled`, `:105-109`;
`[linked_data]` per agentbox/CLAUDE.md). ADR-2005's real invariant — redaction precedes encoding —
is enforced at the encoder by `assertPrivacyFilterApplied` (`encoder.js:128`), which trips a
violation counter and throws for fail-closed slots. Exposed by diagrams **AB-04.4**, **AB-05.1**.

## Decision
Adapter dispatch is wrapped in **two** layers, in this order: observability (`wrapDispatch`, Layer 1)
around privacy redaction (`wrapWithPrivacyFilter`, Layer 2). That order is non-negotiable and remains
an Invariant.

JSON-LD encoding is **not** a dispatch-wrap layer. It is a per-surface, manifest-gated encoding stage
invoked by the route that owns the surface, receiving the adapter call as its `adapterCall`
continuation. Its ordering guarantee is enforced **by evidence, not by position**: the privacy filter
stamps a per-dispatch marker on the payload it has traversed, and `assertPrivacyFilterApplied`
rejects an unmarked payload at the encoder — throwing for fail-closed slots (pods, memory) and
counting the violation otherwise. A route that calls an adapter directly and then encodes is
therefore *detected*, which positional wrapping could not achieve.

Any new cross-cutting concern that applies uniformly to every adapter method joins the wrap and
states its fail-open/fail-closed behaviour in an ADR. Any concern that is per-surface, gated, or
needs operation semantics is a stage like the encoder, and MUST carry a runtime assertion proving
the layers it depends on already ran. Claiming an ordering that positional composition does not
provide is forbidden.

## Consequences
- The BASELINE Invariant "every adapter dispatch wrapped observability → privacy → JSON-LD, in that
  order" is replaced by the two-layer wrap plus the marker-enforced encoder ordering.
  `lib/system-manifest.js:292` no longer advertises a three-layer chain on `/v1/system`.
- Adding a Linked-Data surface stays cheap: it needs a gate and a surface module, not a change to the
  dispatch wrapper, and it cannot silently encode unredacted data.
- The cost is that the ordering guarantee is a runtime check rather than a structural one. That is
  deliberate — `tests/contract/memory-encoder-bypass.contract.spec.js` exists precisely because the
  bypass it guards (the pods-fallback branch of `POST /v1/memory` calling `pods.write()` directly)
  was a real defect, and a positional wrap would not have caught it.
- Follow-on: routes that encode must keep using the encoder's `adapterCall` continuation rather than
  calling the adapter and encoding separately. `routes/` is owned by ab-identity-governance; the
  contract suite above is the guard.

## Verification
Verification ran on the **uncommitted working tree** above SHA
`89301ec7c911eab270c00a0cf81596d0d4f15535`; `verified_commit` and `verified_paths` must be re-run and
restored at the landing commit.

- `grep -n "wrapWithPrivacyFilter\|privacyWrapped" agentbox/management-api/observability/metrics.js`
  → `:9` require, `:127` `const privacyWrapped = wrapWithPrivacyFilter(slot, methodName, fn, manifest)`,
  `:140` `await privacyWrapped(...args)`. No encoder reference in the file.
- `sed -n '107,112p' agentbox/management-api/observability/metrics.js` → the docblock naming Layer 3
  as ADR-012 and caller-invoked.
- `sed -n '117,137p' agentbox/management-api/middleware/linked-data/encoder.js` → `dispatch({slot,
  operation, payload, context, adapterCall})`, `assertPrivacyFilterApplied(payload, slot, this.logger)`
  at `:128`, pass-through `return adapterCall(payload)` at `:136` when no surface gate is on.
- `grep -rn "encoder.dispatch" agentbox/management-api/routes/` → `routes/memory.js:166` (the only
  production caller), consistent with the encoder being route-level.
- `npx jest ../tests/contract/adapter-lifecycle.contract.spec.js
  ../tests/contract/memory-encoder-bypass.contract.spec.js --ci --forceExit` **run from
  `management-api/`** (the runner CI uses — `contract-tests.yml:52-54`; `node --test` fails
  because most suites expect injected globals, and the root `package.json` restricts jest's
  `roots` to `tests/config`) → **2 suites passed, 21 tests passed**.
- BASELINE-container.md §Invariants and `lib/system-manifest.js:292` updated in the same change.
