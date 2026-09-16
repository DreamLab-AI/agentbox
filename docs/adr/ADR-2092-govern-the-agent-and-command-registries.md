---
id: ADR-2092
title: Agents and slash-commands get the same manifest governance skills already have
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: pending-rebuild
supersedes: []
superseded_by: []
verified_commit: 03a3b13b5135768a28332e346dbe577cf8a8662d
verified_paths:
  - agents/registered-agents.txt
  - scripts/reconcile-agents.sh
  - scripts/reconcile-commands.sh
  - scripts/project-skill-roots.mjs
  - config/registered-commands.txt
  - config/entrypoint-unified.sh
  - flake.nix
  - tests/config/agent-reconcile.test.sh
owner: jjohare
review_trigger: a new subagent worth always-loading, or evidence the router surfaces baked-but-unregistered skills too slowly
repo: agentbox
---

# ADR-2092 — Agents and slash-commands get the same manifest governance skills already have

## Context

ADR-2083 and the SK-1/SK-2 work gave *skills* a governed pipeline: one canonical baked
tree (`/opt/agentbox/skills`), a curated manifest (`registered-skills.txt`), a boot
reconciler that projects the manifest into `~/.claude/skills`, and a projector that
collapses the ancestor roots. The stated reason was budgetary: the native skill list sits
in context on every turn, so the always-loaded set is kept small and everything else is
reached through the router.

**Agents and commands never got any of that.** `ruflo init` (`@claude-flow/cli`) and
`aqe init --auto` each dump their template sets into `$HOME/.claude/agents` and
`$HOME/.claude/commands`; when init runs from a nested CWD a second copy lands under
`$WORKSPACE/.claude/`. `~/.claude` is a host mount, so every dump survives every
rebuild, and nothing refreshed, deduplicated or removed them.

Audit, 2026-09-16, of the live container:

| Block | Measured | Prompt cost |
|---|---|---|
| Agent registry | 97 unique agents across 2 roots | 26,151 chars ≈ **6,540 tok/turn** |
| Command registry | 244 files, 225 with no `description:` | 7,663 chars ≈ **1,915 tok/turn** |
| Ancestor skill root | 26 skills, **0** of them registered | 9,510 chars ≈ **2,377 tok/turn** |

Three findings, in descending order of seriousness.

**1. Divergent duplicates, with the wrong copy winning.** 74 of the 97 agents existed in
both roots; only 37 were byte-identical. The Agent tool reads the nearest root, so the
nested copy shadows the user copy — and the nested copies were the *older, truncated*
ones. `collective-intelligence-coordinator` was served at 3,854 bytes while a 31,403-byte
revision sat unused one directory up; `adaptive-coordinator` 15,744 against 36,250. This
is a correctness defect, not a budget one: the agent that ran was not the agent that had
been written.

**2. The registry is inherited, not chosen.** 63 of 97 agents carry V2 claude-flow hook
theatre (`echo "🐝 …"`, `npx claude-flow hooks pre-task`, `ruv-swarm`); 9 are
`flow-nexus-*` against an account this estate does not have; 13 `github-*` agents
duplicate the `github-*` skills; the SPARC agents duplicate `sparc-methodology`. Only 9
agents were free of legacy markers. None had been reviewed against current subagent
practice — a precise trigger description, an explicit tool restriction, no orchestration
boilerplate — and built-in agents (Explore, Plan, general-purpose) already cover generic
search, planning and catch-all work.

**3. The skills manifest was being bypassed on the ancestor roots.**
`project-skill-roots.mjs` only ever *repaired* what it found: an entry whose name happened
to be baked was freshened to a canonical link and kept, registered or not. So
`registered-skills.txt` governed `~/.claude/skills` and nothing governed the roots the
Skill tool reads from a nested CWD. Those carried 26 unregistered skills — three
`flow-nexus-*`, one whose own description opens `DEPRECATED`, one superseded by
`build-with-quality` — all live in the prompt.

## Decision

Give agents and commands the governance skills already have, and close the leak on the
skill side.

- **`agents/`** is the canonical subagent tree, baked to `/opt/agentbox/agents`.
  **`agents/registered-agents.txt`** is the single source of truth for registration.
- **`scripts/reconcile-agents.sh`** runs at boot: links the registered set into
  `~/.claude/agents`, retires vendor dumps to a recoverable `.superseded/` sidecar, and
  collapses the secondary roots so the visible set no longer depends on launch directory.
- **`config/registered-commands.txt`** + **`scripts/reconcile-commands.sh`** do the same
  for slash-commands, prune-only (commands are installed by their owning subsystem, so
  there is nothing to project). The operator does not invoke them; `dream.md` is kept.
- **`project-skill-roots.mjs`** now mirrors the *registered* set into the ancestor roots.
  Unregistered entries are retired unless named in the new **`skills/overlay-skills.txt`**
  allowlist — which turns the project-local overlay from "whatever is on disk" into a
  decision, the thing the original design decision wanted and could not enforce.

The registered agent set is **12**, rewritten rather than inherited: `code-reviewer`,
`test-engineer`, `security-reviewer`, `rust-engineer`, `system-architect`,
`performance-engineer`, `memory-curator`, `adr-architect`, `ontology-curator`,
`harness-janitor`, `nix-image-engineer`, `auto-consultant`. Each merges a family of the
old set, carries an explicit `tools:` restriction, and encodes estate rules that were
previously only in `CLAUDE.md` prose (RuVector's 512-token embed cap and serial-HNSW
index law; the never-hand-roll-crypto rule; the do-not-build-from-inside-the-container
rule).

Everything retired stays reachable: baked-but-unregistered skills through the router and
`SKILL-DIRECTORY.md`, and every retired file under `.superseded/`.

## Consequences

**Cost.** The always-loaded custom registry falls from ≈10,832 to ≈1,273 tokens per turn
(agents 6,540→1,273; commands 1,915→~15; ancestor skill root 2,377→0) — about **9,500
tokens a turn**, on every turn, cached.

**Correctness.** One agent root, one definition per name. The shadowing class is gone, and
a rebuild now refreshes agents the way it already refreshed skills — the reconciler links
to the baked tree rather than leaving a host-mount snapshot to rot.

**What this makes harder.** Adding a subagent is now a repo change plus a rebuild, not a
file dropped in `~/.claude/agents`. That is the intended trade: the previous cost of
adding one was zero, which is precisely how 97 accumulated. Hand-written agents placed
flat in the root with no vendor marker are still preserved and reported, so the escape
hatch survives for experiments.

**Risk accepted.** The reconcilers delete nothing — every retirement is a move into
`.superseded/`. Pruning is disabled outright when a manifest cannot be read, so a
transient read error cannot empty a root. Both scripts are idempotent, fail-open, and
covered by `tests/config/agent-reconcile.test.sh` (26 assertions).

**Revisit when** a subagent earns always-loaded status, or if measurement shows the router
surfaces a demoted skill too slowly to be worth the saving.

## Alternatives rejected

**Keep the inherited set and trim descriptions.** Addresses the token cost and none of the
correctness problem; the divergent duplicates and the shadowing would remain.

**Delete the vendor dumps outright.** Simpler, and unrecoverable. `.superseded/` costs
disk that this estate has and buys a way back from a bad cull.

**Enumerate the overlay into the baked canonical set.** Rejected in the original SK-2 work
for a reason that still holds: the `aqe init` fleet is legitimately project-scoped, and
baking it would couple the image to one project's QE choices. The allowlist keeps the
overlay supported without that coupling.
