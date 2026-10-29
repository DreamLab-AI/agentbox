//! A thin tmux driver.
//!
//! Every call goes through [`Tmux::run`], which targets either the default
//! server or a private one (`-L <socket>`). Tests use a private server so they
//! never touch the operator's.
//!
//! Ownership is a marker, not a name: sessions this crate creates carry the
//! session option `@agentbox-sessions=1`, and reconcile only ever considers
//! those. Anything else on the server (the coordinator, a stray `aoe_*`
//! session, a session the operator started) is foreign and is never killed,
//! recreated or reconfigured.

use anyhow::{anyhow, bail, Result};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

/// Session name prefix. Deliberately not `aoe_`, so a leftover Agent of Empires
/// session can never be mistaken for ours.
pub const PREFIX: &str = "abs_";
pub const OPT_OWNED: &str = "@agentbox-sessions";
pub const OPT_SLUG: &str = "@agentbox-slug";
pub const OPT_FP: &str = "@agentbox-fp";
pub const OPT_ORIGIN: &str = "@agentbox-origin";
pub const OPT_TOOL: &str = "@agentbox-tool";

pub fn session_name(slug: &str) -> String {
    format!("{PREFIX}{slug}")
}

/// One session's first pane, as tmux reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pane {
    pub name: String,
    pub owned: bool,
    pub slug: String,
    pub fingerprint: String,
    /// `seed` for manifest-declared sessions, `api` for ones created on request.
    pub origin: String,
    pub tool: String,
    pub dead: bool,
    pub path: String,
    pub created: u64,
}

