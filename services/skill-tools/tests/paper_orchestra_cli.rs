//! End-to-end tests of the `paper-orchestra` binary: exit-code conventions,
//! file/directory papers and the JSON outputs.

use std::path::Path;
use std::process::{Command, Output};

fn po(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_paper-orchestra"))
        .args(args)
        .output()
        .expect("run paper-orchestra")
}

fn code(o: &Output) -> i32 {
    o.status.code().expect("exit code")
}

fn out(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn s(p: &Path) -> &str {
    p.to_str().expect("utf-8 path")
}

fn write(p: &Path, body: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

#[test]
fn help_exits_zero_and_lists_subcommands() {
    let o = po(&["--help"]);
    assert_eq!(code(&o), 0);
    for name in [
        "init",
        "validate-inputs",
        "consistency",
        "validate-outline",
        "anti-leakage",
        "claim-evidence",
        "orphan-cites",
        "citation-coverage",
        "verify-refs",
        "reverse-outline",
        "score-delta",
        "decision-band",
        "score-trajectory",
        "concession-guard",
        "worklog",
        "critique-memory",
        "arxiv-preflight",
    ] {
        assert!(out(&o).contains(name), "{name} missing from help");
    }
}

#[test]
fn usage_errors_use_the_subcommands_own_code() {
    assert_eq!(code(&po(&["score-delta"])), 3);
    assert_eq!(code(&po(&["concession-guard"])), 3);
    assert_eq!(code(&po(&["orphan-cites"])), 2);
    assert_eq!(code(&po(&["no-such-subcommand"])), 2);
}

#[test]
fn init_then_validate_inputs() {
    let d = tempfile::tempdir().unwrap();
    let ws = d.path().join("ws");
    assert_eq!(code(&po(&["init", "--out", s(&ws)])), 0);
    assert!(ws.join("inputs/figures").is_dir());
    assert!(!ws.join("inputs/template.tex").exists());
    // Non-empty without --force.
    assert_eq!(code(&po(&["init", "--out", s(&ws)])), 1);
    assert_eq!(code(&po(&["init", "--out", s(&ws), "--force"])), 0);
    // Missing inputs -> 2.
    assert_eq!(code(&po(&["validate-inputs", "--workspace", s(&ws)])), 2);
    write(&ws.join("inputs/idea.md"), "");
    write(&ws.join("inputs/experimental_log.md"), "x 1 2 3 4 5 6");
    assert_eq!(code(&po(&["validate-inputs", "--workspace", s(&ws)])), 1);
    write(
        &ws.join("inputs/idea.md"),
        "# Problem Statement\nWe propose a method.\n# Core Hypothesis\nOur approach improves accuracy through regularisation of features during training across many epochs, \
         which we validate with controlled comparisons against strong published baselines under matched training budgets on standard benchmark datasets, reporting means and intervals over repeated runs with fixed seeds and identical preprocessing for every compared system.",
    );
    write(
        &ws.join("inputs/experimental_log.md"),
        "## 1. Experimental Setup\nTrained.\n## 2. Raw Numeric Data\n| M | Acc |\n|---|---|\n| A | 91.2 |\n| B | 89.5 |\n| C | 88.1 |\n| D | 70.3 |\n",
    );
    let o = po(&["validate-inputs", "--workspace", s(&ws)]);
    assert_eq!(code(&o), 0, "{} {}", out(&o), err(&o));
}

#[test]
fn score_delta_and_decision_band_exit_codes() {
    let d = tempfile::tempdir().unwrap();
    let (a, b) = (d.path().join("a.json"), d.path().join("b.json"));
    write(&a, r#"{"overall_score": 70, "axis_scores": {}}"#);
    write(&b, r#"{"overall_score": 82, "axis_scores": {}}"#);
    let o = po(&["score-delta", "--prev", s(&a), "--curr", s(&b)]);
    assert_eq!(code(&o), 5, "{}", out(&o));
    assert!(out(&o).contains("\"decision\": \"HALT_TARGET_MET\""));
    assert_eq!(
        code(&po(&["score-delta", "--prev", s(&b), "--curr", s(&a)])),
        1
    );
    assert_eq!(
        code(&po(&[
            "score-delta",
            "--prev",
            "/nonexistent",
            "--curr",
            s(&a)
        ])),
        3
    );
    let o = po(&["decision-band", "74.6"]);
    assert_eq!(code(&o), 0);
    assert!(out(&o).contains("\"decision_band\": \"Minor Revision\""));
    assert_eq!(code(&po(&["decision-band", "70", "--accept-min", "10"])), 2);
}

#[test]
fn concession_guard_blocks_on_standing_critical() {
    let d = tempfile::tempdir().unwrap();
    let log = d.path().join("log.json");
    write(
        &log,
        r#"{"rounds":[{"round":1,"findings":[{"id":"F1","severity":"critical","attack":"x","rebuttal_score":2,"conceded":true}]}]}"#,
    );
    let o = po(&["concession-guard", "--log", s(&log)]);
    assert_eq!(code(&o), 1);
    assert!(out(&o).contains("recommended action: REVERT"));
    write(&log, r#"{"rounds":[]}"#);
    assert_eq!(code(&po(&["concession-guard", "--log", s(&log)])), 3);
}

#[test]
fn worklog_appends_and_tracks_best() {
    let d = tempfile::tempdir().unwrap();
    let (wl, sc) = (d.path().join("w/worklog.json"), d.path().join("score.json"));
    write(&sc, r#"{"overall_score": 61.5}"#);
    for i in ["0", "1"] {
        let o = po(&[
            "worklog",
            "--worklog",
            s(&wl),
            "--iter",
            i,
            "--score",
            s(&sc),
            "--decision",
            "ACCEPT_IMPROVED",
        ]);
        assert_eq!(code(&o), 0, "{}", err(&o));
    }
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&wl).unwrap()).unwrap();
    assert_eq!(v["iterations"].as_array().unwrap().len(), 2);
    assert_eq!(v["best_iter"], 0, "first maximal entry wins");
}

#[test]
fn papers_may_be_directories_with_inputs() {
    let d = tempfile::tempdir().unwrap();
    write(
        &d.path().join("paper/main.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\input{sec/a}\n\\bibliography{refs}\n\\end{document}\n",
    );
    write(
        &d.path().join("paper/sec/a.tex"),
        "\\section{A}\nSee \\citep{known} and \\textcite[p.~2]{ghost}.\n",
    );
    write(
        &d.path().join("paper/refs.bib"),
        "@article{known,\n title={T}}\n@article{spare,\n title={U}}\n",
    );
    let (paper, bib) = (d.path().join("paper"), d.path().join("paper/refs.bib"));
    let o = po(&["orphan-cites", s(&paper), s(&bib)]);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("ghost"));
    assert!(
        out(&o).contains("spare"),
        "unused keys are listed even when orphans exist"
    );
    // Anti-leakage on the same directory.
    assert_eq!(code(&po(&["anti-leakage", s(&paper)])), 0);
}

#[test]
fn missing_and_refused_includes_are_warned_on_every_paper_gate() {
    let d = tempfile::tempdir().unwrap();
    write(
        &d.path().join("paper/main.tex"),
        "\\begin{document}\n\\input{nowhere}\n\\input{/etc/hostname}\n\\cite{known}\n\\end{document}\n",
    );
    write(&d.path().join("refs.bib"), "@article{known,\n title={T}}\n");
    let (paper, bib) = (d.path().join("paper"), d.path().join("refs.bib"));
    let o = po(&["orphan-cites", s(&paper), s(&bib)]);
    assert_eq!(code(&o), 0);
    assert!(
        err(&o).contains("nowhere") && err(&o).contains("/etc/hostname"),
        "{}",
        err(&o)
    );
    assert!(err(&po(&["anti-leakage", s(&paper)])).contains("not found or refused"));
}

#[test]
fn claim_evidence_log_and_ledger_modes() {
    let d = tempfile::tempdir().unwrap();
    let tex = d.path().join("p.tex");
    write(
        &tex,
        "\\begin{document}\n\\section{R}\nWe reach \\ledger[pct]{a.acc} here. A made-up 77.7\\% gain.\n\\ledger{gone}\n\\end{document}\n",
    );
    let ledger = d.path().join("ledger.json");
    write(
        &ledger,
        r#"{"entries":[{"id":"a.acc","value":0.9,"text":"90%"}]}"#,
    );
    let (rep, md) = (d.path().join("r.json"), d.path().join("r.md"));
    let o = po(&[
        "claim-evidence",
        "--paper",
        s(&tex),
        "--ledger",
        s(&ledger),
        "--out",
        s(&rep),
        "--out-md",
        s(&md),
    ]);
    assert_eq!(
        code(&o),
        2,
        "unknown id outranks needs-evidence: {}",
        out(&o)
    );
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&rep).unwrap()).unwrap();
    assert_eq!(v["errors"][0]["id"], "gone");
    assert_eq!(v["needs_evidence"][0]["value"], "77.7");
    assert_eq!(v["needs_evidence"][0]["line"], 3);
    assert!(std::fs::read_to_string(&md).unwrap().contains("77.7"));

    write(
        &tex,
        "\\begin{document}\nWe reach \\ledger{a.acc}.\n\\end{document}\n",
    );
    assert_eq!(
        code(&po(&[
            "claim-evidence",
            "--paper",
            s(&tex),
            "--ledger",
            s(&ledger),
            "--out",
            s(&rep)
        ])),
        0
    );

    let log = d.path().join("log.md");
    write(&log, "| Ours | 87.4 |");
    write(
        &tex,
        "\\section{E} We reach 87.4\\% accuracy and 99.1\\% recall.\n",
    );
    let o = po(&[
        "claim-evidence",
        "--paper",
        s(&tex),
        "--log",
        s(&log),
        "--out",
        s(&rep),
    ]);
    assert_eq!(code(&o), 1);
    assert!(out(&o).contains("needs evidence: 1"));
    // Exactly one of --log / --ledger.
    assert_eq!(
        code(&po(&[
            "claim-evidence",
            "--paper",
            s(&tex),
            "--out",
            s(&rep)
        ])),
        2
    );
}

#[test]
fn verify_refs_exit_code_follows_row_failures() {
    let d = tempfile::tempdir().unwrap();
    let c = d.path().join("c.json");
    write(
        &c,
        r#"[{"key":"a","claimed_title":"Attention is all you need","found_title":"Attention Is All You Need","found_date":"2017-06-12"}]"#,
    );
    assert_eq!(
        code(&po(&[
            "verify-refs",
            "--candidates",
            s(&c),
            "--cutoff",
            "2024-10-01"
        ])),
        0
    );
    assert_eq!(
        code(&po(&[
            "verify-refs",
            "--candidates",
            s(&c),
            "--cutoff",
            "2017-01-01"
        ])),
        1
    );
    assert_eq!(
        code(&po(&[
            "verify-refs",
            "--candidates",
            s(&c),
            "--cutoff",
            "tomorrow"
        ])),
        2
    );
}

#[test]
fn arxiv_preflight_exit_codes_and_json() {
    let d = tempfile::tempdir().unwrap();
    let src = d.path().join("src");
    write(
        &src.join("main.tex"),
        "\\pdfoutput=1\n\\documentclass{article}\n\\begin{document}\n\\begin{abstract}A fine abstract.\\end{abstract}\nText.\n\\end{document}\n",
    );
    let j = d.path().join("pf.json");
    let o = po(&[
        "arxiv-preflight",
        "--source",
        s(&src),
        "--main",
        "main.tex",
        "--json",
        s(&j),
    ]);
    assert_eq!(code(&o), 0, "{}", out(&o));
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&j).unwrap()).unwrap();
    assert_eq!(v["errors"], 0);
    write(
        &src.join("main.tex"),
        "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}\n",
    );
    let o = po(&["arxiv-preflight", "--source", s(&src), "--main", "main.tex"]);
    assert_eq!(
        code(&o),
        1,
        "pdfoutput is informational; the missing abstract only warns"
    );
    assert!(out(&o).contains("[pdfoutput]"));
    write(
        &src.join("main.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\includegraphics{gone}\n\\end{document}\n",
    );
    assert_eq!(
        code(&po(&[
            "arxiv-preflight",
            "--source",
            s(&src),
            "--main",
            "main.tex"
        ])),
        2
    );
    assert_eq!(
        code(&po(&[
            "arxiv-preflight",
            "--source",
            s(&src),
            "--main",
            "nope.tex"
        ])),
        2
    );
}

#[test]
fn reverse_outline_and_strict_mode() {
    let d = tempfile::tempdir().unwrap();
    let tex = d.path().join("p.tex");
    write(
        &tex,
        "\\begin{document}\\section{S} However, this fails in practice when agents write outside the workspace root. We extend the matcher to canonicalise paths.\\end{document}",
    );
    let (md, js) = (d.path().join("o.md"), d.path().join("o.json"));
    let o = po(&[
        "reverse-outline",
        "--paper",
        s(&tex),
        "--out",
        s(&md),
        "--json",
        s(&js),
    ]);
    assert_eq!(code(&o), 0);
    assert!(std::fs::read_to_string(&md)
        .unwrap()
        .contains("`no-topic-sentence`"));
    assert!(std::fs::read_to_string(&js)
        .unwrap()
        .contains("\"sections\""));
    assert_eq!(
        code(&po(&[
            "reverse-outline",
            "--paper",
            s(&tex),
            "--out",
            s(&md),
            "--strict"
        ])),
        1
    );
    assert_eq!(
        code(&po(&[
            "reverse-outline",
            "--paper",
            "/nonexistent.tex",
            "--out",
            s(&md)
        ])),
        2
    );
}

#[test]
fn validate_outline_exit_codes() {
    let d = tempfile::tempdir().unwrap();
    let f = d.path().join("outline.json");
    write(
        &f,
        r#"{"plotting_plan":[],"intro_related_work_plan":{},"section_plan":[]}"#,
    );
    let o = po(&["validate-outline", s(&f)]);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("plotting_plan"));
    assert_eq!(code(&po(&["validate-outline", "/nonexistent.json"])), 1);
}

