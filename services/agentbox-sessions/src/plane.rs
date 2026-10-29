//! The session plane: the manifest's seeds made real as tmux sessions.
//!
//! [`Plane`] owns one reconcile pass and the operations the socket and CLI
//! share (status, send, create, close). Every mutation takes the one operation
//! lock, so a timer-driven reconcile and a request cannot interleave on the
//! same session.

use crate::boundary::{Boundary, Phase, Who};
use crate::contract::{Contract, Launch};
use crate::manifest::{self, valid_slug, Seed};
use crate::reconcile::{self, Decision, Restarts, Seen, Wanted};
use crate::status::{self, State};
use crate::tmux::{self, NewSession, Pane, Tmux};
use crate::{trust, worktree};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Provider variables copied from the daemon's environment into every session
/// so the wrappers and tools can reach their credentials. This is the list the
/// old seeder forwarded. It deliberately excludes `ANTHROPIC_BASE_URL` and
/// `ANTHROPIC_AUTH_TOKEN`: those live only in the openrouter and zai profiles.
pub const PASSTHROUGH: [&str; 17] = [
    "OPENROUTER_API_KEY", "OR_MODEL", "ZAI_API_KEY", "ZAI_ANTHROPIC_API_KEY", "ZAI_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL",
    "GOOGLE_API_KEY", "GOOGLE_GEMINI_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_MODEL", "LOOM_BASE_URL", "LOOM_RAW_BASE_URL", "LOOM_MODEL",
    "GEMMA_BASE_URL", "GEMMA_MODEL", "CODEX_HOME",
];

/// Redirect variables scrubbed from every session that does not allowlist them
/// (N-01: only the wrapper seeds may talk to a non-Anthropic endpoint).
const SCRUB: [&str; 2] = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"];

#[derive(Debug, Clone)]
pub struct Config {
    /// Directory holding `agentbox.toml`, `config/` and `scripts/` (`/opt/agentbox` in the image).
    pub root: PathBuf,
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub project: PathBuf,
    pub tmux_socket: Option<String>,
    pub socket_path: PathBuf,
    pub socket_gid: Option<u32>,
    pub acl_uids: Vec<u32>,
    pub hook_dir: PathBuf,
    pub interval: Duration,
    pub send_pause: Duration,
}

fn own_uid() -> u32 {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata("/proc/self").map(|m| m.uid()).unwrap_or(1000)
}

impl Config {
    pub fn new(root: PathBuf, home: PathBuf, workspace: PathBuf) -> Self {
        let project = if workspace.join("project").exists() { workspace.join("project") } else { workspace.clone() };
        Self {
            root,
            home,
            project,
            workspace,
            tmux_socket: None,
            socket_path: PathBuf::from("/run/agentbox-sessions/sessions.sock"),
            socket_gid: None,
            acl_uids: vec![own_uid()],
            hook_dir: PathBuf::from("/run/agentbox-sessions/hooks"),
            interval: Duration::from_secs(30),
            send_pause: Duration::from_millis(400),
        }
    }

    pub fn from_env() -> Result<Self> {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let home = PathBuf::from(env("HOME").unwrap_or_else(|| "/home/devuser".into()));
        let workspace = env("WORKSPACE").map(PathBuf::from).unwrap_or_else(|| home.join("workspace"));
        let mut c = Self::new(PathBuf::from(env("AGENTBOX_ROOT").unwrap_or_else(|| "/opt/agentbox".into())), home, workspace);
        c.tmux_socket = env("AGENTBOX_SESSIONS_TMUX_SOCKET");
        if let Some(p) = env("AGENTBOX_SESSIONS_SOCKET") {
            c.socket_path = PathBuf::from(p);
        }
        c.socket_gid = env("AGENTBOX_SESSIONS_GID").and_then(|g| g.parse().ok());
        if let Some(p) = env("AGENTBOX_SESSIONS_ACL") {
            c.acl_uids = load_acl(&PathBuf::from(&p)).with_context(|| format!("ACL {p}"))?;
        }
        if let Some(d) = env("AGENTBOX_SESSIONS_STATE_DIR") {
            c.hook_dir = PathBuf::from(d);
        }
        if let Some(s) = env("AGENTBOX_SESSIONS_INTERVAL_SECS").and_then(|s| s.parse().ok()) {
            c.interval = Duration::from_secs(s);
        }
        if let Some(ms) = env("AGENTBOX_SESSIONS_SEND_PAUSE_MS").and_then(|s| s.parse().ok()) {
            c.send_pause = Duration::from_millis(ms);
        }
        Ok(c)
    }

