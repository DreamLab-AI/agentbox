---
title: Agentbox Capability Governance
doc_id: AB-GOVERNANCE
version: 0.2.0
status: draft-for-ratification
verified_commit: cdc18cf53
changelog:
  - "0.2.0 (2026-09-02): ADR-2028 — skills read and write the authored corpus through VAULT_ROOT/VAULT_PAGES and emit V2 frontmatter; no skill hard-codes a corpus path."
  - "0.1.1 (2026-08-31): fix wrong verified_commit (was outer-repo hash), correct agentbox.toml citations (loom_url 1564, loom_model 1565, session-seed models 1231/1238), and update N-05 to the revised token-auth boundary."
sources:
  - agentbox.toml (loom façade 650/1564, loom_model 1565, session-seed models 1231/1238, N-05 1137-1146, skill gates 539/554/582/585/621-624, direct_axiom_load 638)
  - agentbox/skills/SKILL-DIRECTORY.md
  - agentbox/skills/lint-skills.sh
  - agentbox/skills/tree-search-coder/SKILL.md
  - agentbox/skills/dream-machine/SKILL.md
  - agentbox/dream.config.json
  - agentbox/services/dream-engine/
  - agentbox/mcp/servers/lib/ontology-retrieval.js
  - agentbox/mcp/mcp.json
  - agentbox/config/nip98-proxy/README.md
  - agentbox/docs/reference/adr/ADR-020, ADR-051, ADR-052, ADR-057, ADR-059
date: 2026-08-31
---

# Agentbox Capability Governance

## Purpose

Ground truth for what agentbox lets an agent *do* and what actually gates those actions
today. It exists because autonomy has outgrown its designed control plane: the two ADRs
that would enforce uniform governance are unbuilt, so this document names the real,
partial controls and the resulting top risk.

## Current state

### Capability surface (what an agent can do)

Agentbox grants an agent a broad, live action surface. Every one of these is enabled in
the manifest and reachable in a turn:

- **Tools / MCP** — a large MCP fleet (`mcp/mcp.json`), including code-execution
  (`code-interpreter`, ADR-018 kernel), the ACI shell (`[skills.aci_shell] enabled = true`,
  `agentbox.toml:582`) with `aci.edit_file` / `aci.run_tests` / `aci.submit`, and the
  Prime-substrate tools with **DID-owned recursive `spawn_child`** over the beads work-DAG
  (`mcp/mcp.json:197`).
- **Code-mode / CodeAct** — `[skills.code_interpreter] enabled = true` (`:539`) and
  `[skills.codeact] enabled = true` (`:554`): generate-and-execute reflect loops in a live
  kernel.
- **Shell** — ACI shell test execution is allowlisted (`test_command_allowlist`,
  `agentbox.toml:585`) but raw `Bash` remains available to the harness outside that allowlist.
- **Subagents / jobs** — typed recursive spawn (`spawn_child/spawn_ready/spawn_complete`),
  the beads durable work-DAG, and the nightly dream-engine (`[dream_machine] enabled = true`,
  `agentbox.toml`) which runs unattended repository evolution 01:00–05:00 UTC.
- **Tree-search-coder** — `[skills.tree_search_coder] enabled = true` (`:624`), N-candidate
  execution-gated generation.

These surfaces are governed today only by their *individual* boundary guards — hook guards,
per-MCP wrappers, the privacy filter, ACSP approvals, the spend policy, and harness-native
permissions. There is no single decision point they all cross.

### The two designed governors are PROPOSED, NOT BUILT

- **Execution journal (legacy ADR-057)** — a harness-neutral, replayable append-only record
  from which a turn can be reconstructed. Frontmatter `status: proposed`
  (`docs/reference/adr/ADR-057-...:4`). No implementation exists: a repo-wide search for
  `SessionEvent` / execution-journal code in `src/`, `services/`, `mcp/` returns nothing.
  Today's records (Claude hooks, Codex notifications, NIP-59 mirror, kind-30840 digests,
  OTel, domain receipts) remain disjoint and can disagree with no authoritative source.
