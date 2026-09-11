---
id: ADR-2019
title: Model-lifecycle freeze — 384-dim bge is the active column, SONA and attention-rerank stay off
date: 2026-08-31
decision_status: accepted
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: ee742ade57ddca06ba846676e6006171ec76c49d
verified_paths: [mcp/servers/lib/aggregate-effectiveness.js, scripts/ruvector-sona-feeder.mjs, agentbox.toml]
owner: jjohare
review_trigger: A SONA binary with configurable embedding_dim (384-capable) ships, or a dimension migration is planned
repo: agentbox
domain: LEARNING-memory
lineage: "legacy PRD-020 / ADR-040 (model lifecycle), DDD-018 (I22)."
---

# ADR-2019 — Model-lifecycle freeze — 384-dim bge is the active column, SONA and attention-rerank stay off

## Context
The active embedding column is bge-small-en-v1.5 at 384-dim. Two learning
enhancements were built or trialled and both are inert at 384-dim: the prebuilt
`@ruvector/sona@0.1.5` NAPI binary hardcodes `embedding_dim=256` and accumulates
nothing on 384-dim learns (verified live); attention-rerank was measured on
2026-07-21 as `cos/sqrt(384)` on the L2-normalised corpus — an identity blend,
max diff ~4e-7. A dimension migration would reuse a stale SONA scope and silently
decouple the learn side from apply (DDD-018 I22).

## Decision
The embedding model is locked to bge-small-en-v1.5 / 384-dim as the sole active
column. `sona_learn`/`sona_apply` stay **off** because the shipped binary cannot
accumulate at 384-dim; `attention_rerank` stays **off** as a measured no-op on the
L2-normalised corpus. Any future dimension migration must mint a **fresh SONA scope
string** — never reusing `'agentbox_memory'` across dimensions (I22). This
forecloses flipping SONA/attention on as cargo-cult "improvements" and forecloses a
dimension migration that silently poisons the SONA scope.

## Consequences
- No wasted compute or false confidence from an engine that discards 384-dim learns.
- SONA remains deliberately unbuilt at 384-dim; the feeder is proven but the gates
  stay sealed until a 384-dim-capable binary and a passing recall run (ADR-2018).
- A dimension migration is a scoped, deliberate operation, not a config flip.
- Cost: the potential upside of SONA/attention is forgone until the binary changes.

## Verification


implementation_status = none — SONA/attention are deliberately unbuilt at 384-dim.
At verified_commit cbe7335b9: `mcp/servers/lib/aggregate-effectiveness.js:48` sets
`EMBEDDING_DIM = 384`; `scripts/ruvector-sona-feeder.mjs:15-31,53-56` documents the
fixed 384-dim scope, the fresh-scope-on-migration I22 rule, and the 256-dim binary
no-accumulation finding, with `SONA_SCOPE = 'agentbox_memory'` and
`SONA_EMBEDDING_DIM = 384` at lines 128-129. `agentbox.toml:429-431` holds
`attention_rerank`, `sona_learn_enabled`, `sona_apply_enabled` all `false` with the
measured/blocked rationale. activation_status = inactive: gates stay sealed.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `fa024cc08` (pinned embedding identity + recall gate) and the ADR-2016 closeout rework of `mcp/servers/lib/aggregate-effectiveness.js` (+169/-15: attributability exclusions, independence de-duplication and a harder promotion floor). None of it touches the dimension freeze or the SONA/attention gates — the promotion statistics sit above the embedding column, not in it — so the decision still holds. Re-checked at HEAD: `mcp/servers/lib/aggregate-effectiveness.js:48` still sets `const EMBEDDING_DIM = 384` and enforces it at `:118-119` (a non-384 embedding is a hard `dimension mismatch` throw, not a coercion); `scripts/ruvector-sona-feeder.mjs:128-129` still holds `SONA_SCOPE = 'agentbox_memory'` and `SONA_EMBEDDING_DIM = 384` with the I22 fresh-scope-on-migration rule documented at `:27-28`; `agentbox.toml:431` `attention_rerank = false` ("MEASURED 2026-07-21 … blend is an identity, zero benefit"), `:432` `sona_learn_enabled = false` ("engine hardcodes embedding_dim=256; 384-dim learns accepted-but-discarded"), `:433` `sona_apply_enabled = false`. `implementation_status` stays `none` and `activation_status` `inactive` — the gates are still deliberately sealed, which is the decision, not a shortfall. Commands: `git diff --stat 89301ec7..HEAD -- mcp/servers/lib/aggregate-effectiveness.js agentbox.toml`, `grep -n 'EMBEDDING_DIM' mcp/servers/lib/aggregate-effectiveness.js`, `grep -n 'attention_rerank\|sona_learn_enabled\|sona_apply_enabled' agentbox.toml`.

## Closeout extension — 2026-09-04

Work packages: **CP-03/04/07/08**. Owner remains `jjohare`; memory and release maintainers own the cross-service acceptance boundary.

The entry point defaults to bge-small-en-v1.5 and validates 384 dimensions, but permits an EMBEDDING_MODEL override. The manifest keeps SONA and attention gates off; historical engine measurements were not rerun.

