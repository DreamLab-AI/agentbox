---
title: Agentbox Capability Governance
doc_id: AB-GOVERNANCE
version: 0.3.3
status: draft-for-ratification
verified_commit: 
changelog:
  - "0.3.3 (2026-09-06): ADR-2080 — the metaharness cost-optimal router runs as the dedicated AoE `router` session (Phase 0 of ADR-2079): artefacts vendored from one pinned manifest, task embedded offline, scoped to that session, public tier only."
  - "0.3.2 (2026-09-06): ADR-2079 (proposed) — examine AoE as the DISPATCH plane of a fleet model router; the routing policy lives in a Rust crate outside the session manager, privacy tier is the first routing axis, subagent models are out of reach, a research spike precedes any build."
  - "0.3.1 (2026-09-06): Remediation — 2026-09-05 section: ADR-2057/2061/2062/2063/2064/2065/2066/2068/2069/2070/2072 and proposed 2071/2073–2078, the ADR-2018 recall diagnosis, landed in 796d85fcf — re-verified at "
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
  `scripts/skill-count-check.js` (run in `invariants.yml`); no other document restates it
  (ADR-2056). The router's `skill-router/references/routing-table.md` is **generated** from
  frontmatter by `skills/gen-routing-table.mjs` and `skill-router/references/section-map.json`
  (ADR-2083); it is never hand-edited.
- **Authoring contract** (ADR-2083, taught by `skills/skill-builder`): `name` equals the
  directory (lowercase-hyphen); `description` ≤ 1024 chars with what/when/when-not; depth in
  `references/`; portable frontmatter core per agentskills.io plus Claude Code's documented
  extras and an allow-listed estate vocabulary; redirect stubs carry `deprecated: true` +
  `replacement:`; Claude-only affordances are stated in one line with the Codex fallback.
- **Lint gate** — `skills/lint-skills.sh` (thin wrapper over `lint-skills.mjs`) exits non-zero
  on any finding. Checks: banned stale strings (dead hosts, retired SDKs), absolute
  `~/.claude/skills` and `/home/devuser/.claude/skills` paths (skills bake at
  `/opt/agentbox/skills`), the retired bare `/workspace/` path, a real frontmatter parse,
  NAME (== directory), DESCLEN (≤ 1024), the 250-line/`references/` budget, every cited
  `references|scripts|assets` path resolving, REGISTERED (both manifests resolve to live,
  non-deprecated skills), DIRECTORY (every skill named in the directory and the section map),
  ROUTING (generated table current), DEPRECATED (stub keys). Unknown frontmatter keys and stale
  model ids are advisory warnings. `SKIP_DIRS` holds only non-skill directories; per-check
  exemptions carry a reason. Contract tests: `tests/config/skill-lint.test.sh`.
- **Registration** — `skills/registered-skills.txt` (Claude Code, always-loaded native Skill
  list) and `skills/codex-registered-skills.txt` (Codex / GPT-6 Astra, sized for its
  8,000-character skill index) are reconciled at boot by `scripts/reconcile-skills.sh` into
  `~/.claude/skills` and `~/.codex/skills` from the baked tree; `~/.codex/AGENTS.md` points
  Codex at the directory and routing table for reference-only skills. Manifest-disabled or
  not-installed skills are never registered.
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
process owner supervisord, dispatched to the connected node (`the connected node`). **The default reasoning
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
| 052 | Dream machine the connected node annexe | **Shipped** — engine binary, config, supervisor gate, the connected node dispatch |
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

- **Façade** — `${LOOM_BASE_URL}` (`agentbox.toml [dream_machine].loom_url`,
  also `[skills.ontology.condense].endpoint`), an OpenAI
  chat-completions endpoint. The `.132` (the gateway host) address NATs to the connected node over the 25G rail;
  the connected node's old `.48` is dead. `/loom/search` + `/loom/sparql` retrieval is wired in
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
3. **RESOLVED (ADR-2070) — not a divergence: ADR-045 governs ingress, the Loom doors are
   egress.** ADR-045's "one front door" binds external control surfaces reaching *into* the box
   (`:9096`, NIP-98). The scaffolded façade (`:8084`) and the raw model (`:8085`) are *egress* to
   a LAN model host — a plane ADR-045 never addressed. The raw door is deliberate and named
   (`flake.nix` `LOOM_RAW_BASE_URL`, the `slug = "loom-raw"` session seed): **agent-choice and
   benchmark-only**, for raw coding where the ontology scaffold is cost without benefit. It is
   **not** a fallback, **not** for knowledge work or ontology retrieval, and nothing may
   auto-route to it when the façade errors — a scaffold failure must surface, not silently
   downgrade. A third Loom-side endpoint requires an ADR. Residual: unenforced at runtime —
   nothing checks which base URL a session actually opened.
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
chat/scaffold evaluation results. The [estate review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/agent-grounding-and-governance.md)
records current helper-level gaps and the required evidence for closing them.

