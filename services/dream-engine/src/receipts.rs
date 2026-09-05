//! Typed evaluator receipts — the raw evidence a verdict must answer to.
//!
//! Before this module the engine kept only an evaluator's stdout, merged into
//! the prompt as prose. An evaluator that exited non-zero, printed nothing, or
//! never ran at all was indistinguishable from one that passed, so "failure
//! text can coexist with ACCEPT" (ADR-2024 closeout). A receipt fixes that: it
//! records the exit code, both streams verbatim, the wall-clock duration and a
//! *typed* [`EvaluatorOutcome`] derived from them by a pure function.
//!
//! Receipts are persisted raw — `stdout` and `stderr` as their own files, never
//! truncated — so a night's evidence survives the report that summarised it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::manifest::write_atomic;
use crate::runner::ExecOutcome;

/// Which side of the experiment a receipt belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// The unmodified baseline tree shipped to the annexe.
    Baseline,
    /// The tree with the report's candidate patch applied.
    Candidate,
}

impl Phase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Phase::Baseline => "baseline",
            Phase::Candidate => "candidate",
        }
    }
}

/// The typed result of one evaluator run.
///
/// Every variant except [`Passed`](EvaluatorOutcome::Passed) vetoes acceptance
/// when the evaluator is required — see [`crate::gate`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum EvaluatorOutcome {
    /// Exit 0, output present, no explicit failure marker.
    Passed,
    /// Non-zero exit — the evaluator ran and disagreed.
    Failed { exit_code: i32 },
    /// Exit 0, but the output declares failure in so many words
    /// (`FAIL:`, `FAILED`, `test result: FAILED`).
    ExplicitFail { marker: String },
    /// The evaluator could not be run at all: transport error, missing
    /// interpreter, unreachable host. Not evidence about the repository.
    Blocked { detail: String },
    /// Killed at its wall-clock budget.
    TimedOut { after_secs: u64 },
    /// Exit 0 with no output on either stream. Surface-independent, therefore
    /// unfalsifiable — the ADR-065 no-op in its most literal form.
    Silent,
    /// Declared in the manifest but absent from the receipt set.
    Missing,
}

impl EvaluatorOutcome {
    pub fn label(&self) -> &'static str {
        match self {
            EvaluatorOutcome::Passed => "PASSED",
            EvaluatorOutcome::Failed { .. } => "FAILED",
            EvaluatorOutcome::ExplicitFail { .. } => "EXPLICIT-FAIL",
            EvaluatorOutcome::Blocked { .. } => "BLOCKED",
            EvaluatorOutcome::TimedOut { .. } => "TIMED-OUT",
            EvaluatorOutcome::Silent => "SILENT",
            EvaluatorOutcome::Missing => "MISSING",
        }
    }

    /// True only for an unambiguous pass. Everything else vetoes.
    pub fn is_pass(&self) -> bool {
        matches!(self, EvaluatorOutcome::Passed)
    }

    /// True when the outcome says the *harness* broke rather than the code.
    ///
    /// The distinction drives the veto's verdict: a broken harness is
    /// `BLOCKED-ENV` (an operational fault that must not park a healthy repo),
    /// while a failing evaluator is `REJECT` (real evidence against the
    /// candidate).
    pub fn is_harness_fault(&self) -> bool {
        matches!(
            self,
            EvaluatorOutcome::Blocked { .. }
                | EvaluatorOutcome::TimedOut { .. }
                | EvaluatorOutcome::Silent
                | EvaluatorOutcome::Missing
        )
    }
}

/// One evaluator run, in full.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatorReceipt {
    pub name: String,
    pub command: String,
    /// `sha256(command)` — must match the frozen manifest's identity.
    pub command_digest: String,
    pub phase: Phase,
    pub required: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub timeout_secs: u64,
    pub started_at: String,
    pub stdout: String,
    pub stderr: String,
    pub outcome: EvaluatorOutcome,
}

impl EvaluatorReceipt {
    /// Build a receipt from a raw execution, classifying the outcome.
    pub fn from_exec(
        name: &str,
        command: &str,
        phase: Phase,
        required: bool,
        timeout_secs: u64,
        exec: ExecOutcome,
    ) -> Self {
        let outcome = classify(&exec, timeout_secs);
        Self {
            name: name.to_string(),
            command: command.to_string(),
            command_digest: crate::manifest::digest(command.as_bytes()),
            phase,
            required,
            exit_code: exec.exit_code,
            duration_ms: exec.duration_ms,
            timeout_secs,
            started_at: exec.started_at,
            stdout: exec.stdout,
            stderr: exec.stderr,
            outcome,
        }
    }

    /// A receipt standing in for an evaluator that never produced one.
    pub fn missing(name: &str, command: &str, phase: Phase, required: bool) -> Self {
        Self {
            name: name.to_string(),
            command: command.to_string(),
            command_digest: crate::manifest::digest(command.as_bytes()),
            phase,
            required,
            exit_code: None,
            duration_ms: 0,
            timeout_secs: 0,
            started_at: chrono::Utc::now().to_rfc3339(),
            stdout: String::new(),
            stderr: String::new(),
            outcome: EvaluatorOutcome::Missing,
        }
    }

