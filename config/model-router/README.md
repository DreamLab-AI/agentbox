# model-router — the metaharness cost-optimal router as a dedicated AoE session

**Decision record:** [ADR-2080](../../docs/adr/ADR-2080-metaharness-router-console-under-aoe.md)
(Phase 0 of [ADR-2079](../../docs/adr/ADR-2079-aoe-is-the-dispatch-plane-of-a-fleet-model-router.md)).
**Gate:** `agentbox.toml [model_routing.neural]`. **Session:** AoE seed `router` (window 8).

| File | Role |
|---|---|
| `console.mjs` | The session's program. Embeds each task offline (MiniLM q8 via the closure's `@huggingface/transformers`), calls ruflo's `ModelRouter.route(task, embedding)` so the metaharness KRR backend fires, executes the pick through ruflo's OpenRouter branch, prints a labelled receipt, records the bandit outcome and a DRACO-shaped trajectory row. REPL or `--once`, `--dry-run`, `--json`, `--status`. |
| `artefacts.json` | The single pinned source of truth for every vendored input: the twelve ruflo router artefacts at tag `v3.38.20` (seed corpus, KRR unified + three specialists, calibrators, FastGRNN weights, OpenRouter alternates, provenance) and the five MiniLM embedder files at a pinned Hugging Face revision, each with URL, size and sha256. Read by `flake.nix` (bakes `/opt/agentbox/model-router`, rebuild class) and by `scripts/model-router-fetch.sh` (pre-rebuild fallback `$WORKSPACE/.agentbox/model-router`). |
| `../harness-wrappers/router.sh` | The AoE `custom_agents.router` entry: asserts artefacts, key, egress switch, pins `AGENTBOX_MODEL_ROUTER_PRIVACY_TIER=public`, execs the console. |

## Why a console, not "just turn ruflo's flag on"

Two facts measured on the baked ruflo 3.38.20 closure (2026-09-06):

1. The `@claude-flow/cli` npm tarball's `files` list excludes `assets/model-router/`, so the closure has **no seed corpus, KRR model, calibrator or alternates**. With `CLAUDE_FLOW_ROUTER_NEURAL=1` and nothing to load, `tryCostOptimalRoute()` returns `null` and every decision is `routedBy: 'bandit-fallback'`.
2. ruflo's `task-embedder.js` imports the retired `@xenova/transformers` specifier; the closure carries the renamed `@huggingface/transformers` 4.2.0. The import fails silently, no embedding is produced, and the neural path never fires even when artefacts exist.

The console fixes both without patching either tree: it vendors the artefacts and embeds the task itself with the shipped package, then calls the router API directly. When upstream fixes the specifier, ruflo's own agent spawn path lights up with the same vendored artefacts (the console sets the same `CLAUDE_FLOW_ROUTER_*` variables, scoped to its own process).

## Use

```
./agentbox.sh model-router fetch                 # once, pre-rebuild: populate the fallback dir (hash-verified)
./agentbox.sh model-router status                # backend, artefact dir, provenance
./agentbox.sh model-router route "write a jest test for parseUrn" --dry-run   # route only
# or open the `router` session in AoE (tmux window 8) and type tasks.
```

Quality bar and cost ceiling come from `[model_routing.neural]` (`quality_bar`, `cost_ceiling_usd_per_mtok`) via the entrypoint's `AGENTBOX_MODEL_ROUTER_*` exports. State (bandit priors, trajectories, the console ledger) lives in `$WORKSPACE/.agentbox/model-router-state/`; ruflo's promotion-gate analyser reads the trajectory file unchanged.

## Availability and tariffs

The alternates file is a dated upstream measurement; slugs get retired. On start the console fetches the provider's live model list (cached 24 h under the state dir, fail-open), skips a dead pick for the first live fallback, prefers live prices over the file's estimates, and on a 404/402 walks a fallback chain — same-tier ranked alternates, then the router's own alternatives by score, then the tier ladder — recording the failed pick as `escalated` and every attempt in `console-ledger.jsonl`. Probe of 2026-09-06: 11 of 15 candidate slugs served, 4 retired.

## Privacy

The console **only serves public-tier work**: it exits unless `AGENTBOX_MODEL_ROUTER_PRIVACY_TIER=public`, and `AGENTBOX_EGRESS=0` (ADR-2026) forces dry-run. Personal or LAN-only content goes to the Loom sessions (`loom`, `loom-raw`), never here (ADR-2079 §4, ADR-2070).
