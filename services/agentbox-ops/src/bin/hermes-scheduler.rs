//! `hermes-scheduler` — background cron daemon for Claude Code agent tasks.
//!
//! Replaces `skills/hermes-scheduler/scripts/scheduler.py`. Subcommands and
//! output match the Python original; `run-loop` is new and internal — it is
//! what the detached daemon execs, replacing the original's double `fork()`.

use agentbox_ops::hermes::{
    self,
    jobs::{self, Store},
    schedule::parse_schedule,
};
use chrono::Local;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "hermes-scheduler", about = "Hermes Scheduler for Claude Code")]
struct Args {
    /// State directory (default ~/.claude/scheduler).
    #[arg(long, global = true)]
    root: Option<PathBuf>,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Start the scheduler daemon.
    Start,
    /// Stop the scheduler daemon.
    Stop,
    /// Show scheduler status.
    Status,
    /// Run one tick in the foreground.
    Tick,
    /// Internal: the supervised tick loop the daemon runs.
    #[command(hide = true)]
    RunLoop,
    /// Add a job.
    Add {
        /// Natural-language task.
        #[arg(long)]
        prompt: String,
        /// Schedule: '30m', 'every 2h', '0 9 * * *'.
        #[arg(long)]
        schedule: String,
        #[arg(long)]
        name: Option<String>,
        /// Repeat count; omit to repeat forever.
        #[arg(long)]
        repeat: Option<i64>,
        /// Working directory (default ~/workspace).
        #[arg(long)]
        workdir: Option<String>,
    },
    /// List all jobs.
    List,
    /// Remove a job.
    Remove {
        #[arg(long)]
        id: String,
    },
    /// Pause a job.
    Pause {
        #[arg(long)]
        id: String,
    },
    /// Resume a paused job.
    Resume {
        #[arg(long)]
        id: String,
    },
    /// Trigger a job immediately.
    Trigger {
        #[arg(long)]
        id: String,
    },
    /// View recent output.
    Output {
        #[arg(long)]
        id: String,
        #[arg(long, default_value_t = 50)]
        lines: usize,
    },
}

fn main() {
    let args = Args::parse();
    let store = Store::new(args.root.unwrap_or_else(Store::default_root));
    let now = Local::now();

    match args.command {
        Cmd::Start => {
            if let Err(e) = hermes::daemon_start(&store) {
                eprintln!("Scheduler failed to start: {e}");
                std::process::exit(1);
            }
        }
        Cmd::Stop => hermes::daemon_stop(&store),
        Cmd::Status => hermes::daemon_status(&store),
        Cmd::Tick => println!(
            "Tick complete: {} job(s) executed",
            hermes::tick(&store, true)
        ),
        Cmd::RunLoop => hermes::run_loop(&store),

        Cmd::Add {
            prompt,
            schedule,
            name,
            repeat,
            workdir,
        } => {
            let parsed = match parse_schedule(&schedule, now) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(2);
                }
            };
            let job = jobs::new_job(
                &prompt,
                parsed,
                name.as_deref(),
                repeat,
                workdir.as_deref(),
                now,
            );
            let mut all = store.load();
            all.push(job.clone());
            if let Err(e) = store.save(&all, now) {
                eprintln!("Failed to save jobs: {e}");
                std::process::exit(1);
            }
            println!("Job created: {}", job.id);
            println!("  Name: {}", job.name);
            println!("  Schedule: {}", job.schedule_display);
            println!(
                "  Next run: {}",
                job.next_run_at.as_deref().unwrap_or("None")
            );
        }

        Cmd::List => {
            let all = store.load();
            if all.is_empty() {
                println!("No jobs");
                return;
            }
            for j in &all {
                let times = j
                    .repeat
                    .times
                    .map(|t| t.to_string())
                    .unwrap_or_else(|| "∞".to_string());
                println!(
                    "  [{}] {} | {} | state={} last={} runs={}/{}",
                    j.id,
                    j.name,
                    j.schedule_display,
                    j.state,
                    j.last_status.as_deref().unwrap_or("never"),
                    j.repeat.completed,
                    times
                );
            }
        }

        Cmd::Remove { id } => mutate(&store, now, &id, "removed", |all| jobs::remove(all, &id)),
        Cmd::Pause { id } => mutate(&store, now, &id, "paused", |all| jobs::pause(all, &id, now)),
        Cmd::Resume { id } => mutate(&store, now, &id, "resumed", |all| {
            jobs::resume(all, &id, now)
        }),
        Cmd::Trigger { id } => mutate(
            &store,
            now,
            &id,
            "triggered — will run on next tick",
            |all| jobs::trigger(all, &id, now),
        ),

        Cmd::Output { id, lines } => {
            let dir = store.output_dir().join(&id);
            if !dir.exists() {
                println!("No output for job {id}");
                return;
            }
            let mut files: Vec<_> = std::fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|e| e == "md"))
                .collect();
            files.sort();
            files.reverse();
            let Some(latest) = files.first() else {
                println!("No output files for job {id}");
                return;
            };
            println!(
                "--- {} ---",
                latest.file_name().unwrap_or_default().to_string_lossy()
            );
            let text = std::fs::read_to_string(latest).unwrap_or_default();
            let all: Vec<&str> = text.lines().collect();
            for line in all.iter().skip(all.len().saturating_sub(lines)) {
                println!("{line}");
            }
        }
    }
}

/// Applies a mutation, persists it, and prints the Python original's message.
fn mutate<F>(store: &Store, now: chrono::DateTime<Local>, id: &str, verb: &str, f: F)
where
    F: FnOnce(&mut Vec<agentbox_ops::hermes::jobs::Job>) -> bool,
{
    let mut all = store.load();
    if f(&mut all) {
        if let Err(e) = store.save(&all, now) {
            eprintln!("Failed to save jobs: {e}");
            std::process::exit(1);
        }
        println!("Job {id} {verb}");
    } else {
        println!("Job {id} not found");
    }
}
