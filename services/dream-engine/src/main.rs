use clap::Parser;
use std::path::PathBuf;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use dream_engine::config::RuntimeConfig;
use dream_engine::engine::{fallback_llm_config, llm_config, ruvector_config, Engine};

/// Dream Engine — nightly evidence-gated repository evolution (HP annexe).
///
/// Rust rewrite of scripts/dream-machine-nightly.mjs. Discovers repos
/// nominated by a dream.config.json marker file, compiles a deterministic
/// nightly prompt, dispatches build + evaluators to the HP annexe over SSH,
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

    /// Directory for night artefacts (reports, receipts).
    #[arg(
        long,
        default_value = "/home/devuser/workspace/.tmp/dream-annexe-artefacts"
    )]
    artefact_dir: PathBuf,

    /// Optional agentbox.toml to read the [dream_machine] table from.
    #[arg(long)]
    agentbox_toml: Option<PathBuf>,
}

fn load_runtime(cli: &Cli) -> RuntimeConfig {
    if let Some(path) = &cli.agentbox_toml {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(value) = text.parse::<toml::Table>() {
                if let Some(dm) = value.get("dream_machine") {
                    if let Ok(rt) = dm.clone().try_into::<RuntimeConfig>() {
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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    if !cli.once && !cli.loop_mode && !cli.dry_run {
        eprintln!("usage: dream-engine --once | --loop | --dry-run [--target <repo>]");
        std::process::exit(2);
    }

    let runtime = load_runtime(&cli);
    if !runtime.enabled && cli.loop_mode {
        info!("dream_machine.enabled = false — loop mode exiting cleanly");
        return;
    }

    // Singleton guard: exactly one engine may dream. A localhost port bind is
    // a lock the kernel releases on ANY process death — no stale lockfiles.
    // Two loops racing the shared HP annexe corrupted nights 2026-08-20/21
    // (supervisord + a leftover tmux launcher); this makes that class of
    // fault impossible regardless of who starts us.
    let _singleton = match std::net::TcpListener::bind("127.0.0.1:49172") {
        Ok(l) => l,
        Err(_) => {
            error!("another dream-engine instance holds the singleton lock (127.0.0.1:49172) — exiting to avoid racing the HP annexe");
            std::process::exit(if cli.loop_mode { 0 } else { 1 });
        }
    };

    let llm = llm_config(&runtime);
    let engine = Engine {
        llm_fallback: fallback_llm_config(&runtime, &llm),
        llm,
        ruvector: ruvector_config(&runtime),
        runtime,
        workspace: cli.workspace.clone(),
        artefact_dir: cli.artefact_dir.clone(),
    };

    if cli.loop_mode {
        run_loop(&engine, cli.target.as_deref()).await;
        return;
    }

    let (day_int, date) = day_int_and_date();

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
        Err(e) => {
            error!(error = %e, "cycle failed");
            std::process::exit(1);
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
            match target {
                Some(t) => match engine.run_cycle(Some(t), day_int, &date, false).await {
                    Ok(res) => info!(
                        repo = %res.repo,
                        verdict = res.verdict.as_str(),
                        "nightly cycle complete"
                    ),
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
            last_run_date = date;
        }
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
    }
}
