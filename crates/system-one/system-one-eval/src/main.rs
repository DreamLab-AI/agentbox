//! Command-line entry point for [`system_one_eval`].
//!
//! The library half holds the corpus, the client and the scoring; this file is
//! argument parsing and printing, so that every number the CLI reports can also
//! be produced from an integration test.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use clap::{Args, Parser, Subcommand, ValueEnum};

use system_one_eval::client::Backend;
use system_one_eval::copy::{self, CeilingMode, CopyCeiling, Exposure, Ranker, SequentialEmbedder};
use system_one_eval::metrics::{self, Report};
use system_one_eval::runner::{load as load_corpus, run_backend, run_sweep, Loaded};

/// Default corpus, relative to the repository root.
const DEFAULT_CASES: &str = "tests/system-one/routing-cases.json";
/// Default skills tree: the baked one, which is what the router reads.
const DEFAULT_SKILLS: &str = "/opt/agentbox/skills";
/// ADR-2089's measured Jev input price, US dollars per million tokens.
const JEV_USD_PER_MTOK_IN: f64 = 0.042;
/// The estate's bge-small endpoint, which is also the façade's own.
const DEFAULT_EMBEDDINGS_URL: &str = "http://192.168.2.132:9997/v1/embeddings";
/// The frozen 384-dim embedding model (ADR-2019).
const DEFAULT_EMBEDDINGS_MODEL: &str = "bge-small-en-v1.5";

#[derive(Parser, Debug)]
#[command(
    name = "system-one-eval",
    about = "Measure a System One backend against the labelled routing corpus",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Run the corpus against one backend.
    Run(RunArgs),
    /// Run the corpus against two backends and diff them, case by case.
    Parity(ParityArgs),
    /// Run the corpus once per decline threshold and report the trade-off.
    Sweep(SweepArgs),
    /// Report the input-exposure control: the copy ceiling and gain over copy.
    CopyCeiling(CopyCeilingArgs),
    /// Report what the corpus and the skills tree contain, without calling out.
    Inspect(SharedArgs),
}

#[derive(Args, Debug, Clone)]
struct SharedArgs {
    /// Labelled case set.
    #[arg(long, default_value = DEFAULT_CASES)]
    cases: PathBuf,
    /// Skills tree the candidate map is built from.
    #[arg(long, default_value = DEFAULT_SKILLS)]
    skills_dir: PathBuf,
    /// Score only the first N cases.
    #[arg(long)]
    limit: Option<usize>,
    /// Per-option token budget used to classify late discriminators.
    #[arg(long, default_value_t = 44)]
    option_budget: usize,
    /// Write the full report as JSON to this path.
    #[arg(long)]
    json: Option<PathBuf>,
    /// Embeddings endpoint used by the embedding copy ceiling.
    #[arg(long, default_value = DEFAULT_EMBEDDINGS_URL)]
    embeddings_url: String,
    /// Embeddings model.
    #[arg(long, default_value = DEFAULT_EMBEDDINGS_MODEL)]
    embeddings_model: String,
    /// Per-embedding-request timeout.
    #[arg(long, default_value_t = 60_000)]
    embeddings_timeout_ms: u64,
}

/// Which judge-free ceilings to compute.
#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
enum Ceilings {
    /// No copy ceiling at all.
    Off,
    /// BM25 only: deterministic, and needs nothing but the corpus.
    Lexical,
    /// BM25 and bge-small cosine. The embedding one needs the endpoint.
    Both,
}

