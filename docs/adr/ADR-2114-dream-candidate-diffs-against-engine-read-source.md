---
id: ADR-2114
title: Dream candidate diffs are written against source the engine reads from the dispatched commit
date: 2026-09-25
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 3bb96e5264e8e912b4aebb00de10cb45648e1eb5
verified_paths: [services/dream-engine/src/source.rs, services/dream-engine/src/compile.rs, services/dream-engine/src/persist.rs, services/dream-engine/src/candidate.rs, services/dream-engine/src/engine.rs]
owner: jjohare
review_trigger: the dream engine gaining a tool-using (agentic) model call, or a month of nights in which repair.json records more NO-PATCH/absent outcomes than recovered patches
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: amends legacy ADR-061 (dream ACCEPT persisted as a draft PR — the typed ```dream-patch contract); builds on ADR-2024 (evidence-gated acceptance) and ADR-070 (self-GC evidence governance)
---

# ADR-2114 — Dream candidate diffs are written against source the engine reads from the dispatched commit

## Context
ADR-061 made an ACCEPT night emit its change as a ```dream-patch unified diff, which ADR-2024's gate applies and re-evaluates.
The nightly model is one chat completion (`llm.rs`) with no tools. It received evaluator receipts but **no source text**. The prompt, written for an agent, also told it to run evaluators, build the candidate, publish gists and append the ledger.
The model could not write a diff against code it had never seen. From the dream inbox, between 2026-09-07 and 2026-09-21:
- **12 nights** declared ACCEPT with no dream-patch block (`CandidateState::NoPatch`), across dreamlab-ai-website, nostr-rust-forum, VisionFlow, dream-machine and campaignbuilder;
- **2 nights** emitted a patch that did not apply (`DidNotApply`).

The resulting INCONCLUSIVE dry streaks parked the whole roster, and every night from 2026-09-22 ran with zero eligible repos.

## Decision
1. **The engine supplies the source.** Before the main call, a bounded source-planner completion names at most `DREAM_SOURCE_MAX_FILES` (12) files, optionally with line ranges. Paths the evidence mentions verbatim are added deterministically.
   - Every path must be relative, contain no `..`, be tracked at the dispatched commit, and fall outside the secret denylist (`.env*`, `*secret*`, `*credential*`, key and keystore files).
   - Text is read with `git show <commit>:<path>` from the **same commit** that is archived to the annexe and used as the candidate worktree's base, so the text the model sees is byte-identical to the baseline its diff is applied to.
   - Files are clipped head and tail with an explicit elision marker, within `DREAM_SOURCE_BUDGET` (60 000 B) and `DREAM_SOURCE_FILE_CAP` (16 000 B).
   - The section is appended as `## Source (from <commit>)` and receipted in `<night>/source.json`. The stage is fail-open.
2. **The prompt describes a single completion.** The engine runs evaluators, writes the ledger and opens draft PRs. The model analyses the evidence, freezes a hypothesis, writes the diff and proposes a ledger row whose finding cell the engine takes. It is never asked to run, publish or persist anything. An ACCEPT without a diff is stated to be vetoed.
3. **One repair pass.** A strict ACCEPT with no dream-patch block gets exactly one follow-up completion asking for the diff alone or `NO-PATCH: <reason>`, recorded in `<night>/repair.json`. The report and its VERDICT line are not rewritten. If no diff comes back, the existing NoPatch veto stands.
4. **Tolerant apply.** `git apply` is tried in this order: plain, `--recount`, `--recount --ignore-whitespace`, then `--3way` (only when the diff names real blob ids). A final failure carries the last strategy's stderr.

## Consequences
- The ADR-061 fence and the ADR-2024 gate are unchanged. This ADR only closes the information gap in front of them and adds one bounded retry, so no acceptance is easier to reach than before: every candidate is still re-run against the required evaluators.
- Each night costs up to two extra completions: the source planner always runs, and the repair pass runs only on an ACCEPT without a diff. The prompt grows by up to about 60 KB of source.
- Source text leaves the LAN when the provider is external (Z.AI). The denylist and the existing `redact` pass apply. A repo whose source must not leave the LAN should run with `DREAM_SOURCE_READ=0` or on the Loom.
- Standby is not lifted automatically. After deploy, repos are revived with `/dream revive`. `repair.json` and `source.json` then show whether NoPatch nights stop.

## Verification
At `verified_commit`, `cargo test` in `services/dream-engine` passes 189 tests, including:
- `source::tests` (path validation, denylist, plan parsing, mention extraction, index, slicing and clipping, section budget, repair trigger and classification, blob read at a commit rather than the worktree);
- `persist::tests` (apply order, `--recount` landing a miscounted hunk, last-strategy detail, worktree pinned to an older base);
- `compile::tests` (no agent-only steps, and a proposed ledger row that parses as a ledger row).

`cargo clippy --all-targets -- -D warnings` is clean. No live night has run yet; activation stays `staged` until one has.

## Amendment — 2026-09-25 (`ef7a8c09d`)

Two guards added before landing, from the agentbox-3d session's parallel excerpts work:

- **Key material is withheld, not redacted.** `source::has_secret_content` drops a whole file from the source section when it holds a PEM private key, an `nsec1` bech32 secret (58+ data chars) or a 64-hex run on a key-named line; the receipt records `withheld-key-material`. Name-based denial cannot see a secret inside an ordinary-looking fixture or doc, and the engine's `redact` only rewrites home paths.
- **Binary deletions are refused.** `persist::deletes_binary` rejects a candidate that deletes a binary file before it is applied; the gate records the new `CandidateState::Refused` as an *unproven* veto (a model fault), never as a harness fault, so it cannot masquerade as BLOCKED-ENV. The prompt states the rule.
