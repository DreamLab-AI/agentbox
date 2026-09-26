---
id: ADR-2030
title: Publishable service crates are MIT OR Apache-2.0 inside the AGPL-3.0 repository
date: 2026-09-03
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 4f9450ac86477bc3832933953454ea577bd3d531
verified_paths: [services/LICENSING-NOTICE.md, docs/developer/licensing.md, scripts/ci/check-crate-licensing.sh, services/*/Cargo.toml]
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
`services/` crate that links an AGPL-licensed library (`nostr-pod-bridge`,
which links `solid-pod-rs-nostr`) is not permissive in effect and must
declare `AGPL-3.0-only` in its manifest rather than advertise a grant it
cannot give. A crate that is deliberately not offered for reuse may also
declare `AGPL-3.0-only`, with `publish = false` and a README that says it is
not dual-licensed (`secret-backup`, added 2026-09-05); the permissive default
is a publication posture, not an obligation on every subtree crate. Contributions to `services/` are accepted
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

**2026-09-05 re-verified at 08e817f39.** `verified_paths` was the whole `services` directory, so this record went stale on every commit touching any crate's source — 88 files in the last diff, almost none of them licensing-relevant. It is now narrowed to the files the decision actually depends on: the licensing notice, the developer doc, the CI gate, and each crate's `Cargo.toml` (the manifests that carry the `license` field). Crate source files are deliberately excluded — editing `dream-engine/src/runner.rs` cannot change a licence grant. The decision still holds. Re-checked at HEAD: nine package manifests under `services/`, seven declaring `MIT OR Apache-2.0` with `LICENSE-MIT` + `LICENSE-APACHE` + `README.md` on disk, and two declaring `AGPL-3.0-only` with the full AGPL `LICENSE` text. `sh scripts/ci/check-crate-licensing.sh` → exit 0, `OK … 9 services/ package directories carry the texts they declare`; the gate is wired at `.github/workflows/invariants.yml:93-94` (new since the last verification, via `7e7b2d586`), which converts the 2026-09-04 closeout's "no adjacent LICENSE file or README" finding into an enforced invariant. **Divergence found and corrected by this pass:** `services/secret-backup` (added by `7905d2a64`) declares `AGPL-3.0-only` but its dependency graph is wholly permissive (`age`, `secrecy`, `tar`, `anyhow`, `clap`, `walkdir`, `tempfile` — `services/secret-backup/Cargo.toml:15-27`), so it is **not** the linked-AGPL exception this record's Decision described; it is AGPL by choice with `publish = false` (`:9`). `services/LICENSING-NOTICE.md` had not caught up: it named `nostr-pod-bridge` as the sole exception, omitted `secret-backup` from the per-directory table, and asserted "Eight package manifests, seven permissive and one AGPL" when there are nine and two. The notice and this record's Decision have both been corrected to describe the two exceptions and their different reasons. The CI gate itself was already correct — its rule keys on the declared licence, not on the dependency graph — which is why the divergence was documentary, not a code-compliance failure. `implementation_status` stays `partial`: no crate has been published to crates.io, so the per-crate grant has not been exercised where it matters, and the CP-01/CP-08 release-identity obligations are untouched. Commands: `git diff --name-only 89301ec7..HEAD -- services docs/developer/licensing.md`, `grep -h '^license' services/*/Cargo.toml | sort | uniq -c`, `sh scripts/ci/check-crate-licensing.sh`.

## Closeout extension — 2026-09-04

CP-01/08. Owner remains jjohare with package/release maintainers. The [current local inventory](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/service-package-inventory.json) finds eight package manifests: seven declare MIT OR Apache-2.0 and nostr-pod-bridge declares AGPL-3.0-only. None of those package directories has an adjacent LICENSE file or README. Implementation is partial against this record's promised per-workspace texts and per-crate README statement. Historical acceptance and live status are retained; the original ten-crate context is not a current inventory.

**Acceptance condition:** Reconcile retained versus extracted package ownership, provide the declared package documentation/texts through the intended release process, and inspect actual packaged contents. Bind each release to source revision, manifest, dependency graph, notices and archive digest. Review the distribution-specific dependency/licensing position through the designated maintainer process; this metadata inventory does not establish legal compatibility or permission to publish. Verify extracted repository and consumed Nix revisions separately. Reopen on package extraction, dependencies, declared terms or first publication. See the [release-boundary review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/configuration-projection.md#service-package-and-release-metadata).

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

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: services/LICENSING-NOTICE.md: the correction this record's own 2026-09-05 re-verification made (secret-backup is AGPL by choice with publish = false; nine manifests, two AGPL); `scripts/ci/check-crate-licensing.sh` OK, 9 package directories. Decision unaffected; `verified_commit` moved to the landing commit.

## Re-verification attempted — 2026-09-21 — NOT RE-VERIFIED, RECORD HAS DRIFTED

`verified_commit` is deliberately **left at `1b43b70ff09b971b440c9964743402aec45ef515`**. It
is stale, and it stays stale, because this record's own CI gate does not pass at
`b680a7aeef604276af73e00e1eb5156f379530ae`. Bumping the SHA here would convert "unknown"
into "confirmed" against the evidence.

What the staleness gate pointed at was innocuous: the three tripped Cargo manifests gained
a `loom-client = "0.1"` dependency (ADR-2084) and one description was reworded. Running the
gate itself is what found the drift.

```
$ bash scripts/ci/check-crate-licensing.sh          # clean worktree at HEAD
FAIL (check-crate-licensing): services/explainer-tools: [package] has no readme
FAIL (check-crate-licensing): services/explainer-tools: LICENSE-MIT is missing or empty
FAIL (check-crate-licensing): services/explainer-tools: LICENSE-APACHE is missing or empty
FAIL (check-crate-licensing): services/explainer-tools: README.md is missing or empty
FAIL (check-crate-licensing): 9 problem(s) across 10 package directories.
exit 1
```

`services/explainer-tools/Cargo.toml` declares `license = "MIT OR Apache-2.0"` and
`publish = false`, but the crate directory holds only `Cargo.toml`, `Cargo.lock`, `src/`
and `tests/` — no `LICENSE-MIT`, no `LICENSE-APACHE`, no `README.md`, and no `readme`
key. That is precisely the state this record forbids: "the `LICENSE-MIT` / `LICENSE-APACHE`
texts in each workspace" and "the dual grant must be stated in every crate README". It is
also not the record's own escape hatch, which requires `AGPL-3.0-only` **plus** a README
saying the crate is not dual-licensed (the `secret-backup` precedent).

**Two consequences worth separating.** First, `.github/workflows/invariants.yml:110-111`
runs this check, so the invariants job is red at `HEAD` for a second, independent reason
beyond the ADR index — fixing the ledger will not turn CI green on its own. Second, this is
a gap in the record's *own* staleness contract: `verified_paths` enumerates ten specific
`Cargo.toml` files, so a crate added under `services/` that is on none of them is invisible
to the gate. The record's `review_trigger` says "any new crate under `services/`" — that
trigger fired when `explainer-tools` landed and was not honoured.

**To clear this record:** give `services/explainer-tools` the `LICENSE-MIT`,
`LICENSE-APACHE` and `README.md` its manifest declares (or relicense it `AGPL-3.0-only`
with the README the escape hatch requires), add a `readme` key to `[package]`, add
`services/explainer-tools/Cargo.toml` to `verified_paths`, re-run
`scripts/ci/check-crate-licensing.sh` to exit 0, and only then bump `verified_commit`.
That is a code change under `services/`, outside this agent's remit.

## Structural fix — 2026-09-21 — `verified_paths` now globs `services/`

The missing licence files were the symptom; the enumeration was the defect. This record's
`verified_paths` named nine specific `Cargo.toml` files, so a **new** crate under
`services/` was invisible to the staleness gate — which is how `explainer-tools` landed
without licence texts while this record still read as verified. The `review_trigger`
already said "any new crate under `services/`"; nothing could act on it.

`verified_paths` now carries `services/*/Cargo.toml` in place of the nine entries. The
generator passes each entry straight to `git diff --name-only <commit>..HEAD -- <paths>`
via `execFileSync` (no shell), so the `*` reaches git as pathspec magic rather than being
expanded or mangled — verified against the very commit range that hid the drift:

```
$ git diff --name-only 1b43b70f..HEAD -- 'services/*/Cargo.toml'
services/agentbox-mcp/Cargo.toml
services/dream-engine/Cargo.toml
services/explainer-tools/Cargo.toml     # <- the added crate the enumeration could not see
services/podcast-ingest/Cargo.toml
```

`git ls-files 'services/*/Cargo.toml'` returns exactly the 10 package directories
`scripts/ci/check-crate-licensing.sh` reports, so the glob and the gate now cover the same
set by construction. Note that git's `*` spans `/`, so a future nested workspace member
(`services/<crate>/crates/<sub>/Cargo.toml`) is also caught — a superset, and the right one
for a record that governs the licensing of everything under `services/`.

The three non-manifest paths (`LICENSING-NOTICE.md`, `docs/developer/licensing.md`, the
gate script) stay enumerated: they are singular files, not a growing set.

This does not by itself make the enumeration-vs-trigger problem a solved class. Other
records in this pack arm the gate on fixed path lists while their `review_trigger` prose
describes a *set* that can grow — ADR-2084's "or a fifth caller appears" is the same shape
and also fired unactioned. Where a trigger names a set, the governed paths should glob it.

## Re-verification — 2026-09-21

Left STALE on the 2026-09-21 ledger pass because its claim was false at `b680a7ae`:
`services/explainer-tools` declared `MIT OR Apache-2.0` and shipped no licence texts
or README, and `scripts/ci/check-crate-licensing.sh` exited 1 — a drift the previous
enumerated `verified_paths` could not see, since the crate was added after the list
was written. Fixed in `e57156a8f`. Re-established at `e57156a8f` in a detached
worktree (not the working tree): `check-crate-licensing.sh` → "10 services/ package
directories carry the texts they declare", exit 0; `git ls-files 'services/*/Cargo.toml'`
returns the same 10 manifests the gate covers. Claim STILL TRUE at this commit.

Re-verified 2026-09-22 at `fc202907b` after `docs/developer/licensing.md` gained the
`crates/sidestr/` section (ADR-2106): the `services/` rule and gate are unchanged;
`scripts/ci/check-crate-licensing.sh` still reports the ten `services/` package directories.

Re-verified 2026-09-23 at `4293e7ed9` after `docs/developer/licensing.md`'s sidestr
section was rewritten for ADR-2112 (the crates moved to `DreamLab-AI/sidestr-rs`): only that
section changed; the `services/` rule, `services/LICENSING-NOTICE.md` and
`scripts/ci/check-crate-licensing.sh` are untouched, and the gate still reports the ten
`services/` package directories.

## Re-verification — 2026-09-25 (`5a7226b797c5949771e8b8ddcd69cfddd3c7f533`)

Tripped by `services/dream-engine/Cargo.toml` gaining dependencies for forum I/O (ADR-2115). This is the case the Consequences section warns about — "adding an AGPL dependency to a permissive crate is a licence change" — so it was checked, not bumped blind. The first draft of that change linked `nostr-bbs-core`, which is `AGPL-3.0-only` and pulls `solid-pod-rs` (`AGPL-3.0-only`); that would have made `dream-engine` AGPL in effect while it declares `MIT OR Apache-2.0`. It was reworked before commit: signing and verification use `nostr` (rust-nostr, MIT), the governance wire types are mirrored locally, and `nostr-bbs-core` is a **dev-dependency only** (conformance tests), so it is not linked into the shipped binary. At `5a7226b79`: the normal+build dependency closure of `dream-engine` (`cargo metadata` resolve, dev edges excluded) is 312 packages with no copyleft-only licence (`r-efi` is `MIT OR Apache-2.0 OR LGPL-2.1-or-later`); `grep -h '^license' services/*/Cargo.toml | sort | uniq -c` → 8 `MIT OR Apache-2.0`, 2 `AGPL-3.0-only`; `sh scripts/ci/check-crate-licensing.sh` → `OK … 10 services/ package directories carry the texts they declare`. Still true. Note for the release process: the nix derivation runs `doCheck = true`, so the check phase compiles the AGPL dev-dependency; that is a build-time test input, not part of the distributed artefact.

## Operator decision — 2026-09-25: `dream-engine` becomes AGPL-3.0-only and links `nostr-bbs-core`

Supersedes the outcome of the 2026-09-25 re-verification above (which kept `dream-engine` permissive by mirroring the forum's governance wire types over the MIT `nostr` crate, with `nostr-bbs-core` as a dev-dependency only). That history stands; this is the new state.

The operator decided that `dream-engine` should link `nostr-bbs-core` directly, so its forum I/O (ADR-2115) uses the forum's own event, signing, verification and governance types rather than a local mirror that could drift. Per this record's Decision, a crate that links an AGPL library "is not permissive in effect and must declare `AGPL-3.0-only`". So `services/dream-engine` now:
- declares `license = "AGPL-3.0-only"`;
- ships the full AGPL-3.0 text as `LICENSE` (copied from `services/nostr-pod-bridge/LICENSE`) in place of `LICENSE-MIT`/`LICENSE-APACHE`;
- states in its README that it is **not** dual-licensed and accepts contributions under AGPL-3.0-only;
- sets `meta.license = licenses.agpl3Only` in `lib/dream-engine.nix`.

It joins `nostr-pod-bridge` as the second linked-AGPL exception; `secret-backup` remains AGPL by choice. `services/LICENSING-NOTICE.md` and `docs/developer/licensing.md` are updated. The notice's per-directory table also gained the missing `explainer-tools` row, and its count is now ten manifests: seven permissive, three AGPL.

The gate needed no change: `scripts/ci/check-crate-licensing.sh` keys on each manifest's declared licence (rule 3: an AGPL crate must ship the AGPL `LICENSE`, a README saying AGPL-3.0-only and "not dual-licensed", and no permissive texts), not on a fixed crate list. Result: `grep -h '^license' services/*/Cargo.toml | sort | uniq -c` → 3 `AGPL-3.0-only`, 7 `MIT OR Apache-2.0`; `sh scripts/ci/check-crate-licensing.sh` → `OK (check-crate-licensing): 10 services/ package directories carry the texts they declare.`

Verified at `7f1cdaaad68fac7681cec1e510765f979037aee1` (`verified_commit`): gate and licence counts as above; `cargo test` in `services/dream-engine` passes 212 and `cargo clippy --all-targets -- -D warnings` is clean with `nostr-bbs-core` as a normal dependency.

## Re-verification — 2026-09-26 (`4f9450ac86477bc3832933953454ea577bd3d531`)

Tripped by `services/dream-engine/Cargo.toml` gaining `base64 = "0.22"` as a **dev-dependency** (test-only NIP-44 payload shape check in `src/zone_crypto.rs`; already in the lockfile transitively, MIT OR Apache-2.0). The crate's declared licence is unchanged (`AGPL-3.0-only`, `nostr-bbs-core` linked); `sh scripts/ci/check-crate-licensing.sh` → `OK … 10 services/ package directories carry the texts they declare`. Decision unaffected.