/// Everything needed to start a session.
pub struct NewSession<'a> {
    pub name: &'a str,
    pub cwd: &'a Path,
    pub env: &'a [(String, String)],
    pub argv: &'a [String],
    pub slug: &'a str,
    pub fingerprint: &'a str,
    pub origin: &'a str,
    pub tool: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Client {
    pub tty: String,
    pub session: String,
    pub activity: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Tmux {
    socket: Option<String>,
}

impl Tmux {
    pub fn new(socket: Option<String>) -> Self {
        Self { socket }
    }

    fn command(&self) -> Command {
        let mut c = Command::new("tmux");
        if let Some(s) = &self.socket {
            c.arg("-L").arg(s);
        }
        c
    }

    fn run(&self, args: &[&str]) -> Result<String> {
        let out = self.command().args(args).output().map_err(|e| anyhow!("tmux: {e}"))?;
        if !out.status.success() {
            bail!("tmux {}: {}", args.first().copied().unwrap_or(""), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// True when there is no server to talk to, which is an empty answer for a
    /// listing and not a failure.
    fn no_server(msg: &str) -> bool {
        msg.contains("no server running") || msg.contains("error connecting to") || msg.contains("No such file or directory")
    }

    /// First pane of every session on the server.
    pub fn list(&self) -> Result<Vec<Pane>> {
        let fmt = format!(
            "#{{session_name}}\t#{{pane_dead}}\t#{{pane_current_path}}\t#{{session_created}}\t#{{{OPT_OWNED}}}\t#{{{OPT_SLUG}}}\t#{{{OPT_FP}}}\t#{{{OPT_ORIGIN}}}\t#{{{OPT_TOOL}}}"
        );
        let text = match self.run(&["list-panes", "-a", "-F", &fmt]) {
            Ok(t) => t,
            Err(e) if Self::no_server(&e.to_string()) => return Ok(vec![]),
            Err(e) => return Err(e),
        };
        let mut seen = std::collections::HashSet::new();
        let mut panes = Vec::new();
        for line in text.lines() {
            let f: Vec<&str> = line.split('\t').collect();
            if f.len() < 9 || !seen.insert(f[0].to_string()) {
                continue;
            }
            panes.push(Pane {
                name: f[0].into(),
                dead: f[1] == "1",
                path: f[2].into(),
                created: f[3].parse().unwrap_or(0),
                owned: f[4] == "1",
                slug: f[5].into(),
                fingerprint: f[6].into(),
                origin: f[7].into(),
                tool: f[8].into(),
            });
        }
        Ok(panes)
    }

    /// Start a detached session. The options are set in the same tmux command
    /// queue as the creation, so a process that exits immediately still leaves
    /// a dead, marked pane to observe (`remain-on-exit`) instead of vanishing.
    pub fn new_session(&self, s: &NewSession<'_>) -> Result<()> {
        // `=name:` is "exactly this session". Bare `=name` is an exact *window*
        // name to set-option, which fails and aborts the rest of the chained commands.
        let target = format!("={}:", s.name);
        let mut args: Vec<String> = vec!["new-session".into(), "-d".into(), "-s".into(), s.name.into(), "-c".into(), s.cwd.display().to_string(), "-x".into(), "200".into(), "-y".into(), "50".into()];
        for (k, v) in s.env {
            args.push("-e".into());
            args.push(format!("{k}={v}"));
        }
        args.push("--".into());
        args.extend(s.argv.iter().cloned());
        for (opt, val) in [("remain-on-exit", "on"), (OPT_OWNED, "1"), (OPT_SLUG, s.slug), (OPT_FP, s.fingerprint), (OPT_ORIGIN, s.origin), (OPT_TOOL, s.tool)] {
            args.extend([";".into(), "set-option".into(), "-t".into(), target.clone(), opt.into(), val.into()]);
        }
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        self.run(&refs).map(|_| ())
    }

    pub fn kill(&self, name: &str) -> Result<()> {
        self.run(&["kill-session", "-t", &format!("={name}")]).map(|_| ())
    }

    pub fn capture(&self, name: &str, lines: u32) -> Result<String> {
        self.run(&["capture-pane", "-p", "-t", &format!("={name}:"), "-S", &format!("-{lines}")])
    }

    /// Type `text` literally, wait, then press Enter. Codex treats text and
    /// Enter arriving in one burst as a paste and does not submit it, so the
    /// pause is part of the contract.
    pub fn send_text(&self, name: &str, text: &str, pause: Duration) -> Result<()> {
        let target = format!("={name}:");
        self.run(&["send-keys", "-t", &target, "-l", "--", text])?;
        std::thread::sleep(pause);
        self.run(&["send-keys", "-t", &target, "Enter"]).map(|_| ())
    }

    pub fn clients(&self) -> Result<Vec<Client>> {
        let text = match self.run(&["list-clients", "-F", "#{client_tty}\t#{session_name}\t#{client_activity}"]) {
            Ok(t) => t,
            Err(e) if Self::no_server(&e.to_string()) => return Ok(vec![]),
            Err(e) => return Err(e),
        };
        Ok(text
            .lines()
            .filter_map(|l| {
                let f: Vec<&str> = l.split('\t').collect();
                (f.len() == 3).then(|| Client { tty: f[0].into(), session: f[1].into(), activity: f[2].parse().unwrap_or(0) })
            })
            .collect())
    }

    /// Move one named client to a session. The client is a required argument:
    /// `switch-client` without `-c` acts on whichever client tmux infers, which
    /// from a non-terminal shell is the operator's (the ADR-2063 hijack). This
    /// is the only place in the crate that issues the command.
    pub fn switch_client(&self, client_tty: &str, target: &str) -> Result<()> {
        if client_tty.is_empty() {
            bail!("refusing to switch-client without a named client");
        }
        self.run(&["switch-client", "-c", client_tty, "-t", target]).map(|_| ())
    }

    /// The session a pane (by `%id`) belongs to.
    pub fn pane_session(&self, pane: &str) -> Result<String> {
        Ok(self.run(&["display-message", "-p", "-t", pane, "#{session_name}"])?.trim().to_string())
    }

    /// Whether a raw tmux target (for the external coordinator) resolves to a live pane.
    pub fn target_alive(&self, target: &str) -> bool {
        self.run(&["display-message", "-p", "-t", target, "#{pane_dead}"]).map(|s| s.trim() == "0").unwrap_or(false)
    }

    pub fn send_text_to_target(&self, target: &str, text: &str, pause: Duration) -> Result<()> {
        self.run(&["send-keys", "-t", target, "-l", "--", text])?;
        std::thread::sleep(pause);
        self.run(&["send-keys", "-t", target, "Enter"]).map(|_| ())
    }

    pub fn capture_target(&self, target: &str, lines: u32) -> Result<String> {
        self.run(&["capture-pane", "-p", "-t", target, "-S", &format!("-{lines}")])
    }

    pub fn kill_server(&self) {
        let _ = self.run(&["kill-server"]);
    }
}
