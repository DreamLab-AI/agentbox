| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-16 | dream-engine | INCONCLUSIVE — see report | NONE | NONE | yes | INCONCLUSIVE |  | 7862b60080c4 |  |
| 2026-08-17 | hooks-pipeline | INCONCLUSIVE — see report | NONE | NONE | yes | INCONCLUSIVE |  | 728fe3b68fbc |  |
| 2026-08-17 | hooks-pipeline | Given the six config/hooks/*.cjs hooks are syntactically valid at d4f5905, when  | NONE | NONE | yes | INCONCLUSIVE |  | c3a5b17b759e |  |
| 2026-08-18 | sovereign-mesh | Given the sovereign-mesh surfaces (nostr-bridge, relay-slot) are path-dependent  | NONE | NONE | yes | INCONCLUSIVE |  | 8bfd1da98223 |  |
| 2026-08-18 | sovereign-mesh | Given the annexe clone at `8a495e4` cannot resolve the sibling path dependencies | NONE | NONE | yes | INCONCLUSIVE |  | 4becd512f2e4 |  |
| 2026-08-27 | ontology-monitor | Given the 2026-08-27 annexe bundle at commit `11d91abd` (green build, 64/64 drea | NONE | NONE | yes | INCONCLUSIVE |  | c004af3ed500 |  |
| 2026-08-28 | operator-handoff | OPERATOR FIX: evaluatorEntrypoints with nested double quotes were mangled by the annexe ssh dispatch (bash -lc consumes one escaping level); affected evaluators converted to checked-in scripts (scripts/dream-*.sh) invoked quote-free. Verified passing locally. Dream cycle: trust the script form; never inline double-quoted logic in dream.config.json. RuVector key: dream-evaluator-ssh-quoting-bug-class (patterns ns) | NONE | NONE | n/a | OPERATOR |  | session-018aCYi4 |  |
| 2026-08-29 | hooks-pipeline | Given the 2026-08-28 operator conversion of evaluators to checked-in scripts (`s | NONE | https://github.com/DreamLab-AI/agentbox/pull/3 | yes | ACCEPT |  | 69475221dcc4 |  |
| 2026-08-30 | sovereign-mesh | Given the annexe clone at `fbb2a2b6` does not contain the sibling repos `nostr-r | NONE | NONE | yes | INCONCLUSIVE |  | ace358d25f71 |  |
| 2026-08-31 | ontology-monitor | Given PR #3 was opened as a draft on 2026-08-29 with only a human empowered to m | NONE | NONE | yes | ACCEPT |  | dfa31471d47e |  |
| 2026-09-01 | hooks-pipeline | Given the 2026-08-28 conversion of evaluator entrypoints to checked-in scripts ( | NONE | NONE | yes | ACCEPT |  | 36eaf8b908f7 |  |
| 2026-09-01 | ledger-signals | fate reconciliation (operator): PR #3 was merged by human 2026-08-29T13:56Z (merge commit `55e96ea`), 16 minutes after opening — the annexe has no GitHub read so nights 08-30..09-01 carried the stale draft-open state forward; recording the terminal fate so the pending-merge queue clears | NONE | NONE | no | INCONCLUSIVE |  | operator | #3:MERGED |
| 2026-09-02 | sovereign-mesh | Given the per-night clone at `~/dream-annexe/2026-09-02-agentbox-p303/agentbox`  | NONE | NONE | yes | ACCEPT |  | 5c6385435532 |  |
