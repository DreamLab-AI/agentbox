---
id: ADR-2080
title: Run the metaharness cost-optimal router as a dedicated AoE session for public day-to-day dev — artefacts vendored, embedding done offline, scoped to that session
date: 2026-09-06
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: cda60e7a0d04a1436d2cdd83779c49745a4efb96
verified_paths: []
owner: jjohare
review_trigger: the next ruflo pin (re-verify the tarball still omits assets/model-router and task-embedder still imports @xenova/transformers — either fix retires half of this record); a week of console ledger rows (feed ADR-2079's spike); any request to route non-public work through it
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2079 (AoE is the dispatch plane; this is its Phase 0 — the first labelled, audited, privacy-pinned dispatch to a non-Claude backend chosen by a learned router); legacy ADR-041 (the aqe projection stays); ADR-2031 (dated tariffs); ADR-2070 (raw Loom door never auto-routed); ADR-2026 (egress switch honoured); upstream ruflo ADR-148/149/150 and metaharness ADR-040/043 (the router and its promotion gate).
---

# ADR-2080 — Run the metaharness router as a dedicated AoE session

## Context

The operator wants the metaharness cost-optimal router for day-to-day open-source work,
which is public and not privacy-sensitive. The baked ruflo 3.38.20 closure already carries
`@metaharness/router` 0.3.3 and `@ruvector/tiny-dancer` 0.1.22 behind ruflo's
`CLAUDE_FLOW_ROUTER_NEURAL=1` gate (upstream ADR-148/149), but two measured facts stop it
firing: the `@claude-flow/cli` npm tarball's `files` list excludes `assets/model-router/`
(no seed corpus, KRR artefact, calibrator or OpenRouter alternates in the image), and
ruflo's `task-embedder.js` imports the retired `@xenova/transformers` specifier while the
closure ships `@huggingface/transformers` 4.2.0, so no embedding is ever produced and the
path returns `bandit-fallback`. Agentbox's bespoke `claude-flow` MCP server exposes no
routing tool, and AoE's seven seeds pick models by hand. ADR-2079 requires privacy tier to
gate before cost and forbids patching AoE.

## Decision

**Accepted.** The router ships as a dedicated AoE session, `router`, whose program is an
agentbox console; nothing in the AoE or ruflo trees is patched.

1. **Artefacts are vendored from one pinned manifest.** `config/model-router/artefacts.json`
   lists the twelve ruflo router artefacts at tag `v3.38.20` (`e21aa352…`) and the five
   MiniLM embedder files at Hugging Face revision `751bff37…`, each with URL, size and
   sha256. `flake.nix` reads it and bakes `/opt/agentbox/model-router` when
   `[model_routing.neural].enabled` is true (rebuild class, byte-identical-when-off);
   `scripts/model-router-fetch.sh` reads the same file to populate the pre-rebuild
   fallback `$WORKSPACE/.agentbox/model-router`, refusing any file whose hash differs.
2. **The console embeds the task itself.** `config/model-router/console.mjs` loads
   `Xenova/all-MiniLM-L6-v2` (q8) through the closure's `@huggingface/transformers` with
   remote models disabled, mean-pools and normalises exactly as ruflo's embedder would, and
   calls ruflo's `ModelRouter.route(task, embedding)` so the metaharness KRR backend fires
   (`routedBy: metaharness-krr`). The seed corpus was embedded with the same model; using
   any other embedder is forbidden because every prediction would be meaningless.
3. **Scoped to the session, never global.** The entrypoint projects
   `[model_routing.neural]` into `AGENTBOX_MODEL_ROUTER_*` only; the console sets
   `CLAUDE_FLOW_ROUTER_*` in its own process. No other ruflo work is re-routed to an
   external provider by this record.
4. **Public-tier only, egress-switch honoured.** The wrapper
   `config/harness-wrappers/router.sh` pins `AGENTBOX_MODEL_ROUTER_PRIVACY_TIER=public`; the
   console exits on any other value and drops to dry-run when `AGENTBOX_EGRESS=0`. The
   manifest key `privacy_tier` accepts only `public` (schema enum). Personal or LAN-only
   content goes to the Loom seeds, never here.
5. **Every dispatch is labelled and audited.** Each task yields a receipt (backend, tier,
   model id, provider, confidence, complexity, route latency, tokens, dated tariff cost,
   duration, outcome) appended to `console-ledger.jsonl`; the bandit outcome is recorded
   through ruflo's `recordModelOutcome`/`recordModelOutcomeByModelId`; the DRACO-shaped
   trajectory row is written by ruflo itself, so `router-parallel-analyze.mjs` and the
   ADR-150 promotion gate apply unchanged.
6. **Execution rides ruflo's provider router**, `callAnthropicMessages` with an explicit
   `provider: 'openrouter'` and the picked slug; `provider = "anthropic"` restricts picks
   to Claude tiers. The wrapper fails loudly when `OPENROUTER_API_KEY` is absent instead
   of falling back to another billing key (the N-01 posture).
7. **Surfaces.** Seed `slug = "router"`, `tool = "custom:router"` resolved by the seeder's
   wrapper table; `./agentbox.sh model-router <fetch|check|status|route|console>`; catalogue
   entry `model-routing-neural` (apply class rebuild); TUI/wizard expose the gate.

## Consequences

- Day-to-day public work gets a learned cheapest-adequate model per task, with a receipt,
  today, from the repo checkout (fallback dir) and after the next rebuild (baked).
- ADR-2079's spike now has a data source: the ledger and trajectory files are the
  routed-versus-default measurements it asks for.
- Cost: seventeen vendored files (~27 MB, dominated by the 23 MB embedder), one more
  session seed, one more wrapper; tariffs are the upstream file's dated estimates and must
  be re-pinned with the ruflo ref.
- The corpus is forty rows measured 2026-06-15 against seven OpenRouter models; picks for
  strong tasks can land on cheap models at bar 0.50 (observed: a design task routed to
  `inclusionai/ling-2.6-flash`). Raise `quality_bar` or set a cost ceiling per taste; the
  `/escalate` command re-runs one tier up and records the escalation.
- Two upstream defects are worked around, not fixed; the review trigger names them.
- The vendored alternates are dated: a live probe of this key on 2026-09-06 found four of
  the fifteen candidate slugs retired on OpenRouter (`inclusionai/ling-2.6-flash`, the cheap
  tier's default alt, plus three date-suffixed Anthropic ids). The console therefore
  preflights the provider's live model list (cached 24 h in the state dir, fail-open),
  skips a dead pick for the first available fallback, prefers live tariffs over the file's
  estimates, and on a 404/402 walks a fallback chain (same-tier ranked alternates → the
  router's own alternatives by score → the tier ladder), recording the failed pick as
  `escalated` and every attempt in the ledger. Re-pinning the ruflo ref refreshes the file.
- Rebuild not yet done: the baked path is unverified until then.

## Verification

`implementation_status: partial` (fallback path live and measured; baked path staged).
Verified at `cda60e7a0d04a1436d2cdd83779c49745a4efb96` plus this change:

- Tarball omission: `node -e "require('@claude-flow/cli/package.json').files"` in the
  closure → `["dist","!dist/**/*.map",…,"plugins",…]`; `find <closure> -name seed-rows.json`
  → nothing. Embedder mismatch: `task-embedder.js:46` `specifier = '@xenova/transformers'`;
  `ls <closure>/node_modules/@xenova` → absent; `@huggingface/transformers` 4.2.0 present.
- `scripts/model-router-fetch.sh` → 17 files fetched, all hashes verified.
  `console.mjs --status` → `routedBy: "metaharness-krr"`, `available: true`.
- `--dry-run --once` → route in 8 ms after a 342 ms warm start, pick
  `google/gemini-2.5-flash-lite` with three alternatives; ledger and trajectory rows written.
- Live probe (`GET /api/v1/models`, `/api/v1/auth/key`): key is paid-tier; 11/15 candidate
  slugs served, 4 retired. First real `--once` picked `inclusionai/ling-2.6-flash` and got
  `404 … no longer available`, recorded `ok:false` + `outcome: failure` in the ledger — the
  defect that motivated the preflight and fallback chain above. The AoE `router` session was
  created by `scripts/aoe-seed-sessions.mjs` (`created session "router" (tool=router)`),
  `~/.config/agent-of-empires/config.toml` carries `custom_agents.router`, and the
  `aoe_router_*` tmux pane shows the console banner and prompt.
- Second real `--once` (availability-aware): the router's pick `inclusionai/ling-2.6-flash`
  was absent from the live list, the console used the first live fallback
  `nvidia/nemotron-3-super-120b-a12b:free`, got a correct one-line answer (136 tokens,
  3.5 s, ~$0.000003), ledger rows `decision` (`routedBy: hybrid+availability`), `result`
  (`ok: true`) and `outcome: success` written, bandit priors updated.
- `cargo test` in `services/agentbox-manifest` → 115 tests green with the new key;
  `scripts/agentbox-config-validate.sh` → manifest valid; `check-manifest-catalogue.js`
  → new gate catalogued, `trajectory` baselined as a knob.

**Acceptance for `complete`/`live`:** after a rebuild, `/opt/agentbox/model-router/`
holds the 17 files with matching hashes; the `router` session exists in AoE and typing a
task returns a receipt; `AGENTBOX_MODEL_ROUTER_PRIVACY_TIER=private` makes the wrapper
exit non-zero; `AGENTBOX_EGRESS=0` yields a decision and no provider call.
