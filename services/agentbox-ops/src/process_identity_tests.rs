//! Tests for [`super`]. Every process used here is spawned and reaped by the
//! test itself — nothing inspects, signals or depends on a process this suite
//! does not own.

use super::*;
use std::process::{Child, Command, Stdio};

/// A subprocess owned by one test: killed and reaped on drop, so a failing
/// assertion cannot leak a `sleep` into the container.
pub struct OwnedChild {
    child: Option<Child>,
    pub pid: u32,
}

impl OwnedChild {
    /// Spawns `sh -c <script>` with no stdio attached.
    pub fn spawn(script: &str) -> Self {
        let child = Command::new("sh")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the test harness must be able to spawn sh");
        let pid = child.id();
        // A process mid-`exec` briefly exposes an empty /proc/<pid>/cmdline;
        // settle so the test reads the command it means to record.
        std::thread::sleep(std::time::Duration::from_millis(120));
        Self {
            child: Some(child),
            pid,
        }
    }

    /// Kills and reaps now, so the PID is genuinely retired before the test
    /// asserts on it.
    pub fn kill_and_reap(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        self.kill_and_reap();
    }
}

/// A `/proc` that refuses every read, standing in for `hidepid`, a denied
/// namespace or a container without procfs.
struct DeniedProc;

impl ProcSource for DeniedProc {
    fn cmdline(&self, pid: u32) -> Result<Vec<u8>, ProcError> {
        Err(ProcError::Inaccessible(format!(
            "/proc/{pid}/cmdline: Permission denied"
        )))
    }
    fn stat(&self, pid: u32) -> Result<String, ProcError> {
        Err(ProcError::Inaccessible(format!(
            "/proc/{pid}/stat: Permission denied"
        )))
    }
}

/// A `/proc` serving fixed bytes, for shapes that are awkward to produce live
/// (a zombie's empty cmdline, a malformed stat).
struct FixedProc {
    cmdline: Vec<u8>,
    stat: String,
}

impl ProcSource for FixedProc {
    fn cmdline(&self, _pid: u32) -> Result<Vec<u8>, ProcError> {
        Ok(self.cmdline.clone())
    }
    fn stat(&self, _pid: u32) -> Result<String, ProcError> {
        Ok(self.stat.clone())
    }
}

/// Builds a `/proc/<pid>/stat` line whose field 22 is `starttime`, with a comm
/// that deliberately contains spaces and parentheses.
fn stat_line(comm: &str, state: &str, starttime: u64) -> String {
    let mut fields: Vec<String> = vec![state.to_string()]; // field 3
    for n in 4..=21 {
        fields.push(n.to_string());
    }
    fields.push(starttime.to_string()); // field 22
    fields.push("0".to_string()); // field 23, proving we do not read past 22
    format!("4242 ({comm}) {}", fields.join(" "))
}

#[test]
fn starttime_is_counted_from_the_last_paren_not_by_splitting_the_line() {
    // comm containing spaces and parentheses is the case that breaks a naive
    // whitespace split. Fields 3..=22 follow the last ')'.
    let stat = stat_line("weird (comm) name", "R", 987_654);
    assert_eq!(parse_starttime(&stat), Ok(987_654));

    assert!(matches!(
        parse_starttime("4242 (short) R 1 2 3"),
        Err(ProcError::Malformed(_))
    ));
    assert!(matches!(
        parse_starttime("no parens here"),
        Err(ProcError::Malformed(_))
    ));
}

#[test]
fn argv_splits_on_nul_and_drops_the_terminator() {
    assert_eq!(
        parse_argv(b"sleep\0300\0"),
        vec!["sleep".to_string(), "300".to_string()]
    );
    // Interior empty arguments are legal and must survive.
    assert_eq!(
        parse_argv(b"prog\0\0tail\0"),
        vec!["prog".to_string(), String::new(), "tail".to_string()]
    );
    assert!(parse_argv(b"").is_empty());
    assert!(parse_argv(b"\0").is_empty());
}

#[test]
fn a_recognised_owned_process_verifies_against_its_recorded_identity() {
    let child = OwnedChild::spawn("exec sleep 30");
    let proc = ProcFs::default();
    let recorded = capture(&proc, child.pid).expect("an owned live child must be capturable");

    assert_eq!(recorded.pid, child.pid);
    assert_eq!(recorded.argv, vec!["sleep".to_string(), "30".to_string()]);
    assert!(recorded.starttime > 0, "{}", recorded.display());
    assert_eq!(verify(&proc, &recorded), IdentityVerdict::Match);
}

#[test]
fn a_stale_pid_is_no_such_process_after_the_child_is_reaped() {
    let mut child = OwnedChild::spawn("exec sleep 30");
    let proc = ProcFs::default();
    let recorded = capture(&proc, child.pid).expect("live child");
    child.kill_and_reap();

    assert_eq!(verify(&proc, &recorded), IdentityVerdict::NoSuchProcess);
}