#[test]
fn score_trajectory_and_critique_memory() {
    let d = tempfile::tempdir().unwrap();
    for (i, v) in [(0, 50.0), (1, 60.0)] {
        let body: String = format!(
            "{{\"scientific_depth\":{v},\"technical_execution\":{v},\"logical_flow\":{v},\"writing_clarity\":{v},\"evidence_presentation\":{v},\"academic_style\":{v}}}"
        );
        write(&d.path().join(format!("scores/iter{i}/scores.json")), &body);
    }
    let report = d.path().join("traj.json");
    let o = po(&[
        "score-trajectory",
        "--scores-dir",
        s(&d.path().join("scores")),
        "--report-path",
        s(&report),
    ]);
    assert_eq!(code(&o), 0, "{}", out(&o));
    assert!(std::fs::read_to_string(&report)
        .unwrap()
        .contains("\"status\": \"ok\""));

    let (rev, mem) = (d.path().join("review.json"), d.path().join("mem.json"));
    write(
        &rev,
        r#"{"weaknesses":["Ablations omit the temperature sweep"]}"#,
    );
    let o = po(&[
        "critique-memory",
        "--worklog",
        s(&d.path().join("absent.json")),
        "--review",
        s(&rev),
        "--iter",
        "1",
        "--out",
        s(&mem),
    ]);
    assert_eq!(code(&o), 0, "{}", err(&o));
    assert!(std::fs::read_to_string(&mem)
        .unwrap()
        .contains("\"total_unique_findings\": 1"));
}

#[test]
fn consistency_and_citation_coverage() {
    let d = tempfile::tempdir().unwrap();
    let (idea, log) = (d.path().join("idea.md"), d.path().join("log.md"));
    write(&idea, "We study accuracy on CIFAR-10.");
    write(&log, "| Model | Accuracy |\n|---|---|\n| Ours | 0 |\n");
    assert_eq!(
        code(&po(&["consistency", "--idea", s(&idea), "--log", s(&log)])),
        1
    );
    let (tex, pool) = (d.path().join("p.tex"), d.path().join("pool.json"));
    write(&tex, "\\cite{a}");
    write(
        &pool,
        r#"{"papers":[{"bibtex_key":"a"},{"bibtex_key":"b"},{"bibtex_key":"c"}]}"#,
    );
    assert_eq!(
        code(&po(&[
            "citation-coverage",
            "--tex",
            s(&tex),
            "--pool",
            s(&pool)
        ])),
        1
    );
    assert_eq!(
        code(&po(&[
            "citation-coverage",
            "--tex",
            s(&tex),
            "--pool",
            s(&pool),
            "--threshold",
            "0.3"
        ])),
        0
    );
}
