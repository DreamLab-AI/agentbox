---
id: ADR-2135
title: Use Jev to time the advisor — jev-checkpoints, with spawn routing shadow-only
date: 2026-10-09
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 926f62660f46e6f65578216919170b50ea113964
verified_paths: [agentbox.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, flake.nix, config/entrypoint-unified.sh, config/claude-plugins/.claude-plugin/marketplace.json, scripts/ci/check-manifest-catalogue.js, tests/config/jev-checkpoints.test.mjs, tests/config/factrail-projection.test.sh, tests/config/ruflo-console.test.mjs]
owner: jjohare
review_trigger: the first soak report of injections per hundred turns and USD per session, a measured shadow-log agreement rate for spawn routing (ADR-2110 labels), a change to the advisor checkpoints in ADR-2134, or a Claude Code function-hook API change
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2134 (the advisor whose consult timing this judges), ADR-2121 (factrail precedent: plugin, gate, egress carve-out), ADR-2090 (egress being widened), ADR-2094 (local backend), ADR-2110 (teacher labels)
---

# ADR-2135 — Use Jev to time the advisor — jev-checkpoints, with spawn routing shadow-only

## Context

ADR-2134 gives the Sonnet lead an Opus advisor but leaves *when* to consult it to the lead's judgement, which is weakest exactly where it matters: a turn that claims "done" without a verifying run, a fix attempted for the third time against the same failure, a plan that touches a contract. Opus is the expensive resource, so consult timing is a cheap-classifier problem. Jev (TypeSafe System One) already scores typed questions for under a cent (ADR-2091, ADR-2121). Prior art: pi-warden's done-claim and retry guards; compact-adviser timing. The counter-evidence is `suenot/codex-jev-router`: Jev-chosen subagent models came out 27% cheaper than fixed strong-tier children but 69.7% dearer than one strong agent, so letting Jev *pick models* is not established.

## Decision

1. **Plugin.** `jev-checkpoints` (0.1.0, `MIT OR Apache-2.0`) is a Claude Code function-hook plugin authored in `config/claude-plugins/jev-checkpoints/`, baked into the `agentbox` directory marketplace, installed as `jev-checkpoints@agentbox` in the root session only. It injects at most one advisory line of 300 characters per checkpoint per turn and never forces a tool call or blocks.
2. **Checkpoints**, each switchable in `[features.jev_checkpoints]`: *done* (Jev Score ≥ `done_threshold` that a completion claim had no successful test/build/lint/type-check this turn: ADR-2134 checkpoint 3); *repeat* (the same normalised failure fingerprint `repeat_count` times; local only, never calls Jev: checkpoint 2); *plan* (Score ≥ `plan_threshold` that a prompt needs a multi-file plan or touches an auth/schema/API/data contract: checkpoint 1); *spawn* (Jev Choice over haiku|sonnet|opus|inherit).
3. **Spawn routing is shadow-only by default.** `spawn_mode = "shadow"` records each decision (digest, never prompt text) to files `shadow-<session>[.N].jsonl` beside the `shadow_log` base path (glob `shadow-*.jsonl`) and alters nothing; the log feeds ADR-2110 teacher labels. `enforce` rewrites only an unset model, at or above `spawn_min_confidence`, never above the main model, and is not enabled by this ADR.
4. **Egress widens ADR-2090 the way ADR-2121 did.** Sent: prompt text (plan), assistant final text (done), subagent description/prompt head (spawn), each clamped head 9000 / tail 3000, plus tool-call names with ok|error. Never tool-result contents. Email carve-out: a session that has ever made an `mcp__email-gateway__*`/Gmail call or loaded `email-search` is never sent to a cloud judge for the rest of its life (the local repeat check still runs); a backend is local only when declared (`backendLocal`, below). Fail-open on any error, timeout, 429 or missing key.
5. **Wiring.** `[features.jev_checkpoints].enabled = true` is rebuild-class for the plugin (`flake.nix` drops the tree from the baked config when off and strips `*.test.ts`) and boot-class for the projection (`config/entrypoint-unified.sh`: manifest values projected as camelCase userConfig; cache compared to the baked tree by content and reinstalled on difference; off uninstalls). `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` and the `agentbox` marketplace are kept while any of factrail, ruflo-console or jev-checkpoints is on. `backendLocal` is an explicit boolean, never inferred from the `api` string (ADR-2094 §5): the entrypoint sets it true only from the resolved sovereign-System-One config with no manifest `api`; an explicit `api`, with or without the façade, leaves it false so the email fence holds. The fence's `taintTools`/`taintSkills` are projected from `[features.jev_compaction]`'s lists, one definition for both Jev plugins. `timeout_ms` is capped at 8000 (hook budget 10 s). The key is the environment's `TYPESAFE_API_KEY`, as for factrail; it is never a userConfig value and no `/nix/store` path is written.

## Consequences

- A third consumer of the Jev wire protocol and a second function-hook plugin; both share one marketplace and one env switch, which is why the factrail and ruflo-console blocks now test three gates.
- Cost is one Jev request per qualifying event (about $0.005 order of magnitude); done and plan are the only cloud calls. No measurement of the saving in Opus consults exists yet — ADR-2134's advisor cost is the thing to watch.
- ADR-2121's governed paths `config/entrypoint-unified.sh`, `config/claude-plugins/.claude-plugin/marketplace.json`, `schema/agentbox.toml.schema.json`, `tests/config/factrail-projection.test.sh` and `tests/config/ruflo-console.test.mjs` change (shared-keep logic, one catalogue entry, one test boundary); ADR-2121 is not re-verified here.
- Spawn enforcement needs the shadow log to show agreement with a strong-tier baseline before any change of default; until then the 69.7% result stands as the working prior.
- Activation needs the host rebuild, a Claude Code ≥ 2.1.294, and a soak of injection rates; the image and boot are unverified until `./agentbox.sh rebuild` runs.

## Verification

Gate `node --test tests/config/jev-checkpoints.test.mjs` (manifest defaults, schema closure and ranges, validator accept/reject, catalogue entry, marketplace entry, flake gating text, entrypoint projection keys and shared-keep logic, `_jk_project` behaviour, plugin `userConfig` coverage once the plugin source is present). Also `bash tests/config/factrail-projection.test.sh`, `node --test tests/config/ruflo-console.test.mjs`, `scripts/agentbox-config-validate.js agentbox.toml`. `nix flake check` and the entrypoint's `claude plugin` calls have not run: no Nix here, and builds are host-only. `verified_commit` is stamped by the coordinator after merge.
