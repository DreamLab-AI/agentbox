use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use dream_engine::archive::GitIdentity;
use dream_engine::config::RuntimeConfig;
use dream_engine::engine::Engine;
use dream_engine::estate::{
    default_artefact_dir, default_roster_path, fallback_llm_config, legacy_artefact_dir,
    llm_config, ruvector_config, unmigrated_artefacts,
};
use dream_engine::ledger_io::{self, NightRunning};
use dream_engine::review::{self, Ledgering, Mode};
use dream_engine::runner::{EvaluatorRunner, SshRunner};
use dream_engine::{digest, governance, inbox};

/// Dream Engine — nightly evidence-gated repository evolution (the connected node annexe).
///
/// Rust rewrite of scripts/dream-machine-nightly.mjs. Discovers repos
/// nominated by a dream.config.json marker file, compiles a deterministic
/// nightly prompt, dispatches build + evaluators to the connected node annexe over SSH,
/// calls the LLM (Z.AI GLM by default), parses the verdict, and persists
/// report + ledger row + witness + RuVector memory.
#[derive(Parser, Debug)]
#[command(name = "dream-engine", version, about)]
struct Cli {
    /// Run a single cycle now, ignoring the nightly window.
    #[arg(long)]
    once: bool,

    /// Loop forever, running one cycle per night inside the UTC window.
    #[arg(long = "loop")]
    loop_mode: bool,

    /// Compile + select only; no dispatch, no LLM call.
    #[arg(long)]
    dry_run: bool,

    /// Force a specific nominated repo instead of day rotation.
    #[arg(long)]
    target: Option<String>,

    /// Workspace root to scan for nominated repos.
    #[arg(long, default_value = "/home/devuser/workspace")]
    workspace: PathBuf,

    /// Directory for night artefacts (reports, receipts, review records).
    /// Durable: never prune it. Default: `[dream_machine].artefact_dir`, else
    /// /home/devuser/workspace/dream-artefacts.
    #[arg(long)]
    artefact_dir: Option<PathBuf>,

    /// Optional agentbox.toml to read the [dream_machine] table from.
    #[arg(long)]
    agentbox_toml: Option<PathBuf>,

    /// Durable fair-scheduling state: which repo dreamed when, so the nightly
    /// cap rotates through the whole roster instead of pinning its head.
    #[arg(long, default_value_os_t = default_roster_path())]
    roster_path: PathBuf,

