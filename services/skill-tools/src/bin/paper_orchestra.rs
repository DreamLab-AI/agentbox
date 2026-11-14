//! `paper-orchestra` — deterministic helpers for the paper-orchestra skill.
//!
//! One binary, one subcommand per upstream script (see
//! `skill_tools::paper_orchestra` for the mapping and exit-code conventions).
//! Command-line usage errors exit 64 (`EX_USAGE`), which no gate uses.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{ArgGroup, Parser, Subcommand};

use skill_tools::paper_orchestra::json_util::{to_pretty, write_atomic};
use skill_tools::paper_orchestra::tex::Paper;
use skill_tools::paper_orchestra::{
    anti_leakage, citations, claim_evidence, concession, critique_memory, outline, preflight,
    reverse_outline, scoring, verify_refs, worklog, workspace,
};

/// Deterministic helpers for the paper-orchestra skill (arXiv preprints).
#[derive(Parser, Debug)]
#[command(
    name = "paper-orchestra",
    version,
    about,
    after_help = "Exit codes are per subcommand (see each --help). Command-line usage errors exit 64, \
                  which no gate uses; input errors in score and concession files exit 3."
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Scaffold a workspace (inputs/, figures/, drafts/, refinement/, final/).
    Init {
        /// Workspace directory to create.
        #[arg(long)]
        out: PathBuf,
        /// Allow scaffolding into a non-empty directory.
        #[arg(long)]
        force: bool,
    },
    /// Check the workspace inputs: presence, structure and density. Exit 0 pass, 1 fail, 2 missing.
    ValidateInputs {
        /// Workspace directory.
        #[arg(long)]
        workspace: PathBuf,
        /// Minimum words in idea.md.
        #[arg(long, default_value_t = 50)]
        min_idea_words: usize,
        /// Minimum markdown tables in experimental_log.md (a shortfall only warns).
        #[arg(long, default_value_t = 1)]
        min_tables: usize,
        /// Minimum numeric values in experimental_log.md.
        #[arg(long, default_value_t = 5)]
        min_numeric_values: usize,
    },
    /// Cross-validate idea.md against experimental_log.md (WARN gate: exit 1 on warnings).
    Consistency {
        /// Path to idea.md.
        #[arg(long)]
        idea: PathBuf,
        /// Path to experimental_log.md.
        #[arg(long)]
        log: PathBuf,
    },
    /// Validate an outline.json against the typed schema. Exit 0 valid, 1 errors.
    ValidateOutline {
        /// Path to outline.json.
        outline: PathBuf,
    },
    /// Grep a paper for leaked emails, affiliations and author lists. Exit 0 clean, 1 leaks.
    AntiLeakage {
        /// A .tex file or a directory.
        paper: PathBuf,
    },
    /// Check quantitative claims against an experimental log or a results ledger.
    #[command(group(ArgGroup::new("evidence").required(true).multiple(false)))]
    ClaimEvidence {
        /// A .tex file or a directory.
        #[arg(long)]
        paper: PathBuf,
        /// experimental_log.md (log mode).
        #[arg(long, group = "evidence")]
        log: Option<PathBuf>,
        /// ledger.json (ledger mode).
        #[arg(long, group = "evidence")]
        ledger: Option<PathBuf>,
        /// Ledger macro name, without the backslash.
        #[arg(long = "macro", default_value = "ledger")]
        macro_name: String,
        /// JSON report path.
        #[arg(long)]
        out: PathBuf,
        /// Optional Markdown claim-evidence map.
        #[arg(long)]
        out_md: Option<PathBuf>,
    },
    /// Check every cited key resolves to a bib entry. Exit 0 ok, 1 orphans.
    OrphanCites {
        /// A .tex file or a directory.
        paper: PathBuf,
        /// The .bib file.
        bib: PathBuf,
    },
    /// Enforce the citation-pool integration threshold. Exit 0 ok, 1 below threshold.
    CitationCoverage {
        /// A .tex file or a directory.
        #[arg(long)]
        tex: PathBuf,
        /// citation_pool.json.
        #[arg(long)]
        pool: PathBuf,
        /// Minimum integration ratio.
        #[arg(long, default_value_t = 0.90)]
        threshold: f64,
    },
    /// Title similarity and date-cutoff verdicts for candidate references. Exit 1 if any row fails.
    VerifyRefs {
        /// JSON array of {key, claimed_title, found_title, found_date?}.
        #[arg(long)]
        candidates: PathBuf,
        /// Strict cutoff date YYYY-MM-DD: papers must predate it.
        #[arg(long)]
        cutoff: Option<String>,
        /// Similarity must be strictly greater than this (0-100).
        #[arg(long, default_value_t = 70)]
        threshold: u32,
        /// Score short (<4 word) candidates contained in the found title at least 95.
        #[arg(long)]
        substring_bypass: bool,
        /// Write the full per-row results here.
        #[arg(long)]
        json: Option<PathBuf>,
    },
    /// Build a reverse outline (one topic sentence per paragraph) with structural flags.
    ReverseOutline {
        /// A .tex file or a directory.
        #[arg(long)]
        paper: PathBuf,
        /// Markdown output path.
        #[arg(long)]
        out: PathBuf,
        /// Optional JSON output path.
        #[arg(long)]
        json: Option<PathBuf>,
        /// Sentences above which a paragraph is overlong.
        #[arg(long, default_value_t = 8)]
        max_sentences: usize,
        /// Words above which a paragraph is overlong.
        #[arg(long, default_value_t = 220)]
        max_words: usize,
        /// Exit 1 when any paragraph carries a flag.
        #[arg(long)]
        strict: bool,
    },
    /// Apply the accept/revert/halt rules to two score files. Exit 0/1/2/4/5, 3 on input error.
    ///
    /// Both files use the score schema: `overall_score` and
    /// `axis_scores.AXIS.score` for all six axes. A missing or non-numeric
    /// value is an input error (exit 3), never a zero.
    ScoreDelta {
        /// Score JSON of the previous accepted iteration.
        #[arg(long)]
        prev: PathBuf,
        /// Score JSON of the iteration just completed.
        #[arg(long)]
        curr: PathBuf,
        /// Smallest overall delta that is not a "small" improvement.
        #[arg(long, default_value_t = 1.0, allow_negative_numbers = true)]
        plateau_threshold: f64,
        /// Consecutive small improvements before HALT_PLATEAU.
        #[arg(long, default_value_t = 3)]
        plateau_streak: i64,
        /// Small-delta accepted iterations so far (kept by the calling loop).
        #[arg(long, default_value_t = 0, conflicts_with = "worklog")]
        consecutive_small: i64,
        /// Derive the streak from this worklog.json: the trailing accepted
        /// iterations whose gain is below --plateau-threshold (absent file = 0).
        #[arg(long)]
        worklog: Option<PathBuf>,
        /// Score at or above which the paper is in the Accept band.
        #[arg(long, default_value_t = 80.0)]
        accept_threshold: f64,
        /// Do not halt on reaching the Accept band.
        #[arg(long)]
        no_target_halt: bool,
    },
    /// Map a 0-100 overall score to its decision band.
    DecisionBand {
        /// Overall score.
        #[arg(
            allow_negative_numbers = true,
            conflicts_with = "score_json",
            required_unless_present = "score_json"
        )]
        score: Option<f64>,
        /// Read overall_score from a score.json instead.
        #[arg(long)]
        score_json: Option<PathBuf>,
        /// Accept lower bound.
        #[arg(long, default_value_t = 80.0)]
        accept_min: f64,
        /// Minor revision lower bound.
        #[arg(long, default_value_t = 65.0)]
        minor_min: f64,
        /// Major revision lower bound.
        #[arg(long, default_value_t = 50.0)]
        major_min: f64,
    },
    /// Track per-dimension deltas across iterN/score.json. Exit 1 on regression or plateau, 3 on input error.
    ///
    /// Each iterN/ directory is read from score.json, or from review.json when
    /// score.json is absent (both carry the score schema); directories with
    /// neither are skipped. A file without numeric axis_scores.AXIS.score is
    /// an input error.
    ScoreTrajectory {
        /// Directory holding iterN/ subdirectories.
        #[arg(long)]
        scores_dir: PathBuf,
        /// Flag any dimension whose latest delta is below this.
        #[arg(long, default_value_t = -3.0, allow_negative_numbers = true)]
        regression_threshold: f64,
        /// Optional JSON report path.
        #[arg(long)]
        report_path: Option<PathBuf>,
    },
    /// Check a Devil's Advocate concession log. Exit 0 clear, 1 block, 2 restate, 3 input error.
    ConcessionGuard {
        /// Concession log JSON.
        #[arg(long)]
        log: PathBuf,
        /// Optional report path.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Append an iteration entry to worklog.json (append-only).
    Worklog {
        /// worklog.json path (created if absent).
        #[arg(long)]
        worklog: PathBuf,
        /// Iteration number.
        #[arg(long = "iter")]
        iteration: i64,
        /// review.json of this iteration.
        #[arg(long)]
        review: Option<PathBuf>,
        /// score.json of this iteration.
        #[arg(long)]
        score: Option<PathBuf>,
        /// Decision, e.g. ACCEPT_IMPROVED.
        #[arg(long)]
        decision: String,
        /// The agent's worklog block.
        #[arg(long)]
        actions: Option<PathBuf>,
        /// Reason, if this iteration halts the loop.
        #[arg(long)]
        halted_because: Option<String>,
    },
    /// Update critique_memory.json from the worklog and the current review.
    CritiqueMemory {
        /// worklog.json (an absent file counts as empty).
        #[arg(long)]
        worklog: PathBuf,
        /// This iteration's review.json.
        #[arg(long)]
        review: PathBuf,
        /// Current iteration.
        #[arg(long = "iter")]
        iteration: i64,
        /// Output path.
        #[arg(long)]
        out: PathBuf,
    },
    /// Check a LaTeX source tree against arXiv's submission rules. Exit 2 errors, 1 warnings, 0 clean.
    ArxivPreflight {
        /// Source directory as it will be uploaded.
        #[arg(long)]
        source: PathBuf,
        /// Main file, relative to --source.
        #[arg(long)]
        main: PathBuf,
        /// A build log (main.log) to inspect.
        #[arg(long)]
        log: Option<PathBuf>,
        /// Abstract limit in characters.
        #[arg(long, default_value_t = preflight::DEFAULT_ABSTRACT_MAX)]
        abstract_max: usize,
        /// Write the full report as JSON.
        #[arg(long)]
        json: Option<PathBuf>,
    },
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read(path)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .map_err(|e| format!("cannot read {}: {e}", path.display()))
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    serde_json::from_str(&read(path)?)
        .map_err(|e| format!("invalid JSON in {}: {e}", path.display()))
}

