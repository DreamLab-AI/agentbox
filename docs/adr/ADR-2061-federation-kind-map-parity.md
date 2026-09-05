---
id: ADR-2061
title: Make the cross-repo URN kind map symmetric and fixture-gated in both languages
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: adding or removing a URN kind on either side of the federation boundary, or any change to the sha256-12 content-address derivation
repo: agentbox
domain: PROTOCOL-registry
lineage: ADR-2025 (cross-repo federation contract), ADR-2023 (sha256-12 content address, visionclaw)
---

# ADR-2061 — Make the cross-repo URN kind map symmetric and fixture-gated in both languages

## Context

`docs/PROTOCOL-registry.md` already records the seam: *"JS supports
agent/activity/thing/bead and option-dependent memory elevation; Rust has a
narrower closed map"*. Phase 1 diagrams ES-03.4 and ES-03.5 drew both sides from
code and made the consequence concrete.

`management-api/lib/bc20-provenance-bridge.js` crosses `bead` **structurally**:
`:88-89` states *"`bead` crosses structurally: both grammars are
`<pubkey>:<sha256-12>` now that agentbox beads are content-addressed"*, and
`:167-169` implements the pass-through, dropping only when the 64-hex owner scope
is missing (`:173-174`). VisionClaw's `cross_from_agentbox()`
(`src/uri/mod.rs:650`) has no `bead` arm — it falls to the same wildcard `None`
as `memory`.

So the same object crosses agentbox→VisionClaw when the JS bridge translates it
and is refused when the Rust translator does. Neither side is wrong in isolation;
they were written to different closed-map lists and nothing detects the
disagreement. The content-address halves *are* proven equal — the golden fixture
`entity_urn_matches_uris_js_golden` (`src/services/provenance_writer.rs:623`)
pins both languages to `sha256-12-8c3913fd05a9` for identical canonical input —
so the hash is not the divergence; the kind list is.

## Decision

The supported-kind list is a **single versioned artefact shared by both
repositories**, not a list transcribed into two translators. Each side derives
its closed map from that artefact, and a paired fixture asserts symmetry: for
every kind in the artefact, both translators must agree on *crossed* versus
*refused*, and on the target grammar when crossed.

Asymmetry becomes a build failure rather than a runtime surprise. A kind is added
to the artefact only with both a JS and a Rust arm and a fixture row; a kind
deliberately refused (today `memory`, which needs a `{domain,slug}` elevation
absent on the hot path) is recorded as an explicit refusal with its reason, not
as an absent arm — "not implemented" and "deliberately closed" must be
distinguishable from the map alone.

`bead` is resolved **in favour of crossing**, matching the JS bridge. This is not
a coin-toss between two defensible positions: the convergence was the original
decision and the Rust wildcard is the side that fell behind. `uris.js:106-108`
records the intent in the source — *"bead is content-addressed to match
VisionClaw's converged grammar (`urn:visionclaw:bead:<pubkey>:<sha256-12>`) so
the BC20 bridge can cross beads structurally instead of dropping them (audit
2026-06-09 A3)"* — and `:109` sets `contentAddressed: true` to achieve it. The
pass-through is lossless, the missing-scope drop is already handled, and `bead`
is the one kind needing no `UrnMapping` persistence to round-trip because both
grammars are already `<pubkey>:<sha256-12>`. The Rust side gains the arm, which
is a pure addition with no storage dependency.

## Consequences

- The Rust translator gains a `bead` arm and both sides gain a shared fixture.
  Until then the boundary silently disagrees and the JS bridge is the more
  permissive of the two.
- Adding a federated kind becomes a two-repo change with a fixture, which is
  slower and is the point: today a one-sided addition is indistinguishable from a
  deliberate refusal.
- The `PROTOCOL-registry.md` "URN crossing" row's required acceptance —
  *"Versioned supported-kind agreement and explicit unmapped outcomes"* — is
  satisfied by the artefact plus the refusal reasons.
- Cross-lead: the Rust arm is in `src/uri/mod.rs` (**vc-knowledge**), the JS map
  in `management-api/lib/bc20-provenance-bridge.js`
  (**ab-identity-governance**). Both leads have been sent this finding with the
  file:line evidence. Whichever direction they settle on, the fixture requirement
  stands — if they instead decide `bead` must **not** cross, this ADR is amended
  to record the refusal and the JS arm is removed, and the symmetry gate is
  unchanged.
- Not bounded to one lead's files, so this lands as `proposed` per the Phase 2
  policy for cross-repo work.

## Acceptance test

The implementation is accepted when all four hold:

1. A single artefact enumerates every federated kind with, per kind: `crosses`
   (bool), the source grammar, the target grammar, and — when `crosses` is false
   — a `refusal_reason` string.
2. A JS test and a Rust test each read that artefact and assert their translator
   agrees with every row, both for crossing and for refusal. Neither test
   hard-codes the kind list.
3. A round-trip fixture proves that for each crossing kind, a URN minted by
   `management-api/lib/uris.js` and translated by `bc20-provenance-bridge.js`
   yields byte-identical output to the same URN translated by
   `cross_from_agentbox()` — extending the existing
   `entity_urn_matches_uris_js_golden` pattern from the content address to the
   whole crossing.
4. Adding a kind to one translator without the other fails CI, demonstrated by a
   deliberately one-sided change on a scratch branch.

## Verification

Not implemented — `implementation_status: none`. Verification below establishes
only that the divergence this ADR addresses is real, and ran on the **uncommitted
working tree** above SHA `89301ec7c911eab270c00a0cf81596d0d4f15535`;
`verified_paths` is empty because the tree is uncommitted, and this must be
re-run at the landing commit.

- `grep -n -B6 'bead:' management-api/lib/uris.js` → `:106-108` the intent comment
  quoted in Decision above, and `:109`
  `bead: { ownerScope: true, scopeRequired: true, contentAddressed: true, resolvableSurface: 'beads' }`.
  This is the decisive evidence that structural crossing was the design and the
  Rust wildcard is the stale side; the direction was confirmed independently by
  the ab-identity-governance lead, who owns the JS map.
- `grep -n 'toVisionclaw\|toAgentbox\|bead' management-api/lib/bc20-provenance-bridge.js`
  → `:21` documents `urn:agentbox:bead:<pubkey>:<sha256-12>` →
  `urn:visionclaw:bead:<pubkey>:<sha256-12>` as a pass-through; `:88-89` the
  structural-crossing rationale; `:96` and `:102` the kind-map entries;
  `:134` `function toVisionclaw`; `:167-169` the pass-through branch;
  `:173-174` the missing-scope drop.
- `grep -n 'fn cross_from_agentbox' ../src/uri/mod.rs` → `:650`; reading the body
  from `:650` confirms a `did:nostr` pass-through arm and no `bead` arm.
- `grep -n 'entity_urn_matches_uris_js_golden\|8c3913fd05a9' ../src/services/provenance_writer.rs`
  → `:65` (doc reference), `:623` (the test), `:626` and `:633` (the expected
  URN `urn:agentbox:event:<a×64>:sha256-12-8c3913fd05a9`), `:842` (reuse).
  The content address is therefore already proven byte-identical across
  languages; the kind list is the sole divergence.