- **Monotonic action-policy pipeline (legacy ADR-059)** — the invariant that *every*
  agent-initiated side effect crosses one policy decision point, with parent-token
  propagation into sub-calls and no later stage able to rewrite an earlier approval.
  Frontmatter `status: proposed` (`docs/reference/adr/ADR-059-...:4`). No pipeline code
  exists. The ADR itself names the exact bypasses that remain live: "a code-mode sub-call,
  plugin tool, consultant action, background job, or alternate harness path takes a
  different route."

**Acknowledged bypasses live today** (no uniform interceptor): direct tool calls vs
code-mode sub-calls; MCP plugin tools; consultant/subagent actions; background jobs
(dream-engine, beads); and alternate harness paths. Each is individually guarded; none is
guarded the same way; a post-hook can still rewrite what an earlier guard approved.

### Skills system

- **Directory** — `skills/SKILL-DIRECTORY.md` (912 lines) is the canonical index; skills
  self-trigger from their `description` frontmatter.
- **Lint gate** — `skills/lint-skills.sh` enforces estate hygiene and exits non-zero on any
  finding: banned stale strings (dead hosts like `192.168.2.48`, retired SDKs), absolute
  `~/.claude/skills` paths (skills are baked at `/opt/agentbox/skills`), the retired bare
  `/workspace/` path, monolith SKILL.md files (>250 lines with no `references/`), and
  frontmatter sanity (`name` + `description` present).
- **Manifest gates** — `agentbox.toml` `[skills.*]` blocks are the boot gates; each skill
  declares its own `manifest_gate` (e.g. tree-search-coder → `[skills.tree_search_coder]
  enabled = true`). "Byte-identical-when-off" is the discipline: a disabled skill leaves no
  runtime trace.
- **Corpus access** — a skill that reads or writes authored markdown reaches the corpus
  through the `[vault]` path authority, never a literal path (ADR-2028): `$VAULT_ROOT` for
  the vault root, `$VAULT_PAGES` for the authored pages, exported by the entrypoint into
  every supervised program, tmux window and shell. Config files carry `${VAULT_ROOT}` /
  `${VAULT_PAGES}` placeholders that the reading skill expands, so relocating the vault in
  `agentbox.toml` relocates every skill's input and output with no edit to the skill. Every
  skill that writes pages — `podcast-knowledge-ingest`, `web-summary`'s note-link mode, the
  `ontology-*` write paths — emits **V2 YAML frontmatter**
  (`project/docs/VAULT-corpus-format.md` §V2/§V5): `public` is a real YAML boolean, wikilink
  values are quoted, and a legacy `key:: value` leading block is converted on write. Emitting
  a `key:: value` line is a violation (Invariant 1). With no `[vault]` configured a corpus
  skill disables itself with one clear line rather than writing into a stale tree; the shared
  helper is `mcp/servers/lib/vault-frontmatter.js` and the CI gate is
  `scripts/ci/check-no-logseq-paths.sh`.

### Dream-machine programme (legacy ADR-052, ADR-055–072) — mostly paper

The dream-engine itself is **real and shipped**: a Rust crate at `services/dream-engine/`
with a built release binary (`services/dream-engine/target/release/dream-engine`,
10.3 MB, 2026-08-30), driven by `dream.config.json`, gated `[dream_machine] enabled = true`,
process owner supervisord, dispatched to HP (`10.10.10.1`) using the Loom/Qwen model. The
`/dream` control skill (`skills/dream-machine/`), management route (`management-api/routes/
dream.js`), ledger (`management-api/lib/dream-ledger.js`), and console
(`voice/console/site/dream.html`) exist.

Shipped-vs-paper inventory of the ADR-052/055–072 band:

| ADR | Subject | State |
|-----|---------|-------|
| 052 | Dream machine HP annexe | **Shipped** — engine binary, config, supervisor gate, HP dispatch |
| 055 | Dream cockpit panel | Partial — `dream.html` console exists; full cockpit unverified |
| 056 | Dream decision surface | Paper |
| 057 | Replayable execution journal | **Proposed, no code** |
| 058 | Lifecycle-scoped capability composition | Paper |
| 059 | Monotonic action-policy pipeline | **Proposed, no code** |
| 060 | Dream annexe path dependencies | Config-level only (`sibling-path-deps-fenced` note in `dream.config.json`) |
| 061 | Dream-persist accept-as-draft-PR | Paper |
| 062–067 | Metaharness adoption / governance / pins | Paper (retroactive band) |
| 065 | Darwin evaluator liveness | Enforced as *discipline* in `agentbox.toml` `[dream_machine]` (mandatory `--sandbox mock`), not as code |
| 068 | Kernel tooldispatcher deferral | Deferral recorded, unbuilt |
| 069 | Unified operator auth | Partial — nip98-proxy is the single ingress (see Loom/auth below) |
| 070–072 | Self-GC / swarm telemetry / evaluator-before-schedule | Paper |

The engine ships; the surrounding governance/decision/telemetry apparatus is largely
proposal prose.

### The Ontology Loom (this document is its interim authority)

The Loom is **load-bearing in production** but its harness-side decision record
(legacy ADR-051) is still `status: proposed` (`docs/reference/adr/ADR-051-...:5`). Until
ADR-051 ratifies, **this document is the interim authority for the harness-side Loom
contract.** Verified live wiring:

- **Façade** — `http://192.168.2.132:8084/v1` (`agentbox.toml:1564`, also at `:650`), an OpenAI
  chat-completions endpoint. The `.132` (machinelearn) address NATs to HP over the 25G rail;
  HP's old `.48` is dead. `/loom/search` + `/loom/sparql` retrieval is wired in
  `mcp/servers/lib/ontology-retrieval.js:345-393` via `LOOM_FACADE_URL`; the "one brain"
  ontology retrieval resolves through the Loom rather than re-deriving index state locally.
- **Model-swap contract** — consumers hold the façade; the model is a URL behind it,
  swappable with zero consumer change. Session seeds encode both a scaffolded path
  (`slug = "loom"` → `model = "loom-lan/qwen3.8-27B"`, `agentbox.toml:1231`) and a raw path
  (`slug = "loom-raw"` → `model = "loom-raw/qwen3.8-27B"` via `:8085`, `agentbox.toml:1238`).
- **Current model** — **Qwen3.8-27B** (`loom_model = "qwen3.8-27B"`, `agentbox.toml:1565`;
  `loom_max_tokens = 16384`).
- **Distillation tools** — ADR-051's deferred-distillation MCP tools (submit/await/fetch as
  beads work items) are **not yet a discrete server**; only the beads substrate primitives
  (`mcp/servers/substrate-tools.js`, "activates after image rebuild") exist. Retrieval is
  live; deferred distillation is partial.

### Tree-search-coder (legacy ADR-020 Surface 2)

Live and gated. `skills/tree-search-coder/SKILL.md` is an orchestration-only skill (carries
no code): it invokes `sparc:coder` N times at varied temperature, verifies each branch in a
fresh `code-interpreter` KernelSession, scores by assertion-pass count, tie-breaks on
shortest code. **Spend-capped and never auto-routed:** `[skills.tree_search_coder]`
(`agentbox.toml:621`) sets `max_candidates = 5`, `per_branch_timeout_s = 60`, and
`spend_cap_usd = 0.50`. ADR-020 Surface 1 (ACI shell) is landed; Surface 2 is the skill
above, enabled but explicitly-invoke-only.

## Known divergences & open items