    fn roots(&self) -> trust::Roots {
        trust::Roots { home: self.home.clone(), workspace: self.workspace.clone(), codex_home: std::env::var("CODEX_HOME").ok().filter(|s| !s.is_empty()).map(PathBuf::from) }
    }
}

/// `{"allowed_uids": [1000, 961]}`, the shape of the identity port's ACL reduced to what a session socket needs.
pub fn load_acl(path: &std::path::Path) -> Result<Vec<u32>> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let uids = v["allowed_uids"].as_array().ok_or_else(|| anyhow!("allowed_uids missing"))?;
    uids.iter().map(|u| u.as_u64().and_then(|n| u32::try_from(n).ok()).ok_or_else(|| anyhow!("bad uid {u}"))).collect()
}

/// A seed resolved all the way to the command tmux will run.
#[derive(Debug, Clone)]
pub struct Plan {
    pub seed: Seed,
    pub launch: Launch,
    pub dir: PathBuf,
    pub name: String,
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub slug: String,
    pub decision: Option<Decision>,
    pub note: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionView {
    pub slug: String,
    pub name: String,
    /// `seed`, `api` or `external`.
    pub origin: String,
    pub present: bool,
    pub state: State,
    pub label: String,
    pub tool: String,
    pub model: Option<String>,
    pub dir: String,
    pub worktree: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateReq {
    pub slug: String,
    pub tool: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub worktree: bool,
}

pub fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn log(msg: &str) {
    eprintln!("[agentbox-sessions] {msg}");
}

pub struct Plane {
    pub cfg: Config,
    pub tmux: Tmux,
    pub manifest: manifest::Plane,
    pub contract: Contract,
    restarts: Mutex<Restarts>,
    op: Mutex<()>,
    boundary: Option<Boundary>,
}

impl Plane {
    pub fn load(cfg: Config) -> Result<Self> {
        let manifest = manifest::Plane::load(&cfg.root.join("agentbox.toml"))?;
        let contract = Contract::load(&cfg.root.join("config/session-plane/launch.json"))?;
        let tmux = Tmux::new(cfg.tmux_socket.clone());
        Ok(Self { cfg, tmux, manifest, contract, restarts: Mutex::new(Restarts::default()), op: Mutex::new(()), boundary: Boundary::from_env() })
    }

    /// Replace the boundary client (tests, or a deployment without a key).
    pub fn with_boundary(mut self, b: Option<Boundary>) -> Self {
        self.boundary = b;
        self
    }

    fn wrapper_dir(&self) -> PathBuf {
        self.cfg.root.join("config/harness-wrappers")
    }

    pub fn plan_for(&self, seed: &Seed) -> Result<Plan> {
        let launch = self.contract.resolve(seed, &self.wrapper_dir())?;
        let dir = self.contract.session_dir(seed, &self.cfg.home, &self.cfg.project);
        let mut argv = vec!["env".to_string()];
        for v in SCRUB.iter().filter(|v| !seed.env_allowlist.iter().any(|a| a == **v)) {
            argv.extend(["-u".to_string(), (*v).to_string()]);
        }
        argv.extend(launch.argv.iter().cloned());
        // The fingerprint covers what the manifest and contract decide. Provider
        // credentials are excluded, so rotating a key never restarts a session.
        let fp = Sha256::digest(json!({ "argv": argv, "env": launch.env, "dir": dir }).to_string().as_bytes());
        let fingerprint = hex::encode(fp)[..12].to_string();
        let mut env: Vec<(String, String)> = launch.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for k in PASSTHROUGH {
            if let Ok(v) = std::env::var(k) {
                if !v.is_empty() && !launch.env.contains_key(k) {
                    env.push((k.to_string(), v));
                }
            }
        }
        Ok(Plan { seed: seed.clone(), launch, dir, name: tmux::session_name(&seed.slug), argv, env, fingerprint })
    }

    fn panes(&self) -> Result<HashMap<String, Pane>> {
        Ok(self.tmux.list()?.into_iter().map(|p| (p.name.clone(), p)).collect())
    }

    fn blocker_in(&self, name: &str, blockers: &[String]) -> Option<String> {
        let text = self.tmux.capture(name, 60).ok()?;
        blockers.iter().find(|b| !b.is_empty() && text.contains(b.as_str())).cloned()
    }

    fn session_id(p: &Pane) -> String {
        format!("{}-{}", p.name, p.created)
    }

    fn emit(&self, phase: Phase, pane: &Pane, plan: &Plan) {
        let Some(b) = &self.boundary else { return };
        let id = Self::session_id(pane);
        let who = Who { session_id: &id, slug: &plan.seed.slug, tool: &plan.seed.tool, project_path: &plan.dir.display().to_string(), eager_mandate: plan.seed.eager_mandate };
        if let Err(e) = b.emit(phase, &who) {
            log(&format!("boundary {phase:?} for {} failed open: {e:#}", plan.seed.slug));
        }
    }

    /// Start (or restart) one session. Returns notes worth logging.
    fn start(&self, plan: &Plan, old: Option<&Pane>, origin: &str) -> Result<Vec<String>> {
        let mut notes = Vec::new();
        let mut cut = false;
        if plan.seed.worktree {
            cut = worktree::ensure(&self.cfg.project, &plan.dir, &plan.seed.slug).context("worktree")?;
        }
        notes.extend(trust::seed(&plan.launch.trust, &plan.dir, &self.cfg.roots()));
        if let Some(o) = old {
            self.emit(Phase::Close, o, plan);
            self.tmux.kill(&o.name).context("kill old session")?;
        }
        self.tmux
            .new_session(&NewSession { name: &plan.name, cwd: &plan.dir, env: &plan.env, argv: &plan.argv, slug: &plan.seed.slug, fingerprint: &plan.fingerprint, origin, tool: &plan.seed.tool })
            .context("start session")?;
        lock(&self.restarts).record(&plan.seed.slug);
        if let Some(fresh) = self.panes()?.get(&plan.name) {
            self.emit(Phase::Create, fresh, plan);
        }
        if cut {
            if let Err(e) = worktree::init_submodules(&self.cfg.project, &plan.dir) {
                notes.push(format!("submodule init failed open: {e:#}"));
            }
        }
        Ok(notes)
    }

    /// One pass over the manifest's seeds.
    pub fn reconcile_once(&self, dry_run: bool) -> Vec<Outcome> {
        let _g = lock(&self.op);
        let panes = match self.panes() {
            Ok(p) => p,
            Err(e) => return vec![Outcome { slug: "*".into(), decision: None, note: String::new(), error: Some(format!("tmux: {e:#}")) }],
        };
        let mut out = Vec::new();
        for seed in &self.manifest.seeds {
            let plan = match self.plan_for(seed) {
                Ok(p) => p,
                Err(e) => {
                    out.push(Outcome { slug: seed.slug.clone(), decision: None, note: String::new(), error: Some(format!("{e:#}")) });
                    continue;
                }
            };
            let pane = panes.get(&plan.name);
            let blocked = pane.filter(|p| p.owned && !p.dead).and_then(|p| self.blocker_in(&p.name, &plan.launch.blockers));
            let seen = pane.map(|p| Seen { owned: p.owned, dead: p.dead, fingerprint: &p.fingerprint, blocked: blocked.as_deref() });
            let restarts = lock(&self.restarts).count(&seed.slug);
            let decision = reconcile::decide(
                &Wanted { fingerprint: &plan.fingerprint, worktree: seed.worktree },
                seen.as_ref(),
                // A worktree that is gone has nothing to protect.
                || worktree::dirty(&plan.dir).map(|d| d.len()).unwrap_or(0),
                restarts,
            );
            let mut o = Outcome { slug: seed.slug.clone(), decision: Some(decision.clone()), note: String::new(), error: None };
            if !dry_run && matches!(decision, Decision::Create | Decision::Recreate(_)) {
                let old = if matches!(decision, Decision::Recreate(_)) { pane } else { None };
                match self.start(&plan, old, "seed") {
                    Ok(notes) => o.note = notes.join("; "),
                    Err(e) => o.error = Some(format!("{e:#}")),
                }
            }
            out.push(o);
        }
        out
    }

    fn state_of(&self, pane: &Pane, launch: Option<&Launch>) -> State {
        let blockers: Vec<String> = match launch {
            Some(l) => l.blockers.clone(),
            None => self.contract.common_blockers.clone(),
        };
        let text = if pane.dead { String::new() } else { self.tmux.capture(&pane.name, 60).unwrap_or_default() };
        status::classify(&status::Inputs {
            dead: pane.dead,
            pane: &text,
            blockers: &blockers,
            ready: launch.and_then(|l| l.ready.as_deref()),
            hook: status::read_hook(&self.cfg.hook_dir, &pane.slug),
            age_secs: now_unix().saturating_sub(pane.created),
            settle_secs: self.contract.settle_seconds,
        })
    }

    pub fn status(&self) -> Result<Vec<SessionView>> {
        let panes = self.panes()?;
        let mut out = Vec::new();
        let mut seeded = HashSet::new();
        for seed in &self.manifest.seeds {
            let name = tmux::session_name(&seed.slug);
            seeded.insert(name.clone());
            let plan = self.plan_for(seed).ok();
            let dir = plan.as_ref().map(|p| p.dir.display().to_string()).unwrap_or_default();
            let (present, state) = match panes.get(&name).filter(|p| p.owned) {
                Some(p) => (true, self.state_of(p, plan.as_ref().map(|p| &p.launch))),
                None => (false, State::Missing),
            };
            out.push(SessionView { slug: seed.slug.clone(), name, origin: "seed".into(), present, label: state.label(), state, tool: seed.tool.clone(), model: seed.model.clone(), dir, worktree: seed.worktree });
        }
        for p in panes.values().filter(|p| p.owned && !seeded.contains(&p.name)) {
            let launch = self.contract.tools.get(&p.tool).map(|t| Launch {
                kind: p.tool.clone(),
                argv: vec![],
                env: BTreeMap::new(),
                blockers: self.contract.common_blockers.iter().chain(t.blockers.iter()).cloned().collect(),
                ready: t.ready.clone(),
                trust: vec![],
            });
            let state = self.state_of(p, launch.as_ref());
            out.push(SessionView { slug: p.slug.clone(), name: p.name.clone(), origin: p.origin.clone(), present: true, label: state.label(), state, tool: p.tool.clone(), model: None, dir: p.path.clone(), worktree: false });
        }
        let c = &self.manifest.coordinator;
        let alive = self.tmux.target_alive(&c.target);
        let state = if alive { State::Idle } else { State::Missing };
        out.push(SessionView { slug: c.slug.clone(), name: c.target.clone(), origin: "external".into(), present: alive, label: state.label(), state, tool: "claude".into(), model: None, dir: String::new(), worktree: false });
        out.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(out)
    }

    /// Type `text` into a session and submit it. Refuses a dead or blocked
    /// session: text typed into a trust or sign-in prompt answers the wrong
    /// question.
    pub fn send(&self, slug: &str, text: &str) -> Result<()> {
        let _g = lock(&self.op);
        if slug == self.manifest.coordinator.slug {
            return self.tmux.send_text_to_target(&self.manifest.coordinator.target, text, self.cfg.send_pause);
        }
        let name = tmux::session_name(slug);
        let panes = self.panes()?;
        let pane = panes.get(&name).filter(|p| p.owned).ok_or_else(|| anyhow!("no session {slug:?}"))?;
        let plan = self.manifest.seeds.iter().find(|s| s.slug == slug).and_then(|s| self.plan_for(s).ok());
        match self.state_of(pane, plan.as_ref().map(|p| &p.launch)) {
            State::Dead => bail!("session {slug:?} is dead"),
            State::Blocked(why) => bail!("session {slug:?} is blocked: {why}"),
            _ => {}
        }
        self.tmux.send_text(&name, text, self.cfg.send_pause)?;
        if let Some(plan) = plan {
            self.emit(Phase::Turn, pane, &plan);
        }
        Ok(())
    }

    /// Start a session that is not in the manifest (nostr-gateway `/spawn`).
    /// It is owned, so it can be listed, sent to and closed, but it is never
    /// reconciled: only manifest seeds are.
    pub fn create(&self, req: &CreateReq) -> Result<()> {
        let _g = lock(&self.op);
        if !valid_slug(&req.slug) {
            bail!("slug {:?} must match [a-z0-9][a-z0-9-]{{0,31}}", req.slug);
        }
        if req.slug == self.manifest.coordinator.slug || self.manifest.seeds.iter().any(|s| s.slug == req.slug) {
            bail!("slug {:?} belongs to the manifest", req.slug);
        }
        let seed = Seed { slug: req.slug.clone(), tool: req.tool.clone(), model: req.model.clone(), worktree: req.worktree, env_allowlist: vec![], eager_mandate: false };
        let plan = self.plan_for(&seed)?;
        if self.panes()?.contains_key(&plan.name) {
            bail!("session {:?} already exists", req.slug);
        }
        self.start(&plan, None, "api").map(|_| ())
    }

    /// Close a session created on request. Manifest seeds are not closeable:
    /// the next pass would only start them again.
    pub fn close(&self, slug: &str) -> Result<()> {
        let _g = lock(&self.op);
        if self.manifest.seeds.iter().any(|s| s.slug == slug) || slug == self.manifest.coordinator.slug {
            bail!("{slug:?} is declared in the manifest; remove it there");
        }
        let name = tmux::session_name(slug);
        let panes = self.panes()?;
        let pane = panes.get(&name).filter(|p| p.owned && p.origin == "api").ok_or_else(|| anyhow!("no api-created session {slug:?}"))?;
        let seed = Seed { slug: slug.into(), tool: pane.tool.clone(), model: None, worktree: false, env_allowlist: vec![], eager_mandate: false };
        if let Ok(plan) = self.plan_for(&seed) {
            self.emit(Phase::Close, pane, &plan);
        }
        self.tmux.kill(&name)
    }

    /// Provisioning that does not depend on tmux (OpenRouter, Z.AI and OpenCode
    /// config files) stays in `scripts/session-provision.mjs`. Fail-open.
    pub fn provision(&self) -> String {
        let script = self.cfg.root.join("scripts/session-provision.mjs");
        if std::env::var("AGENTBOX_SESSIONS_PROVISION").as_deref() == Ok("0") || !script.exists() {
            return "provisioning skipped".into();
        }
        let child = std::process::Command::new("node").arg(&script).stdin(std::process::Stdio::null()).spawn();
        let Ok(mut child) = child else { return "provisioning skipped: node not found".into() };
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            match child.try_wait() {
                Ok(Some(st)) => return format!("provisioning exited {st}"),
                Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(200)),
                _ => {
                    let _ = child.kill();
                    return "provisioning timed out (60s), continuing".into();
                }
            }
        }
    }