#[derive(Args, Debug, Clone)]
struct RunArgs {
    #[command(flatten)]
    shared: SharedArgs,
    /// Full `/v1/systemone` URL.
    #[arg(long)]
    backend: String,
    /// Label used in the report.
    #[arg(long, default_value = "sso")]
    label: String,
    /// Model name sent in the body.
    #[arg(long, default_value = "laya-typed-decisions")]
    model: String,
    /// Bearer token. Prefer `--key-env`.
    #[arg(long)]
    key: Option<String>,
    /// Environment variable holding the bearer token. Defaults to
    /// `SSO_API_KEY`, so exporting that is enough.
    #[arg(long, default_value = "SSO_API_KEY")]
    key_env: String,
    /// Concurrent in-flight requests.
    #[arg(long, default_value_t = 4)]
    concurrency: usize,
    /// Per-call timeout.
    #[arg(long, default_value_t = 20_000)]
    timeout_ms: u64,
    /// Retries on 429/529.
    #[arg(long, default_value_t = 2)]
    retries: u32,
    /// Input price, US dollars per million tokens. Local backends are free.
    #[arg(long, default_value_t = 0.0)]
    usd_per_mtok_in: f64,
    /// Options to offer per request. Unset leaves the façade's own default,
    /// which on an engine with no head budget means all of them.
    #[arg(long)]
    shortlist_k: Option<usize>,
    /// Which copy ceiling to report beside accuracy.
    ///
    /// The gold label here is the name of an option whose rubric is shown to
    /// the judge, so exposure is total and the control belongs beside every
    /// run rather than behind a flag. The default is the lexical ceiling
    /// because it needs no network and therefore can never make a run fail;
    /// the `copy-ceiling` subcommand reports both, with the embedding ceiling
    /// and the per-item statistics.
    #[arg(long, value_enum, default_value_t = Ceilings::Lexical)]
    copy_ceiling: Ceilings,
}

#[derive(Args, Debug, Clone)]
struct CopyCeilingArgs {
    #[command(flatten)]
    shared: SharedArgs,
    /// Full `/v1/systemone` URL. Omit it only with `--from-report`.
    #[arg(long)]
    backend: Option<String>,
    /// Label used in the report.
    #[arg(long, default_value = "sso")]
    label: String,
    /// Model name sent in the body.
    #[arg(long, default_value = "laya-typed-decisions")]
    model: String,
    /// Bearer token. Prefer `--key-env`.
    #[arg(long)]
    key: Option<String>,
    /// Environment variable holding the bearer token. Defaults to
    /// `SSO_API_KEY`, so exporting that is enough.
    #[arg(long, default_value = "SSO_API_KEY")]
    key_env: String,
    /// Concurrent in-flight requests. One by default: the openjev engine is
    /// serialised by a tokeniser lock, so more in flight only queues.
    #[arg(long, default_value_t = 1)]
    concurrency: usize,
    /// Per-call timeout.
    #[arg(long, default_value_t = 120_000)]
    timeout_ms: u64,
    /// Retries on 429/529.
    #[arg(long, default_value_t = 2)]
    retries: u32,
    /// Options to offer per request.
    #[arg(long)]
    shortlist_k: Option<usize>,
    /// Decline threshold to send. Unset keeps the deployed one, which is the
    /// honest comparator — the copy baseline is the side that gets tuned.
    #[arg(long)]
    none_threshold: Option<f64>,
    /// Read the judge's answers from a report written by `run --json`.
    ///
    /// Reuses a measurement instead of re-running it, which matters when the
    /// judge is a 4B cross-encoder and the control is the cheap half.
    #[arg(long)]
    from_report: Option<PathBuf>,
    /// Also print the naive ceiling, in which `none` is conceded to the judge.
    ///
    /// It is printed *beside* the fair one, never instead of it.
    #[arg(long, default_value_t = false)]
    concede_none: bool,
    /// Which judge-free rankers to build.
    #[arg(long, value_enum, default_value_t = Ceilings::Both)]
    ceilings: Ceilings,
}

#[derive(Args, Debug, Clone)]
struct SweepArgs {
    #[command(flatten)]
    run: RunArgs,
    /// Explicit thresholds, comma-separated. Overrides `--from/--to/--step`.
    #[arg(long, value_delimiter = ',')]
    thresholds: Vec<f64>,
    /// Lowest threshold of a generated sweep.
    #[arg(long, default_value_t = 0.0)]
    from: f64,
    /// Highest threshold of a generated sweep, inclusive.
    #[arg(long, default_value_t = 1.0)]
    to: f64,
    /// Step between generated thresholds.
    #[arg(long, default_value_t = 0.1)]
    step: f64,
}

impl SweepArgs {
    /// The thresholds to sweep, ascending and de-duplicated.
    fn thresholds(&self) -> Result<Vec<f64>, String> {
        if !self.thresholds.is_empty() {
            let mut out = self.thresholds.clone();
            out.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            out.dedup();
            return Ok(out);
        }
        if self.step <= 0.0 || self.to < self.from {
            return Err(format!(
                "a sweep needs step > 0 and to >= from (got from={}, to={}, step={})",
                self.from, self.to, self.step
            ));
        }
        let steps = ((self.to - self.from) / self.step).round() as usize;
        Ok((0..=steps)
            .map(|i| (self.from + self.step * i as f64).min(self.to))
            .collect())
    }
}

