---
id: ADR-2030
title: Publishable service crates are MIT OR Apache-2.0 inside the AGPL-3.0 repository
date: 2026-09-03
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: [services, docs/developer/licensing.md]
owner: jjohare
review_trigger: any new crate under services/, any services crate gaining an AGPL dependency, or first publication of a services crate to crates.io
repo: agentbox
---

# ADR-2030 — Publishable service crates are MIT OR Apache-2.0 inside the AGPL-3.0 repository

## Context
ADR-016 (archive) made the repository AGPL-3.0-only end to end because every
first-party component was aggregated into one hosted service. The 2026-09
Python-to-Rust programme produced ten Rust crates under `services/` that are
self-contained Cargo workspaces, several of them clean-room and reusable
(prose-sanitiser, diagram-ir, the CPython-byte-shape JSON emitter, the
WebCrypto envelope). The operator's standing rule is that such modules are
published to crates.io, where AGPL library crates see little adoption. Every
manifest under `services/` already declares `MIT OR Apache-2.0`; the repo
root `LICENSE` is AGPL-3.0; the two grants were flagged as contradictory by
three workers and by the Codex adversarial review (finding 9). The copyright
holder resolved it on 2026-09-03: the crates, and this code, may be fully
open and permissive without changing the containing repository's licence.

## Decision
Code under `services/` is licensed `MIT OR Apache-2.0` by its own manifests
and the `LICENSE-MIT` / `LICENSE-APACHE` texts in each workspace; the rest
of the repository remains AGPL-3.0-only under the root `LICENSE`. The
permissive grant is per crate and travels with the crate on crates.io. An
AGPL-3.0 repository may contain permissively licensed subtrees; the AGPL
governs the aggregate hosted service, not the licence of each part. A
`services/` crate that links an AGPL-licensed library (today
`nostr-pod-bridge`, which links `solid-pod-rs-nostr`) is not permissive in
effect and must declare `AGPL-3.0-only` in its manifest rather than
advertise a grant it cannot give. Contributions to `services/` are accepted
under the same permissive terms.

## Consequences
The four prose-sanitiser publication candidates and the other reusable
crates can be published without a relicensing exercise. `licensing.md`
gains a subtree row and the dual grant must be stated in every crate
README. Adding an AGPL dependency to a permissive crate is a licence change
and needs this record re-reviewed. ADR-016's "uniformly AGPL-3.0" statement
is amended by this record; the archive copy is not edited.

## Verification


`grep -h '^license' services/*/Cargo.toml services/*/crates/*/Cargo.toml`
shows `MIT OR Apache-2.0` on every crate except `nostr-pod-bridge`
(`AGPL-3.0-only`, set by this change). `services/LICENSING-NOTICE.md` and
`docs/developer/licensing.md` describe the split. Verified at the commit
that lands this record.

## Closeout extension — 2026-09-04

CP-01/08. Owner remains jjohare with package/release maintainers. The [current local inventory](../../../../VisionFlow/docs/estate-review/evidence/service-package-inventory.json) finds eight package manifests: seven declare MIT OR Apache-2.0 and nostr-pod-bridge declares AGPL-3.0-only. None of those package directories has an adjacent LICENSE file or README. Implementation is partial against this record's promised per-workspace texts and per-crate README statement. Historical acceptance and live status are retained; the original ten-crate context is not a current inventory.

