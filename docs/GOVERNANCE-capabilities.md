---
title: Agentbox Capability Governance
doc_id: AB-GOVERNANCE
version: 0.3.0
status: draft-for-ratification
verified_commit: cdc18cf53
changelog:
  - "0.3.0 (2026-09-04): ADR-2031 — consultant model is projected from the manifest at boot (env override wins, TUI preserves the operator's choice); general-purpose Gemini default is gemini-3.8-flash with a dated tariff."
  - "0.2.0 (2026-09-02): ADR-2028 — skills read and write the authored corpus through VAULT_ROOT/VAULT_PAGES and emit V2 frontmatter; no skill hard-codes a corpus path."
  - "0.1.1 (2026-08-31): fix wrong verified_commit (was outer-repo hash), correct agentbox.toml citations (loom_url 1564, loom_model 1565, session-seed models 1231/1238), and update N-05 to the revised token-auth boundary."
sources:
  - agentbox.toml (cited by [section].key per ADR-2052 — [skills.ontology.condense].endpoint, [dream_machine].loom_url/.loom_model/.loom_max_tokens, [[interaction_plane.session_seeds]], [interaction_plane] N-05 token auth, the [skills.*] gates, [skills.ontology].direct_axiom_load)
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
- **deepsec Security gate** — `[toolchains].deepsec = true` bakes the vercel-labs
  vulnerability reviewer; `[security.deepsec]` bounds it (route, `fail_on`,
  `max_duration`) and `skills/build-with-quality/scripts/deepsec-gate.sh` is the only
  entry point (ADR-2033). It reads source and sends snippets to the configured model
  route; the default route is the operator's own `claude` login, the LAN-only route is
  the Loom façade.

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

- **Directory** — `skills/SKILL-DIRECTORY.md` is the canonical index; skills self-trigger
  from their `description` frontmatter. The skill **count** has one authority,
  `scripts/skill-count-check.js` (currently 126); no other document restates it, and this
  one does not restate the directory's line count either — both drifted before (ADR-2056).
- **Lint gate** — `skills/lint-skills.sh` (a thin shell wrapper over `lint-skills.mjs`)
  enforces estate hygiene and exits non-zero on any finding. Its `SKIP_DIRS` holds only
  genuinely non-skill directories: a skill is never excluded wholesale, and relief from a
  single check goes in that check's own narrow exemption set with a reason. `toprank` was
  formerly skipped entirely, which dropped it from all six checks and made this gate count
  125 skills against `skill-count-check.js`'s 126 (ADR-2056). Checks: banned stale strings (dead hosts like `192.168.2.48`, retired SDKs), absolute
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
process owner supervisord, dispatched to HP (`10.10.10.1`). **The default reasoning
provider is Z.AI, not the Loom** — `[dream_machine].llm_provider = "zai"` with
`zai_model = "glm-5.3"`, and the generated `[program:dream-engine]` block defaults
`DREAM_LLM_PROVIDER` the same way. That is a deliberate choice for reasoning-token
headroom (glm-5.3 hit the old 16384 cap with empty content; both caps are now 32768).
**Egress consequence, stated plainly: under the default provider, nightly repository
content leaves the LAN to a third-party API.** `llm_provider = "loom"` selects the
LAN-only path via `[dream_machine].loom_url`/`.loom_model`, and only that setting makes
the nightly cycle local-only. The `dream.config.json` `extraDisciplines` entry
`secrets-never-in-report` bounds what may cross that boundary, as prose instruction to
the model rather than an enforced outbound filter (ADR-2053). The
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

- **Façade** — `http://192.168.2.132:8084/v1` (`agentbox.toml [dream_machine].loom_url`,
  also `[skills.ontology.condense].endpoint`), an OpenAI
  chat-completions endpoint. The `.132` (machinelearn) address NATs to HP over the 25G rail;
  HP's old `.48` is dead. `/loom/search` + `/loom/sparql` retrieval is wired in
  `mcp/servers/lib/ontology-retrieval.js:345-393` via `LOOM_FACADE_URL`; the "one brain"
  ontology retrieval resolves through the Loom rather than re-deriving index state locally.