#[derive(Args, Debug, Clone)]
struct ParityArgs {
    #[command(flatten)]
    shared: SharedArgs,
    /// Backend A URL.
    #[arg(long)]
    a_url: String,
    /// Backend A label.
    #[arg(long, default_value = "jev")]
    a_label: String,
    /// Backend A model.
    #[arg(long, default_value = "jev-latest")]
    a_model: String,
    /// Backend A bearer token.
    #[arg(long)]
    a_key: Option<String>,
    /// Backend A input price; defaults to ADR-2089's measured Jev price.
    #[arg(long, default_value_t = JEV_USD_PER_MTOK_IN)]
    a_usd_per_mtok_in: f64,
    /// Backend B URL.
    #[arg(long)]
    b_url: String,
    /// Backend B label.
    #[arg(long, default_value = "sso")]
    b_label: String,
    /// Backend B model.
    #[arg(long, default_value = "laya-typed-decisions")]
    b_model: String,
    /// Backend B bearer token.
    #[arg(long)]
    b_key: Option<String>,
    /// Backend B input price; a local façade costs nothing per route.
    #[arg(long, default_value_t = 0.0)]
    b_usd_per_mtok_in: f64,
    /// Concurrent in-flight requests per backend.
    #[arg(long, default_value_t = 4)]
    concurrency: usize,
    /// Per-call timeout.
    #[arg(long, default_value_t = 20_000)]
    timeout_ms: u64,
    /// Retries on 429/529.
    #[arg(long, default_value_t = 2)]
    retries: u32,
}

/// Resolve the shared arguments into a loaded corpus.
fn load(shared: &SharedArgs) -> Result<Loaded, String> {
    load_corpus(
        &shared.cases,
        &shared.skills_dir,
        shared.limit,
        shared.option_budget,
    )
}

fn write_json(path: &Option<PathBuf>, value: &impl serde::Serialize) -> Result<(), String> {
    let Some(path) = path else { return Ok(()) };
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("cannot serialise the report: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    eprintln!("report written to {}", path.display());
    Ok(())
}

/// Is this backend on this machine or this network?
///
/// Deliberately conservative: anything that is not obviously loopback or a
/// private range counts as remote and therefore requires a credential. The
/// cost of a false "remote" is one flag; the cost of a false "local" is a run
/// that reports 403s as if the service were down.
fn is_local_url(url: &str) -> bool {
    let host = url
        .split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .rsplit(':')
        .next_back()
        .unwrap_or("");
    host == "localhost"
        || host == "systemone"
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("172.16.")
        || host == "::1"
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Inspect(shared) => inspect(shared),
        Command::Run(args) => run(args).await,
        Command::Parity(args) => parity(args).await,
        Command::Sweep(args) => sweep(args).await,
        Command::CopyCeiling(args) => copy_ceiling(args).await,
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("system-one-eval: {message}");
            ExitCode::FAILURE
        }
    }
}

fn inspect(shared: SharedArgs) -> Result<(), String> {
    let loaded = load(&shared)?;
    let late = loaded.late.iter().filter(|l| **l).count();
    if !loaded.corpus.role.is_empty() {
        println!("corpus       {}\n", loaded.corpus.role);
    }
    println!("cases        {}", loaded.corpus.cases.len());
    println!("candidates   {} (+ none)", loaded.candidates.len());
    println!(
        "late-discriminator cases  {late} of {} at an option budget of {} tokens",
        loaded.corpus.cases.len(),
        shared.option_budget
    );
    let mut by_class: std::collections::BTreeMap<&str, usize> = Default::default();
    for case in &loaded.corpus.cases {
        *by_class.entry(case.class.as_str()).or_insert(0) += 1;
    }
    for (class, count) in by_class {
        println!("  class {class:<16} {count}");
    }
    if !loaded.unscorable.is_empty() {
        println!("\nlabels with no live skill:");
        for label in &loaded.unscorable {
            println!("  {label}");
        }
    }
    Ok(())
}

/// A run's report, plus the input-exposure control when one was computed.
///
/// `#[serde(flatten)]` keeps the JSON a superset of the old shape, so anything
/// already reading a `run --json` report keeps working and simply gains a
/// field.
#[derive(serde::Serialize)]
struct RunOutput {
    #[serde(flatten)]
    report: Report,
    #[serde(skip_serializing_if = "Option::is_none")]
    copy_ceiling: Option<CopyCeiling>,
}