    /// Reap Agent of Empires' leftover worktrees (see `worktree::reap_legacy`).
    pub fn reap_legacy(&self, dry_run: bool) -> Result<worktree::Reaped> {
        let root = PathBuf::from(format!("{}-worktrees", self.cfg.project.display()));
        let slugs: Vec<String> = self.manifest.seeds.iter().filter(|s| s.worktree).map(|s| s.slug.clone()).collect();
        let live: HashSet<PathBuf> = self.tmux.list()?.iter().filter_map(|p| std::fs::canonicalize(&p.path).ok()).collect();
        worktree::reap_legacy(&self.cfg.project, &root, &slugs, &live, dry_run)
    }

    /// Each seed's launch as the contract resolves it, for the Node/Rust parity test.
    pub fn resolve_all(&self) -> Result<serde_json::Value> {
        let mut rows = Vec::new();
        for seed in &self.manifest.seeds {
            let l = self.contract.resolve(seed, &self.wrapper_dir())?;
            let dir = self.contract.session_dir(seed, &self.cfg.home, &self.cfg.project);
            rows.push(json!({ "slug": seed.slug, "kind": l.kind, "argv": l.argv, "env": l.env, "blockers": l.blockers, "ready": l.ready, "dir": dir }));
        }
        Ok(json!(rows))
    }
}