1. **TOP OPEN RISK — the governance gap.** Autonomy (recursive spawn, code execution,
   nightly unattended dream cycles, background jobs) is live while the two governors that
   would make it safe (execution journal ADR-057, monotonic policy pipeline ADR-059) are
   unbuilt proposals. There is no single policy decision point and no canonical replayable
   record. Every side-effect path is guarded differently and a post-hook can rewrite an
   approval. This is the most important thing to fix and the reason this document exists.
2. **ADR-051 (Loom) is Proposed but the Loom is production-critical.** The load-bearing
   external-LLM subunit runs on a decision record that has not ratified. Interim authority:
   this document.
3. **ADR-045 "one front door" publishes two LAN doors** — the scaffolded façade (:8084) and
   raw model (:8085) are both reachable; consumers must pick correctly per task.
4. **Deferred-distillation MCP tools are not built** — ADR-051 names them; only beads
   substrate primitives exist, "after image rebuild".
5. **AoE :9095 is token-gated, not loopback-gated (N-05 revised).** `aoe serve` runs
   `--auth token`: every request to `:9095` must carry the daemon's shared-secret token
   (minted at launch into the owner-only 0700 `~/.config/agent-of-empires/serve.url`), so
   loopback reachability alone no longer drives the daemon (`agentbox.toml:1137-1146`). The
   nip98-proxy (`:9096`) remains the sole *identity* ingress — it verifies NIP-98 then
   injects the token upstream (`config/nip98-proxy/README.md`). Documented residual limit:
   a process running as the **same devuser** can still read the token file — the token
   raises the bar but does not isolate same-uid peers; per-process isolation is future work.
6. **Dream governance band (056/058/061/062–072) is paper** — the engine runs ahead of its
   decision-surface, self-GC, and telemetry-contract designs.
7. **Skill lint is advisory** — `lint-skills.sh` gates estate hygiene but is not a runtime
   capability gate; an enabled skill with clean frontmatter is trusted.

## Invariants (must not silently change)

- **Byte-identical-when-off** — a disabled `[skills.*]` / `[dream_machine]` gate leaves no
  runtime trace.
- **Tree-search-coder is never auto-routed** and always carries a `spend_cap_usd`.
- **AoE daemon access is token-gated (N-05 revised)** — every request to `:9095` must carry
  the daemon's shared-secret token (owner-only 0700 `serve.url`); the nip98-proxy (`:9096`)
  stays the sole *identity* ingress. Loopback reachability is no longer the boundary, and the
  token does not isolate same-uid peers (documented residual limit).
- **Dream cycles are evidence-gated and human-merge-gated** — a self-modifying hypothesis
  (a change to the dream-engine that dreams itself) must never bypass the human merge gate
  (`dream.config.json` extraDisciplines / `self-referential`).
- **Darwin evaluators must produce surface-dependent output** — any `@metaharness/darwin`
  entrypoint runs `--sandbox mock`/`agent`, never the no-op `real` default.
- **Governed ontology writes only** — `direct_axiom_load = false` (`agentbox.toml`); the
  ungoverned `POST /api/ontology/load` backdoor stays disabled outside bootstrap.
- **The Loom model swaps behind the façade** — changing the model must not touch a consumer;
  consumers hold `:8084`, never a raw model port, for scaffolded work.

## Change process

This is a living document, not an ADR. Present-tense current state only; historical
decisions get one line plus a legacy-ADR citation. Ground-truth order: **live code >
verified audit facts > legacy ADR prose.** When legacy contradicts code, code wins and the
divergence is recorded above. Amend on: ADR-057/059 landing (retire the top risk), ADR-051
ratifying (this doc cedes Loom authority back), a Loom model swap, a new `[skills.*]` gate,
or an AoE ingress change. Bump `version`, refresh `verified_commit`
(`git -C /home/devuser/workspace/project rev-parse --short HEAD`), re-verify every
file:line citation touched.
