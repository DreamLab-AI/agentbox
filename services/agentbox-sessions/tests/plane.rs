//! Integration tests: the real daemon logic against a private tmux server
//! (`tmux -L`), real processes and real git repositories. None of them touches
//! the default tmux server.

use agentbox_sessions::api;
use agentbox_sessions::plane::{Config, CreateReq, Plane};
use agentbox_sessions::reconcile::{Decision, Hold, Reason};
use agentbox_sessions::status::State;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

static N: AtomicU32 = AtomicU32::new(0);

struct Fx {
    _dir: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
    sock: String,
}

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

impl Fx {
    /// `tools` is the contract's `tools` object; `seeds` is TOML for the seed tables.
    fn new(tools: Value, seeds: &str) -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        let home = dir.path().join("home");
        std::fs::create_dir_all(root.join("config/session-plane")).unwrap();
        std::fs::create_dir_all(root.join("config/harness-wrappers")).unwrap();
        let project = home.join("workspace/project");
        std::fs::create_dir_all(&project).unwrap();
        git(&project, &["init", "-q", "-b", "main"]);
        std::fs::write(project.join(".gitignore"), "node_modules/\ncoverage/\n").unwrap();
        std::fs::write(project.join("a.txt"), "a").unwrap();
        git(&project, &["add", "."]);
        git(&project, &["commit", "-q", "-m", "init"]);
        let contract = json!({
            "worktree_root": "~/workspace/wt", "worktree_prefix": "aoe-", "settle_seconds": 1,
            "common_blockers": ["Unrecognized flag"], "tools": tools,
        });
        std::fs::write(root.join("config/session-plane/launch.json"), contract.to_string()).unwrap();
        std::fs::write(root.join("agentbox.toml"), format!("[interaction_plane]\nenabled = true\n{seeds}")).unwrap();
        let sock = format!("abs-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst));
        Fx { _dir: dir, root, home, sock }
    }

    fn cfg(&self) -> Config {
        let mut c = Config::new(self.root.clone(), self.home.clone(), self.home.join("workspace"));
        c.tmux_socket = Some(self.sock.clone());
        c.send_pause = Duration::from_millis(60);
        c.hook_dir = self.root.join("hooks");
        c.socket_path = self.root.join("run/sessions.sock");
        c
    }

    fn plane(&self) -> Plane {
        Plane::load(self.cfg()).unwrap().with_boundary(None)
    }

    fn tmux(&self, args: &[&str]) {
        let ok = Command::new("tmux").args(["-L", &self.sock]).args(args).status().unwrap().success();
        assert!(ok, "tmux {args:?}");
    }
}

impl Drop for Fx {
    fn drop(&mut self) {
        let _ = Command::new("tmux").args(["-L", &self.sock, "kill-server"]).stderr(std::process::Stdio::null()).status();
        // kill-server leaves the socket file behind; do not litter the tmux directory.
        use std::os::unix::fs::MetadataExt;
        let uid = std::fs::metadata("/proc/self").map(|m| m.uid()).unwrap_or(0);
        let dir = std::env::var("TMUX_TMPDIR").unwrap_or_else(|_| "/tmp".into());
        let _ = std::fs::remove_file(Path::new(&dir).join(format!("tmux-{uid}")).join(&self.sock));
    }
}

fn wait_for(what: &str, secs: u64, mut f: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for {what}");
}

fn pane_dead(p: &Plane, name: &str) -> bool {
    p.tmux.list().unwrap().iter().any(|x| x.name == name && x.dead)
}

fn pane_text(p: &Plane, name: &str) -> String {
    p.tmux.capture(name, 40).unwrap_or_default()
}

fn decision(out: &[agentbox_sessions::plane::Outcome], slug: &str) -> Decision {
    let outcome = out.iter().find(|o| o.slug == slug).unwrap_or_else(|| panic!("no outcome for {slug}: {out:?}"));
    assert!(outcome.error.is_none(), "reconciliation failed for {slug}: {outcome:?}");
    outcome.decision.clone().expect("a decision")
}

fn sleeper() -> Value {
    json!({ "sleeper": { "argv": ["sleep", "600"] } })
}

const A: &str = "[[interaction_plane.session_seeds]]\nslug = \"a\"\ntool = \"sleeper\"\n";

