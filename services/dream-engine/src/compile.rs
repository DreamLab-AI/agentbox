use crate::config::{DreamConfig, Slot};

/// Compile a deterministic nightly prompt from config + tonight's slot.
///
/// This replaces the TypeScript `@dream-machine/compile` package.
/// The prompt encodes the methodology for a **single completion** (ADR-2114):
/// what the engine has already done and will do after the reply, the
/// hypothesis → candidate-diff method, evidence grading, the proposed ledger
/// row, and the frozen hypothesis discipline. It never asks the model to run,
/// publish or persist anything — the engine owns every side effect.
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
            .map(|(name, spec)| {
                format!(
                    "- **{}** ({}): `{}`",
                    name,
                    if spec.required { "REQUIRED — a bad result vetoes acceptance" } else { "advisory" },
                    spec.cmd
                )
            })
            .collect();
        format!(
            "\n## Evaluator entrypoints (the engine runs these on the baseline and on your candidate — you cannot)\n{}\n\
             A REQUIRED evaluator that is missing, silent, blocked, timed out or failing \
             vetoes ACCEPT deterministically, whatever this report says (ADR-2024).\n",
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
3. Grade evidence: A = evaluator receipt in this prompt, B = source shown in this prompt, C = inference.
4. ADR convention: {adr_example} (sequential).
5. Branch prefix: `{branch_prefix}`.
6. Labels: {labels}.

## Disciplines
{discipline_list}
{build_section}{evaluators_section}
## What you are, and what the engine does

You are a **single model call**. You cannot run commands, read anything beyond this prompt, open branches or PRs, publish gists or issues, or write the ledger. Before calling you the engine has already: dispatched commit `(see Session commit below)` to the annexe, run the build step and every evaluator listed above (their receipts are under TONIGHT'S EVIDENCE), and read the source files most relevant to tonight's deep from that same commit (the `## Source` section, when present).

After you reply, the **engine** extracts your ```dream-patch block, applies it to that commit in isolation, re-runs every REQUIRED evaluator against the candidate, and decides the verdict from those receipts — an ACCEPT whose candidate does not pass is vetoed whatever this report says. The engine then writes the ledger row at `{ledger_path}` and, only on an upheld ACCEPT, opens a **draft** PR on a `{branch_prefix}<deep>-<date>` branch for a human to merge.

Never claim to have run, built, tested, published, pushed or merged anything. Report what the receipts and source show, and what you predict the candidate will do.

## Method

### 1 — Orientation
1. Read the recent ledger rows in the evidence. Note streaks, repeated directions and the blockers prior nights named; do not retry a direction a prior night showed is blocked.
2. Read tonight's receipts and source for the scans **{scans}**. Collect raw observations, citing receipt names and `path:line`.

### 2 — Hypothesis
3. Rank ≤ 5 candidate findings by (fitness-to-deep, novelty, testability against the REQUIRED evaluators, reviewability, smallness of the diff). Pick the highest-scoring one whose change you can write against the source shown.
4. **Freeze the hypothesis** in the exact template:
   > Given <precondition>, when <action>, then <expected>.
   Do NOT modify it afterwards.

### 3 — Candidate
5. Write the smallest change that tests the hypothesis as a unified diff against the source shown. Copy context lines verbatim from it. Never write a hunk inside an elided region or against a file that is not shown (creating a new file is fine). If the source you need was not provided, name the file and line range and give INCONCLUSIVE with that as the blocker.
6. For each REQUIRED evaluator, predict what it will report on the candidate and why, citing receipt lines.
7. Critic: assume the candidate is subtly wrong and find the flaw. Reward-hack check: a change that weakens a test, benchmark, threshold or gold answer is not a candidate.
8. Evidence-grade every claim: **A** = a receipt shown in this prompt, **B** = a direct reading of source shown, **C** = inference. Label anything unverifiable.
9. Security: no credentials, PII or destructive operations in the diff or the report.

### 4 — Verdict
10. Choose the verdict:
    - **ACCEPT**: you emit a candidate diff you expect to pass every REQUIRED evaluator with no regression and no reward-hack. The engine's re-run decides whether it stands.
    - **REJECT**: the evidence falsifies the hypothesis, or the only available change would regress.
    - **INCONCLUSIVE**: the evidence or source is insufficient to write or judge a candidate. Name the blocker.
11. If ACCEPT: emit the candidate change as **one git-apply-able unified diff** (paths relative to the repo root, standard `a/`…`b/…` prefixes) inside a fenced block delimited exactly:
    ```dream-patch
    <the full diff>
    ```
    Emit exactly one such block. An ACCEPT without it is vetoed by the engine: a finding with no code change is a REJECT or INCONCLUSIVE, stated plainly. The diff must not delete a binary file; the engine refuses such a patch before applying it.
12. Include ONE proposed ledger row in the report, in exactly this shape, so the engine can take your finding cell (the engine fills the issue, PR, witness, prior-night-fate and reviewer columns from its own records — leave them as shown):
    `| {date_iso} | {deep} | <finding> | NONE | NONE | yes | <VERDICT> | <effect> |  |  |  |  |`
    The **finding** MUST be a concrete, self-contained ≤80-char statement of what tonight established — NEVER `INCONCLUSIVE — see report`, `see gist`, or any bare pointer. The ledger is the only cross-night memory; a row that points elsewhere is a lost night. For an INCONCLUSIVE night, name the blocker itself (e.g. `annexe cannot resolve sibling path-deps`, `perf deep has no evaluator`, `source for src/x.rs:200-400 not provided`) so the dry-streak and duplicate-direction signals can read it and stop retrying a dead end.
13. If an ADR is warranted, propose it ({adr_example} convention) under **Human action recommended** — you cannot file it.

## Stop conditions
- Every REQUIRED evaluator blocked or silent in the receipts → INCONCLUSIVE, naming the blocker.
- A candidate that fails the security step → REJECT.
- Never fabricate a receipt, a command result, a witness, or GitHub state.

## VERDICT (final line of report)
The very last line of your report MUST be exactly one of:
```
VERDICT: ACCEPT
VERDICT: REJECT
VERDICT: INCONCLUSIVE
```

## FINAL REPORT
End with a structured summary block containing at minimum:
- Date, deep, scans, commit
- Finding, hypothesis, verdict, predicted effect
- Receipts and source files cited; files the candidate changes
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
        date_iso = date_iso(day_int),
        adr_example = adr_example,
    )
}

/// `20260815` → `2026-08-15`; anything else is passed through unchanged so the
/// row stays well-formed text even for a synthetic day integer.
fn date_iso(day_int: u32) -> String {
    let s = day_int.to_string();
    if s.len() == 8 {
        format!("{}-{}-{}", &s[..4], &s[4..6], &s[6..])
    } else {
        s
    }
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
            annexe_include: vec![],
            evaluator_entrypoints: {
                let mut m = HashMap::new();
                m.insert("bench".into(), crate::config::EvaluatorSpec::command("cargo test"));
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
    fn prompt_assigns_side_effects_to_the_engine() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        // ADR-2114: the model is one completion with no tools. The prompt must
        // say so and must not ask it to run, publish or persist anything —
        // the old agent-shaped steps produced narrated ACCEPTs with no diff.
        assert!(prompt.contains("single model call"));
        assert!(prompt.contains("Never claim to have run"));
        for banned in [
            "Publish gist",
            "Create issue",
            "Append one ledger row",
            "check its current GitHub state",
            "Run every evaluator entrypoint",
        ] {
            assert!(!prompt.contains(banned), "prompt still asks the model to: {banned}");
        }
        // Prior-night fates and reviewer columns are engine-filled now.
        assert!(prompt.contains(
            "engine fills the issue, PR, witness, prior-night-fate and reviewer columns"
        ));
    }

    #[test]
    fn proposed_ledger_row_parses_as_a_ledger_row() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        let row = prompt
            .lines()
            .map(str::trim)
            .find(|l| l.starts_with("`| 2026-08-15 | compiler-parity |"))
            .expect("row template present")
            .trim_matches('`');
        // verdict::report_ledger_row_finding needs ≥12 `|` cells, ISO date first.
        assert!(row.split('|').count() >= 12, "{row}");
        assert_eq!(date_iso(20260815), "2026-08-15");
        assert_eq!(date_iso(7), "7");
    }

    #[test]
    fn prompt_forbids_accept_without_patch() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        assert!(prompt.contains("An ACCEPT without it is vetoed by the engine"));
        assert!(prompt.contains("Never write a hunk inside an elided region"));
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

    #[test]
    fn prompt_asks_for_a_dream_patch_block() {
        let cfg = test_config();
        let slot = &cfg.slots[0];
        let prompt = compile(&cfg, slot, 20260815, &[]);
        // ADR-061 (amended by ADR-2114): ACCEPT must emit the candidate as a
        // ```dream-patch block the engine applies, re-evaluates and — only if
        // the gate upholds it — opens as a draft PR.
        assert!(prompt.contains("```dream-patch"));
        assert!(prompt.contains("draft"));
    }
}
