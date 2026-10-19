//! Main pipeline — port of `run(args)` and the `argparse` CLI definition
//! (`main()`) from `promote.py`.

use super::candidate::{find_candidates, find_candidates_from, target_page_name};
use super::dossier::{
    clear_slug_outputs, load_processed_fingerprint_sets, write_dossier_json, write_dossier_md,
};
use super::judge::judge_before_after;
use super::ledger_parse::{load_ledger_dir_assertions, Assertion};
use super::loom::{assemble_draft, check_loom_reachable, DraftResult};
use super::working_page::write_working_page;
use super::{completeness, DEFAULT_LOOM_MODEL, DEFAULT_LOOM_URL};
use crate::ingest::ledger::LEDGER_SUBDIR;
use clap::Parser;
use std::path::{Path, PathBuf};

/// Ledger promotion: candidacy detector + dossier assembly.
#[derive(Parser, Debug)]
#[command(name = "podcast-promote")]
pub struct Args {
    /// dir containing the target topic pages (`<Topic>.md`) the ledger bullets link to
    /// (the curated corpus, `$VAULT_PAGES`). Also holds the retired flat
    /// `podcast-evidence___*.md` ledger pages when `--ledger-dir` is not in play.
    #[arg(long)]
    pub pages_dir: PathBuf,

    /// dir holding the evidence ledgers, one `<episode-slug>.md` each. Defaults
    /// to `<working-graph-dir>/podcast-evidence` when that directory exists,
    /// otherwise the ledgers are looked for in `--pages-dir` (flat layout).
    #[arg(long)]
    pub ledger_dir: Option<PathBuf>,

    /// output dir for survivor dossiers
    #[arg(long)]
    pub proposals_dir: PathBuf,

    /// output dir for rejected dossiers (default: <proposals-dir>/../rejects)
    #[arg(long)]
    pub rejects_dir: Option<PathBuf>,

    /// min assertions for a topic to become a candidate
    #[arg(long, default_value_t = 5)]
    pub min_assertions: usize,

    /// min distinct episodes for a topic to become a candidate
    #[arg(long, default_value_t = 2)]
    pub min_episodes: usize,

    /// min rubric-A improvement to survive
    #[arg(long, default_value_t = -0.5)]
    pub judge_a_min: f64,

    /// rubric-B improvement must be strictly > this to survive
    #[arg(long, default_value_t = 0.0)]
    pub judge_b_min: f64,

    /// min answer-completeness score to survive
    #[arg(long, default_value_t = 0.6)]
    pub completeness_min: f64,

    /// seed for blind A/B ordering
    #[arg(long, default_value_t = 42)]
    pub judge_seed: i64,

    #[arg(long, default_value = DEFAULT_LOOM_URL)]
    pub loom_url: String,

    #[arg(long, default_value = DEFAULT_LOOM_MODEL)]
    pub loom_model: String,

    /// only run candidacy detection, no Loom/judge calls, no writes
    #[arg(long)]
    pub dry_run: bool,

    /// process at most N candidates this run
    #[arg(long)]
    pub limit: Option<usize>,

    /// if set, rejected candidates also land their processed news as a vault page here
    /// (default: $VAULT_WORKING_PAGES from agentbox.toml [vault].working)
    #[arg(long, env = "VAULT_WORKING_PAGES")]
    pub working_graph_dir: Option<PathBuf>,

    /// cap assertions handed to draft/completeness, strongest first; 0 = uncapped
    #[arg(long, default_value_t = 12)]
    pub max_dossier_assertions: usize,
}

/// Where the ledgers are read from: the explicit `--ledger-dir`, else the working
/// vault's `<working-graph-dir>/podcast-evidence` when it exists, else `None`
/// (the flat layout, ledgers beside the topic pages).
pub fn resolve_ledger_dir(args: &Args) -> Option<PathBuf> {
    args.ledger_dir.clone().or_else(|| {
        args.working_graph_dir
            .as_ref()
            .map(|w| w.join(LEDGER_SUBDIR))
            .filter(|d| d.is_dir())
    })
}

fn conf_float(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(0.0)
}

/// Pragmatic `Path.resolve()` equivalent that never fails for a
/// not-yet-existing path (Rust's `fs::canonicalize` does): makes the path
/// absolute against the current directory. Does not resolve symlinks —
/// acceptable here since the result only affects log messages and the
/// `rejects_dir` default derivation, never file contents.
fn resolve_path(p: &Path) -> PathBuf {
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    }
}

