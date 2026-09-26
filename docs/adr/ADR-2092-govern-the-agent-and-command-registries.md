---
id: ADR-2092
title: Agents and slash-commands get the same manifest governance skills already have
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: a5d9ff5a93fa63862fb63a0424adaa4598fb4e41
verified_paths: [agents/registered-agents.txt, scripts/reconcile-agents.sh, scripts/reconcile-commands.sh, scripts/project-skill-roots.mjs, config/registered-commands.txt, config/entrypoint-unified.sh, flake.nix, tests/config/agent-reconcile.test.sh]
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
  `~/.claude/agents`, retires vendor dumps to a recoverable sidecar outside every scanned
  root (`~/.claude/agentbox-superseded/{agents,commands}/<root-key>/`, override
  `AGENTBOX_SUPERSEDED_DIR`; amended 2026-09-25 — the original in-root `.superseded/` was
  still loaded, because Claude Code scans agent and command roots recursively, dot-dirs
  included; a legacy in-root sidecar is migrated out on every run), and
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
`SKILL-DIRECTORY.md`, and every retired agent or command under
`~/.claude/agentbox-superseded/`.

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
the out-of-root sidecar. Pruning is disabled outright when a manifest cannot be read, so a
transient read error cannot empty a root. Both scripts are idempotent, fail-open, and
covered by `tests/config/agent-reconcile.test.sh` (45 assertions, including sidecar
outside every root and legacy-sidecar migration).

**Revisit when** a subagent earns always-loaded status, or if measurement shows the router
surfaces a demoted skill too slowly to be worth the saving.

## Alternatives rejected

**Keep the inherited set and trim descriptions.** Addresses the token cost and none of the
correctness problem; the divergent duplicates and the shadowing would remain.

**Delete the vendor dumps outright.** Simpler, and unrecoverable. The sidecar costs
disk that this estate has and buys a way back from a bad cull.

**Enumerate the overlay into the baked canonical set.** Rejected in the original SK-2 work
for a reason that still holds: the `aqe init` fleet is legitimately project-scoped, and
baking it would couple the image to one project's QE choices. The allowlist keeps the
overlay supported without that coupling.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by `config/entrypoint-unified.sh` alone (`0950527d3`, ADR-2093); the seven other governed paths are unchanged. Re-established at `HEAD`: the agent reconciler runs with the manifest, the baked tree and both secondary roots (`config/entrypoint-unified.sh:2585-2593`, `REGISTERED_AGENTS_MANIFEST=…/registered-agents.txt`, `AGENT_ROOT_TARGETS` collapsing `$WORKSPACE/.claude/agents` and `$WORKSPACE/project/.claude/agents`), and the prune-only command reconciler follows it over three roots (`:2603-2609`). `bash tests/config/agent-reconcile.test.sh` in a clean worktree at `HEAD` → **26 passed, 0 failed**, including "every registered agent is baked". Claim STILL TRUE.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by `config/entrypoint-unified.sh` alone (`b680a7ae`, ADR-2094); the seven other governed paths — the two registration manifests, the three reconcilers, `flake.nix` and `tests/config/agent-reconcile.test.sh` — are unchanged since the previous anchor. ADR-2094's entrypoint edits are additive and sit before the reconciliation block. Re-read at HEAD in a detached worktree: `:2620` `project-skill-roots.mjs`, `:2643` `reconcile-agents.sh` and `:2661` `reconcile-commands.sh` are still invoked from `/opt/agentbox/scripts`, in that order, at boot. `bash -n config/entrypoint-unified.sh` → clean. The registered set is still the 12 named in the Decision, and no new agent or command root is introduced by the SSO work. Claim STILL TRUE.

### Re-verified 2026-09-21 at 6669e9f3b22af1e2b651037cf39a4a551a346d3f

One governed path moved, `config/entrypoint-unified.sh`, in a COMMENT-ONLY hunk: `git diff 1639f86ab..6669e9f3b -- config/entrypoint-unified.sh` is 6 insertions and 1 deletion, all of them `#` lines. The ShellCheck directive above the jev-compaction plugin install carried its rationale inside the directive, which SC1125 rejects and which made ShellCheck ignore the whole directive; the rationale is now a separate comment above a bare `# shellcheck disable=SC2086`. No executable line changed anywhere in the file, and the shell ignores comments, so runtime behaviour is byte-identical. The agent and command reconciliation calls in the entrypoint are unchanged, as are registered-agents.txt, registered-commands.txt and the reconcile scripts. Claim STILL TRUE.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `config/entrypoint-unified.sh`: exports `VAULT_REPO` (from `[vault].repo`, else derived from `VAULT_ROOT`; empty when unresolvable so the management API fails closed) and adds it to the vault-disabled `unset` list. Nothing else in boot order, gating or service start changed. `flake.nix`: statix lint only — assignment→`inherit` (with `or` defaults preserved as `inherit ({ defaults } // cfg)`), redundant parentheses dropped, `(x or false) == true` rewritten as `let v = x or false; in builtins.isBool v && v` (same result for every input), and one comment reworded ("logseq corpus" → "vault corpus"). No derivation, port, service, gate or package changed. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Confirms the in-place amendment of 2026-09-25.** The Decision bullet on `reconcile-agents.sh` was edited in place (see its bracketed "amended 2026-09-25"), not superseded. The authority is ADR-2111 D1, and the change is recorded there. The code matches the amended text. `SUPERSEDED_BASE="${AGENTBOX_SUPERSEDED_DIR:-…/agentbox-superseded}"` is at `scripts/reconcile-agents.sh:52` and `scripts/reconcile-commands.sh:33`. Retired files land under `<base>/{agents,commands}/<root-key>/`. A legacy in-root `.superseded/` is migrated out on every run (`reconcile-agents.sh:109`, `reconcile-commands.sh:69-107`): identical copies are dropped, a differing copy is kept as `.migrated-N`, and a copy that cannot be migrated is pruned from the scan. The registered agent set is still 12. Other governed changes are orthogonal: `flake.nix` (tmpfs, closure rehashes, Transformers, jupyter tests), and the `config/entrypoint-unified.sh` blocks for other records. One of those extends this record's registry model to hooks: `config/registered-hooks.txt` + `agentbox-manifest hooks-reconcile` (ADR-2111 D3), which runs after every hook registration. `bash tests/config/agent-reconcile.test.sh` → 45 passed, 0 failed. Claim STILL TRUE as amended.