    /// One-shot operator commands (forum I/O only; no annexe, no LLM).
    #[command(subcommand)]
    command: Option<Cmd>,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Dream-machine decisions on the forum governance panel (ADR-2115).
    Governance {
        #[command(subcommand)]
        action: GovernanceAction,
    },
    /// Compose tonight's plain-English digest and post it to the forum.
    Digest {
        /// Night to report (YYYY-MM-DD, default today UTC).
        #[arg(long)]
        date: Option<String>,
        /// Print the digest; post nothing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Human review records: the only source of the ledger's `Reviewer` and
    /// `Review-minutes` cells.
    Review {
        #[command(subcommand)]
        action: ReviewAction,
    },
    /// Reopen a finished night: archive its run-state and manifest as
    /// `*-superseded-<timestamp>` (nothing is deleted) so the next start runs it
    /// afresh. A finished night is otherwise never repeated.
    ResetNight {
        /// Repository name (the directory name, not the slug).
        repo: String,
        /// Night date, `YYYY-MM-DD`.
        date: String,
    },
}

#[derive(Subcommand, Debug)]
enum ReviewAction {
    /// Import reviews from a JSON Lines file, one review per line. Each line
    /// is checked against its night folder (witness recomputed), written as
    /// that night's review.json, and backfilled into the ledger row. Refuses
    /// to run while a night is in progress. Exit 1: a line was refused; exit
    /// 3: every line was recorded but a ledger fill is pending.
    Import {
        /// The JSON Lines file (`-` reads standard input).
        file: PathBuf,
        /// Validate and report; write no record, edit no ledger.
        #[arg(long)]
        dry_run: bool,
        /// Run even while a night is in progress (ledger edits still wait
        /// for the night's ledger lock).
        #[arg(long)]
        force_during_night: bool,
    },
    /// Backfill ledger rows from every night's review.json (the night-start
    /// step, run by hand). Refuses to run while a night is in progress.
    Backfill {
        /// Validate and report; edit no ledger.
        #[arg(long)]
        dry_run: bool,
        /// Run even while a night is in progress.
        #[arg(long)]
        force_during_night: bool,
    },
}

#[derive(Subcommand, Debug)]
enum GovernanceAction {
    /// Publish the panel and every open, unpublished inbox item as a case.
    Publish {
        /// Print the unsigned events; send nothing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Read admin decisions for published cases and resolve inbox items.
    Ingest {
        /// Print the resolutions; write nothing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Withdraw (NIP-09 kind-5) every resolved case still on the panel.
    Withdraw {
        /// Print the unsigned deletions; send nothing.
        #[arg(long)]
        dry_run: bool,
    },
}

/// Refuse a ledger-writing review command while a night is in progress (the
/// night-in-progress lock in the artefact directory is held), unless forced.
fn refuse_during_night(what: &str, artefact_dir: &std::path::Path, dry_run: bool, force: bool) {
    if dry_run || force || !ledger_io::night_in_progress(artefact_dir) {
        return;
    }
    eprintln!(
        "review {what}: a dream night is in progress ({} is held); rerun once it ends, or pass \
         --force-during-night (ledger edits then wait for the night's ledger lock)",
        artefact_dir.join(ledger_io::NIGHT_RUNNING_FILE).display()
    );
    std::process::exit(1);
}

/// Run a one-shot subcommand. These touch only the forum, the inbox file, a
/// night folder's review record and the ledger rows it names, so they run
/// alongside the supervised loop without its singleton lock; ledger edits take
/// each ledger's own lock, and review commands refuse to run during a night.
async fn run_command(
    cmd: &Cmd,
    workspace: &std::path::Path,
    artefact_dir: &std::path::Path,
    identity: Option<GitIdentity>,
) {
    let how = Ledgering {
        identity,
        ..Ledgering::default()
    };
    match cmd {
        Cmd::Governance { action } => {
            let report = match action {
                GovernanceAction::Publish { dry_run } => {
                    let paths = governance::CasePaths {
                        workspace: workspace.to_path_buf(),
                        artefact_dir: artefact_dir.to_path_buf(),
                    };
                    governance::publish(&inbox::inbox_path(), &paths, *dry_run).await
                }
                GovernanceAction::Ingest { dry_run } => {
                    governance::ingest(&inbox::inbox_path(), *dry_run).await
                }
                GovernanceAction::Withdraw { dry_run } => {
                    governance::withdraw(&inbox::inbox_path(), *dry_run).await
                }
            };
            println!(
                "published={} rejected={} resolved={} withdrawn={} dry-run-listed={}",
                report.published,
                report.rejected,
                report.resolved,
                report.withdrawn,
                report.skipped
            );
        }
        Cmd::Review { action } => match action {
            ReviewAction::Import {
                file,
                dry_run,
                force_during_night,
            } => {
                refuse_during_night("import", artefact_dir, *dry_run, *force_during_night);
                let text = if file.as_os_str() == "-" {
                    std::io::read_to_string(std::io::stdin())
                } else {
                    std::fs::read_to_string(file)
                };
                let text = match text {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("review import: cannot read {}: {e}", file.display());
                        std::process::exit(1);
                    }
                };
                let mode = if *dry_run { Mode::DryRun } else { Mode::Apply };
                let reports = review::import_jsonl(&text, artefact_dir, workspace, mode, &how);
                for r in &reports {
                    println!("{r}");
                }
                let refused = reports.iter().filter(|r| r.refused()).count();
                let pending = reports.iter().filter(|r| r.fill_pending()).count();
                println!(
                    "{}imported={} fill-pending={pending} refused={refused}",
                    if *dry_run { "dry-run: " } else { "" },
                    reports.len() - refused - pending
                );
                if refused > 0 {
                    std::process::exit(1);
                }
                if pending > 0 {
                    std::process::exit(3);
                }
            }
            ReviewAction::Backfill {
                dry_run,
                force_during_night,
            } => {
                refuse_during_night("backfill", artefact_dir, *dry_run, *force_during_night);
                let mode = if *dry_run { Mode::DryRun } else { Mode::Apply };
                let out = review::backfill_all(artefact_dir, workspace, mode, &how);
                let mut refused = 0usize;
                for (night, result) in &out {
                    match result {
                        Ok(fill) => println!("{night}: {fill}"),
                        Err(e) => {
                            refused += 1;
                            println!("{night}: REFUSED: {e}");
                        }
                    }
                }
                println!(
                    "{}reviewed-nights={} refused={refused}",
                    if *dry_run { "dry-run: " } else { "" },
                    out.len()
                );
                if refused > 0 {
                    std::process::exit(1);
                }
            }
        },
        Cmd::ResetNight { repo, date } => {
            let dir = artefact_dir.join(format!("{date}-{repo}"));
            match dream_core::runstate::reset_night(&dir) {
                Ok(()) => println!(
                    "night {date}-{repo} reset; archived under {}",
                    dir.display()
                ),
                Err(e) => {
                    eprintln!("reset-night failed: {e}");
                    std::process::exit(1);
                }
            }
        }
        Cmd::Digest { date, dry_run } => {
            let date = date.clone().unwrap_or_else(|| day_int_and_date().1);
            println!("{}", digest::run(workspace, &date, *dry_run).await);
        }
    }
}

fn load_runtime(cli: &Cli) -> RuntimeConfig {
    if let Some(path) = &cli.agentbox_toml {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(value) = text.parse::<toml::Table>() {
                if let Some(dm) = value.get("dream_machine") {
                    if let Ok(mut rt) = dm.clone().try_into::<RuntimeConfig>() {
                        rt.resolve_placeholders();
                        return rt;
                    }
                }
            }
        }
        error!(path = %path.display(), "could not parse [dream_machine] from agentbox.toml — using defaults");
    }
    // Defaults via serde: deserialize an empty table.
    toml::Table::new()
        .try_into()
        .expect("RuntimeConfig defaults are total")
}

fn day_int_and_date() -> (u32, String) {
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let day_int: u32 = now.format("%Y%m%d").to_string().parse().unwrap_or(0);
    (day_int, date)
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    let runtime = load_runtime(&cli);

    // The configured identity is a fallback, never an override. The engine's
    // own commits (archive, ledger rows) resolve it per repository. Commits
    // inside dream-core (candidate worktrees) take no identity argument, so
    // the fallback is also installed as an account-level git configuration
    // layer that includes the account's real configuration after it: any
    // repository or account identity outranks it. Set while the process is
    // still single-threaded, before the async runtime starts.
    match runtime.git_identity() {
        Some(identity) => {
            let layer = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join(".cache/dream-engine/fallback-identity.gitconfig");
            match dream_engine::archive::install_fallback_layer(&identity, &layer) {
                Ok(path) => {
                    std::env::set_var("GIT_CONFIG_GLOBAL", &path);
                    info!(name = %identity.name, email = %identity.email, layer = %path.display(),
                        "fallback git identity (used only where a repository has none)");
                }
                Err(e) => warn!(error = %e, layer = %layer.display(),
                    "cannot write the fallback git identity layer; dream-core commits in a \
                     repository without its own identity will fail"),
            }
        }
        None => warn!(
            "no fallback git identity configured: set {} — until then commits in a checkout \
             without its own git identity fail (Author identity unknown)",
            dream_engine::archive::IDENTITY_KEYS
        ),
    }

    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            error!(error = %e, "cannot start the async runtime");
            std::process::exit(1);
        }
    };
    rt.block_on(run(cli, runtime));
}