/// Port of `run(args)`. Returns the process exit code.
pub async fn run(args: &Args) -> i32 {
    let pages_dir = resolve_path(&args.pages_dir);
    let proposals_dir = resolve_path(&args.proposals_dir);
    let rejects_dir = match &args.rejects_dir {
        Some(d) => resolve_path(d),
        None => proposals_dir
            .parent()
            .map(|p| p.join("rejects"))
            .unwrap_or_else(|| PathBuf::from("rejects")),
    };

    if !pages_dir.exists() {
        eprintln!("pages-dir does not exist: {}", pages_dir.display());
        return 2;
    }

    let ledger_dir = resolve_ledger_dir(args).map(|d| resolve_path(&d));
    let (scanned, candidates) = match &ledger_dir {
        Some(dir) => {
            if !dir.exists() {
                eprintln!("ledger-dir does not exist: {}", dir.display());
                return 2;
            }
            (
                dir.clone(),
                find_candidates_from(
                    load_ledger_dir_assertions(dir),
                    args.min_assertions,
                    args.min_episodes,
                ),
            )
        }
        None => (
            pages_dir.clone(),
            find_candidates(&pages_dir, args.min_assertions, args.min_episodes),
        ),
    };
    println!(
        "Scanned {} — {} candidate topic(s) found (>= {} assertions, >= {} episodes).",
        scanned.display(),
        candidates.len(),
        args.min_assertions,
        args.min_episodes
    );
    for c in &candidates {
        let mut episodes = c.sorted_episodes();
        episodes.sort();
        println!(
            "  - {:?}: {} assertions across {} episode(s) ({})",
            c.topic,
            c.assertions.len(),
            c.episodes().len(),
            episodes.join(", ")
        );
    }

    if args.dry_run {
        println!("\n[DRY RUN] stopping before dossier assembly / Loom calls / judge calls.");
        return 0;
    }
    if candidates.is_empty() {
        return 0;
    }

    let _ = std::fs::create_dir_all(&proposals_dir);
    let _ = std::fs::create_dir_all(&rejects_dir);
    let processed = load_processed_fingerprint_sets(&proposals_dir, &rejects_dir);

    let loom_reachable = check_loom_reachable(&args.loom_url, 5).await;
    println!(
        "\nLoom reachability ({}): {}",
        args.loom_url,
        if loom_reachable { "OK" } else { "UNREACHABLE" }
    );
    if std::env::var("GOOGLE_API_KEY")
        .unwrap_or_default()
        .is_empty()
    {
        println!("GOOGLE_API_KEY not set — judge step will fail-closed per candidate (logged, not crashed).");
    }

    let mut n_processed = 0usize;
    for candidate in &candidates {
        if let Some(limit) = args.limit {
            if n_processed >= limit {
                break;
            }
        }

        let slug = candidate.slug();
        let fps = candidate.fingerprints();
        if let Some(prior_fps) = processed.get(&slug) {
            if *prior_fps == fps {
                println!("\n[{slug}] unchanged since last run (same fingerprint set) — skipping.");
                continue;
            }
            println!(
                "\n[{slug}] fingerprint set changed since last run ({} -> {}) — refreshing.",
                prior_fps.len(),
                fps.len()
            );
        }

        n_processed += 1;
        println!(
            "\n[{slug}] assembling dossier: {} assertions, {} episodes",
            candidate.assertions.len(),
            candidate.episodes().len()
        );

        let mut dossier_assertions: Vec<Assertion> = candidate.assertions.clone();
        if args.max_dossier_assertions > 0 && dossier_assertions.len() > args.max_dossier_assertions
        {
            dossier_assertions.sort_by(|a, b| {
                let ca = -conf_float(&a.confidence);
                let cb = -conf_float(&b.confidence);
                ca.partial_cmp(&cb)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.claim_date.cmp(&b.claim_date))
                    .then_with(|| a.fp.cmp(&b.fp))
            });
            dossier_assertions.truncate(args.max_dossier_assertions);
            println!(
                "  capped to {} strongest assertions for the dossier (--max-dossier-assertions {})",
                dossier_assertions.len(),
                args.max_dossier_assertions
            );
        }

        let target_page_rel = target_page_name(&candidate.topic);
        let target_page = pages_dir.join(&target_page_rel);
        let mut reasons: Vec<String> = Vec::new();

        if !target_page.exists() {
            reasons.push(format!(
                "no_target_page: {target_page_rel} does not exist in pages-dir"
            ));
            clear_slug_outputs(&slug, &[&proposals_dir, &rejects_dir]);
            let draft = DraftResult {
                ok: false,
                spliced_text: None,
                edit: None,
                error: Some("no_target_page".to_string()),
            };
            let data = write_dossier_json(
                &rejects_dir.join(format!("{slug}.json")),
                candidate,
                &draft,
                None,
                0.0,
                &[],
                "candidate_deferred",
                &reasons,
                &target_page_rel,
            );
            write_dossier_md(&rejects_dir.join(format!("{slug}.md")), &data);
            println!("  DEFER [{slug}]: no target page — recorded in rejects/, retry-eligible");
            continue;
        }

        let page_bytes = std::fs::read(&target_page).unwrap_or_default();
        let page_text = String::from_utf8_lossy(&page_bytes).to_string();

        if !loom_reachable {
            reasons.push("loom_unreachable".to_string());
            clear_slug_outputs(&slug, &[&proposals_dir, &rejects_dir]);
            let draft = DraftResult {
                ok: false,
                spliced_text: None,
                edit: None,
                error: Some("loom_unreachable".to_string()),
            };
            let data = write_dossier_json(
                &rejects_dir.join(format!("{slug}.json")),
                candidate,
                &draft,
                None,
                0.0,
                &[],
                "candidate_deferred",
                &reasons,
                &target_page_rel,
            );
            write_dossier_md(&rejects_dir.join(format!("{slug}.md")), &data);
            println!("  DEFER [{slug}]: Loom unreachable — recorded in rejects/, retry-eligible");
            continue;
        }

        let draft = assemble_draft(
            &candidate.topic,
            &page_text,
            &dossier_assertions,
            &args.loom_url,
            &args.loom_model,
        )
        .await;
        if !draft.ok {
            reasons.push(format!(
                "draft_failed: {}",
                draft.error.clone().unwrap_or_default()
            ));
            clear_slug_outputs(&slug, &[&proposals_dir, &rejects_dir]);
            let data = write_dossier_json(
                &rejects_dir.join(format!("{slug}.json")),
                candidate,
                &draft,
                None,
                0.0,
                &[],
                "candidate_deferred",
                &reasons,
                &target_page_rel,
            );
            write_dossier_md(&rejects_dir.join(format!("{slug}.md")), &data);
            println!(
                "  DEFER [{slug}]: draft assembly failed — {} (retry-eligible)",
                draft.error.unwrap_or_default()
            );
            continue;
        }

        let edit = draft.edit.clone().unwrap_or_default();
        let mode = edit.get("mode").and_then(|v| v.as_str()).unwrap_or("");
        let anchor = edit.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
        let anchor_prefix: String = anchor.chars().take(60).collect();
        println!("  draft OK ({mode}, anchor {anchor_prefix:?}...)");

        let content = edit.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let (score, detail) = completeness::completeness_score(&dossier_assertions, content);
        println!("  completeness: {score:.2}");

        let judge = judge_before_after(
            &candidate.topic,
            &page_text,
            draft.spliced_text.as_deref().unwrap_or(""),
            args.judge_seed,
        )
        .await;
        if judge.ok {
            println!(
                "  judge: rubric-A improvement={:?}  rubric-B improvement={:?}",
                judge.rubric_a_improvement, judge.rubric_b_improvement
            );
        } else {
            println!(
                "  judge: FAILED/SKIPPED — {}",
                judge.error.clone().unwrap_or_default()
            );
        }

        if !judge.ok {
            reasons.push(format!(
                "judge_unavailable: {}",
                judge.error.clone().unwrap_or_default()
            ));
            clear_slug_outputs(&slug, &[&proposals_dir, &rejects_dir]);
            let data = write_dossier_json(
                &rejects_dir.join(format!("{slug}.json")),
                candidate,
                &draft,
                Some(&judge),
                score,
                &detail,
                "candidate_deferred",
                &reasons,
                &target_page_rel,
            );
            write_dossier_md(&rejects_dir.join(format!("{slug}.md")), &data);
            println!(
                "  DEFER [{slug}]: judge unavailable — {} (retry-eligible)",
                judge.error.unwrap_or_default()
            );
            continue;
        }

        let mut survive = true;
        if !judge
            .rubric_b_improvement
            .map(|v| v > args.judge_b_min)
            .unwrap_or(false)
        {
            survive = false;
            reasons.push(format!(
                "rubric_b_improvement {:?} <= {}",
                judge.rubric_b_improvement, args.judge_b_min
            ));
        }
        if !judge
            .rubric_a_improvement
            .map(|v| v >= args.judge_a_min)
            .unwrap_or(false)
        {
            survive = false;
            reasons.push(format!(
                "rubric_a_improvement {:?} < {}",
                judge.rubric_a_improvement, args.judge_a_min
            ));
        }
        if score < args.completeness_min {
            survive = false;
            reasons.push(format!(
                "completeness {score:.2} < {}",
                args.completeness_min
            ));
        }

        let status = if survive {
            "candidate_survivor"
        } else {
            "candidate_rejected"
        };
        let out_dir = if survive {
            &proposals_dir
        } else {
            &rejects_dir
        };
        clear_slug_outputs(&slug, &[&proposals_dir, &rejects_dir]);
        let data = write_dossier_json(
            &out_dir.join(format!("{slug}.json")),
            candidate,
            &draft,
            Some(&judge),
            score,
            &detail,
            status,
            &reasons,
            &target_page_rel,
        );
        write_dossier_md(&out_dir.join(format!("{slug}.md")), &data);

        if survive {
            println!(
                "  SURVIVOR [{slug}] -> {}",
                out_dir.join(format!("{slug}.json")).display()
            );
        } else {
            println!(
                "  REJECT [{slug}] ({}) -> {}",
                reasons.join("; "),
                out_dir.join(format!("{slug}.json")).display()
            );
            if let Some(wg_dir) = &args.working_graph_dir {
                let wg_path = write_working_page(wg_dir, &data);
                println!("  news page -> {}", wg_path.display());
            }
        }
    }

    0
}

