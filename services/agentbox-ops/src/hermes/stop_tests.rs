//! Tests for the Hermes stop path's process-identity rule (ADR-2032).
//!
//! Every process here is spawned by the test and killed by the test. Nothing
//! signals a process this suite did not create, and no test touches the real
//! `~/.claude/scheduler` state — each one runs against a `tempfile` store.

use super::*;
use crate::process_identity::{capture, ProcError, ProcFs, ProcSource, ProcessIdentity};
use std::cell::Cell;
use std::process::{Child, Command, Stdio};

/// A subprocess owned by one test: killed and reaped on drop.
struct OwnedChild {
    child: Option<Child>,
    pid: u32,
}

impl OwnedChild {
    fn spawn(script: &str) -> Self {
        let child = Command::new("sh")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the test harness must be able to spawn sh");
        let pid = child.id();
        // Let the shell settle into its final argv before identity is captured.
        std::thread::sleep(Duration::from_millis(120));
        Self {
            child: Some(child),
            pid,
        }
    }

    fn is_alive(&self) -> bool {
        !matches!(
            ProcFs::default().cmdline(self.pid),
            Err(ProcError::NoSuchProcess)
        )
    }

    fn kill_and_reap(&mut self) {
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

/// A `/proc` that refuses every read.
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

/// A counting signal function that records calls instead of signalling.
struct RecordingSignal {
    calls: Cell<u32>,
    result: Result<(), String>,
}

impl RecordingSignal {
    fn ok() -> Self {
        Self {
            calls: Cell::new(0),
            result: Ok(()),
        }
    }
    fn failing(error: &str) -> Self {
        Self {
            calls: Cell::new(0),
            result: Err(error.to_string()),
        }
    }
    fn send(&self, _pid: u32) -> Result<(), String> {
        self.calls.set(self.calls.get() + 1);
        self.result.clone()
    }
}

/// A store whose PID file names `pid`, with `identity` recorded when given.
fn store_for(dir: &std::path::Path, pid: u32, identity: Option<&ProcessIdentity>) -> Store {
    let store = Store::new(dir);
    store.ensure_dirs().unwrap();
    std::fs::write(store.pid_file(), pid.to_string()).unwrap();
    if let Some(identity) = identity {
        store.save_identity(identity).unwrap();
    }
    store
}

fn short_grace() -> Duration {
    Duration::from_millis(300)
}

#[test]
fn an_identity_round_trips_through_the_store_and_probes_as_running() {
    let tmp = tempfile::tempdir().unwrap();
    let me = std::process::id();
    let identity = capture(&ProcFs::default(), me).expect("this test process is capturable");
    let store = store_for(tmp.path(), me, Some(&identity));

    assert_eq!(store.load_identity().as_ref(), Some(&identity));
    assert_eq!(probe(&store), DaemonProbe::Running { pid: me });
    assert!(is_running(&store));
}

#[test]
fn a_record_without_an_identity_is_unverifiable_and_is_never_signalled() {
    let tmp = tempfile::tempdir().unwrap();
    let child = OwnedChild::spawn("trap '' TERM; while :; do sleep 1; done");
    // No identity file: the pre-identity daemon shape.
    let store = store_for(tmp.path(), child.pid, None);

    assert!(matches!(
        probe(&store),
        DaemonProbe::Unverifiable { .. }
    ));

    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );

    match &outcome {
        StopOutcome::RefusedUnverifiable { pid, reason } => {
            assert_eq!(*pid, child.pid);
            assert!(reason.contains("no identity recorded"), "{reason}");
        }
        other => panic!("an unverifiable record must be refused, got {other:?}"),
    }
    assert_eq!(signal.calls.get(), 0, "nothing may be signalled on a refusal");
    assert!(!outcome.is_success());
    assert!(child.is_alive(), "the process must be untouched");
    // Recoverable state is preserved for a later, informed attempt.
    assert!(store.pid_file().exists());
}

#[test]
fn a_reused_pid_is_refused_and_never_signalled() {
    let tmp = tempfile::tempdir().unwrap();
    let child = OwnedChild::spawn("trap '' TERM; while :; do sleep 1; done");
    let mut identity = capture(&ProcFs::default(), child.pid).expect("live child");
    // Synthesise the reuse the kernel will not stage on demand: same PID, a
    // start time that is not the recorded one.
    identity.starttime += 1;
    let store = store_for(tmp.path(), child.pid, Some(&identity));

    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );

    match &outcome {
        StopOutcome::RefusedMismatch { pid, reason } => {
            assert_eq!(*pid, child.pid);
            assert!(reason.contains("reused"), "{reason}");
        }
        other => panic!("a reused PID must be refused, got {other:?}"),
    }
    assert_eq!(signal.calls.get(), 0);
    assert!(child.is_alive());
    assert!(store.identity_file().exists(), "state must survive a refusal");
}

#[test]
fn an_unknown_wrapper_argv_is_refused_even_at_the_same_pid() {
    let tmp = tempfile::tempdir().unwrap();
    let child = OwnedChild::spawn("trap '' TERM; while :; do sleep 1; done");
    let mut identity = capture(&ProcFs::default(), child.pid).expect("live child");
    // The PID is right and the start time is right, but the command is not the
    // one that was launched — a wrapper swap, refused like any other mismatch.
    identity.argv = vec![
        "hermes-scheduler".to_string(),
        "run-loop".to_string(),
        "--root".to_string(),
        tmp.path().display().to_string(),
    ];
    let store = store_for(tmp.path(), child.pid, Some(&identity));

    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );

    match &outcome {
        StopOutcome::RefusedMismatch { reason, .. } => assert!(reason.contains("argv"), "{reason}"),
        other => panic!("a differing argv must be refused, got {other:?}"),
    }
    assert_eq!(signal.calls.get(), 0);
    assert!(child.is_alive());
}

#[test]
fn unreadable_proc_data_is_an_explicit_refusal_not_an_assumed_match() {
    let tmp = tempfile::tempdir().unwrap();
    let me = std::process::id();
    let identity = capture(&ProcFs::default(), me).unwrap();
    let store = store_for(tmp.path(), me, Some(&identity));

    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(&store, &DeniedProc, &|pid| signal.send(pid), short_grace());

    match &outcome {
        StopOutcome::RefusedInaccessible { pid, reason } => {
            assert_eq!(*pid, me);
            assert!(reason.contains("denied"), "{reason}");
        }
        other => panic!("an unreadable /proc must be refused, got {other:?}"),
    }
    assert_eq!(signal.calls.get(), 0);
    assert!(store.pid_file().exists(), "state must survive a refusal");
    assert!(store.identity_file().exists());
}

#[test]
fn a_failed_signal_is_reported_and_leaves_recoverable_state() {
    let tmp = tempfile::tempdir().unwrap();
    let child = OwnedChild::spawn("trap '' TERM; while :; do sleep 1; done");
    let identity = capture(&ProcFs::default(), child.pid).expect("live child");
    let store = store_for(tmp.path(), child.pid, Some(&identity));

    let signal = RecordingSignal::failing("Operation not permitted (os error 1)");
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );

    match &outcome {
        StopOutcome::SignalFailed { pid, error } => {
            assert_eq!(*pid, child.pid);
            assert!(error.contains("not permitted"), "{error}");
        }
        other => panic!("a rejected signal must be reported, got {other:?}"),
    }
    assert_eq!(signal.calls.get(), 1, "the signal must have been attempted");
    assert!(!outcome.is_success());
    assert!(child.is_alive());
    assert!(store.pid_file().exists());
    assert!(store.identity_file().exists());
}

