use agentbox_sessions::plane::{Config, Plane};
use agentbox_sessions::reconcile::Decision;
use agentbox_sessions::status::{write_hook, Hook};
use agentbox_sessions::{api, pick};
use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use std::sync::Arc;

/// Agentbox session plane (ADR-2153): reconcile the manifest's session seeds in tmux.
#[derive(Parser)]
#[command(name = "agentbox-sessions", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the supervised daemon: provision, serve the socket, reconcile on a timer.
    Daemon,
    /// One reconcile pass.
    Reconcile {
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// List sessions with their status.
    List {
        #[arg(long)]
        json: bool,
    },
    /// Type a line into a session and submit it.
    Send { slug: String, text: String },
    /// Start a session that is not in the manifest.
    Create {
        slug: String,
        #[arg(long)]
        tool: String,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        worktree: bool,
    },
    /// Close a session created with `create`.
    Close { slug: String },
    /// Interactive picker for tab 8; moves only the client it runs in.
    Pick {
        #[arg(long)]
        list: bool,
    },
    /// Print each seed as the launch contract resolves it.
    Resolve {
        #[arg(long)]
        json: bool,
    },
    /// Record busy/idle from an agent hook.
    Mark { slug: String, state: String },
    /// Reap Agent of Empires' leftover worktrees.
    Reap {
        #[arg(long)]
        dry_run: bool,
    },
    /// Send one raw JSON request to a running daemon's socket.
    Call { request: String },
}

fn log(msg: &str) {
    eprintln!("[agentbox-sessions] {msg}");
}

fn main() {
    if let Err(e) = run() {
        eprintln!("agentbox-sessions: {e:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let cfg = Config::from_env()?;
    if let Cmd::Call { request } = &cli.cmd {
        println!("{}", api::call(&cfg.socket_path, request)?);
        return Ok(());
    }
    if let Cmd::Mark { slug, state } = &cli.cmd {
        if !agentbox_sessions::manifest::valid_slug(slug) { bail!("invalid slug"); }
        let s = match state.as_str() {
            "busy" => Hook::Busy,
            "idle" => Hook::Idle,
            other => bail!("state must be busy or idle, not {other:?}"),
        };
        write_hook(&cfg.hook_dir, slug, s)?;
        return Ok(());
    }
    let plane = Plane::load(cfg)?;
    match cli.cmd {
        Cmd::Daemon => daemon(plane),
        Cmd::Reconcile { dry_run, json } => {
            let out = plane.reconcile_once(dry_run);
            if json {
                println!("{}", serde_json::to_string_pretty(&out)?);
            } else {
                for o in &out {
                    let what = o.decision.as_ref().map(describe).unwrap_or_else(|| "error".into());
                    println!("{:<12} {what}{}{}", o.slug, o.error.as_ref().map(|e| format!("  ERROR {e}")).unwrap_or_default(), if o.note.is_empty() { String::new() } else { format!("  ({})", o.note) });
                }
            }
            Ok(())
        }
        Cmd::List { json } => {
            let rows = plane.status()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                print!("{}", pick::render(&rows));
            }
            Ok(())
        }
        Cmd::Send { slug, text } => plane.send(&slug, &text),
        Cmd::Create { slug, tool, model, worktree } => plane.create(&agentbox_sessions::plane::CreateReq { slug, tool, model, worktree }),
        Cmd::Close { slug } => plane.close(&slug),
        Cmd::Pick { list } => pick::run(&plane, list),
        Cmd::Resolve { json } => {
            let v = plane.resolve_all()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&v)?);
            } else {
                for r in v.as_array().into_iter().flatten() {
                    println!("{:<12} {:<10} {}", r["slug"].as_str().unwrap_or(""), r["kind"].as_str().unwrap_or(""), r["argv"]);
                }
            }
            Ok(())
        }
        Cmd::Reap { dry_run } => {
            let r = plane.reap_legacy(dry_run)?;
            println!("removed {}, moved aside {}, left {}", r.removed.len(), r.aside.len(), r.left.len());
            for (p, why) in &r.left {
                println!("  left {}: {why}", p.display());
            }
            Ok(())
        }
        Cmd::Call { .. } | Cmd::Mark { .. } => unreachable!(),
    }
}

fn describe(d: &Decision) -> String {
    match d {
        Decision::Create => "create".into(),
        Decision::Recreate(r) => format!("recreate ({r:?})"),
        Decision::Keep => "keep".into(),
        Decision::Hold(h) => format!("hold ({h:?})"),
    }
}

fn daemon(plane: Plane) -> Result<()> {
    if !plane.manifest.enabled {
        // Like the identity port: one line and a clean exit, so a supervisor
        // with the gate off sees EXITED and not a restart loop.
        println!("agentbox-sessions: [interaction_plane].enabled is false; not starting");
        return Ok(());
    }
    if !plane.wait_for_server(std::time::Duration::from_secs(120)) {
        log("no tmux server after 120 s; continuing (the first session will start one without the baked tmux.conf)");
    }
    log(&plane.provision());
    let listener = api::bind(&plane.cfg)?;
    log(&format!("socket {} (uids {:?})", plane.cfg.socket_path.display(), plane.cfg.acl_uids));
    let plane = Arc::new(plane);
    {
        let p = Arc::clone(&plane);
        std::thread::spawn(move || api::serve(p, listener));
    }
    {
        let p = Arc::clone(&plane);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(60));
            match p.status() {
                Ok(rows) => {
                    let seeds: Vec<_> = rows.iter().filter(|s| s.origin == "seed").collect();
                    let unhealthy: Vec<_> = seeds.iter().filter(|s| !s.present || matches!(s.state, agentbox_sessions::status::State::Dead | agentbox_sessions::status::State::Blocked(_) | agentbox_sessions::status::State::Missing | agentbox_sessions::status::State::Starting))
                        .map(|s| format!("{}={}", s.slug, s.label)).collect();
                    log(&format!("boot health: {}/{} seeds live and unblocked; {}", seeds.len() - unhealthy.len(), seeds.len(), unhealthy.join(", ")));
                }
                Err(e) => log(&format!("boot health unavailable: {e:#}")),
            }
        });
    }
    match plane.reap_legacy(false) {
        Ok(r) if !r.removed.is_empty() || !r.aside.is_empty() => log(&format!("legacy worktrees: removed {}, moved aside {}, left {}", r.removed.len(), r.aside.len(), r.left.len())),
        Ok(_) => {}
        Err(e) => log(&format!("legacy worktree reaper failed open: {e:#}")),
    }
    loop {
        for o in plane.reconcile_once(false) {
            match (&o.decision, &o.error) {
                (_, Some(e)) => log(&format!("{}: ERROR {e}", o.slug)),
                (Some(Decision::Keep), None) => {}
                (Some(d), None) => log(&format!("{}: {}{}", o.slug, describe(d), if o.note.is_empty() { String::new() } else { format!(" ({})", o.note) })),
                (None, None) => {}
            }
        }
        std::thread::sleep(plane.cfg.interval);
    }
}