/// Entry point used by the `podcast-promote` binary.
pub async fn run_main() -> i32 {
    let args = Args::parse();
    run(&args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn args(extra: &[&str]) -> Args {
        let mut argv = vec![
            "podcast-promote",
            "--proposals-dir",
            "/tmp/unused-proposals",
        ];
        argv.extend_from_slice(extra);
        Args::try_parse_from(argv).unwrap()
    }

    const LEDGER: &str = "---\ntype: Episode\npublic: false\n---\n\n- A claim. [[Topic A]]\n  **tier:** 1\n  **confidence:** 0.9\n  **claim-date:** 2026-01-01\n  <!-- assertion-fp: aaaaaaaaaaaaaaaa -->\n";

    #[test]
    fn ledger_dir_defaults_to_podcast_evidence_under_the_working_dir() {
        let work = tempdir().unwrap();
        std::fs::create_dir(work.path().join("podcast-evidence")).unwrap();
        let a = args(&[
            "--pages-dir",
            "/v/knowledge",
            "--working-graph-dir",
            work.path().to_str().unwrap(),
        ]);
        assert_eq!(
            resolve_ledger_dir(&a),
            Some(work.path().join("podcast-evidence"))
        );
    }

    #[test]
    fn ledger_dir_is_none_when_the_working_dir_has_no_ledgers() {
        let work = tempdir().unwrap();
        let a = args(&[
            "--pages-dir",
            "/v/knowledge",
            "--working-graph-dir",
            work.path().to_str().unwrap(),
        ]);
        assert_eq!(resolve_ledger_dir(&a), None);
    }

    #[test]
    fn explicit_ledger_dir_wins() {
        let a = args(&[
            "--pages-dir",
            "/v/knowledge",
            "--ledger-dir",
            "/somewhere/else",
            "--working-graph-dir",
            "/v/working",
        ]);
        assert_eq!(
            resolve_ledger_dir(&a),
            Some(PathBuf::from("/somewhere/else"))
        );
    }

    #[tokio::test]
    async fn dry_run_reads_ledgers_from_the_ledger_dir_not_the_pages_dir() {
        let pages = tempdir().unwrap();
        let ledgers = tempdir().unwrap();
        for ep in ["ep-one", "ep-two"] {
            std::fs::write(ledgers.path().join(format!("{ep}.md")), LEDGER).unwrap();
        }
        let a = args(&[
            "--pages-dir",
            pages.path().to_str().unwrap(),
            "--ledger-dir",
            ledgers.path().to_str().unwrap(),
            "--working-graph-dir",
            pages.path().to_str().unwrap(),
            "--min-assertions",
            "2",
            "--min-episodes",
            "2",
            "--dry-run",
        ]);
        // The pages dir is empty: only the ledger dir can supply candidates.
        let loaded = load_ledger_dir_assertions(&resolve_ledger_dir(&a).unwrap());
        let candidates = find_candidates_from(loaded, 2, 2);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].topic, "Topic A");
        assert_eq!(run(&a).await, 0);
    }

    #[tokio::test]
    async fn a_missing_ledger_dir_is_an_error_not_a_silent_zero() {
        let pages = tempdir().unwrap();
        let a = args(&[
            "--pages-dir",
            pages.path().to_str().unwrap(),
            "--ledger-dir",
            "/nonexistent/ledgers-for-test",
            "--working-graph-dir",
            pages.path().to_str().unwrap(),
            "--dry-run",
        ]);
        assert_eq!(run(&a).await, 2);
    }
}