fn write_json<T: serde::Serialize>(path: &Path, v: &T) -> Result<(), String> {
    let s = to_pretty(v).map_err(|e| e.to_string())?;
    write_atomic(path, &s).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Loads a paper and warns about every include that was missing or refused, so
/// no gate silently passes over text it never read.
fn load_paper(p: &Path) -> Result<Paper, String> {
    let paper = Paper::load(p).map_err(|e| e.to_string())?;
    for m in &paper.missing {
        eprintln!(
            "WARN: \\input/\\include target not found or refused: {m} (its text was not checked)"
        );
    }
    Ok(paper)
}

/// Exit code for a command-line usage error (`EX_USAGE`): distinct from every
/// gate result, including the 2 that `arxiv-preflight` and others use.
const EXIT_USAGE: u8 = 64;

/// Reads a score document and checks the keys the loop depends on, so a typo in
/// a key can never read as a zero.
fn read_score(path: &Path, full: bool) -> Result<serde_json::Value, (i32, String)> {
    let doc = read_json(path).map_err(fail(3))?;
    let check = if full {
        scoring::check_score_doc(&doc)
    } else {
        scoring::overall_score_of(&doc).map(|_| ())
    };
    check.map_err(|e| (3, format!("{}: {e}", path.display())))?;
    Ok(doc)
}

fn main() -> ExitCode {
    // Rust ignores SIGPIPE, so `println!` panics when stdout is a closed pipe
    // (`paper-orchestra ... | head`). Exit quietly with the conventional status.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if info.to_string().contains("Broken pipe") {
            std::process::exit(141);
        }
        default_hook(info);
    }));
    let cli = match Cli::try_parse() {
        Ok(c) => c,
        Err(e) => {
            // --help and --version are not errors; everything else is usage.
            let ok = !e.use_stderr();
            let _ = e.print();
            return ExitCode::from(if ok { 0 } else { EXIT_USAGE });
        }
    };
    let code = match run(cli.cmd) {
        Ok(c) => c,
        Err((c, msg)) => {
            eprintln!("ERROR: {msg}");
            c
        }
    };
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}