#[test]
fn a_reused_pid_is_a_mismatch_not_a_match() {
    let proc = ProcFs::default();

    // Real reuse cannot be forced deterministically, so the reused-PID state is
    // synthesised exactly: a live process carrying a *different* start time than
    // the one recorded is, by definition, a PID that has been handed on.
    let live = OwnedChild::spawn("exec sleep 30");
    let mut recorded = capture(&proc, live.pid).expect("live child");
    recorded.starttime += 1;
    match verify(&proc, &recorded) {
        IdentityVerdict::Mismatch { reason } => {
            assert!(reason.contains("start time"), "{reason}");
            assert!(reason.contains("reused"), "{reason}");
        }
        other => panic!("a differing start time must be a mismatch, got {other:?}"),
    }

    // The same PID running a different command is also a mismatch, even when the
    // start time is left alone.
    let mut recorded = capture(&proc, live.pid).expect("live child");
    recorded.argv = vec!["hermes-scheduler".to_string(), "run-loop".to_string()];
    match verify(&proc, &recorded) {
        IdentityVerdict::Mismatch { reason } => assert!(reason.contains("argv"), "{reason}"),
        other => panic!("a differing argv must be a mismatch, got {other:?}"),
    }

    // And a second, genuinely different child never matches the first's record.
    let second = OwnedChild::spawn("exec sleep 31");
    let first_record = capture(&proc, live.pid).expect("live child");
    let impostor = ProcessIdentity {
        pid: second.pid,
        ..first_record
    };
    assert!(
        !verify(&proc, &impostor).is_match(),
        "one child's identity must never verify against another's PID"
    );
}

#[test]
fn a_zombie_pid_reports_a_mismatch_rather_than_a_match() {
    // A reaped-but-present PID exposes an empty cmdline. Whatever is there, it is
    // not the running process that was recorded.
    let source = FixedProc {
        cmdline: Vec::new(),
        stat: stat_line("sleep", "Z", 5),
    };
    let recorded = ProcessIdentity {
        pid: 1,
        argv: vec!["sleep".to_string(), "30".to_string()],
        starttime: 5,
        recorded_at: None,
    };
    match verify(&source, &recorded) {
        IdentityVerdict::Mismatch { reason } => assert!(reason.contains("no argv"), "{reason}"),
        other => panic!("a zombie must not verify, got {other:?}"),
    }
}

#[test]
fn missing_proc_access_is_an_explicit_refusal_not_an_assumed_match() {
    let recorded = ProcessIdentity {
        pid: std::process::id(),
        argv: vec!["whatever".to_string()],
        starttime: 1,
        recorded_at: None,
    };

    // Denied reads.
    match verify(&DeniedProc, &recorded) {
        IdentityVerdict::Inaccessible { reason } => assert!(reason.contains("denied"), "{reason}"),
        other => panic!("a denied /proc must refuse, got {other:?}"),
    }
    assert!(matches!(
        capture(&DeniedProc, recorded.pid),
        Err(ProcError::Inaccessible(_))
    ));

    // An absent procfs root is an access failure, never "the process is gone":
    // reporting NoSuchProcess here would let a caller conclude a daemon died.
    let absent = ProcFs::new("/nonexistent-procfs-for-tests");
    match verify(&absent, &recorded) {
        IdentityVerdict::Inaccessible { reason } => {
            assert!(reason.contains("nonexistent-procfs-for-tests"), "{reason}")
        }
        other => panic!("an absent /proc must refuse, got {other:?}"),
    }

    // A malformed stat is also a refusal, not a silent match.
    let malformed = FixedProc {
        cmdline: b"whatever\0".to_vec(),
        stat: "1 (x) R 1 2 3".to_string(),
    };
    assert!(matches!(
        verify(&malformed, &recorded),
        IdentityVerdict::Inaccessible { .. }
    ));
}

#[test]
fn a_recorded_identity_without_argv_can_never_match() {
    let recorded = ProcessIdentity {
        pid: std::process::id(),
        argv: Vec::new(),
        starttime: 1,
        recorded_at: None,
    };
    assert!(matches!(
        verify(&ProcFs::default(), &recorded),
        IdentityVerdict::Mismatch { .. }
    ));
}

#[test]
fn the_hermes_launcher_allowlist_refuses_unknown_wrappers() {
    for argv in [
        vec!["hermes-scheduler", "run-loop"],
        vec!["/nix/store/abc/bin/hermes-scheduler", "run-loop", "--root", "/x"],
    ] {
        assert!(is_hermes_daemon_argv(&argv), "{argv:?}");
    }
    for argv in [
        vec![],
        vec!["hermes-scheduler"],
        vec!["hermes-scheduler", "status"],
        vec!["sh", "-c", "hermes-scheduler run-loop"],
        vec!["rg", "hermes-scheduler run-loop"],
        vec!["hermes-scheduler run-loop"],
        vec!["node", "hermes-scheduler", "run-loop"],
        vec!["some-wrapper", "hermes-scheduler", "run-loop"],
    ] {
        assert!(!is_hermes_daemon_argv(&argv), "{argv:?}");
    }
}

#[test]
fn the_ruflo_launcher_allowlist_is_unchanged_by_the_move() {
    // The reaper's matcher moved here verbatim; these are its own cases, so a
    // regression in the shared copy fails in both callers' terms.
    for argv in [
        vec!["ruflo", "daemon", "start"],
        vec!["/opt/bin/claude-flow", "daemon", "start"],
        vec![
            "node",
            "/opt/node_modules/@claude-flow/cli/dist/cli.js",
            "daemon",
            "start",
        ],
    ] {
        assert!(is_ruflo_daemon_argv(&argv), "{argv:?}");
    }
    for argv in [
        vec![],
        vec!["sh", "-c", "ruflo daemon start"],
        vec!["node", "unrelated/cli.js", "daemon", "start"],
        vec!["ruflo", "daemon start"],
    ] {
        assert!(!is_ruflo_daemon_argv(&argv), "{argv:?}");
    }
}
