---
id: ADR-2052
title: Cite agentbox.toml by section and key, never by line number
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a governing doc or ADR reintroducing a bare agentbox.toml line-number citation, or the arrival of a CI citation checker
repo: agentbox
domain: LEARNING-memory
lineage: ADR-2014, ADR-2017, ADR-2018, ADR-2023, ADR-2024 (all carry drifted agentbox.toml line citations)
---

# ADR-2052 — Cite agentbox.toml by section and key, never by line number

## Context

`agentbox.toml` is the running configuration and is edited constantly, so every
line-number citation into it rots. Phase 1 found the rot is total, not occasional —
**every** checked citation had drifted:

- `docs/LEARNING-memory.md` cites `feed_retrieval`/`feed_routing` at `:415-416`,
  the sample floor at `:425`, the half-life at `:426`, `aggregate_sweep` at `:427`/`:432`,
  `pattern_distillation` at `:428`, the sona keys at `:429-431`. The live keys are at
  `:417`, `:418`, `:415`, `:416`, `:428`, `:429`, `:430`, `:432-434`.
- `docs/GOVERNANCE-capabilities.md` and ADR-2023 cite `loom_url`/`loom_model`/
  `loom_max_tokens` at `:1564-1566` with `loom_max_tokens = 16384`; the live values are
  `:1613`, `:1614` and `:1618`, and the cap is now `32768`.
- ADR-2024 cites `[dream_machine]` at `:1560-1595`; it is at `:1609`.
- `GOVERNANCE-capabilities` cites the AoE Loom session seeds at `:1231`/`:1238`; they are
  at `:1259`/`:1266`.

Exposed by diagrams AB-21.10, AB-24.7 and AB-23.2. A drifted citation is worse than no
citation: it sends a reader to an unrelated key and looks authoritative doing it.

## Decision

Prose in the governing docs and in ADR bodies cites `agentbox.toml` as
`agentbox.toml [section].key` — a stable address that survives every edit that does not
rename the key. A line number may be appended only as a convenience alongside the key
(`[memory_learning].feed_retrieval, currently :417`), never as the sole address, and it
is never load-bearing for a reader.

Citations into **source files** keep `path:line`, because code lines move far less often
and the surrounding symbol name makes a stale line self-correcting. This decision is
about the manifest only.

Existing drifted citations in the LEARNING-memory and GOVERNANCE-capabilities sections
this lane owns are converted in the same change. Line citations already frozen inside a
ratified ADR's *Verification* section are left alone: they record what was true at that
ADR's `verified_commit` and are historical evidence, not navigation.

## Consequences

- Manifest citations stop rotting on the next `agentbox.toml` edit, which is the common
  case — the file changes far more often than the docs that cite it.
- A reader loses the ability to jump straight to a line; they grep for the key instead.
  That is the intended trade: `grep -n '^\[memory_learning\]' agentbox.toml` is one
  command and is always correct.
- Follow-on, routed to the manifest owner (ab-runtime): a CI check that greps the
  governing docs for `agentbox.toml:<digits>` and fails on a bare line citation would
  make this mechanical. It is not written here because `scripts/` is not this lane's
  to edit. Until it exists the rule is enforced by review.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- Live key positions established with
  `grep -n 'record_trajectories\|aggregate_min_samples\|recency_half_life_days\|feed_retrieval\|feed_routing\|aggregate_sweep\|pattern_distillation\|attention_rerank\|sona_learn_enabled\|param_tuning_enabled' agentbox.toml`
  → `[memory_learning]` block at `:412`, keys at `:413-420` and `:428-434`.
- `grep -n '^\[dream_machine\]' agentbox.toml` → `1609`.
- `grep -n -i 'loom' agentbox.toml` → `loom_url` `:1613`, `loom_model` `:1614`,
  `loom_max_tokens = 32768` `:1618`, condense `endpoint` `:649`, session seeds `:1259`
  and `:1266`.
- After the doc edits, `grep -nE 'agentbox\.toml:[0-9]+' docs/LEARNING-memory.md`
  returns no match in the sections this lane owns.