async fn run(args: RunArgs) -> Result<(), String> {
    let loaded = load(&args.shared)?;
    let backend = backend_of(&args);
    let report = run_backend(&loaded, &backend, args.concurrency).await?;
    println!("{}", metrics::render(&report));

    let ceiling = match args.copy_ceiling {
        Ceilings::Off => None,
        mode => {
            let rankers = build_rankers(&loaded, mode, &args.shared).await?;
            let exposure = Exposure::new(&loaded.candidates);
            let ceiling = copy::build(&report, &exposure, &rankers, CeilingMode::Fair);
            println!("{}", copy::render(&ceiling));
            Some(ceiling)
        }
    };
    write_json(
        &args.shared.json,
        &RunOutput {
            report,
            copy_ceiling: ceiling,
        },
    )
}

/// Build the judge-free rankers over the exposed rubrics.
///
/// The prompts are the corpus prompts as written, unclamped: the clamp in
/// [`system_one_eval::client::clamp_prompt`] exists to keep a pasted document
/// inside the *judge's* budget, and applying it to the copy procedure would
/// hide exposed text from the control that the control is entitled to see.
async fn build_rankers(
    loaded: &Loaded,
    which: Ceilings,
    shared: &SharedArgs,
) -> Result<Vec<Ranker>, String> {
    let exposure = Exposure::new(&loaded.candidates);
    let prompts: Vec<String> = loaded
        .corpus
        .cases
        .iter()
        .map(|c| c.prompt.clone())
        .collect();
    let mut rankers = vec![Ranker::bm25(&exposure, &prompts)];
    if which == Ceilings::Both {
        eprintln!("embedding the exposure, one text per request (sequential)…");
        let embedder = SequentialEmbedder::new(
            &shared.embeddings_url,
            &shared.embeddings_model,
            Duration::from_millis(shared.embeddings_timeout_ms),
        )?;
        rankers.push(Ranker::embedding(&exposure, &prompts, &embedder).await?);
    }
    Ok(rankers)
}

/// The judge half of the control: either a live run, or a saved report.
async fn judge_report(args: &CopyCeilingArgs, loaded: &Loaded) -> Result<Report, String> {
    if let Some(path) = &args.from_report {
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        let report: Report = serde_json::from_str(&text)
            .map_err(|e| format!("{} is not a run report: {e}", path.display()))?;
        // A control whose judge rows belong to a different corpus would be
        // comparing two different experiments and reporting the difference as
        // a gain, so the alignment is checked rather than assumed.
        if report.cases.len() != loaded.corpus.cases.len() {
            return Err(format!(
                "{} has {} cases but the corpus has {} — they are not the same run",
                path.display(),
                report.cases.len(),
                loaded.corpus.cases.len()
            ));
        }
        for (scored, case) in report.cases.iter().zip(&loaded.corpus.cases) {
            if scored.expected != case.expected_skill {
                return Err(format!(
                    "{} disagrees with the corpus at case #{}: report expects `{}`, corpus \
                     expects `{}`",
                    path.display(),
                    scored.index,
                    scored.expected,
                    case.expected_skill
                ));
            }
        }
        eprintln!(
            "judge answers read from {} ({} cases, no backend called)",
            path.display(),
            report.cases.len()
        );
        return Ok(report);
    }

    let url = args
        .backend
        .clone()
        .ok_or("the judge half needs either --backend or --from-report")?;
    let key = args
        .key
        .clone()
        .or_else(|| std::env::var(&args.key_env).ok())
        .filter(|k| !k.is_empty());
    // A remote backend with no credential answers 403 for every case, and the
    // report then shows a judge that "never answered" — which reads exactly
    // like an outage. Refuse instead: a measurement rig must not let a missing
    // credential masquerade as an unavailable service. Loopback backends stay
    // unauthenticated by design (ADR-2094 §2).
    if key.is_none() && !is_local_url(&url) {
        return Err(format!(
            "no bearer token for remote backend {url}. Pass --key, or export {} \
             (or name another var with --key-env). Refusing to run: an \
             unauthenticated remote run returns 403 on every case, and the \
             report is then indistinguishable from the backend being unavailable.",
            args.key_env
        ));
    }
    let backend = Backend {
        label: args.label.clone(),
        url,
        model: args.model.clone(),
        key,
        timeout: Duration::from_millis(args.timeout_ms),
        retries: args.retries,
        usd_per_mtok_in: 0.0,
        none_threshold: args.none_threshold,
        shortlist_k: args.shortlist_k,
    };
    run_backend(loaded, &backend, args.concurrency).await
}