## Dream acceptance qualification — 2026-09-04

The [self-improvement review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/self-improvement.md) distinguishes intended evidence gates from the actual service path. Evaluators run before the model emits its patch; their failures become text rather than a deterministic veto. The configured recall band and a witnessed report do not prove a tested candidate. ADR-2024 remains partial and now requires frozen candidate evaluation, typed required-check rejection and restart-safe receipts. The human-merge requirement is preserved.

## Instruction and enforcement qualification — 2026-09-04

ADR-2020/2021 are partial for hard-limit, off-state and frontmatter/context guarantees. Tree-search instructions do not establish a runtime spending limiter; copied skill files remain distinct from package/process gates. The actual lint accepts empty references directories and body-only metadata fields. Require executor and build receipts plus typed/frontmatter/context validation. See the [estate capability review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/capability-instructions-and-enforcement.md).

## Security gate adoption — 2026-09-05

ADR-2033 makes the build-with-quality Security gate executed rather than declared:
deepsec runs in PR mode under `[security.deepsec]`, every run leaves a receipt, and
exit 78 is recorded as SKIPPED. Invariants added: credentials are env-var names only
in the manifest (E072); the gate cannot be enabled without the baked binary (E070);
model routes must pair with a baked harness (E071). The image is not yet rebuilt with
the closure (placeholder `nodeModulesHash`), so activation is staged; the CI job is
label-gated and skips without a secret.

## Remediation — 2026-09-05

ADR-2057 is implemented, narrowing divergence 8: `[skills.podcast_ingest]` (default `true` = shipped behaviour) now wraps `[program:podcast-cron]` in `lib.optionalString`, the `harness`/`precedent` registration blocks read their own `.enabled` via `agentbox-manifest toml-bool`, all three carry honest apply classes in the system-manifest catalogue (60 gate paths, was 57), and `[skills.harness].template_dir` is projected as `HARNESS_TEMPLATE_DIR` instead of being inert — residual: gate-off skips registration but cannot retract a `.mcp.json` entry an earlier boot wrote (no remove-by-name subcommand), and the podcast gate removes the schedule, not the shared binary from the closure, so byte-identical-when-off now holds for runtime trace but not image closure; activation is staged until the next rebuild.