**Acceptance condition:** Verify the effective model identity and preprocessing in the deployed service, reject incompatible same-dimension changes, and require a new scoped evaluation/recall receipt before enabling learning or migrating geometry.

Dependencies: CP-01 release/model identity and the caller-authority contract. Reopen on model, write/fallback, TTL or retrieval changes. Historical verification fields are retained; this annex records source/mock evidence at `89301ec7c911eab270c00a0cf81596d0d4f15535`, not a new production or recall certification.

See the [shared-memory review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/shared-memory.md), [source/test receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/memory-snapshot.json) and [isolated probe](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/memory-store-probes.json).

### Re-verification 2026-09-05 (ADR-2019)

Verification ran on the **uncommitted working tree** above `89301ec7c911eab270c00a0cf81596d0d4f15535`.
`verified_commit` is set to that SHA and `verified_paths` emptied; **both must be
restored at the landing commit** — the prior list was
`[mcp/servers/lib/aggregate-effectiveness.js, scripts/ruvector-sona-feeder.mjs, agentbox.toml]`.

Each claim re-checked against the current tree:

- **384 is the active dimension.** `mcp/servers/lib/aggregate-effectiveness.js:48`
  `const EMBEDDING_DIM = 384;`, enforced at `:118-119` — a returned vector of any other
  length is rejected with `dimension mismatch: got N, expected 384`. Unchanged.
- **One fixed global SONA scope, 384-dim only.** `scripts/ruvector-sona-feeder.mjs:15-19`
  states the scope is the single string `agentbox_memory`, is the `table_name` argument to
  `ruvector_sona_learn`/`_apply`/`_stats`, is **384-dim only**, and that a future
  1024-dim migration mints a FRESH scope string, never reusing `agentbox_memory`. Unchanged.
- **Both SONA gates remain off, and why.** `agentbox.toml [memory_learning]`:
  `sona_learn_enabled = false` (`:432`, "engine hardcodes embedding_dim=256; 384-dim
  learns accepted-but-discarded"), `sona_apply_enabled = false` (`:433`),
  `sona_enabled = false` (`:419`, superseded, kept for back-compat). Unchanged.
- **`attention_rerank` is off by measurement, not caution.** `agentbox.toml:431` records
  `attention_score = cos/sqrt(384)` on an L2-normalised corpus, max diff 4e-7, "blend is
  an identity, zero benefit". Unchanged.
- No claim in this record drifted. The staleness was caused solely by unrelated
  uncommitted edits to `agentbox.toml`.

## Acceptance progress — 2026-09-05

**Implemented.** Dimension agreement is not compatibility, and the entry point
now says so in code. `mcp/servers/lib/embedding-identity.js` computes an
**effective model identity**: it embeds a frozen probe text and fingerprints the
4-decimal-quantised vector. That fingerprint is a property of the deployed model
and its preprocessing, not of the `EMBEDDING_MODEL` name — a renamed model, a
re-quantised checkpoint or a changed pooling strategy all move it, while a
restart of the same model does not. `config/embedding-identity.json` is the pin.
At MCP boot a mismatch against the pin is **fatal**; unpinned or unprobeable is
advisory, because the right posture is to refuse a known-bad identity, not to
invent a pin nobody agreed. A supervised migration must name the exact divergent
fingerprint in `RUVECTOR_EMBED_IDENTITY_OVERRIDE`; there is no boolean that means
"trust me".

**Tests and results.** Measured against the live Xinference at
`${EMBEDDINGS_HOST}`: `bge-small-en-v1.5`, 384 dimensions, fingerprint
`emb1-384-cd25d147dcb748fd`, **identical across three probes in two processes** —
which is what makes it usable as a gate rather than a source of false alarms. The
pin verdict is `accepted`. The identity is also carried into every recall receipt
(ADR-2018), so a recall number is bound to the model that produced it.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2019-embedding-identity.json`, and the
`bound_to.model` block of `adr-2018-recall-receipt.json`.

**Governed paths changed.** `mcp/servers/lib/embedding-identity.js` (new),
`config/embedding-identity.json` (new), `mcp/servers/ruvector-mcp.cjs`.

**Remaining.** The pin was frozen from what is *currently deployed* rather than
from an independent statement of what *should* be. Migrating geometry still
requires a corpus re-embed plus a passing recall receipt before the pin moves —
that sequence is documented and gate-checked, not automated. Preprocessing beyond
the 2,000-character embed prefix is captured only through its effect on the
fingerprint.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: agentbox.toml: a new `[skills.podcast_ingest]` section (ADR-2057) only; every section this record governs is untouched. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: agentbox.toml. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.

### 2026-09-07 documentation and workflow pin re-verification

The governed manifest diff at `7bf2382c031d696b0b2f5eb466f7e6615c88cc2c`
adds only two comments distinguishing the consultant wire alias from the documented
weight variant. The invariants workflow replaces action version tags with exact
commit pins and retains the same checks. Neither diff changes this decision’s
runtime behaviour; existing implementation and activation qualifications remain.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): agentbox.toml. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff 7bf2382c0..ee742ade5 -- <verified_paths>`; no re-implementation was needed.
