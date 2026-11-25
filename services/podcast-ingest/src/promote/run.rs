//! Main pipeline — port of `run(args)` and the `argparse` CLI definition
//! (`main()`) from `promote.py`.

use super::candidate::{find_candidates, find_candidates_from, target_page_name};
use super::dossier::{clear_slug_outputs, load_processed, write_dossier_json, write_dossier_md};
use super::judge::judge_before_after;
use super::ledger_parse::{load_ledger_dir_assertions, Assertion};
use super::loom::{assemble_draft, check_loom_reachable, DraftResult};
use super::splice::page_sha256;
use super::working_page::{
    ontomark_normalise, ontomark_pin, write_working_page_using, Tools, WorkingPage,
};
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

    /// rewrite the working-vault page of every terminal reject from its stored
    /// dossier, then exit: no ledger scan, no Loom or judge call. For use after
    /// the page format changes
    #[arg(long)]
    pub refresh_working_pages: bool,

    /// regenerate a working page that carries no body marker (every page this
    /// stage wrote before the marker existed). Without this such a page is left
    /// untouched, because its text cannot be proved unedited; with it the page's
    /// generated text is replaced once and the marker added. Text a person put
    /// below the marker later is always kept
    #[arg(long)]
    pub adopt_unmarked_pages: bool,

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

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// What landing one reject's working page came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Landed {
    /// The page was written.
    Written,
    /// The page already said the same thing.
    Unchanged,
    /// The page was left as it was: edited by a person, unmarked, or not this
    /// stage's. The reason was printed.
    Left,
    /// The write failed.
    Failed,
}

/// Counts of [`Landed`] over a run.
#[derive(Debug, Default, PartialEq, Eq)]
struct Tally {
    written: usize,
    unchanged: usize,
    left: usize,
    failed: usize,
}

impl Tally {
    fn add(&mut self, landed: Landed) {
        match landed {
            Landed::Written => self.written += 1,
            Landed::Unchanged => self.unchanged += 1,
            Landed::Left => self.left += 1,
            Landed::Failed => self.failed += 1,
        }
    }

    /// The closing line. Pages left untouched are counted apart from pages
    /// written, so a run that refreshed nothing does not read as a refresh.
    fn summary(&self) -> String {
        format!(
            "refreshed {} working page(s), {} unchanged, {} left untouched (edited, no body marker, or not this stage's), {} failure(s).",
            self.written, self.unchanged, self.left, self.failed
        )
    }
}

/// Write one reject's working page and report it.
fn land_working_page(working_dir: &Path, data: &serde_json::Value, adopt_unmarked: bool) -> Landed {
    let tools = Tools {
        normalise: &ontomark_normalise,
        pin: &ontomark_pin,
        adopt_unmarked,
    };
    land_working_page_using(working_dir, data, &tools)
}

/// [`land_working_page`] with the tools given, so a test can stand in for the
/// `ontomark` binary, which a build sandbox does not have.
fn land_working_page_using(working_dir: &Path, data: &serde_json::Value, tools: &Tools) -> Landed {
    match write_working_page_using(working_dir, data, &now_rfc3339(), tools) {
        WorkingPage::Edited(p) => {
            println!(
                "  news page NOT refreshed: {} was edited since this stage wrote it (its generated text no longer matches the marker); left untouched",
                p.display()
            );
            Landed::Left
        }
        WorkingPage::Unmarked(p) => {
            println!(
                "  news page NOT refreshed: {} has no body marker, so it cannot be proved unedited; left untouched (--adopt-unmarked-pages regenerates it once)",
                p.display()
            );
            Landed::Left
        }
        WorkingPage::Written(p) => {
            println!("  news page -> {}", p.display());
            Landed::Written
        }
        WorkingPage::Unchanged(p) => {
            println!("  news page unchanged: {}", p.display());
            Landed::Unchanged
        }
        WorkingPage::Foreign(p) => {
            println!(
                "  news page NOT written: {} exists and is not a promotion-stage page",
                p.display()
            );
            Landed::Left
        }
        WorkingPage::Failed(p, e) => {
            eprintln!("  news page FAILED: {}: {e}", p.display());
            Landed::Failed
        }
    }
}

/// `--refresh-working-pages`: rewrite every terminal reject's working page
/// from the dossier already on disk. Returns the process exit code.
pub fn refresh_working_pages(rejects_dir: &Path, working_dir: &Path, adopt_unmarked: bool) -> i32 {
    let tools = Tools {
        normalise: &ontomark_normalise,
        pin: &ontomark_pin,
        adopt_unmarked,
    };
    refresh_working_pages_using(rejects_dir, working_dir, &tools)
}