#[test]
fn a_daemon_that_ignores_sigterm_is_reported_as_signalled_not_stopped() {
    let tmp = tempfile::tempdir().unwrap();
    // The shell ignores SIGTERM, so delivery succeeds and shutdown does not.
    let child = OwnedChild::spawn("trap '' TERM; while :; do sleep 1; done");
    let identity = capture(&ProcFs::default(), child.pid).expect("live child");
    let store = store_for(tmp.path(), child.pid, Some(&identity));

    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &super::sigterm,
        short_grace(),
    );

    match &outcome {
        StopOutcome::Signalled { pid, waited_ms } => {
            assert_eq!(*pid, child.pid);
            assert!(*waited_ms >= 300, "the grace period must be honoured: {waited_ms}");
        }
        other => panic!("an ignored SIGTERM must report delivery only, got {other:?}"),
    }
    assert!(outcome.is_success(), "delivery succeeded");
    assert!(
        !outcome.is_confirmed_shutdown(),
        "delivery is not shutdown — that distinction is the point"
    );
    assert!(child.is_alive(), "the process ignored the signal");
    assert!(
        store.pid_file().exists() && store.identity_file().exists(),
        "a daemon still shutting down keeps the state a retry needs"
    );
    assert!(outcome.message().contains("still running"));
}

#[test]
fn a_daemon_that_exits_is_confirmed_and_its_records_are_cleared() {
    let tmp = tempfile::tempdir().unwrap();
    // A plain `sleep` takes the default SIGTERM disposition and dies.
    let child = OwnedChild::spawn("exec sleep 30");
    let identity = capture(&ProcFs::default(), child.pid).expect("live child");
    let store = store_for(tmp.path(), child.pid, Some(&identity));

    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &super::sigterm,
        Duration::from_secs(5),
    );

    match &outcome {
        StopOutcome::Exited { pid, .. } => assert_eq!(*pid, child.pid),
        other => panic!("a terminating daemon must be confirmed exited, got {other:?}"),
    }
    assert!(outcome.is_confirmed_shutdown());
    assert!(
        !store.pid_file().exists() && !store.identity_file().exists(),
        "records are cleared only once the daemon is confirmed gone"
    );
}

#[test]
fn a_stale_record_for_a_dead_pid_reports_not_running_and_clears() {
    let tmp = tempfile::tempdir().unwrap();
    let mut child = OwnedChild::spawn("exec sleep 30");
    let identity = capture(&ProcFs::default(), child.pid).expect("live child");
    let store = store_for(tmp.path(), child.pid, Some(&identity));
    // Killed *and reaped*, so the PID is genuinely retired rather than a zombie.
    child.kill_and_reap();

    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );

    assert_eq!(
        outcome,
        StopOutcome::NotRunning {
            pid: Some(child.pid)
        }
    );
    assert_eq!(signal.calls.get(), 0, "a dead PID is never signalled");
    assert!(!store.pid_file().exists());
    assert!(!store.identity_file().exists());
}

#[test]
fn an_empty_store_reports_not_running_without_signalling() {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::new(tmp.path());
    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );
    assert_eq!(outcome, StopOutcome::NotRunning { pid: None });
    assert_eq!(signal.calls.get(), 0);
}

#[test]
fn an_identity_recorded_for_another_pid_is_unverifiable() {
    let tmp = tempfile::tempdir().unwrap();
    let child = OwnedChild::spawn("trap '' TERM; while :; do sleep 1; done");
    let identity = capture(&ProcFs::default(), std::process::id()).unwrap();
    // PID file and identity record disagree — a torn or hand-edited state.
    let store = store_for(tmp.path(), child.pid, Some(&identity));

    let signal = RecordingSignal::ok();
    let outcome = daemon_stop_with(
        &store,
        &ProcFs::default(),
        &|pid| signal.send(pid),
        short_grace(),
    );
    match &outcome {
        StopOutcome::RefusedUnverifiable { reason, .. } => {
            assert!(reason.contains("PID file"), "{reason}")
        }
        other => panic!("a disagreeing record must be refused, got {other:?}"),
    }
    assert_eq!(signal.calls.get(), 0);
    assert!(child.is_alive());
}

#[test]
fn is_running_is_conservative_when_proc_cannot_be_read() {
    let tmp = tempfile::tempdir().unwrap();
    let me = std::process::id();
    let identity = capture(&ProcFs::default(), me).unwrap();
    let store = store_for(tmp.path(), me, Some(&identity));

    // Unreadable proc data must not be mistaken for a dead daemon: starting a
    // second scheduler over a live one is the worse failure.
    let state = probe_with(&store, &DeniedProc);
    assert!(matches!(state, DaemonProbe::Inaccessible { .. }));
    assert!(!state.is_retired());
}