    /// A one-line summary for the prompt, ledger and operator alerts.
    pub fn summary(&self) -> String {
        format!(
            "{} [{}] {} exit={} {}ms",
            self.name,
            self.phase.as_str(),
            self.outcome.label(),
            self.exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "-".into()),
            self.duration_ms
        )
    }
}

/// Explicit failure markers, matched against whole trimmed lines (uppercased).
///
/// Deliberately narrow. `cargo test`'s happy path prints "test result: ok. 12
/// passed; 0 failed", which must NOT match — a substring search for "failed"
/// would veto every green night.
fn explicit_fail_marker(text: &str) -> Option<String> {
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let upper = t.to_ascii_uppercase();
        let hit = upper == "FAIL"
            || upper == "FAILED"
            || upper.starts_with("FAIL:")
            || upper.starts_with("FAILED:")
            || upper.starts_with("EVALUATOR-FAIL")
            || upper.contains("TEST RESULT: FAILED")
            || upper.starts_with("ERROR: TEST FAILED");
        if hit {
            return Some(t.chars().take(160).collect());
        }
    }
    None
}

/// Pure classification of a raw execution into a typed outcome.
pub fn classify(exec: &ExecOutcome, timeout_secs: u64) -> EvaluatorOutcome {
    if let Some(detail) = &exec.transport_error {
        return EvaluatorOutcome::Blocked {
            detail: detail.chars().take(400).collect(),
        };
    }
    // 124 is GNU `timeout`'s signal that it killed the child; 137 is SIGKILL
    // after `--kill-after`.
    if exec.timed_out || matches!(exec.exit_code, Some(124) | Some(137)) {
        return EvaluatorOutcome::TimedOut {
            after_secs: timeout_secs,
        };
    }
    match exec.exit_code {
        None => EvaluatorOutcome::Blocked {
            detail: "process produced no exit status".into(),
        },
        Some(0) => {
            if exec.stdout.trim().is_empty() && exec.stderr.trim().is_empty() {
                return EvaluatorOutcome::Silent;
            }
            if let Some(marker) = explicit_fail_marker(&exec.stdout)
                .or_else(|| explicit_fail_marker(&exec.stderr))
            {
                return EvaluatorOutcome::ExplicitFail { marker };
            }
            EvaluatorOutcome::Passed
        }
        Some(code) => EvaluatorOutcome::Failed { exit_code: code },
    }
}

/// Filesystem-safe form of an evaluator name.
fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "evaluator".into()
    } else {
        s
    }
}

/// Persist a phase's receipts under `dir/receipts/<phase>/`.
///
/// Each evaluator gets `<name>.stdout`, `<name>.stderr` (raw, untruncated) and
/// `<name>.json` (metadata + typed outcome, streams elided). A phase index
/// lists them. Every write is atomic, so an interrupted run leaves whole files.
pub fn persist(dir: &Path, phase: Phase, receipts: &[EvaluatorReceipt]) -> std::io::Result<PathBuf> {
    let out = dir.join("receipts").join(phase.as_str());
    std::fs::create_dir_all(&out)?;
    let mut index = Vec::new();
    for r in receipts {
        let base = slug(&r.name);
        write_atomic(&out.join(format!("{base}.stdout")), r.stdout.as_bytes())?;
        write_atomic(&out.join(format!("{base}.stderr")), r.stderr.as_bytes())?;
        let mut meta = r.clone();
        meta.stdout = format!("(raw stream in {base}.stdout, {} bytes)", r.stdout.len());
        meta.stderr = format!("(raw stream in {base}.stderr, {} bytes)", r.stderr.len());
        let bytes = serde_json::to_vec_pretty(&meta)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_atomic(&out.join(format!("{base}.json")), &bytes)?;
        index.push(serde_json::json!({
            "name": r.name,
            "file": base,
            "outcome": r.outcome.label(),
            "exitCode": r.exit_code,
            "durationMs": r.duration_ms,
            "required": r.required,
            "commandDigest": r.command_digest,
        }));
    }
    let idx = serde_json::json!({ "phase": phase.as_str(), "receipts": index });
    let bytes = serde_json::to_vec_pretty(&idx)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    write_atomic(&out.join("index.json"), &bytes)?;
    Ok(out)
}