type Outcome = Result<i32, (i32, String)>;

fn fail<T>(code: i32) -> impl Fn(T) -> (i32, String)
where
    T: ToString,
{
    move |e| (code, e.to_string())
}

fn run(cmd: Cmd) -> Outcome {
    match cmd {
        Cmd::Init { out, force } => {
            match workspace::init_workspace(&out, force).map_err(fail(1))? {
                workspace::InitOutcome::Created(p) => {
                    println!("Workspace scaffolded at: {}", p.display());
                    println!(
                        "Next: drop your idea.md and experimental_log.md into inputs/, then run:"
                    );
                    println!(
                        "  paper-orchestra validate-inputs --workspace {}",
                        p.display()
                    );
                    Ok(0)
                }
                workspace::InitOutcome::NonEmpty(p) => Err((
                    1,
                    format!(
                        "{} exists and is non-empty. Use --force to overlay.",
                        p.display()
                    ),
                )),
            }
        }

        Cmd::ValidateInputs {
            workspace: ws,
            min_idea_words,
            min_tables,
            min_numeric_values,
        } => {
            let r = workspace::validate_workspace(
                &ws,
                workspace::DensityOpts {
                    min_idea_words,
                    min_tables,
                    min_numeric_values,
                },
            );
            let mut fails = 0;
            for c in &r.checks {
                match c.level {
                    workspace::Level::Pass => println!("[PASS] {}", c.message),
                    workspace::Level::Warn => println!("[WARN] {}", c.message),
                    workspace::Level::Fail => {
                        fails += 1;
                        eprintln!("[FAIL] {}", c.message);
                    }
                }
            }
            println!();
            if r.exit == 0 {
                println!("Input validation: PASS");
            } else {
                println!("Input validation: FAIL ({fails} blocking problem(s))");
            }
            Ok(r.exit)
        }

        Cmd::Consistency { idea, log } => {
            let idea = read(&idea).map_err(fail(1))?;
            let log = read(&log).map_err(fail(1))?;
            let r = workspace::consistency_check(&idea, &log);
            print!("{}", r.text);
            Ok(i32::from(r.warnings > 0))
        }

        Cmd::ValidateOutline { outline: path } => {
            if !path.is_file() {
                return Err((1, format!("{} not found", path.display())));
            }
            let label = path.display().to_string();
            let r = outline::validate_outline_text(&read(&path).map_err(fail(1))?, &label)
                .map_err(fail(1))?;
            if !r.schema_errors.is_empty() {
                eprintln!("SCHEMA ERRORS:");
                r.schema_errors.iter().for_each(|e| eprintln!("  {e}"));
            }
            if !r.semantic_errors.is_empty() {
                eprintln!("SEMANTIC ERRORS:");
                r.semantic_errors.iter().for_each(|e| eprintln!("  {e}"));
            }
            if !r.warnings.is_empty() {
                println!("WARNINGS:");
                r.warnings.iter().for_each(|w| println!("  {w}"));
            }
            if r.is_valid() {
                println!("OK: {}", r.summary.unwrap_or_default());
                Ok(0)
            } else {
                eprintln!("\nFAIL: {label}");
                Ok(1)
            }
        }

        Cmd::AntiLeakage { paper } => {
            let p = load_paper(&paper).map_err(fail(2))?;
            let leaks = anti_leakage::find_leaks(&p.raw_text());
            if leaks.is_empty() {
                println!("OK: no anti-leakage violations in {}", paper.display());
                return Ok(0);
            }
            eprintln!("FAIL: anti-leakage violations in {}:", paper.display());
            leaks.iter().for_each(|l| eprintln!("  {l}"));
            eprintln!("\nThe Anti-Leakage Prompt (App. D.4) forbids these. Re-prompt the");
            eprintln!("writing step with explicit instructions to remove these artefacts.");
            Ok(1)
        }

        Cmd::ClaimEvidence {
            paper,
            log,
            ledger,
            macro_name,
            out,
            out_md,
        } => {
            let p = load_paper(&paper).map_err(fail(2))?;
            if let Some(log) = log {
                let log_text = read(&log).map_err(fail(2))?;
                let report = claim_evidence::check_against_log(p.text(), &log_text);
                write_json(&out, &report).map_err(fail(2))?;
                if let Some(md) = out_md {
                    write_atomic(&md, &claim_evidence::render_claim_map(&report))
                        .map_err(fail(2))?;
                }
                let s = &report.summary;
                println!("Claim-evidence gate: {} claims extracted", s.total);
                println!("  supported:      {}", s.supported);
                println!("  needs evidence: {}", s.unsupported);
                println!(
                    "  attributed:     {}  (cited to another paper)",
                    s.uncertain
                );
                if report.unsupported.is_empty() {
                    println!("PASS — all extracted claims are corroborated by experimental_log.md");
                    return Ok(0);
                }
                println!("\nNEEDS EVIDENCE (not found in experimental_log.md):");
                for i in &report.unsupported {
                    println!("  [{}] {}", i.value, take(&i.claim, 120));
                }
                println!(
                    "\nWARN: {} claim(s) need evidence — review before submission.",
                    report.unsupported.len()
                );
                println!("Full report: {}", out.display());
                Ok(1)
            } else {
                let ledger_path = ledger.expect("clap guarantees --log or --ledger");
                let ledger = claim_evidence::Ledger::parse(&read(&ledger_path).map_err(fail(2))?)
                    .map_err(fail(2))?;
                let r = claim_evidence::check_against_ledger(&p, &ledger, &macro_name);
                write_json(&out, &r).map_err(fail(2))?;
                if let Some(md) = out_md {
                    write_atomic(&md, &claim_evidence::render_ledger_markdown(&r))
                        .map_err(fail(2))?;
                }
                let s = &r.summary;
                println!(
                    "Claim-evidence gate (ledger mode): {} \\{} uses, {} distinct ids, ledger of {} entries",
                    s.macro_uses, macro_name, s.distinct_ids, r.ledger_entries
                );
                println!("  errors (unknown or superseded id): {}", s.errors);
                println!(
                    "  hand-typed numbers needing evidence: {}",
                    s.needs_evidence
                );
                println!("  hand-typed numbers attributed:       {}", s.attributed);
                for e in &r.errors {
                    let what = match &e.superseded_by {
                        Some(n) => format!("superseded by `{n}`"),
                        None => "unknown id".to_string(),
                    };
                    println!("  ERROR `{}` {what} at {}:{}", e.id, e.file, e.line);
                }
                for n in &r.needs_evidence {
                    println!(
                        "  NEEDS EVIDENCE [{}] {}:{} ({})  {}",
                        n.value,
                        n.file,
                        n.line,
                        n.section,
                        take(&n.sentence, 120)
                    );
                }
                println!("Full report: {}", out.display());
                Ok(r.exit_code())
            }
        }

        Cmd::OrphanCites { paper, bib } => {
            let p = load_paper(&paper).map_err(fail(2))?;
            let bib_text = read(&bib).map_err(fail(2))?;
            let r = citations::orphan_report(p.text(), &bib_text);
            if r.bib_entries == 0 {
                return Err((1, format!("no @entry keys found in {}", bib.display())));
            }
            println!(
                "{} has {} entries; {} cites {} unique keys",
                bib.display(),
                r.bib_entries,
                paper.display(),
                r.cited
            );
            if !r.unused.is_empty() {
                let shown: Vec<&str> = r.unused.iter().take(25).map(String::as_str).collect();
                let more = if r.unused.len() > 25 {
                    format!(", … (+{})", r.unused.len() - 25)
                } else {
                    String::new()
                };
                println!(
                    "INFO: {} bib entries never cited (informational): {}{more}",
                    r.unused.len(),
                    shown.join(", ")
                );
            }
            if r.orphans.is_empty() {
                println!("OK: no orphan cite keys");
                return Ok(0);
            }
            eprintln!(
                "\nFAIL: {} orphan \\cite key(s) (not in {}):",
                r.orphans.len(),
                bib.display()
            );
            r.orphans.iter().for_each(|k| eprintln!("  - {k}"));
            Ok(1)
        }

        Cmd::CitationCoverage {
            tex,
            pool,
            threshold,
        } => {
            let p = load_paper(&tex).map_err(fail(2))?;
            let r = citations::coverage_report(p.text(), &read(&pool).map_err(fail(2))?, threshold)
                .map_err(fail(2))?;
            print!("{}", r.text);
            Ok(r.exit)
        }

        Cmd::VerifyRefs {
            candidates,
            cutoff,
            threshold,
            substring_bypass,
            json,
        } => {
            let rows: Vec<verify_refs::Candidate> = serde_json::from_value(read_json(&candidates).map_err(fail(2))?)
                .map_err(|e| (2, format!("candidates must be an array of objects with key, claimed_title, found_title: {e}")))?;
            let cutoff = match cutoff {
                Some(c) => Some(
                    chrono::NaiveDate::parse_from_str(&c, "%Y-%m-%d")
                        .map_err(|_| (2, format!("--cutoff must be YYYY-MM-DD, got {c}")))?,
                ),
                None => None,
            };
            let out = verify_refs::verify(&rows, threshold, cutoff, substring_bypass);
            for r in &out {
                let cut = r
                    .cutoff
                    .as_ref()
                    .map(|c| {
                        format!(
                            "  cutoff {} (paper={}, cutoff={})",
                            c.verdict,
                            c.paper_date.as_deref().unwrap_or("unknown"),
                            c.cutoff
                        )
                    })
                    .unwrap_or_default();
                println!("{:<32} {:>3} {}{cut}", r.key, r.similarity, r.title_verdict);
            }
            let failed = out.iter().filter(|r| !r.pass).count();
            println!(
                "{}/{} reference(s) pass (title similarity > {threshold})",
                out.len() - failed,
                out.len()
            );
            if let Some(j) = json {
                write_json(&j, &out).map_err(fail(2))?;
            }
            Ok(i32::from(failed > 0))
        }

        Cmd::ReverseOutline {
            paper,
            out,
            json,
            max_sentences,
            max_words,
            strict,
        } => {
            let p = load_paper(&paper).map_err(fail(2))?;
            let o = reverse_outline::build_outline(p.text(), max_sentences, max_words);
            write_atomic(&out, &reverse_outline::render_markdown(&o)).map_err(fail(2))?;
            if let Some(j) = json {
                write_json(&j, &serde_json::json!({ "sections": o })).map_err(fail(2))?;
            }
            let total: usize = o.iter().map(|s| s.paragraphs.len()).sum();
            println!(
                "Reverse outline: {} sections, {total} paragraphs → {}",
                o.len(),
                out.display()
            );
            let counts = reverse_outline::flag_counts(&o);
            if counts.is_empty() {
                println!("  no structural flags");
            }
            for (name, n) in &counts {
                println!("  {name}: {n}");
            }
            Ok(i32::from(strict && !counts.is_empty()))
        }

        Cmd::ScoreDelta {
            prev,
            curr,
            plateau_threshold,
            plateau_streak,
            consecutive_small,
            worklog: worklog_path,
            accept_threshold,
            no_target_halt,
        } => {
            let (p, c) = (read_score(&prev, true)?, read_score(&curr, true)?);
            let consecutive_small = match worklog_path {
                None => consecutive_small,
                Some(w) if !w.exists() => 0,
                Some(w) => {
                    let wl: worklog::Worklog =
                        serde_json::from_value(read_json(&w).map_err(fail(3))?)
                            .map_err(|e| (3, format!("{} is not a worklog: {e}", w.display())))?;
                    worklog::small_gain_streak(&wl, plateau_threshold)
                        .map_err(|e| (3, format!("{}: {e}", w.display())))?
                }
            };
            let o = scoring::score_delta(
                &p,
                &c,
                scoring::DeltaOpts {
                    plateau_threshold,
                    plateau_streak,
                    consecutive_small,
                    accept_threshold,
                    no_target_halt,
                },
            )
            .map_err(fail(3))?;
            println!("{}", to_pretty(&o).map_err(fail(3))?);
            Ok(o.exit_code)
        }

        Cmd::DecisionBand {
            score,
            score_json,
            accept_min,
            minor_min,
            major_min,
        } => {
            let s = match (score, score_json) {
                (Some(s), _) => s,
                (None, Some(p)) => scoring::overall_score_of(&read_json(&p).map_err(fail(2))?)
                    .map_err(|e| {
                        (
                            2,
                            format!("cannot read overall_score from {}: {e}", p.display()),
                        )
                    })?,
                (None, None) => unreachable!("clap requires one of the two"),
            };
            let o = scoring::decision_band(s, accept_min, minor_min, major_min).map_err(fail(2))?;
            println!("{}", to_pretty(&o).map_err(fail(2))?);
            Ok(0)
        }

        Cmd::ScoreTrajectory {
            scores_dir,
            regression_threshold,
            report_path,
        } => {
            let entries = scoring::load_scores(&scores_dir).map_err(|e| {
                let missing = !scores_dir.is_dir();
                (if missing { 1 } else { 3 }, e)
            })?;
            let none = || {
                (
                    1,
                    "No iterN/score.json (or review.json) files found in scores-dir.".to_string(),
                )
            };
            let o = scoring::analyse_trajectory(&entries, regression_threshold)
                .map_err(fail(3))?
                .ok_or_else(none)?;
            print!("{}", o.text);
            if let Some(rp) = report_path {
                write_json(&rp, &o.report).map_err(fail(1))?;
                println!("Report written to: {}", rp.display());
            }
            Ok(o.exit)
        }

        Cmd::ConcessionGuard { log, out } => {
            let doc =
                read_json(&log).map_err(|e| (3, format!("cannot read concession log: {e}")))?;
            let rounds = concession::validate_log(&doc).map_err(fail(3))?;
            let report = concession::analyse(rounds);
            if let Some(o) = out {
                write_json(&o, &report).map_err(fail(3))?;
            }
            print!("{}", concession::summary(&report));
            Ok(report.exit_code())
        }

        Cmd::Worklog {
            worklog: path,
            iteration,
            review,
            score,
            decision,
            actions,
            halted_because,
        } => {
            let mut wl: worklog::Worklog = if path.exists() {
                serde_json::from_value(read_json(&path).map_err(fail(1))?)
                    .map_err(|e| (1, format!("{} is not a worklog: {e}", path.display())))?
            } else {
                worklog::Worklog::default()
            };
            let score_doc = worklog::load_optional(score.as_deref()).map_err(fail(1))?;
            if let (Some(sp), false) = (&score, score_doc.is_null()) {
                scoring::overall_score_of(&score_doc)
                    .map_err(|e| (3, format!("{}: {e}", sp.display())))?;
            }
            let entry = worklog::new_entry(
                iteration,
                &decision,
                worklog::load_optional(review.as_deref()).map_err(fail(1))?,
                score_doc,
                worklog::load_optional(actions.as_deref()).map_err(fail(1))?,
            );
            worklog::append(&mut wl, entry, halted_because.as_deref()).map_err(fail(3))?;
            write_json(&path, &wl).map_err(fail(1))?;
            println!(
                "OK: appended iter {iteration} ({decision}) to {}",
                path.display()
            );
            if let Some(b) = wl.best_iter {
                println!("    current best_iter: {b}");
            }
            Ok(0)
        }

        Cmd::CritiqueMemory {
            worklog: wl_path,
            review,
            iteration,
            out,
        } => {
            let wl = if wl_path.exists() {
                read_json(&wl_path).map_err(fail(1))?
            } else {
                serde_json::json!({ "iterations": [] })
            };
            let current = read_json(&review).map_err(fail(1))?;
            let m = critique_memory::build_memory(&wl, &current, iteration);
            write_json(&out, &m).map_err(fail(1))?;
            let s = &m._stats;
            println!("OK: critique_memory.json updated for iter {iteration}");
            println!(
                "    persistent: {}  resolved: {}  da_critical_open: {}",
                s.persistent_count, s.resolved_count, s.da_critical_open
            );
            if !m.focus_on.is_empty() {
                println!("    focus_on:");
                m.focus_on.iter().for_each(|l| println!("      - {l}"));
            }
            if !m.do_not_reflag.is_empty() {
                println!(
                    "    do_not_reflag: {} resolved issue(s) suppressed",
                    m.do_not_reflag.len()
                );
            }
            Ok(0)
        }

        Cmd::ArxivPreflight {
            source,
            main,
            log,
            abstract_max,
            json,
        } => {
            let report = preflight::run(&preflight::Options {
                source,
                main,
                log,
                abstract_max,
            })
            .map_err(fail(2))?;
            print!("{}", report.render());
            if let Some(j) = json {
                write_json(&j, &report).map_err(fail(2))?;
            }
            Ok(report.exit_code())
        }
    }
}

fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