#[test]
fn seeds_start_owned_and_foreign_sessions_are_never_touched() {
    let fx = Fx::new(sleeper(), &format!("{A}[[interaction_plane.session_seeds]]\nslug = \"conflict\"\ntool = \"sleeper\"\n"));
    // The operator's own sessions, and a leftover Agent of Empires one.
    fx.tmux(&["new-session", "-d", "-s", "agentbox", "sleep", "600"]);
    fx.tmux(&["new-session", "-d", "-s", "aoe_codex_ab12cd34", "sleep", "600"]);
    // A session that squats on a seed's name without our marker.
    fx.tmux(&["new-session", "-d", "-s", "abs_conflict", "sleep", "600"]);
    let p = fx.plane();
    let before: Vec<_> = p.tmux.list().unwrap().into_iter().filter(|x| !x.owned).collect();
    assert_eq!(before.len(), 3);

    let out = p.reconcile_once(false);
    assert_eq!(decision(&out, "a"), Decision::Create);
    assert_eq!(decision(&out, "conflict"), Decision::Hold(Hold::Conflict));

    let after = p.tmux.list().unwrap();
    let a = after.iter().find(|x| x.name == "abs_a").unwrap();
    assert!(a.owned && a.origin == "seed" && a.tool == "sleeper" && !a.dead && a.fingerprint.len() == 12);
    for b in &before {
        let now = after.iter().find(|x| x.name == b.name).expect("foreign session survives");
        assert_eq!((now.created, now.owned, now.dead), (b.created, false, false), "{} was altered", b.name);
    }
    // A second pass keeps everything.
    let out = p.reconcile_once(false);
    assert_eq!(decision(&out, "a"), Decision::Keep);
}

#[test]
fn the_coordinator_is_listed_as_external_and_never_reconciled() {
    let fx = Fx::new(sleeper(), A);
    fx.tmux(&["new-session", "-d", "-s", "agentbox", "sleep", "600"]);
    let p = fx.plane();
    let out = p.reconcile_once(false);
    assert!(out.iter().all(|o| o.slug != "tab0"));
    let rows = p.status().unwrap();
    let tab0 = rows.iter().find(|r| r.slug == "tab0").unwrap();
    assert_eq!((tab0.origin.as_str(), tab0.present), ("external", true));
}

#[test]
fn a_dying_command_is_restarted_then_backs_off() {
    let fx = Fx::new(json!({ "exits": { "argv": ["sh", "-c", "exit 1"] } }), "[[interaction_plane.session_seeds]]\nslug = \"x\"\ntool = \"exits\"\n");
    let p = fx.plane();
    assert_eq!(decision(&p.reconcile_once(false), "x"), Decision::Create);
    for _ in 0..2 {
        wait_for("pane to die", 5, || pane_dead(&p, "abs_x"));
        assert_eq!(decision(&p.reconcile_once(false), "x"), Decision::Recreate(Reason::Dead));
    }
    wait_for("pane to die", 5, || pane_dead(&p, "abs_x"));
    assert!(matches!(decision(&p.reconcile_once(false), "x"), Decision::Hold(Hold::Backoff(3))), "a command that dies on launch must not spin the daemon");
    assert!(pane_dead(&p, "abs_x"), "and the dead pane is left for a person to read");
}

#[test]
fn a_live_session_on_a_stale_model_is_recreated() {
    let tools = json!({ "modeled": { "argv": ["sleep", "600"], "model_env": { "M": "{model}" } } });
    let seed = |m: &str| format!("[[interaction_plane.session_seeds]]\nslug = \"d\"\ntool = \"modeled\"\nmodel = \"{m}\"\n");
    let fx = Fx::new(tools, &seed("deepseek-chat"));
    let old = fx.plane();
    assert_eq!(decision(&old.reconcile_once(false), "d"), Decision::Create);
    let fp_old = old.tmux.list().unwrap().into_iter().find(|x| x.name == "abs_d").unwrap().fingerprint;

    // The manifest moves on; the session is alive and would have been skipped as "already exists".
    std::fs::write(fx.root.join("agentbox.toml"), format!("[interaction_plane]\nenabled = true\n{}", seed("deepseek-flash"))).unwrap();
    let new = fx.plane();
    assert_eq!(decision(&new.reconcile_once(false), "d"), Decision::Recreate(Reason::Drifted));
    let now = new.tmux.list().unwrap().into_iter().find(|x| x.name == "abs_d").unwrap();
    assert_ne!(now.fingerprint, fp_old);
    assert!(!now.dead && now.owned);

    // Recreating the server's only session races tmux's server shutdown.
    // Exercise that boundary repeatedly and require successful outcomes.
    for i in 0..25 {
        let model = if i % 2 == 0 { "deepseek-chat" } else { "deepseek-flash" };
        std::fs::write(fx.root.join("agentbox.toml"), format!("[interaction_plane]\nenabled = true\n{}", seed(model))).unwrap();
        let next = fx.plane();
        assert_eq!(decision(&next.reconcile_once(false), "d"), Decision::Recreate(Reason::Drifted));
        assert!(next.tmux.list().unwrap().iter().any(|x| x.name == "abs_d" && x.owned && !x.dead));
    }
}