/// [`refresh_working_pages`] with the tools given.
fn refresh_working_pages_using(rejects_dir: &Path, working_dir: &Path, tools: &Tools) -> i32 {
    let mut names: Vec<PathBuf> = std::fs::read_dir(rejects_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "json"))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    let mut tally = Tally::default();
    for path in names {
        let Some(data) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        else {
            eprintln!("  unreadable dossier: {}", path.display());
            tally.add(Landed::Failed);
            continue;
        };
        if data.get("status").and_then(|v| v.as_str()) != Some("candidate_rejected") {
            continue;
        }
        tally.add(land_working_page_using(working_dir, &data, tools));
    }
    println!("{}", tally.summary());
    i32::from(tally.failed > 0)
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

    if args.refresh_working_pages {
        let Some(working_dir) = &args.working_graph_dir else {
            eprintln!("--refresh-working-pages needs --working-graph-dir");
            return 2;
        };
        return refresh_working_pages(&rejects_dir, working_dir, args.adopt_unmarked_pages);
    }

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
    let processed = load_processed(&proposals_dir, &rejects_dir);

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
    let mut write_failures = 0usize;
    for candidate in &candidates {
        if let Some(limit) = args.limit {
            if n_processed >= limit {
                break;
            }
        }

        let slug = candidate.slug();
        let fps = candidate.fingerprints();
        let target_page_rel = target_page_name(&candidate.topic);
        let target_page = pages_dir.join(&target_page_rel);
        // `None` when the topic has no page. A page that exists but cannot be
        // read is treated the same way: deferred, and retried next run.
        let page_text = std::fs::read_to_string(&target_page).ok();
        let page_hash = page_text.as_deref().map(page_sha256);

        if let (Some(prior), Some(hash)) = (processed.get(&slug), page_hash.as_deref()) {
            if prior.is_current(&fps, hash) {
                println!(
                    "\n[{slug}] unchanged since last run (same evidence, same page) — skipping."
                );
                continue;
            }
            if prior.fingerprints == fps {
                println!(
                    "\n[{slug}] target page changed since the dossier was drafted — refreshing."
                );
            } else {
                println!(
                    "\n[{slug}] fingerprint set changed since last run ({} -> {}) — refreshing.",
                    prior.fingerprints.len(),
                    fps.len()
                );
            }
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

        let mut reasons: Vec<String> = Vec::new();

        let (Some(page_text), Some(page_hash)) = (page_text, page_hash) else {
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
                None,
            );
            write_dossier_md(&rejects_dir.join(format!("{slug}.md")), &data);
            println!("  DEFER [{slug}]: no target page — recorded in rejects/, retry-eligible");
            continue;
        };

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
                Some(&page_hash),
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
                Some(&page_hash),
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
                Some(&page_hash),
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
            Some(&page_hash),
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
                if land_working_page(wg_dir, &data, args.adopt_unmarked_pages) == Landed::Failed {
                    write_failures += 1;
                }
            }
        }
    }

    if write_failures > 0 {
        eprintln!("{write_failures} working page(s) could not be written.");
        return 1;
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

    #[test]
    fn refresh_rewrites_only_terminal_rejects_and_leaves_foreign_pages() {
        let rejects = tempdir().unwrap();
        let work = tempdir().unwrap();
        let dossier = |topic: &str, status: &str| {
            serde_json::json!({"topic": topic, "status": status, "episodes": ["ep1"],
                "n_assertions": 1, "draft": {"ok": false},
                "assertions": [{"claim": "C.", "source": "S", "episode": "ep1", "confidence": "0.9"}]})
            .to_string()
        };
        std::fs::write(
            rejects.path().join("a.json"),
            dossier("Alpha", "candidate_rejected"),
        )
        .unwrap();
        std::fs::write(
            rejects.path().join("b.json"),
            dossier("Beta", "candidate_deferred"),
        )
        .unwrap();
        std::fs::write(
            rejects.path().join("c.json"),
            dossier("Gamma", "candidate_rejected"),
        )
        .unwrap();
        std::fs::write(
            work.path().join("Gamma.md"),
            "---\ntype: Note\n---\nMine.\n",
        )
        .unwrap();

        // The real normaliser shells out to `ontomark`, which a build sandbox
        // lacks; the body here needs no normalising, so identity stands in.
        let identity = |body: &str| -> Result<String, String> { Ok(body.to_string()) };
        let tools = Tools {
            normalise: &identity,
            pin: &ontomark_pin,
            adopt_unmarked: false,
        };
        assert_eq!(
            refresh_working_pages_using(rejects.path(), work.path(), &tools),
            0
        );
        let alpha = std::fs::read_to_string(work.path().join("Alpha.md")).unwrap();
        assert!(
            alpha.contains("type: Note") && alpha.contains("promotion-status: candidate_rejected")
        );
        assert!(
            !work.path().join("Beta.md").exists(),
            "a deferred dossier has no page"
        );
        assert_eq!(
            std::fs::read_to_string(work.path().join("Gamma.md")).unwrap(),
            "---\ntype: Note\n---\nMine.\n"
        );
    }

    #[test]
    fn the_summary_counts_untouched_pages_apart_from_written_ones() {
        let mut t = Tally::default();
        for l in [
            Landed::Written,
            Landed::Left,
            Landed::Left,
            Landed::Unchanged,
            Landed::Failed,
        ] {
            t.add(l);
        }
        assert_eq!(
            t.summary(),
            "refreshed 1 working page(s), 1 unchanged, 2 left untouched (edited, no body marker, or not this stage's), 1 failure(s)."
        );
    }

    #[test]
    fn landing_an_unmarked_page_leaves_it_and_reports_left() {
        let work = tempdir().unwrap();
        let page = "---\ntype: Episode\ntitle: Alpha\npublic: false\nstatus: stable\ngenerated:\n  by: process:vault-migrate/1.0\n  at: 2026-09-22T12:41:58Z\npromotion-status: candidate_rejected\n---\n# Alpha — processed news\n\nold\n";
        std::fs::write(work.path().join("Alpha.md"), page).unwrap();
        let data = serde_json::json!({"topic": "Alpha", "status": "candidate_rejected", "episodes": [], "n_assertions": 0, "draft": {"ok": false}, "assertions": []});
        assert_eq!(land_working_page(work.path(), &data, false), Landed::Left);
        assert_eq!(
            std::fs::read_to_string(work.path().join("Alpha.md")).unwrap(),
            page
        );
    }
}
