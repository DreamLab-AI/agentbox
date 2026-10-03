---
id: ADR-2092
title: Agents and slash-commands get the same manifest governance skills already have
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 32cedf9925ff6de8112fb45e41de048106d0d710
verified_paths: [agents/registered-agents.txt, scripts/reconcile-agents.sh, scripts/reconcile-commands.sh, scripts/project-skill-roots.mjs, config/registered-commands.txt, config/entrypoint-unified.sh, flake.nix, tests/config/agent-reconcile.test.sh]
owner: jjohare
review_trigger: a new subagent worth always-loading, or evidence the router surfaces baked-but-unregistered skills too slowly
repo: agentbox
---

# ADR-2092 — Agents and slash-commands get the same manifest governance skills already have

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `config/entrypoint-unified.sh` changes only inside the compaction section (install/uninstall factrail, store migration, key projection); `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (dependency refresh)

No registered agent or command set changes. Stale cargo executables are moved to a recoverable directory rather than shadowing baked tools; numbered backups preserve earlier quarantines. Agent reconciliation passes 45/45 and skill lint passes.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

Volume-identity correction at `efdb79475`: already-prefixed names are retained by the generator. The new resolved-Compose test passes for 15 persistent volume identities, the external Claude home, read-only instructions and PID parity. This changes no service authorization or published ports.

Packaging follow-up at `fc8ba7a7b`: the config copy now filters out mount-only instruction layers. Rechecked the changed Nix expression; it does not alter this record's runtime gates, auth commands or port inventory. The local test evidence below remains applicable.

The manifest-driven root reconciliation still uses registered-agents.txt and the baked scripts. All 45 agent/command/root reconciliation assertions pass, and instruction-layer privacy checks pass 9/9. State now persists in the container-owned Claude-home volume; the registry policy is unchanged. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

The Nix additions introduce only sidechain packaging/supervision, not agent or command registration changes. Reconciliation tests pass 45/45 and skill lint passes.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context

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

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. No agent or command registry baking changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). The agent and command reconcilers are untouched. They run in Stage B, now one-shot per start, and a restart re-runs them. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on. `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`).
Agent and command registry governance is untouched. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`32cedf9925ff6de8112fb45e41de048106d0d710`, custody integration CI fix)

Tripped by `32cedf992`, the fix for the PR's clippy and statix failures. `flake.nix` changes by one line in the `[sidechain.*]` normaliser: `parent = c.parent;` becomes `inherit (c) parent;` (statix W04), which evaluates to the same attribute set. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..32cedf992 -- <verified_paths>`.
