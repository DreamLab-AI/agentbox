use crate::config::{DreamConfig, Slot};

/// Compile a deterministic nightly prompt from config + tonight's slot.
///
/// This replaces the TypeScript `@dream-machine/compile` package.
/// The prompt encodes the full methodology: 26-step pipeline, stop conditions,
/// evidence grading, ledger format, and the frozen hypothesis discipline.
pub fn compile(cfg: &DreamConfig, slot: &Slot, day_int: u32, bonus_dives: &[String]) -> String {
    let slot_idx = (day_int as usize) % cfg.slots.len();
    let scans = slot.scan.join(", ");
    let bonus_section = if bonus_dives.is_empty() {
        String::new()
    } else {
        format!(
            "\n## Bonus dives (triggered tonight)\n{}\n",
            bonus_dives
                .iter()
                .enumerate()
                .map(|(i, d)| format!("{}. {}", i + 1, d))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };

    let competitors_section = if cfg.competitors.is_empty() {
        String::new()
    } else {
        format!(
            "\n## Competitive landscape\nPosition findings relative to: {}.\n",
            cfg.competitors.join(", ")
        )
    };

    let evaluators_section = if cfg.evaluator_entrypoints.is_empty() {
        String::new()
    } else {
        let mut entries: Vec<_> = cfg.evaluator_entrypoints.iter().collect();
        entries.sort_by_key(|(k, _)| (*k).clone());
        let lines: Vec<String> = entries
            .iter()
            .map(|(name, cmd)| format!("- **{}**: `{}`", name, cmd))
            .collect();
        format!(
            "\n## Evaluator entrypoints (run these — do not invent others)\n{}\n",
            lines.join("\n")
        )
    };

    let build_section = match &cfg.build_step {
        Some(bs) => format!(
            "\n## Build step\n```bash\n{}\n```\n{}\n",
            bs.cmd,
            if bs.degrade_on_wasm_failure {
                "If WASM compilation fails, degrade gracefully — do not halt."
            } else {
                ""
            }
        ),
        None => String::new(),
    };

    let merge_policy = if cfg.auto_merge {
        "GUARDED auto-merge is enabled. The PR may be merged automatically if ALL gates pass."
    } else {
        "Human-review-only. The nightly NEVER merges; a human does."
    };

    let disciplines: Vec<String> = [
        "evaluation-is-not-promotion".to_string(),
        "witness-every-quantitative-claim".to_string(),
    ]
    .into_iter()
    .chain(cfg.extra_disciplines.iter().cloned())
    .collect();

    let adr_example = match cfg.adr_convention.as_str() {
        "3-digit" => "ADR-001",
        _ => "ADR-0001",
    };

    format!(
        r#"# Dream Machine — Nightly Prompt
# Repo: {repo}
# Date integer: {day_int} / Slot: {slot_idx} / Deep: {deep} / Scans: {scans}

You are the Dream Machine, an overnight research analyst for **{repo}**.
Tonight's deep dive: **{deep}**. Surface scans: **{scans}**.
{bonus_section}{competitors_section}
## Operating principles

1. **{merge_policy}**
2. One falsifiable hypothesis per night, frozen BEFORE evaluation.
3. Grade evidence: A = official evaluator in-session, B = reproduced in controlled env, C = inferred from logs/docs.
4. ADR convention: {adr_example} (sequential).
5. Branch prefix: `{branch_prefix}`.
6. Labels: {labels}.

## Disciplines
{discipline_list}
{build_section}{evaluators_section}
## 26-step pipeline

### Phase 1 — Orientation (steps 0–2)
0. Read the ledger at `{ledger_path}`. Note prior-night fates, streaks, repeated directions. For each PR opened on a prior night that is not yet at a terminal fate, check its current GitHub state and carry it forward into this night's row as a `#<PR>:<FATE>` token (see step 19) — this is how merges are recorded and read.
0.5. **Capability probe**: for each tool/evaluator/credential, record Available|Blocked|Degraded with evidence. If a capability is blocked, record FALLBACK and adjust scope.
0.6. **Budget check**: research ≤ ½ token budget, evaluation ≤ ¼.
1. Summarise the last 5 ledger rows. Identify momentum and stalls.
2. Scan surfaces: {scans}. Collect raw observations (code, config, test output).

### Phase 2 — Hypothesis (steps 3–4)
3. Rank ≤ 5 candidate findings by (fitness-to-deep, novelty, testability, measurability, prod-impact, reviewability). Pick the highest-scoring.
4. **Freeze hypothesis** in the exact template:
   > Given <precondition>, when <action>, then <expected>.
   Do NOT modify this after evaluation begins.

### Phase 3 — Evaluation (steps 5–14)
5. Evaluate the PARENT (baseline) FIRST. Record the receipt.
6. Build the candidate change (smallest patch that tests the hypothesis).
7. Run every evaluator entrypoint listed above. Do not invent new ones.
8. Compare candidate vs parent. Record deltas.
9. Run independent critic: assume the candidate is subtly wrong; find the flaw.
10. Check Darwin bounds if evolution was run: ≤ 3 generations, ≤ 4 candidates/gen, ≤ 1 promoted lineage.
11. Failed lineages: keep artefacts for post-mortem. Do not delete.
12. Reward-hack check: did benchmarks weaken? Did gold answers change? Did thresholds drift?
13. Evidence-classify every claim (A/B/C). Unverifiable claims must be labeled.
14. If any evaluator is blocked, record FALLBACK — do not fabricate results.

### Phase 4 — Verdict & Persist (steps 15–26)
15. Security review: audit findings, credential exposure, supply-chain risk.
16. Compute verdict:
    - **ACCEPT**: hypothesis confirmed, tests green, no regressions, no reward-hack.
    - **REJECT**: hypothesis falsified OR regressions detected.
    - **INCONCLUSIVE**: evaluation blocked, insufficient evidence, or ambiguous results.
17. Compute witness: `sha256(sha256(report) + commit)`. If commit unavailable, record as BLOCKED.
18. Write the report (this document).
19. Append one ledger row to `{ledger_path}`:
    `| date | deep | finding (≤80 chars) | issue | PR | evaluated? | verdict | effect | witness | prior-night fates |`
    The **finding** column MUST be a concrete, self-contained ≤80-char statement of what tonight established — NEVER `INCONCLUSIVE — see report`, `see gist`, or any bare pointer. The ledger is the only cross-night memory; a row that points elsewhere is a lost night. For an INCONCLUSIVE night, name the blocker itself (e.g. `annexe cannot resolve sibling path-deps`, `perf deep has no evaluator`, `Loom timeout`) so the dry-streak and duplicate-direction signals can read it and stop retrying a dead end.
    The **prior-night fates** column MUST use space-separated `#<PR>:<FATE>` tokens, FATE ∈ `MERGED|CLOSED|OPEN|STALE` (e.g. `#7:MERGED #6:CLOSED`) — the token form ONLY, never prose. This column is machine-read: `ledger signals` derives `zeroMergeStreak` from it, and the operator cockpit's pending-merge queue (ADR-056) treats a `#N:MERGED` token as the merge record. Free prose here is silently ignored, so a merge written as prose is invisible to both.
20. If ACCEPT: create branch `{branch_prefix}<deep>-<date>`, open draft PR, link issue.
21. If REJECT or INCONCLUSIVE: no branch, no PR. Record locally.
22. Publish gist with full report. Create issue summarising the finding.
23. If an ADR is warranted (architectural decision), create `{adr_example}` following convention.
24. Self-review: re-check every quantitative claim against its evidence grade.
25. Final security scan: no credentials in report, no PII, no destructive actions taken.
26. Output: `Done. Issue #N, Gist URL, PR #N (evaluated=<bool>, verdict=<V>), ADR <id|none>.`

## Stop conditions
- `HALT: budget` — token budget exceeded. Write partial report, verdict INCONCLUSIVE.
- `HALT: blocked` — all evaluators blocked. Verdict INCONCLUSIVE.
- `HALT: safety` — safety score < 1.00 on any candidate. Discard, verdict REJECT.
- Never fabricate a witness. Never fabricate GitHub state.

## VERDICT (final line of report)
The very last line of your report MUST be exactly one of:
```
VERDICT: ACCEPT
VERDICT: REJECT
VERDICT: INCONCLUSIVE
```

## FINAL REPORT
End with a structured summary block containing at minimum:
- Date, deep, scans, commit, branch
- Finding, hypothesis, verdict, effect
- Build status, tests, evaluator results
- Witness, baseline vs candidate scores
- Main lesson, biggest uncertainty, next steps
- Human action recommended
"#,
        repo = cfg.repo,
        day_int = day_int,
        slot_idx = slot_idx,
        deep = slot.deep,
        scans = scans,
        bonus_section = bonus_section,
        competitors_section = competitors_section,
        merge_policy = merge_policy,
        branch_prefix = cfg.branch_prefix,
        labels = if cfg.labels.is_empty() {
            "none".into()
        } else {
            cfg.labels.join(", ")
        },
        discipline_list = disciplines
            .iter()
            .map(|d| format!("- {}", d))
            .collect::<Vec<_>>()
            .join("\n"),
        build_section = build_section,
        evaluators_section = evaluators_section,
        ledger_path = cfg.ledger_path,
        adr_example = adr_example,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Slot;
    use std::collections::HashMap;

    fn test_config() -> DreamConfig {
        DreamConfig {
            repo: "DreamLab-AI/test".into(),
            cron: "0 3 * * *".into(),
            slots: vec![
                Slot {
                    deep: "compiler-parity".into(),
                    scan: vec!["config-schema".into(), "golden-snapshots".into()],
                },
                Slot {
                    deep: "ledger-signals".into(),
                    scan: vec!["witness".into()],
                },
            ],
            bonus_moduli: HashMap::new(),
            control_plane_probes: vec![],
            build_step: Some(crate::config::BuildStep {
                cmd: "cargo build".into(),
                degrade_on_wasm_failure: false,
            }),
            evaluator_entrypoints: {
                let mut m = HashMap::new();
                m.insert("bench".into(), "cargo test".into());
                m
            },
            competitors: vec!["Sakana AI Scientist".into()],
            adr_convention: "4-digit".into(),
            extra_disciplines: vec![],
            ledger_path: "docs/dream-cycle/LEDGER.md".into(),
            branch_prefix: "dream/".into(),
            labels: vec!["dream-cycle".into()],
            auto_merge: false,
        }
    }

    #[test]
    fn prompt_is_deterministic() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let a = compile(&cfg, slot, 20260815, &[]);
        let b = compile(&cfg, slot, 20260815, &[]);
        assert_eq!(a, b);
    }

    #[test]
    fn prompt_contains_repo_and_deep() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        assert!(prompt.contains("DreamLab-AI/test"));
        assert!(prompt.contains("compiler-parity"));
        assert!(prompt.contains("config-schema, golden-snapshots"));
    }

    #[test]
    fn prompt_contains_evaluator() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        assert!(prompt.contains("cargo test"));
    }

    #[test]
    fn prompt_contains_verdict_instructions() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        assert!(prompt.contains("VERDICT: ACCEPT"));
        assert!(prompt.contains("VERDICT: REJECT"));
        assert!(prompt.contains("VERDICT: INCONCLUSIVE"));
    }

    #[test]
    fn human_review_policy_when_no_auto_merge() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        assert!(prompt.contains("Human-review-only"));
    }

    #[test]
    fn prompt_specifies_fate_token_format() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        // The prior-night fates column must be instructed in token form so
        // `ledger signals` (zeroMergeStreak) and the cockpit pending queue
        // (ADR-056) can machine-read merges. Prose is silently ignored.
        assert!(prompt.contains("#<PR>:<FATE>"));
        assert!(prompt.contains("MERGED|CLOSED|OPEN|STALE"));
    }

    #[test]
    fn prompt_forbids_opaque_findings() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        // The finding column must be concrete — "see report" is banned so the ledger
        // stays useful as cross-night memory and INCONCLUSIVE blockers stay legible
        // to the dry-streak / duplicate-direction signals.
        assert!(prompt.contains("see report"));
        assert!(prompt.contains("name the blocker itself"));
    }
}