/// The advisor's blind spot: a worktree with build output must not hold its
/// session out of reconcile, while real work in progress must.
#[test]
fn build_output_does_not_block_a_restart_but_unsaved_work_does() {
    let fx = Fx::new(json!({ "exits": { "argv": ["sh", "-c", "exit 1"] } }), "[[interaction_plane.session_seeds]]\nslug = \"w\"\ntool = \"exits\"\nworktree = true\n");
    let p = fx.plane();
    assert_eq!(decision(&p.reconcile_once(false), "w"), Decision::Create);
    let wt = fx.home.join("workspace/wt/aoe-w");
    assert!(wt.join("a.txt").exists(), "worktree cut under the one worktree root");

    std::fs::create_dir_all(wt.join("node_modules/pkg")).unwrap();
    std::fs::create_dir_all(wt.join("coverage")).unwrap();
    std::fs::write(wt.join("coverage/lcov.info"), "x").unwrap();
    wait_for("pane to die", 5, || pane_dead(&p, "abs_w"));
    assert_eq!(decision(&p.reconcile_once(false), "w"), Decision::Recreate(Reason::Dead), "ignored build output is not work in progress");

    std::fs::write(wt.join("wip.txt"), "unsaved").unwrap();
    wait_for("pane to die", 5, || pane_dead(&p, "abs_w"));
    assert_eq!(decision(&p.reconcile_once(false), "w"), Decision::Hold(Hold::DirtyWorktree(1)));
    assert!(wt.join("wip.txt").exists());
}

#[test]
fn only_a_trust_blocker_is_recreated_a_sign_in_is_reported() {
    let tools = json!({
        "trusty": { "argv": ["sh", "-c", "echo 'Yes, I trust this folder'; sleep 600"], "blockers": ["Yes, I trust this folder"] },
        "signin": { "argv": ["sh", "-c", "echo 'You are currently not signed in'; sleep 600"], "blockers": ["You are currently not signed in"] },
    });
    let fx = Fx::new(tools, "[[interaction_plane.session_seeds]]\nslug = \"t\"\ntool = \"trusty\"\n[[interaction_plane.session_seeds]]\nslug = \"s\"\ntool = \"signin\"\n");
    let p = fx.plane();
    p.reconcile_once(false);
    wait_for("both prompts", 5, || pane_text(&p, "abs_t").contains("trust") && pane_text(&p, "abs_s").contains("signed in"));
    let out = p.reconcile_once(false);
    assert_eq!(decision(&out, "t"), Decision::Recreate(Reason::Blocked("Yes, I trust this folder".into())));
    assert_eq!(decision(&out, "s"), Decision::Hold(Hold::Blocked("You are currently not signed in".into())));
    let rows = p.status().unwrap();
    let s = rows.iter().find(|r| r.slug == "s").unwrap();
    assert_eq!(s.state, State::Blocked("You are currently not signed in".into()), "reported, never idle");
}

#[test]
fn trust_is_seeded_before_the_session_starts() {
    let tools = json!({ "claudey": { "argv": ["sleep", "600"], "trust": ["claude-root"] } });
    let fx = Fx::new(tools, "[[interaction_plane.session_seeds]]\nslug = \"c\"\ntool = \"claudey\"\nworktree = true\n");
    std::fs::write(fx.home.join(".claude.json"), "{}").unwrap();
    let p = fx.plane();
    assert_eq!(decision(&p.reconcile_once(false), "c"), Decision::Create);
    let v: Value = serde_json::from_str(&std::fs::read_to_string(fx.home.join(".claude.json")).unwrap()).unwrap();
    let dir = fx.home.join("workspace/wt/aoe-c");
    assert_eq!(v["projects"][dir.to_str().unwrap()]["hasTrustDialogAccepted"], true);
}