- **Model-swap contract** — consumers hold the façade; the model is a URL behind it,
  swappable with zero consumer change. Session seeds encode both a scaffolded path
  (`slug = "loom"` → `model = "loom-lan/qwen3.8-27B"`) and a raw path
  (`slug = "loom-raw"` → `model = "loom-raw/qwen3.8-27B"` via `:8085`), both in
  `agentbox.toml [[interaction_plane.session_seeds]]`.
- **Current model** — **Qwen3.8-27B** (`agentbox.toml [dream_machine].loom_model`;
  `.loom_max_tokens = 32768`, raised from 16384 after reasoning-token truncation).
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
8. **Byte-identical-when-off is currently FALSE for three surfaces (PROPOSED
   ADR-2057).** The invariant below is not softened — the code is wrong, not the
   invariant. Raised by the ab-learning-capabilities lead: the podcast cron has no
   gate wrapper, and `[skills.harness]` / `[skills.precedent]` never read their own
   `.enabled` key, so disabling them leaves a runtime trace. Until ADR-2057 lands,
   a disabled gate cannot be assumed inert for these three; treat "off" as
   "unverified off" when reasoning about them. The build-evidence half of ADR-2020
   (package and supervised-process absence for a disabled gate, bound to build
   identity) is separately still unproven and needs an image rebuild.

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
- **Governed shared-ontology promotion is required** — `direct_axiom_load = false`
  keeps the remote direct-load descriptor disabled outside bootstrap. Forced-local
  dispatch can still edit authored Markdown before that guard; ADR-2022 now marks
  implementation partial for the broad invariant. Local authoring and promotion
  need separately enforced authority and end-to-end receipts.
- **Consultant models come from the manifest** — `[consultants.<name>].model` is projected
  into the consultant's environment at boot by `agentbox-manifest toml-string`; a non-empty
  pre-boot environment override wins, a TUI save never resets an operator's model, and cost
  figures are dated API-equivalent estimates or `null`, never a stale constant (ADR-2031).
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

## Estate grounding closeout — 2026-09-04

[ADR-2023](adr/ADR-2023-loom-facade.md) now carries the CP-03 closeout conditions
for backend selection, cache constraints, degradation and served generation.
The stable façade remains the governing entry-point decision. That decision
must not be interpreted as evidence that the agent search/SPARQL path inherits
chat/scaffold evaluation results. The [estate review](../../../VisionFlow/docs/estate-review/agent-grounding-and-governance.md)
records current helper-level gaps and the required evidence for closing them.

## Dream acceptance qualification — 2026-09-04

The [self-improvement review](../../../VisionFlow/docs/estate-review/self-improvement.md) distinguishes intended evidence gates from the actual service path. Evaluators run before the model emits its patch; their failures become text rather than a deterministic veto. The configured recall band and a witnessed report do not prove a tested candidate. ADR-2024 remains partial and now requires frozen candidate evaluation, typed required-check rejection and restart-safe receipts. The human-merge requirement is preserved.

## Instruction and enforcement qualification — 2026-09-04

ADR-2020/2021 are partial for hard-limit, off-state and frontmatter/context guarantees. Tree-search instructions do not establish a runtime spending limiter; copied skill files remain distinct from package/process gates. The actual lint accepts empty references directories and body-only metadata fields. Require executor and build receipts plus typed/frontmatter/context validation. See the [estate capability review](../../../VisionFlow/docs/estate-review/capability-instructions-and-enforcement.md).

## Security gate adoption — 2026-09-05

ADR-2033 makes the build-with-quality Security gate executed rather than declared:
deepsec runs in PR mode under `[security.deepsec]`, every run leaves a receipt, and
exit 78 is recorded as SKIPPED. Invariants added: credentials are env-var names only
in the manifest (E072); the gate cannot be enabled without the baked binary (E070);
model routes must pair with a baked harness (E071). The image is not yet rebuilt with
the closure (placeholder `nodeModulesHash`), so activation is staged; the CI job is
label-gated and skips without a secret.
