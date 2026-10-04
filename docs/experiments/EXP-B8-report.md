# EXP-B8 report — 2026-10-04

Generated 2026-10-04T15:00:00.141Z by `scripts/experiments/exp-b8-label-log.cjs` when the stopping rule fired (sample of 510 reached). Protocol: `docs/experiments/EXP-B8-label-log.md`, pre-registered 2026-10-02.

## Verdict

**WITHDRAW**. ADR-2110 is withdrawn (rejected): the judge did not beat its copy ceiling on live turns, so the routing premise of the façade programme is falsified at this effect size.

## Numbers

| Quantity | Value |
|---|---|
| Analysable turns | n = 513 (excluded: 547; labels: 500 none, 13 skill) |
| Judge agreement with the teacher | 433/513 = 84.4% |
| Copy ceiling (BM25, decline below ∞ (always decline)) | 500/513 = 97.5% |
| Discordant pairs | b = 4 (judge only right), c = 71 (ceiling only right) |
| Exact two-sided McNemar | p = 6.81e-17 (alpha 0.05) |
| Observed discordant share | ψ = 0.146 (planned 0.163; above plan means power below 0.8) |

## What happens next

- `[skills.routing].label_log = false` and ADR-2110 → decision_status `rejected`, activation_status `inactive`, in the pull request (being opened by the next tick). It is not merged automatically.
- Both hooks were de-registered from `~/.claude/settings.json` at the stop. Sessions started before the stop keep their hook snapshot until they end; rows recorded after the stop are not in this analysis.
- The `routing_labels` table is kept, pending ADR-2110 open question 1 (retention).

## Protocol

MDE 5 points, power 0.8, alpha 0.05 two-sided, n = 510 (Connor 1987, ψ = 14/86 from ADR-2095), hard stop 2026-10-20. One test, no interim looks. Known bias: the judge's pick is shown to the main model, which inflates judge agreement, so a KEEP is an upper bound and a WITHDRAW is robust.