#[test]
fn redirect_variables_are_scrubbed_unless_allowlisted_and_provider_keys_pass_through() {
    let tools = json!({ "dump": { "argv": ["sh", "-c", "echo \"BASE=[$ANTHROPIC_BASE_URL] TOK=[$ANTHROPIC_AUTH_TOKEN] OR=[$OR_MODEL]\"; sleep 600"] } });
    let fx = Fx::new(
        tools,
        "[[interaction_plane.session_seeds]]\nslug = \"plain\"\ntool = \"dump\"\n[[interaction_plane.session_seeds]]\nslug = \"wrapped\"\ntool = \"dump\"\nenv_allowlist = [\"ANTHROPIC_BASE_URL\"]\n",
    );
    // SAFETY: only this test sets these; the other tests do not read them.
    std::env::set_var("ANTHROPIC_BASE_URL", "http://redirect.invalid");
    std::env::set_var("ANTHROPIC_AUTH_TOKEN", "sekret-token");
    std::env::set_var("OR_MODEL", "some/model");
    let p = fx.plane();
    p.reconcile_once(false);
    wait_for("both sessions to print", 5, || pane_text(&p, "abs_plain").contains("OR=[") && pane_text(&p, "abs_wrapped").contains("OR=["));
    let plain = pane_text(&p, "abs_plain");
    let wrapped = pane_text(&p, "abs_wrapped");
    assert!(plain.contains("BASE=[] TOK=[]"), "a native session must never be redirected: {plain}");
    assert!(wrapped.contains("BASE=[http://redirect.invalid] TOK=[]"), "an allowlisted variable survives, the other is still scrubbed: {wrapped}");
    assert!(plain.contains("OR=[some/model]") && wrapped.contains("OR=[some/model]"), "provider keys are forwarded");
}

#[test]
fn send_types_pauses_then_submits_and_refuses_dead_or_blocked_sessions() {
    let tools = json!({
        "echo": { "argv": ["cat"] },
        "exits": { "argv": ["sh", "-c", "exit 1"] },
        "signin": { "argv": ["sh", "-c", "echo 'Select login method'; sleep 600"], "blockers": ["Select login method"] },
    });
    let fx = Fx::new(tools, "[[interaction_plane.session_seeds]]\nslug = \"e\"\ntool = \"echo\"\n[[interaction_plane.session_seeds]]\nslug = \"dead\"\ntool = \"exits\"\n[[interaction_plane.session_seeds]]\nslug = \"blk\"\ntool = \"signin\"\n");
    let p = fx.plane();
    p.reconcile_once(false);
    wait_for("echo pane", 5, || p.tmux.list().unwrap().iter().any(|x| x.name == "abs_e" && !x.dead));
    p.send("e", "hello world").unwrap();
    // `cat` echoes what it receives once Enter submits the line: typed text plus its echo.
    wait_for("cat to echo the submitted line", 5, || pane_text(&p, "abs_e").matches("hello world").count() >= 2);

    wait_for("dead pane", 5, || pane_dead(&p, "abs_dead"));
    assert!(p.send("dead", "x").unwrap_err().to_string().contains("dead"));
    wait_for("prompt", 5, || pane_text(&p, "abs_blk").contains("Select login method"));
    assert!(p.send("blk", "x").unwrap_err().to_string().contains("blocked"));
    assert!(p.send("nobody", "x").is_err());
}

#[test]
fn on_request_sessions_can_be_created_listed_and_closed_but_are_never_reconciled() {
    let fx = Fx::new(json!({ "echo": { "argv": ["cat"] }, "sleeper": { "argv": ["sleep", "600"] } }), A);
    let p = fx.plane();
    p.create(&CreateReq { slug: "scratch".into(), tool: "echo".into(), model: None, worktree: false }).unwrap();
    assert!(p.create(&CreateReq { slug: "scratch".into(), tool: "echo".into(), model: None, worktree: false }).is_err(), "no duplicates");
    assert!(p.create(&CreateReq { slug: "a".into(), tool: "echo".into(), model: None, worktree: false }).is_err(), "cannot shadow a seed");
    assert!(p.create(&CreateReq { slug: "tab0".into(), tool: "echo".into(), model: None, worktree: false }).is_err(), "cannot shadow the coordinator");
    assert!(p.create(&CreateReq { slug: "Bad Slug".into(), tool: "echo".into(), model: None, worktree: false }).is_err());

    let out = p.reconcile_once(false);
    assert!(out.iter().all(|o| o.slug != "scratch"), "only manifest seeds are reconciled");
    let rows = p.status().unwrap();
    assert_eq!(rows.iter().find(|r| r.slug == "scratch").unwrap().origin, "api");

    assert!(p.close("a").is_err(), "a seed is closed by editing the manifest");
    p.close("scratch").unwrap();
    assert!(!p.tmux.list().unwrap().iter().any(|x| x.name == "abs_scratch"));
}