/// Every copy-ceiling report the run produced, for `--json`.
#[derive(serde::Serialize)]
struct CopyCeilingOutput {
    /// The default, fair ceiling. Always present.
    fair: CopyCeiling,
    /// The naive ceiling, only when it was asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    naive: Option<CopyCeiling>,
}

async fn copy_ceiling(args: CopyCeilingArgs) -> Result<(), String> {
    if args.ceilings == Ceilings::Off {
        return Err("`copy-ceiling --ceilings off` would compute nothing".into());
    }
    let loaded = load(&args.shared)?;
    let report = judge_report(&args, &loaded).await?;
    let rankers = build_rankers(&loaded, args.ceilings, &args.shared).await?;
    let exposure = Exposure::new(&loaded.candidates);

    // The fair ceiling is unconditional. The naive one is printed after it,
    // never in its place: on this corpus the naive number is several points
    // larger purely because a copy procedure has no rubric for `none`.
    let fair = copy::build(&report, &exposure, &rankers, CeilingMode::Fair);
    println!("{}", copy::render(&fair));

    let naive = args.concede_none.then(|| {
        let naive = copy::build(&report, &exposure, &rankers, CeilingMode::ConcedeNone);
        println!(
            "\nThe same control WITHOUT a decline rule for the copy procedure. It is shown for \
             comparison only: `none` is conceded to the judge by construction here, and on this \
             corpus that asymmetry supplies most of the margin.\n"
        );
        println!("{}", copy::render(&naive));
        naive
    });

    write_json(&args.shared.json, &CopyCeilingOutput { fair, naive })
}

/// Build a backend from the shared run arguments.
fn backend_of(args: &RunArgs) -> Backend {
    let key = args
        .key
        .clone()
        .or_else(|| std::env::var(&args.key_env).ok())
        .filter(|k| !k.is_empty());
    Backend {
        label: args.label.clone(),
        url: args.backend.clone(),
        model: args.model.clone(),
        key,
        timeout: Duration::from_millis(args.timeout_ms),
        retries: args.retries,
        usd_per_mtok_in: args.usd_per_mtok_in,
        none_threshold: None,
        shortlist_k: args.shortlist_k,
    }
}

async fn sweep(args: SweepArgs) -> Result<(), String> {
    let thresholds = args.thresholds()?;
    let loaded = load(&args.run.shared)?;
    let backend = backend_of(&args.run);
    let sweep = run_sweep(&loaded, &backend, args.run.concurrency, &thresholds).await?;
    println!("{}", metrics::render_sweep(&sweep));
    write_json(&args.run.shared.json, &sweep)
}

async fn parity(args: ParityArgs) -> Result<(), String> {
    let loaded = load(&args.shared)?;
    let timeout = Duration::from_millis(args.timeout_ms);
    let a = Backend {
        label: args.a_label.clone(),
        url: args.a_url.clone(),
        model: args.a_model.clone(),
        key: args.a_key.clone().filter(|k| !k.is_empty()),
        timeout,
        retries: args.retries,
        usd_per_mtok_in: args.a_usd_per_mtok_in,
        none_threshold: None,
        shortlist_k: None,
    };
    let b = Backend {
        label: args.b_label.clone(),
        url: args.b_url.clone(),
        model: args.b_model.clone(),
        key: args.b_key.clone().filter(|k| !k.is_empty()),
        timeout,
        retries: args.retries,
        usd_per_mtok_in: args.b_usd_per_mtok_in,
        none_threshold: None,
        shortlist_k: None,
    };
    // Sequential by backend: running both at once would have each measuring
    // the other's contention, and latency is one of the numbers being reported.
    let report_a = run_backend(&loaded, &a, args.concurrency).await?;
    let report_b = run_backend(&loaded, &b, args.concurrency).await?;
    let parity = metrics::compare(report_a, report_b);
    println!("{}", metrics::render_parity(&parity));
    write_json(&args.shared.json, &parity)
}
