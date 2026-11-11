---
id: ADR-2192
title: The routing hook offers the whole skill tree, and each skill once
date: 2026-11-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ca5b4152a7ea5d721ffa652a617970db64b4d303
verified_paths: []
owner: jjohare
review_trigger: the hook's `none` share of routed turns in ~/.claude/skill-route.jsonl leaving 70-90% over a week at scope "all"; exact accuracy on tests/system-one/routing-cases.json below 85% (the ADR-2091 trigger); any `failed:http-4xx` routes after a backend switch (a backend with a smaller state window); turning `[skills.routing].cascade` on while scope is "registered"
repo: agentbox
domain: GOVERNANCE-capabilities
relates: [ADR-2089, ADR-2090, ADR-2091, ADR-2095, ADR-2111, ADR-2139]
evidence_class: test+runtime
acceptance_boundary: The contract tests establish the candidate set, the dedupe and the boot projection in source. The accuracy and cost figures were measured in this container against cloud Jev 1.14.0 through the proxy on labelled public cases, by calling the router library directly. They do not establish behaviour on live session turns, on another backend, or in a rebuilt image; the hook that runs today is still the baked one.
---

# ADR-2192: The routing hook offers the whole skill tree, and each skill once

## Context

ADR-2111 narrowed the `UserPromptSubmit` routing hook to `skills/registered-skills.txt`, because 70% of live picks named a skill the Skill tool could not load. The library has since learned to append the `SKILL.md` path of such a pick (`formatContext`, `unregisteredPaths`), which removes that reason. The narrowing remained, so the hook could name 21 of 134 baked skills, and the other 113 were reachable only by reading `SKILL-DIRECTORY.md` or running `/route` by hand. On the 86 labelled routing cases the registered set contains only 24 of the expected skills.

A second defect sat in the same candidate map. A skill installed twice, as an enabled plugin and as a synced account skill, was offered under both qualified names with one rubric. Observed 2026-11-11: `anthropic-skills:skill-creator` 0.35 and `skill-creator:skill-creator` 0.23 on one turn, and the pair took two of the three verify-shortlist slots.

## Decision

1. `[skills.routing].scope` selects the hook's baked candidates: `"registered"` (the code default, ADR-2111's behaviour) or `"all"`, every routable baked skill. Status rules are unchanged: deprecated, superseded, not-installed and router-only skills are never offered, gated ones carry their note. The running manifest sets `"all"`.
2. Only `"all"` is projected at boot, as `AGENTBOX_SKILL_ROUTE_SCOPE=all` in the hook command and `runtime-env.sh`. Any other value leaves the hook command byte-identical and adds only a comment line, no variable, to `runtime-env.sh`. Validator E084 rejects values outside the enum.
3. One skill is offered once. An extra (plugin or synced) whose bare name and whitespace-normalised rubric match a candidate already on offer is dropped. Precedence is baked, then enabled plugin, then synced. Same name with a different rubric is two skills. The log line carries `deduped: n`.
4. `registered-skills.txt` is the always-in-context Skill list and nothing else. A skill does not need to be on it to be routed to.

## Consequences

- Measured 2026-11-11 on the 86 cases plus 4 media cases (90), intent and verify options on: registered 38/90 exact, 13.1k input tokens, $0.00055 a route, median 0.36 s; all 84/90, 37.5k tokens, $0.0016, median 0.77 s, max 2.4 s against a 4 s budget. With the intent option off, all scores 83/90 at 19.0k tokens and $0.0008. A 12,000-character turn routed at 41.0k tokens in 0.85 s.
- The measurement itself cost about $0.27 of judge input (6.3M tokens), and the TypeSafe account returned `402 billing_error` on every call from 09:56 UTC the same morning. Re-running it is a spend to announce first.
- Each routed turn costs about three times as much judge input. The duplicate criteria map that the intent option sends is most of it; whether that measurement is still worth its cost is the operator's call, and this record does not change `[system_one.consumers]`.
- The `none` share will fall, because more turns now have a matching skill. On the labelled set it went from 38 to 17 of 90, with 16 cases labelled `none`. Live turns are mostly conversational (303 of the last 356 routed turns were `none`), so the review trigger is on that live share.
- The cascade cutoff 0.3718 was fitted on the whole tree (ADR-2095), so it matches scope `"all"` and not `"registered"`. The cascade stays off.
- A backend with a state window under about 45k tokens would fail every route at scope `"all"` with the intent option on. The hook fails open and logs the reason; `typesafe` declares no budget and accepted 41k.
- 40 `agentbox.toml:<line>` citations in `config/egress-policy.json` were already off by five lines before this change and are now off by more. They are not re-anchored here.

## Verification

Verified on an uncommitted working tree on top of `ca5b4152a7ea5d721ffa652a617970db64b4d303`; `verified_commit` names that base and `verified_paths` is empty until the change is committed and the record re-stamped at its own commit.

- `jest tests/config/skill-route.test.js`: 80 passed, of which 9 are new (scope, path injection under `"all"`, fallback, boot projection, dedupe, shortlist, E084).
- `node scripts/agentbox-config-validate.js agentbox.toml`: manifest valid.
- `node scripts/ci/render-egress-register.js --check`: 46 routes in sync, after re-anchoring the three `skill-route.cjs` citations this change moved.
- Live candidate map in this container: one extra dropped (`anthropic-skills:skill-creator`), 20 kept.
- Not verified: the hook in a rebuilt image. Until a rebuild bakes `config/hooks/` and the entrypoint, the running hook is the old one.