async fn run(cli: Cli, runtime: RuntimeConfig) {
    let artefact_dir = cli
        .artefact_dir
        .clone()
        .or_else(|| runtime.artefact_dir.as_deref().map(PathBuf::from))
        .unwrap_or_else(default_artefact_dir);
    if let Some(cmd) = &cli.command {
        run_command(cmd, &cli.workspace, &artefact_dir, runtime.git_identity()).await;
        return;
    }
    if !cli.once && !cli.loop_mode && !cli.dry_run {
        eprintln!("usage: dream-engine --once | --loop | --dry-run [--target <repo>] | governance publish|ingest|withdraw [--dry-run] | digest [--date D] [--dry-run] | review import <file.jsonl> [--dry-run] | review backfill [--dry-run]");
        std::process::exit(2);
    }

    if !runtime.enabled && cli.loop_mode {
        info!("dream_machine.enabled = false — loop mode exiting cleanly");
        return;
    }

    // Singleton guard: exactly one engine may dream. A localhost port bind is
    // a lock the kernel releases on ANY process death — no stale lockfiles.
    // Two loops racing the shared the connected node annexe corrupted nights 2026-08-20/21
    // (supervisord + a leftover tmux launcher); this makes that class of
    // fault impossible regardless of who starts us.
    let _singleton = match std::net::TcpListener::bind("127.0.0.1:49172") {
        Ok(l) => l,
        Err(_) => {
            error!("another dream-engine instance holds the singleton lock (127.0.0.1:49172) — exiting to avoid racing the connected node annexe");
            std::process::exit(if cli.loop_mode { 0 } else { 1 });
        }
    };

    let llm = llm_config(&runtime);
    let runner: Arc<dyn EvaluatorRunner> = Arc::new(SshRunner {
        host: runtime.hp_host.clone(),
    });
    let engine = Engine {
        llm_fallback: fallback_llm_config(&runtime, &llm),
        llm,
        ruvector: ruvector_config(&runtime),
        runner,
        roster_path: cli.roster_path.clone(),
        forge: Arc::new(dream_core::seams::GhForge),
        llm_override: None,
        runtime,
        workspace: cli.workspace.clone(),
        artefact_dir,
    };

    if cli.loop_mode {
        run_loop(&engine, cli.target.as_deref()).await;
        return;
    }

    let (day_int, date) = day_int_and_date();
    if !migration_guard_clear(&engine.artefact_dir, &date) {
        std::process::exit(1);
    }
    let _night = (!cli.dry_run).then(|| hold_night(&engine.artefact_dir));

    // Bare --once dreams every eligible repo (the nightly shape); --once
    // --target and --dry-run stay single-repo.
    if cli.once && cli.target.is_none() && !cli.dry_run {
        match engine.run_night(day_int, &date).await {
            None => info!("dreaming is paused (/dream on to resume)"),
            Some(outcomes) if outcomes.is_empty() => std::process::exit(1),
            Some(_) => {}
        }
        return;
    }

    match engine
        .run_cycle(cli.target.as_deref(), day_int, &date, cli.dry_run)
        .await
    {
        Ok(res) => {
            info!(
                repo = %res.repo,
                verdict = res.verdict.as_str(),
                witness = %res.witness_short,
                stored = res.stored_to_ruvector,
                "done"
            );
        }
        Err(dream_engine::engine::EngineError::NightLocked(night)) => {
            info!(%night, "night held by another engine — nothing to do");
        }
        Err(e) => {
            error!(error = %e, "cycle failed");
            std::process::exit(1);
        }
    }
}

