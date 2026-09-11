---
id: ADR-2053
title: Record that the dream engine's default reasoning provider is Z.AI and name the egress posture
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a change to [dream_machine].llm_provider, to the DREAM_LLM_PROVIDER default in the generated supervisor block, or to the set of repos in the nightly roster
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2023 (Loom facade), ADR-2024 (dream cycle gating), legacy ADR-052 (dream machine the connected node annexe)
---

# ADR-2053 — Record that the dream engine's default reasoning provider is Z.AI and name the egress posture

## Context

`docs/GOVERNANCE-capabilities.md` describes the dream engine as "dispatched to the connected node
(`the connected node`) using the Loom/Qwen model". The running configuration disagrees:
`agentbox.toml [dream_machine].llm_provider = "zai"` with
`zai_model = "glm-5.3"`, and the generated supervisor block defaults the same way
(`DREAM_LLM_PROVIDER="${dreamMachineCfg.llm_provider or "zai"}"` in `flake.nix`).
`loom_url`/`loom_model` are configured but are selected only when `llm_provider = "loom"`
or `DREAM_LLM_PROVIDER` overrides at runtime.

The choice is deliberate and already reasoned in the manifest: the adjacent comment
records that glm-5.3 burned ~16k thinking tokens on hard nights and hit the old 16384
cap with empty content twice, which is why `zai_max_tokens`/`loom_max_tokens` are now
32768. The credential `ZAI_ANTHROPIC_API_KEY` is a secret inherited from the container
environment and is never written into `agentbox.toml` or the supervisor block.

Exposed by diagrams AB-23.2 and AB-24.9. The problem is not the choice; it is that the
governing document asserts the opposite, and in doing so hides an egress fact.

## Decision

The default is retained. `[dream_machine].llm_provider = "zai"` is an operator decision
about reasoning-token headroom, not a defect, and this ADR does not change it.

`docs/GOVERNANCE-capabilities.md` is corrected to state the default provider accurately
and to name the consequence plainly: **under the default provider, nightly repository
content leaves the LAN** to a third-party API. The Loom is the opt-in LAN-only path,
selected by `llm_provider = "loom"`, and only that setting makes the nightly cycle
local-only. Any future claim that the dream engine is LAN-confined must name the
`llm_provider` value it assumes.

The existing `dream.config.json` `extraDisciplines` entry `secrets-never-in-report`
(never quote `.env` or any `*_KEY`/`*_PRIVKEY` value into a report, ledger or gist)
remains the control that bounds what may cross that boundary, and is now cited from the
governing doc alongside the egress statement rather than only from the config.

## Consequences

- The governing doc stops contradicting the manifest, and a reader evaluating the
  estate's privacy posture can see that the nightly cycle is not LAN-confined by default.
- Operators who need a LAN-only nightly cycle have a named, one-key change
  (`llm_provider = "loom"`) rather than an assumption.
- Cost: the estate now carries an explicit, documented cloud-egress path for repository
  source. That is the honest position, and it makes the trade reviewable.
- Follow-on, not taken here: `secrets-never-in-report` is a *discipline* stated in prose
  to the model, not an enforced filter on the outbound prompt. Enforcing it mechanically
  (running the dream prompt through the privacy filter before egress) is a real control
  and is out of this lane's bounded scope — it touches the engine's LLM path and the
  filter sidecar. Recorded here so it is not lost.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- `sed -n '/^\[dream_machine\]/,/^\[security/p' agentbox.toml` → `llm_provider = "zai"`,
  `zai_model = "glm-5.3"`, `zai_max_tokens = 32768`, `loom_url`, `loom_model = "qwen3.8-27B"`,
  `loom_max_tokens = 32768`, `window_start = 1`, `window_end = 5`,
  `hp_host = "${CONNECTED_NODE_SSH}"`, `max_repos_per_night = 5`, `prune_dry_streak = 5`.
- `grep -n 'DREAM_LLM_PROVIDER' flake.nix` → the `[program:dream-engine]` environment line
  defaulting to `"zai"`.
- `grep -n 'secrets-never-in-report' dream.config.json` → present in `extraDisciplines`.
- Governing-doc claim located with
  `grep -n 'Loom/Qwen' docs/GOVERNANCE-capabilities.md` before the edit; no match after.