/// Read back a phase's receipts (metadata plus the raw streams).
pub fn load(dir: &Path, phase: Phase) -> Vec<EvaluatorReceipt> {
    let out = dir.join("receipts").join(phase.as_str());
    let Ok(entries) = std::fs::read_dir(&out) else {
        return Vec::new();
    };
    let mut receipts = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if path.file_name().and_then(|s| s.to_str()) == Some("index.json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(mut r) = serde_json::from_str::<EvaluatorReceipt>(&text) else {
            continue;
        };
        let base = slug(&r.name);
        r.stdout = std::fs::read_to_string(out.join(format!("{base}.stdout"))).unwrap_or_default();
        r.stderr = std::fs::read_to_string(out.join(format!("{base}.stderr"))).unwrap_or_default();
        receipts.push(r);
    }
    receipts.sort_by(|a, b| a.name.cmp(&b.name));
    receipts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exec(code: Option<i32>, out: &str, err: &str) -> ExecOutcome {
        ExecOutcome {
            exit_code: code,
            stdout: out.into(),
            stderr: err.into(),
            duration_ms: 12,
            transport_error: None,
            timed_out: false,
            started_at: "2026-09-05T01:00:00Z".into(),
        }
    }

    #[test]
    fn zero_exit_with_output_passes() {
        assert_eq!(classify(&exec(Some(0), "12 tests ok\n", ""), 60), EvaluatorOutcome::Passed);
    }

    #[test]
    fn nonzero_exit_fails_with_the_code() {
        assert_eq!(
            classify(&exec(Some(101), "boom", ""), 60),
            EvaluatorOutcome::Failed { exit_code: 101 }
        );
    }

    #[test]
    fn zero_exit_with_no_output_is_silent() {
        assert_eq!(classify(&exec(Some(0), "   \n", "  "), 60), EvaluatorOutcome::Silent);
    }

    #[test]
    fn explicit_fail_text_beats_a_zero_exit() {
        // The exact shape the ADR closeout calls out: failure text coexisting
        // with a success signal.
        let o = classify(&exec(Some(0), "running checks\nFAIL: recall band 91/120\n", ""), 60);
        assert!(matches!(o, EvaluatorOutcome::ExplicitFail { .. }), "got {o:?}");
        let o = classify(&exec(Some(0), "test result: FAILED. 3 passed; 2 failed", ""), 60);
        assert!(matches!(o, EvaluatorOutcome::ExplicitFail { .. }), "got {o:?}");
    }

    #[test]
    fn green_cargo_output_is_not_an_explicit_fail() {
        // Regression guard: a substring search for "failed" would veto every
        // green night, because cargo prints "0 failed" on success.
        let o = classify(
            &exec(Some(0), "test result: ok. 42 passed; 0 failed; 0 ignored", ""),
            60,
        );
        assert_eq!(o, EvaluatorOutcome::Passed);
    }

    #[test]
    fn timeout_is_typed_from_flag_or_exit_code() {
        let mut e = exec(Some(0), "partial", "");
        e.timed_out = true;
        assert_eq!(classify(&e, 900), EvaluatorOutcome::TimedOut { after_secs: 900 });
        assert_eq!(
            classify(&exec(Some(124), "", ""), 900),
            EvaluatorOutcome::TimedOut { after_secs: 900 }
        );
    }

    #[test]
    fn transport_error_is_blocked_not_failed() {
        let mut e = exec(None, "", "");
        e.transport_error = Some("ssh: connect to host 10.10.10.1 port 22: No route".into());
        let o = classify(&e, 60);
        assert!(matches!(o, EvaluatorOutcome::Blocked { .. }), "got {o:?}");
        assert!(o.is_harness_fault());
        assert!(!EvaluatorOutcome::Failed { exit_code: 1 }.is_harness_fault());
    }

    #[test]
    fn only_passed_counts_as_a_pass() {
        assert!(EvaluatorOutcome::Passed.is_pass());
        for o in [
            EvaluatorOutcome::Failed { exit_code: 1 },
            EvaluatorOutcome::ExplicitFail { marker: "FAIL".into() },
            EvaluatorOutcome::Blocked { detail: "x".into() },
            EvaluatorOutcome::TimedOut { after_secs: 1 },
            EvaluatorOutcome::Silent,
            EvaluatorOutcome::Missing,
        ] {
            assert!(!o.is_pass(), "{o:?} must not count as a pass");
        }
    }

    #[test]
    fn receipts_round_trip_through_disk_with_raw_streams() {
        let dir = tempfile::tempdir().unwrap();
        let r = EvaluatorReceipt::from_exec(
            "dream-engine tests",
            "cargo test",
            Phase::Candidate,
            true,
            900,
            exec(Some(101), "line one\nline two\n", "warning: unused\n"),
        );
        persist(dir.path(), Phase::Candidate, std::slice::from_ref(&r)).unwrap();

        // Raw streams are on disk verbatim, not summarised into the JSON.
        let raw = dir.path().join("receipts/candidate/dream-engine-tests.stdout");
        assert_eq!(std::fs::read_to_string(&raw).unwrap(), "line one\nline two\n");
        let meta: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("receipts/candidate/dream-engine-tests.json"))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(meta["outcome"]["kind"], "failed");
        assert_eq!(meta["exitCode"], 101);

        let back = load(dir.path(), Phase::Candidate);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0], r, "receipt reload is lossless");
        assert!(load(dir.path(), Phase::Baseline).is_empty());
    }
}
