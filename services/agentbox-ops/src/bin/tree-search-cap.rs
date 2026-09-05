//! `tree-search-cap` — the enforced spend/candidate/time limiter for the
//! execution-gated tree-search coder (ADR-2020).
//!
//! The tree-search orchestration path is a sequence of tool calls made by an
//! agent, not a single long-lived process, so the cap is enforced at a real
//! dispatch boundary: **every candidate branch must be reserved here before it
//! is dispatched and settled here when it finishes**. The reservation holds the
//! branch's estimated cost against the run's budget for as long as it runs, so
//! concurrent and in-flight branches cannot jointly exceed
//! `[skills.tree_search_coder] spend_cap_usd`.
//!
//! ```text
//! tree-search-cap reserve --run <id> --estimate 0.13
//! tree-search-cap settle  --run <id> --reservation res-… --actual 0.11
//! tree-search-cap settle  --run <id> --reservation res-… --actual 0.00 --failed
//! tree-search-cap status  --run <id>
//! ```
//!
//! Exit codes: `0` granted/accepted, `2` argument or ledger error,
//! `3` REFUSED by the cap (spend, candidate count, wall clock, or a disabled
//! manifest gate). Every response is a single JSON object on stdout.

use agentbox_ops::cost_cap::{
    default_ledger_path, CapConfig, CapError, Limiter, Outcome, Reservation,
};
use clap::{Parser, Subcommand};
use serde_json::json;
use std::path::PathBuf;
use std::process::ExitCode;

const EXIT_ERROR: u8 = 2;
const EXIT_REFUSED: u8 = 3;

#[derive(Parser)]
#[command(
    name = "tree-search-cap",
    about = "Enforced per-run spend/candidate/time cap for execution-gated tree-search (ADR-2020)"
)]
struct Args {
    /// Manifest to read `[skills.tree_search_coder]` from.
    /// Default: $AGENTBOX_MANIFEST, /opt/agentbox/agentbox.toml, ./agentbox.toml.
    #[arg(long, value_name = "FILE", global = true)]
    manifest: Option<PathBuf>,
    /// Ledger file holding the reservations.
    /// Default: $AGENTBOX_TREE_SEARCH_LEDGER, else $XDG_STATE_HOME/agentbox/tree-search-cap.json.
    #[arg(long, value_name = "FILE", global = true)]
    ledger: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Reserve budget for one branch. MUST be called before dispatching it.
    Reserve {
        #[arg(long, value_name = "ID")]
        run: String,
        /// Estimated cost of this branch in USD.
        #[arg(long, value_name = "USD")]
        estimate: f64,
    },
    /// Release a reservation and charge the actual cost (success or failure).
    Settle {
        #[arg(long, value_name = "ID")]
        run: String,
        #[arg(long, value_name = "RES-ID")]
        reservation: String,
        /// Actual cost of the branch in USD.
        #[arg(long, value_name = "USD", default_value_t = 0.0)]
        actual: f64,
        /// Mark the branch as failed/cancelled. The hold is released either way.
        #[arg(long)]
        failed: bool,
    },
    /// Print the run's accounting, expiring any stale holds first.
    Status {
        #[arg(long, value_name = "ID")]
        run: String,
    },
    /// Drop a run's accounting entirely (operator reset).
    Reset {
        #[arg(long, value_name = "ID")]
        run: String,
    },
    /// Print the effective cap configuration and where each field came from.
    Config,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let config = CapConfig::load(args.manifest.as_deref());
    let ledger = args.ledger.clone().unwrap_or_else(default_ledger_path);
    let limiter = Limiter::new(config.clone(), ledger.clone());

    match args.cmd {
        Cmd::Config => {
            print(&json!({
                "ok": true,
                "config": config,
                "ledger": ledger,
            }));
            ExitCode::SUCCESS
        }
        Cmd::Reserve { run, estimate } => match limiter.reserve(&run, estimate) {
            Ok(r) => {
                print(&json!({ "ok": true, "action": "reserve", "reservation": r }));
                ExitCode::SUCCESS
            }
            Err(e) => refuse("reserve", &e),
        },
        Cmd::Settle {
            run,
            reservation,
            actual,
            failed,
        } => {
            // `settle` only needs the identity of the hold; the ledger owns the
            // authoritative estimate and deadline.
            let stub = Reservation {
                id: reservation,
                run_id: run,
                candidate_index: 0,
                estimate_usd: 0.0,
                started_at_ms: 0,
                deadline_ms: i64::MAX,
                cap_usd: config.spend_cap_usd,
                remaining_usd: 0.0,
            };
            let outcome = if failed {
                Outcome::Failed
            } else {
                Outcome::Completed
            };
            match limiter.settle(&stub, actual, outcome) {
                Ok(s) => {
                    print(&json!({ "ok": true, "action": "settle", "settlement": s }));
                    ExitCode::SUCCESS
                }
                Err(e) => refuse("settle", &e),
            }
        }
        Cmd::Status { run } => match limiter.status(&run) {
            Ok(st) => {
                print(&json!({
                    "ok": true,
                    "action": "status",
                    "run": run,
                    "state": st,
                    "outstanding_usd": st.outstanding_usd(),
                    "remaining_usd": config.spend_cap_usd - st.committed_usd - st.outstanding_usd(),
                }));
                ExitCode::SUCCESS
            }
            Err(e) => refuse("status", &e),
        },
        Cmd::Reset { run } => match limiter.reset(&run) {
            Ok(()) => {
                print(&json!({ "ok": true, "action": "reset", "run": run }));
                ExitCode::SUCCESS
            }
            Err(e) => refuse("reset", &e),
        },
    }
}

fn print(v: &serde_json::Value) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

fn refuse(action: &str, e: &CapError) -> ExitCode {
    print(&json!({
        "ok": false,
        "action": action,
        "refused": e,
        "message": e.to_string(),
    }));
    match e {
        CapError::Ledger { .. } | CapError::InvalidAmount { .. } => ExitCode::from(EXIT_ERROR),
        _ => ExitCode::from(EXIT_REFUSED),
    }
}