**Acceptance condition:** Reconcile retained versus extracted package ownership, provide the declared package documentation/texts through the intended release process, and inspect actual packaged contents. Bind each release to source revision, manifest, dependency graph, notices and archive digest. Review the distribution-specific dependency/licensing position through the designated maintainer process; this metadata inventory does not establish legal compatibility or permission to publish. Verify extracted repository and consumed Nix revisions separately. Reopen on package extraction, dependencies, declared terms or first publication. See the [release-boundary review](../../../../VisionFlow/docs/estate-review/configuration-projection.md#service-package-and-release-metadata).

No registry lookup, archive creation or publication ran. The existing staleness gate for this record remains unresolved rather than advancing verified_commit without full review of its declared services-wide scope.

## Acceptance progress — 2026-09-05 (prose-sanitiser side)

Scope note: prose-sanitiser is **not** among the eight `services/` manifests the
2026-09-04 inventory counted. It was extracted to
[DreamLab-AI/prose-sanitiser](https://github.com/DreamLab-AI/prose-sanitiser) and
removed from `services/` by `38009c3`. This paragraph records only what now
exists in that repository; the retained `services/` crates are covered
separately.

Now present there, uncommitted at time of writing: a release receipt
(`docs/release-receipts/2026-09-05.md` and `.json`) binding source revision,
manifest, dependency graph, notices and per-archive digests for all six
publishable crates, plus an acceptance summary at
`docs/estate-closeout/2026-09-05/acceptance.md`. Ownership reconciliation is
**proved rather than asserted**: the `crates/` subtree at `3b545e1` there and
`services/prose-sanitiser/crates` at `3c853e9` here share the git tree hash
`7a3ef0d9b45dc85409ea295f33de185a0cf8e584`, so extraction is content-identical at
the join point and nothing is retained. The declared texts now ship: `LICENSE-MIT`
and `LICENSE-APACHE` sit beside every crate and are dereferenced into all six
archives (verified by extracting one), each crate README carries the dual-grant
statement, and all seven manifests declare description/license/repository/readme/
keywords/categories/rust-version. Every per-crate README previously linked this
ADR by a path valid only in the old `services/` layout, so the statement this
record requires was a dead link in every published archive; the links are now
absolute. Checks: 767 tests, `cargo clippy --all-targets --all-features -D
warnings`, `cargo doc --no-deps -D warnings` with `#![deny(missing_docs)]` newly
active on all seven crates, `cargo deny check` all four sections ok, `cargo fmt`
clean.

Still open from that side, and not claimed closed: the receipt binds a dirty
working tree (head plus a recorded diff digest) because this pass was instructed
not to commit, so ADR-2030's "bind each release to source revision" clause needs
one re-run after the diff lands; the archives already published as `0.1.1` were
not compared against these digests, as no registry was contacted; and the
distribution-specific licensing review remains with the designated maintainer —
`cargo deny`'s `licenses ok` is an allow-list metadata check, not a legal
assessment. This record's services-wide staleness gate is untouched and its
`verified_commit` is not advanced.

## Acceptance progress — 2026-09-05 (retained services/ crates)

**Implemented.** The per-workspace texts and per-crate licence statement this
record promised now exist for every package directory the 2026-09-04 inventory
counted. Verified inventory, re-read rather than taken from the old numbers:
eight package manifests — `agentbox-manifest`, `agentbox-mcp`, `agentbox-ops`,
`dream-engine`, `ontology-tools`, `podcast-ingest` and `skill-tools` declaring
`MIT OR Apache-2.0`, and `nostr-pod-bridge` declaring `AGPL-3.0-only`.

- Every permissive directory carries `LICENSE-MIT`, `LICENSE-APACHE` (standard
  texts, appendix boilerplate completed) and a `README.md` stating what the crate
  is, its dual grant and the ecosystem contribution paragraph, with the copyright
  holder and year taken from the repository root `LICENSE`/`NOTICE`/`MAINTAINERS.md`
  rather than invented.
- `services/nostr-pod-bridge` stays AGPL-3.0-only, with the full `LICENSE` text
  and a README that states explicitly that it is **not** dual-licensed — so
  nobody publishes it under the permissive assumption, which was the live risk of
  a directory whose only licence signal was one manifest line.
- `services/LICENSING-NOTICE.md` and `docs/developer/licensing.md` now describe
  the actual per-directory state.
- `scripts/ci/check-crate-licensing.sh` (new) fails if any `services/` package
  directory lacks the texts and README its own manifest declares, wired into
  `.github/workflows/invariants.yml` as an appended step so the drift cannot
  silently return.

A published crate's README is part of the licensed artefact, so it has to
describe the code it ships with. `services/dream-engine/README.md` gained an
**Acceptance path** section covering the seven modules that carry it
(`manifest`, `readiness`, `candidate`, `receipts`, `gate`, `runstate`,
`roster`), the veto-class → verdict mapping (harness → `BLOCKED-ENV`,
evidence → `REJECT`, unproven → `INCONCLUSIVE`), the rule that a draft PR opens
**only on a gate-upheld ACCEPT**, and the two accepted `evaluatorEntrypoints`
forms with the fail-closed reading of a bare string. Documentation only — no
Rust source was touched.

**Tests and results.** `sh scripts/ci/check-crate-licensing.sh` — exit 0,
`8 services/ package directories carry the texts they declare`.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2030-licensing.json`.

**Remaining.** Metadata and file placement only. No packaged archive was built or
inspected from this repository, no registry was contacted and nothing was
published; this inventory does not establish legal compatibility or permission to
publish, which stays with the designated maintainer process. Binding each release
to source revision, manifest, dependency graph, notices and archive digest is
done on the extracted prose-sanitiser side (above) and not here. The
services-wide staleness gate for this record is untouched and `verified_commit`
is not advanced.

**Governed paths changed.** `services/*/LICENSE-MIT`, `services/*/LICENSE-APACHE`,
`services/nostr-pod-bridge/LICENSE`, `services/*/README.md` (including the dream-engine acceptance-path section),
`services/*/Cargo.toml` (publish metadata only),
`services/LICENSING-NOTICE.md`, `docs/developer/licensing.md`,
`scripts/ci/check-crate-licensing.sh` (new),
`.github/workflows/invariants.yml` (one appended step).

### Re-verification 2026-09-05 (ADR-2030)

Verification ran on the **uncommitted working tree** above `89301ec7c911eab270c00a0cf81596d0d4f15535`.
`verified_commit` is set to that SHA and `verified_paths` emptied; **both must be
restored at the landing commit** — the prior list was `[services, docs/developer/licensing.md]`.

Licence fields re-checked per crate in `services/` (`license` field in `Cargo.toml`,
plus the licence files actually present):

| crate | `license` | files |
|---|---|---|
| `agentbox-manifest` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `agentbox-ops` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `agentbox-mcp` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `skill-tools` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `ontology-tools` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `podcast-ingest` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `dream-engine` | `MIT OR Apache-2.0` | `LICENSE-APACHE`, `LICENSE-MIT` |
| `nostr-pod-bridge` | `AGPL-3.0-only` | `LICENSE` (full AGPL text) |

- **The AGPL exception holds as written.** `services/LICENSING-NOTICE.md` states that a
  crate linking an AGPL library cannot grant permissive terms; `nostr-pod-bridge` links
  `solid-pod-rs-nostr`, declares `AGPL-3.0-only`, and ships `LICENSE` rather than the
  `LICENSE-MIT`/`LICENSE-APACHE` pair. Verified present. It is correctly **not**
  dual-licensed and must not be published under the permissive assumption.
- **CORRECTION — two crates named in the stale diff no longer exist.**
  `services/diagram-ir/` and `services/prose-sanitiser/` appear in the staleness report
  because they existed at the old `verified_commit` `169602a07511ee5f708a7b793545a2e095bce61e`
  and are absent from both HEAD and the working tree
  (`git ls-tree --name-only HEAD services/` lists eight entries plus
  `LICENSING-NOTICE.md`, neither among them). This record's scope is therefore the eight
  crates above. If either returns, it must carry the dual-licence pair before publication.
- No permissively-licensed crate was found missing a licence field or a licence file.