/// The start-up guard ([`unmigrated_artefacts`]): false, with an error and an
/// inbox alert, when the nights are still in the legacy directory.
fn migration_guard_clear(artefact_dir: &std::path::Path, date: &str) -> bool {
    let Some(alert) = unmigrated_artefacts(artefact_dir, &legacy_artefact_dir()) else {
        return true;
    };
    error!("{alert}");
    // A stable night id and text: one open alert, however often it trips.
    if let Err(e) = inbox::add("alert", "archive", "artefact-migration", date, &alert) {
        warn!(error = %e, "dream inbox write failed (fail-open)");
    }
    false
}

/// Hold the night-in-progress lock for a night, so `review import` refuses to
/// run meanwhile. Fail-open: a lock that cannot be taken is logged and the
/// night runs anyway (ledger edits keep their own locks).
fn hold_night(artefact_dir: &std::path::Path) -> Option<NightRunning> {
    match NightRunning::acquire(artefact_dir, std::time::Duration::from_secs(5)) {
        Ok(lock) => Some(lock),
        Err(e) => {
            warn!(error = %e, "night-in-progress lock not taken (fail-open)");
            None
        }
    }
}

/// Nightly loop: at most one cycle per UTC day, only inside the window.
async fn run_loop(engine: &Engine, target: Option<&str>) {
    let mut last_run_date = String::new();
    info!(
        window_start = engine.runtime.window_start,
        window_end = engine.runtime.window_end,
        "entering nightly loop"
    );
    loop {
        let now = chrono::Utc::now();
        let hour = now.format("%H").to_string().parse::<u8>().unwrap_or(0);
        let (day_int, date) = day_int_and_date();

        let in_window = hour >= engine.runtime.window_start && hour < engine.runtime.window_end;
        if in_window && date != last_run_date {
            info!(date = %date, "nightly window open");
            // Un-migrated artefacts: no night runs until they are moved; the
            // check repeats every tick, so moving them resumes the loop
            // without a restart.
            if !migration_guard_clear(&engine.artefact_dir, &date) {
                tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                continue;
            }
            let night = hold_night(&engine.artefact_dir);
            match target {
                Some(t) => match engine.run_cycle(Some(t), day_int, &date, false).await {
                    Ok(res) => info!(
                        repo = %res.repo,
                        verdict = res.verdict.as_str(),
                        "nightly cycle complete"
                    ),
                    Err(dream_engine::engine::EngineError::NightLocked(night)) => {
                        info!(%night, "night held by another engine — skipped")
                    }
                    Err(e) => error!(error = %e, "nightly cycle failed"),
                },
                None => {
                    // A paused night is not consumed: retry the same date
                    // on the next tick once /dream on removes the flag.
                    if engine.run_night(day_int, &date).await.is_none() {
                        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                        continue;
                    }
                }
            }
            drop(night);
            last_run_date = date;
        }
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
    }
}