ADR-2061 closes the federation kind-map divergence: the supported-kind list is now ONE versioned artefact, `schema/federation-kinds.json` (19 kinds, artefact 1.0.0), that both translators *derive* from rather than transcribe — `management-api/lib/bc20-provenance-bridge.js:112-127` reads it at require time and VisionClaw `src/uri/mod.rs` embeds the same bytes via `include_str!("../../agentbox/schema/federation-kinds.json")` (the agentbox tree is that checkout's `./agentbox` submodule) — with a paired fixture (50 jest cases here, 7 `cargo test` cases there) asserting both sides agree on crossed-vs-refused and on the target grammar when crossed, verified by flipping `memory` to `crosses: true` in the artefact and watching 3 JS and 4 Rust tests fail; `memory` is a **recorded** refusal (`refusal_class: "deliberate"`, naming the `{domain, slug}` elevation that would unlock it) rather than an absent arm, which is what makes it distinguishable from "not implemented" — residual: only the JS half is CI-gated (`contract-tests.yml` already globs `tests/contract/*.contract.spec.js`), because VisionClaw's `CPU_CRATES` list excludes the `visionclaw-server` crate that owns `src/uri`, so the Rust fixture needs a one-line `ci.yml` addition owned by another lead.

ADR-2068 binds a session-boundary gate to every session class: `[ontology_monitor].enabled` reached only per-profile sessions (`stacks.rs`) while the root session — tmux window 0 and every unattended teammate pane — had neither the `SessionEnd` hook nor its `AGENTBOX_ONTOLOGY_MONITOR` master switch, so the manifest read "on" while the busiest session class never ran the review; the entrypoint now seeds both from the gate and, gate-off, retracts hook and env to the pre-gate bytes (a new byte-identical-when-off surface, tested five ways) — residual: two registration sites still exist and must be changed together, guarded only by the new `config/hooks/README.md` inventory, and activation is staged until the next boot.

ADR-2069 turns an uncatalogued manifest gate key from a WARN into a build failure: at `e070514d8` the check printed 130 uncatalogued boolean keys and exited 0, so a capability could ship without ever appearing in `/v1/system`; `scripts/ci/check-manifest-catalogue.js` now fails on any boolean key that is neither catalogued nor in an explicit BASELINE, and the BASELINE is a ratchet — an entry that has since been catalogued, or is no longer in `agentbox.toml`, also fails, so the list can only shrink — residual: 17 baselined keys are real capabilities still owed a CATALOGUE entry (`ontology_monitor.enabled`, `skills.codeact.enabled`, `toolchains.claude`, `plugins.memory.enabled`, …), printed as a WARN on every run rather than laundered, and closing them means editing `management-api/lib/system-manifest.js`.

ADR-2070 retires divergence 3 as a category error rather than a breach: ADR-045's "one front door" is an **ingress** invariant (`:9096`, NIP-98) and says nothing about **egress** to a LAN model host, so the Loom's two doors are not a violation of it; the raw `:8085` door stays as a deliberate, named, agent-choice/benchmark-only path for raw coding, explicitly not a fallback and never auto-routed on a façade error, with the model-swap contract (consumers hold `:8084`) unchanged as the load-bearing Loom invariant — residual: the constraint is documentary, nothing checks at runtime which base URL a session opened.

ADR-2071 is **proposed, not landed**, and divergences 1 and 6 stay open: routing the nightly dream cycle through the ADR-2041 journal + policy pipeline would today deny the night on its first action, because its SSH/LLM/`git push`/forum side effects classify as `egress`/`mutate` (in `APPROVAL_REQUIRED`) and `action-plane.js` wires no approver — so the record stages journalling (~380 lines, HTTP-only because `local-jsonl` caches the hash-chain head in memory and appends unlocked, making any second writer a chain-forking corrupter) ahead of policing, keeps the engine's fail-open posture explicit, and names a two-character precondition: the pipeline returns `decision: 'deny'` while `action-plane.js:276` and `routes/tasks.js:85` both test `'denied'`, so the first guard anyone adds yields a 500 where a 403 was intended.

- **ADR-2074** (proposed) — the ADR-051 deferred-distillation tools ship as a discrete,
  manifest-gated MCP server (`ontology-distill`) holding the harness signing key, rather than as
  tools on the fail-open `ontology-bridge`; adds the `job` URN kind with a per-kind RFC 8785 JCS
  canonical form. Nothing of D2/D3 exists today. ADR-2023's "Remaining" is the ORIGIN of this
  gap and is referenced (`see`), not superseded.
- **ADR-2075** (proposed) — the Loom exposes a generation descriptor and the client reports the
  **attested** generation; a configured value that disagrees fails labelled rather than being
  served or relabelled, and the cache keys on the attested id. Preserves the model-swaps-behind-
  the-façade invariant. ADR-2023's "Remaining" is the ORIGIN (`see`).
- **ADR-2077** (proposed) — a procedure ADR closing ADR-2020's outstanding half: the exact
  five-build `nix build .#runtime` sequence, closure identity and runtime trace proved
  separately, gates that cannot pass recorded as named exceptions, and a receipt in
  `docs/estate-closeout/` (the July receipts are frozen under `docs/archive/gap-close-evidence/`). ADR-2020's "Remaining" is the ORIGIN (`see`); ADR-2033
  removed the last blocker by resolving `nodeModulesHash`.
- **ADR-2079** (proposed, option to examine) — Agent of Empires (window 8) as the fleet model
  router's **dispatch plane**, never its decision plane: a Rust routing crate in agentbox holds
  the policy table, per-task-class scorecard and RuVector outcome writer; AoE receives
  `(task, backend)` and runs it, its source tree unpatched. Privacy tier gates before cost
  (nothing personal leaves its tier; `loom-raw` is never a fallback, ADR-2070); Claude Code
  subagents cannot have their model swapped, so the router's choice at that seam is "Claude
  subagent or AoE session". Precondition is a research spike (fleet inventory with dated
  tariffs, six to ten task classes, one week routed-vs-default). Consolidates the four
  scattered model-choice mechanisms (`[model_routing.routes]`, `[consultants.<name>].model`,
  seed `model` keys, the regex prompt-routing hook). PRD-005 is the ORIGIN (`see`).
- **ADR-2080** (accepted, partial, staged) — Phase 0 of ADR-2079 landed as a *dedicated AoE
  session* rather than a router inside AoE: `config/model-router/console.mjs` embeds each task
  offline with the closure's `@huggingface/transformers`, calls ruflo's `ModelRouter.route(task,
  embedding)` so `@metaharness/router`'s KRR fires, executes through OpenRouter and writes a
  labelled receipt + bandit outcome + trajectory row. Vendored because the `@claude-flow/cli`
  tarball omits `assets/model-router/` and ruflo's task-embedder imports a package the closure
  lacks (`config/model-router/artefacts.json` is the one pinned source; `flake.nix` bakes it,
  `scripts/model-router-fetch.sh` fills the fallback). Gate `[model_routing.neural]` (rebuild
  class); `AGENTBOX_MODEL_ROUTER_*` only — never `CLAUDE_FLOW_ROUTER_*` globally; privacy tier
  pinned `public`; egress switch honoured. Fallback path measured live; baked path staged.
