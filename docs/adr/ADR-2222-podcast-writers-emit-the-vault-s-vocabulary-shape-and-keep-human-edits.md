---
id: ADR-2222
title: The podcast writers emit the vault's vocabulary shape and keep human edits
date: 2026-11-25
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e98d2c69a9ef9fdef4a1b3d9ce4bfd053911f9c0
verified_paths: [services/podcast-ingest/src]
owner: jjohare
review_trigger: a change to visionGraph ADR-VG-010 to -013, a vocabulary version 4, a second human principal in the roster, or the writers moving onto `ontomark memory create`
repo: agentbox
evidence_class: source+test
acceptance_boundary: Unit tests (224, with the real ontomark for body normalisation) and a scratch-vault run in which the real writers' ledger, Brief and Proposal pass a vocabulary-3 ontomark build's `validate --vault all` and `repair bodies --check` with 0 errors, and the vocabulary-2 shape passes ontomark 0.9.0 the same way. Not run against the real visionGraph vault or a real weekly run, and not against a published vocabulary-3 ontomark release. The scheduled runs execute the binary baked into the image, so nothing here takes effect until the operator rebuilds the image.
guard: [services/podcast-ingest/src/common/vault_shape.rs, services/podcast-ingest/src/promote/working_page.rs#an_edit_inside_the_generated_text_is_never_overwritten]
---

# ADR-2222 — The podcast writers emit the vault's vocabulary shape and keep human edits

## Context
visionGraph vocabulary 3 (ADR-VG-010 to -013) changes every page header the weekly podcast stages write: ledgers become `Episode`s with typed sources and a principal/instrument stamp, topic pages become `Brief`s that pin the ledgers they summarise, new-page proposals become `Proposal`s. The vault migrates in one commit, so for a while one binary must serve a vault on either vocabulary. Separately, a refresh rewrote the whole body of an owned page, so a person's edit was lost on the next weekly run.

## Decision
- **One chooser.** `common::vault_shape::VaultShape::detect` reads `ontology/vocabulary.yaml` `version` from the vault above the working directory: 3 or higher is the vocabulary-3 shape, lower or no file is the vocabulary-2 shape. There is no flag or environment variable. An unreadable vocabulary, or a version-3 vault without exactly one `kind: human` entry under `principals:` in `ontology/attribution.yaml`, fails the write; nothing falls back.
- **Stamps.** `generated.by` is that human principal, `generated.via` the process (`process:podcast-ingest/<v>` or `process:podcast-promote/<v>`), per ADR-VG-011 §1 and ADR-VG-012 §1/§6. A process or swarm key is never `by`. The writers never write `verified`, an approval or a confirmation. The first `generated` stamp is kept and each later write appends one `contributors` entry. A new ledger is `status: draft`: creating a memory as `approved` is an approval (ADR-VG-013 §1). Appending to an `approved` ledger returns it to `draft`; a terminal ledger is not appended to.
- **Identity.** `page_resource` is `urn:visionflow:page:` plus SHA-256 of `visionflow:page:working:<id>`, `<id>` being the page's path under `working/` without `.md` (migration m0002's rule). It comes from the episode slug or topic file name, so a re-run mints nothing new; an existing page keeps its own.
- **Pins and evidence.** A Brief cites each ledger `rel: derived-from` with `locator: sha256-v1:<digest>`, the digest computed by `ontomark review-binding` on a scratch copy. A Proposal cites ledgers `rel: evidence` with `fp:` locators, only for claims the ledger carries.
- **Human edits.** The generated body ends with `<!-- podcast-promote: body sha256:<hex> -->` over the text above it. A refresh keeps everything below the marker, regenerates the text above only while it still matches, and otherwise leaves the page untouched and says so. A page with no marker (all 110 existing stage pages) is likewise left untouched unless the run has `--adopt-unmarked-pages`.

## Consequences
- The 110 existing topic pages carry no marker, so after the image is rebuilt the weekly stage refreshes none of them until the operator runs once with `--adopt-unmarked-pages`; new topics and adopted pages are protected from then on.
- A ledger with no recording URL or date is not written under vocabulary 3, because an Episode requires both; the assertions stay unrecorded and are retried next run.
- The pin shells out to the same `ontomark` the body normaliser already needs, so the image must bake a vocabulary-3 capable release; the digest was checked identical under 0.9.0 and the pre-release build.
- A page the vault migration has not reached is left for the migration, not half-converted.
- `page_resource` follows the path: a page renamed away keeps its id, and a new page later written at the old path would mint the same id (`DUPLICATE_PAGE_RESOURCE`); rename edge, not handled.
- A refresh run counts pages left untouched (edited, unmarked, foreign) apart from pages written, so a run that refreshed nothing says so.
- The ledger writer no longer separates bullets with blank lines (which failed `repair bodies --check` for any ledger with two claims).

## Verification
`cargo test --offline -- --include-ignored` in `services/podcast-ingest` (226 passed); `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings`. `PODCAST_SAMPLE_VAULT=<root> cargo test --lib -- --ignored sample_vault` writes one page of each kind, then `ontomark validate --vault all` and `repair bodies --vault all --check` on the root. The hash of the first code commit is `06de5a044`.

## Note — 2026-11-25: the vocabulary-3 ontomark pin has landed in source

The Consequences line "the image must bake a vocabulary-3 capable release" is met in source: `lib/ontomark.nix` pins Ontomark 0.10.0 (`baad4cdc1`). The release binary digest was checked against the release's `.sha256` asset. The image has not been rebuilt from it, so a running container may still carry 0.9.0, and `run-promote.sh` refuses an older `podcast-promote` independently. ADR-2136 carries the pin's verification state. This record's `verified_paths` (`services/podcast-ingest/src`) are unchanged, so `verified_commit` stays.
