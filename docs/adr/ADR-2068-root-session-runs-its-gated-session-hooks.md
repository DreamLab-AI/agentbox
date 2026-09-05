---
id: ADR-2068
title: A session-boundary gate binds every session class, root included, and retracts itself when off
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: a new session-boundary hook is added, or a hook is registered in one session class but not the other
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2020 (byte-identical-when-off), legacy ADR-011/PRD-014 (governed ontology elevation)
---

# ADR-2068 — A session-boundary gate binds every session class, root included, and retracts itself when off

## Context

`agentbox.toml [ontology_monitor] enabled = true`, and
`services/agentbox-manifest/src/stacks.rs` (`learning_hooks()`) duly wires
`config/hooks/ontology-monitor.cjs` into `SessionEnd` — but only for
**per-profile** sessions under `workspace/profiles/<stack>/.claude/`. The **root**
session (`~/.claude/settings.json`: tmux window 0 and every unattended teammate
pane, where most concept-bearing work happens) had no such entry, and no
`AGENTBOX_ONTOLOGY_MONITOR` master switch, so the hook would have been a no-op
there even if registered. The manifest read "on" while the busiest session class
never ran the review. There are two independent registration sites for two
session classes and nothing forced them to agree.

## Decision

A manifest gate that names a session-boundary hook binds **every** session class
the box runs, not whichever one its author happened to wire. Concretely:

1. Root-session registration for a gated hook is seeded at boot in
   `config/entrypoint-unified.sh`, reading the gate through
   `agentbox-manifest toml-bool` / `toml-string` — never a hard-coded default.
2. Registration seeds whatever runtime environment the hook needs to be more
   than a no-op (here `AGENTBOX_ONTOLOGY_MONITOR` and `..._MODE`), matching the
   per-profile projection in `stacks.rs`.
3. The **off** path is not "skip"; it is **retract**. Gate off removes any
   registration and env an earlier on-boot wrote, and creates no keys, so
   `settings.json` returns to its pre-gate bytes (ADR-2020
   byte-identical-when-off). `settings.json` persists on the workspace volume, so
   skip-on-off would leave a live hook behind after `enabled = false`.
4. `config/hooks/README.md` is the inventory of which file is a hook in which
   session class, and which files are CLIs. A new hook adds its row there.

## Consequences

- Flipping `[ontology_monitor].enabled` now changes both session classes and is
  genuinely reversible without hand-editing `settings.json`.
- Retract-on-off is the general shape for every settings-seeding block; the
  `trajectory-recorder` block already had it, the others still only add. That is
  the follow-on work this ADR does not do.
- Cost: two registration sites still exist (entrypoint for root, `stacks.rs` for
  profiles) and must be changed together. Making one own both is a larger
  refactor; the README table is the interim guard.
- Activation is staged: the entrypoint change takes effect at the next container
  boot, not live.

## Verification

At `e070514d808b218574403377fb75e0e1a0a256b3` plus this change:
`bash -n config/entrypoint-unified.sh` passes. The block's embedded Node script
was extracted and exercised against a fixture of the live root `settings.json`
shape, five cases, all passing: gate on registers the hook and seeds both env
keys without mutating the pre-existing `SessionEnd` group; a second run is
byte-identical (idempotent); gate off retracts hook **and** env and restores the
original bytes exactly; gate off against a `settings.json` that never had the
hook creates no keys; the mode string is honoured. The third case initially
failed — the off path left an empty `env: {}` behind — and the code was fixed to
delete an emptied `env` map before the case passed.