#[test]
fn the_socket_serves_an_authorised_uid_and_refuses_the_rest() {
    let fx = Fx::new(sleeper(), A);
    // Authorised: the test's own uid is in the ACL.
    let cfg = fx.cfg();
    let sock = cfg.socket_path.clone();
    let plane = Arc::new(Plane::load(cfg).unwrap().with_boundary(None));
    plane.reconcile_once(false);
    let l = api::bind(&plane.cfg).unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&sock).unwrap().permissions().mode() & 0o777, 0o660);
    }
    let p2 = Arc::clone(&plane);
    std::thread::spawn(move || api::serve(p2, l));
    let list: Value = serde_json::from_str(&api::call(&sock, r#"{"op":"list"}"#).unwrap()).unwrap();
    assert_eq!(list["ok"], true);
    assert!(list["sessions"].as_array().unwrap().iter().any(|s| s["slug"] == "a" && s["origin"] == "seed"));
    let bad: Value = serde_json::from_str(&api::call(&sock, r#"{"op":"nope"}"#).unwrap()).unwrap();
    assert_eq!(bad["ok"], false);
    let junk: Value = serde_json::from_str(&api::call(&sock, "not json").unwrap()).unwrap();
    assert_eq!(junk["ok"], false);

    // Refused: same socket protocol, but an ACL that does not list our uid.
    let mut other = fx.cfg();
    other.socket_path = fx.root.join("run/other.sock");
    other.acl_uids = vec![1];
    let denied = Arc::new(Plane::load(other).unwrap().with_boundary(None));
    let l2 = api::bind(&denied.cfg).unwrap();
    let dsock = denied.cfg.socket_path.clone();
    std::thread::spawn(move || api::serve(denied, l2));
    let r: Value = serde_json::from_str(&api::call(&dsock, r#"{"op":"list"}"#).unwrap()).unwrap();
    assert_eq!(r["ok"], false);
    assert!(r["error"].as_str().unwrap().contains("not authorised"), "{r}");
}

#[test]
fn dry_run_changes_nothing() {
    let fx = Fx::new(sleeper(), A);
    let p = fx.plane();
    assert_eq!(decision(&p.reconcile_once(true), "a"), Decision::Create);
    assert!(p.tmux.list().unwrap().is_empty());
}

#[test]
fn the_real_manifest_and_contract_resolve_every_seed() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut c = Config::new(root, PathBuf::from("/home/devuser"), PathBuf::from("/home/devuser/workspace"));
    c.tmux_socket = Some("abs-never-started".into());
    let p = Plane::load(c).unwrap().with_boundary(None);
    let rows = p.resolve_all().unwrap();
    let slugs: Vec<_> = rows.as_array().unwrap().iter().map(|r| r["slug"].as_str().unwrap().to_string()).collect();
    for want in ["codex", "antigravity", "openrouter", "zai", "deepseek", "loom-raw", "router"] {
        assert!(slugs.iter().any(|s| s == want), "{want} missing from {slugs:?}");
    }
    let zai = rows.as_array().unwrap().iter().find(|r| r["slug"] == "zai").unwrap();
    assert_eq!(zai["kind"], "wrapper");
    assert!(p.status().unwrap().iter().all(|r| !r.present), "nothing runs on a server that was never started");
}

#[test]
fn socket_hook_marks_are_visible_and_reject_path_traversal() {
    let fx = Fx::new(sleeper(), A);
    let p = fx.plane();
    p.reconcile_once(false);
    assert_eq!(api::dispatch(&p, r#"{"op":"mark","slug":"a","state":"busy"}"#)["ok"], true);
    assert_eq!(p.status().unwrap().iter().find(|s| s.slug == "a").unwrap().state, State::Busy);
    assert_eq!(api::dispatch(&p, r#"{"op":"mark","slug":"a","state":"idle"}"#)["ok"], true);
    assert_eq!(p.status().unwrap().iter().find(|s| s.slug == "a").unwrap().state, State::Idle);
    assert_eq!(api::dispatch(&p, r#"{"op":"mark","slug":"../escape","state":"idle"}"#)["ok"], false);
    assert_eq!(api::dispatch(&p, r#"{"op":"mark","slug":"a","state":"unknown"}"#)["ok"], false);
}

#[test]
fn send_does_not_latch_busy_for_a_pane_detected_agent_without_completion_hooks() {
    let fx = Fx::new(json!({ "opencode": { "argv": ["cat"], "ready": "PONG" } }),
        "[[interaction_plane.session_seeds]]\nslug = \"oc\"\ntool = \"opencode\"\n");
    let p = fx.plane();
    p.reconcile_once(false);
    p.send("oc", "PONG").unwrap();
    wait_for("ready pane", 5, || pane_text(&p, "abs_oc").contains("PONG"));
    assert_eq!(p.status().unwrap().iter().find(|s| s.slug == "oc").unwrap().state, State::Idle);
    assert!(!p.cfg.hook_dir.join("oc").exists(), "only completion-hook agents get a synthetic busy mark");
}
