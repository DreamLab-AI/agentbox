---
id: ADR-2061
title: Make the cross-repo URN kind map symmetric and fixture-gated in both languages
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
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

## Pre-implementation evidence — the divergence was real

Recorded when this ADR was `proposed`, on the uncommitted working tree above
`89301ec7c911eab270c00a0cf81596d0d4f15535`. Retained as the "before" half of the
record; the landing verification is the dated section below. One line has since
changed: `cross_from_agentbox()` gained its `bead` arm at
`b0bc275f6501aae7751b85a72ce15fe1e730e7e8` (VisionClaw), between the finding and
this landing, so at implementation time only the shared artefact and the symmetry
gate were still outstanding.

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

## Verification — 2026-09-05

Landed. Ran on the **uncommitted working tree** above agentbox
`e070514d808b218574403377fb75e0e1a0a256b3` and VisionClaw
`b0bc275f6501aae7751b85a72ce15fe1e730e7e8`; `verified_paths` is empty because the
tree is uncommitted, and this must be re-run at the landing commit.

### What was built

- **The artefact** — `schema/federation-kinds.json` (258 lines, `version: "1.0.0"`).
  One row per `urn:agentbox` kind with `crosses`, `source_grammar`,
  `target_kind`/`target_grammar`, a `crossing_form`, a `fixture`, and — when
  `crosses` is false — a `refusal_class` (`deliberate` | `not-federated`) plus a
  `refusal_reason`. Four kinds cross (`agent`, `activity`, `thing`, `bead`);
  fifteen refuse. A separate `identity_passthrough` block covers the already-
  converged `did:nostr` input and its malformed twin.
- **JS derives, not transcribes** — `management-api/lib/bc20-provenance-bridge.js:112-127`:
  the module reads the artefact at require time and builds `AGENTBOX_TO_VISIONCLAW`
  by filtering rows with a non-`did:nostr` `target_kind`, with
  `VISIONCLAW_TO_AGENTBOX` inverted from it rather than written out. The exported
  maps are byte-for-byte what they were, so no consumer changed; the artefact is
  exported too (`:390`) so the fixture reads exactly the bytes the bridge read.
- **Rust derives, not transcribes** — `src/uri/mod.rs:651`
  `include_str!("../../agentbox/schema/federation-kinds.json")`. That path is the
  one stated in the Decision and resolves because the agentbox tree is this
  checkout's `./agentbox` submodule; from `src/uri/`, `../../` is the VisionClaw
  root. `federation_kinds()` (`:742`) parses it once into a `OnceLock`;
  `federation_kind()` (`:753`) looks up a row; `cross_from_agentbox` (`:797`) now
  consults `federation_kind(kind)?` and returns `None` when `!spec.crosses`
  (`:820`), then dispatches on `spec.target_kind` (`:830`) instead of on a
  hard-coded kind. The only mapping Rust still owns is target-kind → typed
  constructor, and `federation_targets_all_have_an_arm` fails if the artefact
  names a target with no arm, so that residual cannot become a silent drop.

### Acceptance test — all four hold

1. **Single artefact with per-kind crosses / grammars / refusal reason.**
   `node -e "…"` over the artefact: 19 kinds, crossing = `agent,activity,thing,bead`.
   The kind list is asserted set-equal to `Object.keys(uris.KINDS)` by
   *"artefact enumerates exactly the uris.js KINDS"*, so a kind `uris.js` can mint
   but the artefact never mentions fails rather than crossing by accident.
2. **Both tests read the artefact; neither hard-codes the list.** Every case on
   both sides is generated by iterating `ART.kinds` /
   `federation_kinds().kinds` — `test.each(...)` in jest, a `for` loop in Rust.
   - `cd management-api && ./node_modules/.bin/jest ../tests/contract/federation-kind-parity.contract.spec.js --ci --forceExit`
     → **50 passed, 50 total** (`tests/contract/federation-kind-parity.contract.spec.js`, 210 lines).
   - `cargo test --lib uri` (VisionClaw root) → **82 passed; 0 failed**, including
     the seven new `uri::tests::federation_*` cases (`src/uri/mod.rs:1449,1467,1500,1521,1539,1585,1609`).
3. **Byte-identical output across the two languages.** The fixture `expect`
   values were computed by the JS hasher (`urn:visionclaw:execution:sha256-12-6ce98872df29`,
   `urn:visionclaw:kg:<a×64>:sha256-12-d9acefeb6df6`) and are reproduced by Rust's
   independent `sha2` in `federation_kind_artefact_matches_translator` — the
   crossing, not just the content address, now has the
   `entity_urn_matches_uris_js_golden` guarantee. That golden test still passes
   unchanged in the same run.
4. **A one-sided change fails.** Demonstrated on the working tree rather than a
   scratch branch (this session may not branch): `memory` was flipped to
   `crosses: true` with a `concept` fixture — a kind the JS bridge *can* reach
   given `{domain, slug}` but the Rust translator has no arm for.
   - jest → **3 failed, 47 passed** (`memory crosses to the fixture target
     byte-for-byte`, `memory output satisfies the declared target grammar`,
     `the deliberate refusal is not "not implemented" — it names its unlock`).
   - `cargo test --lib uri` → **4 failed, 78 passed**
     (`federation_kind_artefact_matches_translator`,
     `federation_crossings_match_declared_grammar`,
     `federation_targets_all_have_an_arm`,
     `federation_refusals_are_recorded_not_absent`).
   The artefact was restored and both suites re-run green
   (**82 passed** / **80 passed** across the parity suite plus the pre-existing
   `tests/sovereign/bc20-provenance-bridge.test.js`, which is unchanged and still
   30/30 — the derived map is identical to the map it replaced).

### `memory` is a recorded refusal, not an absent arm

The distinction the Decision demanded is executable, not prose. The artefact
gives `memory` `crosses: false`, `refusal_class: "deliberate"`, the
`target_kind` it *would* reach (`concept`), and an `elevation` block naming
`["domain", "slug"]`. Both suites assert a `deliberate` row carries all three and
that a `not-federated` row carries none of them; the JS suite additionally
supplies exactly the named arguments and asserts the crossing then *succeeds*
against the declared grammar, proving the refusal is a hot-path policy rather
than a missing implementation. The two refusal classes are also distinguishable
at runtime, not only in the artefact: `deliberate` drops report the
`missing-args` reason class, `not-federated` drops report `unmapped-kind`, and
the JS suite asserts the reported class matches the row's declared class for all
fifteen refusing kinds.

### Residual — the Rust half is not yet CI-gated

Honest scope of `activation_status: live`: the **JS** gate runs in CI today with
no workflow change, because `.github/workflows/contract-tests.yml:54` already
globs `tests/contract/` for `*.contract.spec.js` — confirmed by running that
exact invocation with `--listTests`, which enumerates 27 suites including
`federation-kind-parity.contract.spec.js`. The **Rust** fixture is green locally
but VisionClaw's `ci.yml` `CPU_CRATES` list (`:81-90`) does not include
`visionclaw-server`, the crate that owns `src/uri`, so no CI job runs
`cargo test --lib uri`. Closing this needs one line in a workflow file owned by
another lead; until then a one-sided change is caught by CI only when it breaks
the JS side, and by a local `cargo test` otherwise. Also outstanding and
outside this change's file ownership: `docs/PROTOCOL-registry.md:8` still
describes the "URN crossing" row's acceptance as *planned by ADR-2061
(proposed)* and should now read as satisfied.
