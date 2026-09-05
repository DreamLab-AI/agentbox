//! The frozen experiment manifest (ADR-2024 closeout, CP-01/07/08).
//!
//! Before a single token is spent on the model, the engine writes down exactly
//! what the night is an experiment *about*: which baseline revision and tree
//! were shipped to the annexe, which evaluators were selected and what their
//! command strings hash to, which model was going to be asked, and the run
//! identity that ties every later artefact back to this record.
//!
//! Two properties matter and both are tested:
//!
//! * **Frozen.** The manifest is written once, atomically, *before* the model
//!   call. A second attempt at the same night either finds a byte-identical
//!   manifest (and resumes against it) or finds a diverged one — the baseline
//!   moved underneath an interrupted run — which is archived rather than
//!   silently overwritten.
//! * **Restart-safe identity.** [`run_id`] is a pure function of the
//!   experiment's inputs, so an interrupted run recomputes the *same* id on
//!   restart. A run cannot be silently repeated under a fresh name, and a
//!   genuinely different experiment cannot inherit an old one's receipts.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::config::{DreamConfig, EvaluatorSpec};

/// Schema version of the manifest document. Bump on any breaking field change
/// so an older manifest is never silently reinterpreted.
pub const MANIFEST_SCHEMA: u32 = 1;

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialising manifest: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("git {0} failed in {1}")]
    Git(String, String),
}

/// One evaluator as frozen into the manifest: its declared identity, the exact
/// command text, and a digest of that text so a later edit is detectable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvaluatorIdentity {
    pub name: String,
    pub command: String,
    /// `sha256(command)`, lowercase hex — the evaluator's "version" in the
    /// absence of anything better. A changed command is a changed evaluator.
    pub command_digest: String,
    /// Whether a bad result from this evaluator vetoes acceptance.
    pub required: bool,
    /// Deep slots this evaluator covers. Empty ⇒ every deep.
    pub deeps: Vec<String>,
    pub timeout_secs: u64,
}

impl EvaluatorIdentity {
    pub fn from_spec(name: &str, spec: &EvaluatorSpec) -> Self {
        Self {
            name: name.to_string(),
            command: spec.cmd.clone(),
            command_digest: digest(spec.cmd.as_bytes()),
            required: spec.required,
            deeps: spec.deeps.clone(),
            timeout_secs: spec.timeout_secs,
        }
    }

    /// True when this evaluator applies to `deep` (an empty `deeps` list means
    /// "every deep").
    pub fn covers(&self, deep: &str) -> bool {
        self.deeps.is_empty() || self.deeps.iter().any(|d| d == deep)
    }
}

/// The identity of the model the night intended to call. Frozen *before* the
/// call, so a provider failover is visible as a divergence between the frozen
/// intent and the recorded `model_used`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelIdentity {
    pub provider: String,
    pub model: String,
    pub max_tokens: u32,
    /// Fallback provider/model, when one is configured.
    pub fallback: Option<String>,
}

/// The frozen record. Every field is fixed before the model call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExperimentManifest {
    pub schema: u32,
    /// Deterministic, restart-safe identity — see [`run_id`].
    pub run_id: String,
    pub night_id: String,
    pub repo: String,
    pub repo_slug: String,
    pub date: String,
    pub day_int: u32,
    pub deep: String,
    pub scan: Vec<String>,
    /// Full 40-hex commit the annexe tree was archived from.
    pub baseline_revision: String,
    /// `git rev-parse HEAD^{tree}` — the tree actually shipped and evaluated.
    /// This is the *candidate tree* of the baseline evaluation; the patched
    /// candidate's tree hash is recorded separately in `candidate.json`.
    pub baseline_tree_hash: String,
    /// `sha256(dream.config.json)` — the whole configuration, byte-exact.
    pub config_digest: String,
    pub evaluators: Vec<EvaluatorIdentity>,
    pub model: ModelIdentity,
    pub engine_version: String,
    pub created_at: String,
}

impl ExperimentManifest {
    /// Evaluators that apply to this manifest's deep.
    pub fn applicable(&self) -> Vec<&EvaluatorIdentity> {
        self.evaluators
            .iter()
            .filter(|e| e.covers(&self.deep))
            .collect()
    }

    /// Applicable evaluators whose result can veto acceptance.
    pub fn required(&self) -> Vec<&EvaluatorIdentity> {
        self.applicable().into_iter().filter(|e| e.required).collect()
    }

    /// Canonical digest of the manifest *content*, used to detect divergence
    /// between attempts at the same night.
    ///
    /// `created_at` is deliberately excluded. A restart rebuilds the manifest
    /// from the same inputs but stamps a new wall-clock time; if that stamp
    /// entered the digest, every resumed night would look like a diverged
    /// experiment and archive its own predecessor. Everything that actually
    /// defines the experiment — baseline, tree, config, evaluators, model — is
    /// included. (`serde_json::Value` maps are ordered, so the projection is
    /// stable across runs.)
    pub fn digest(&self) -> String {
        let mut v = serde_json::to_value(self).unwrap_or(serde_json::Value::Null);
        if let Some(obj) = v.as_object_mut() {
            obj.remove("created_at");
        }
        digest(serde_json::to_string(&v).unwrap_or_default().as_bytes())
    }
}

/// Lowercase hex SHA-256 of arbitrary bytes.
pub fn digest(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// The restart-safe run identity: 16 hex characters derived from the
/// experiment's defining inputs.
///
/// Deliberately excludes wall-clock time, process id and attempt counter, so
/// an interrupted night recomputes the same id and resumes against its own
/// receipts instead of starting a nameless second run. It *includes* the
/// baseline revision and the config digest, so a genuinely different
/// experiment — new HEAD, edited evaluators — gets a different id and cannot
/// inherit the previous attempt's evidence.
pub fn run_id(repo: &str, date: &str, deep: &str, baseline_revision: &str, config_digest: &str) -> String {
    let material = format!(
        "dream-run-v1\u{0}{repo}\u{0}{date}\u{0}{deep}\u{0}{baseline_revision}\u{0}{config_digest}"
    );
    digest(material.as_bytes())[..16].to_string()
}

/// Outcome of freezing: either this attempt wrote the manifest, or an earlier
/// attempt did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Freeze {
    /// First attempt at this night — the manifest was written now.
    Written,
    /// A byte-identical manifest was already on disk; this is a restart.
    Resumed,
    /// A manifest existed but described a different experiment (the baseline
    /// or the config moved). The old one was archived under its own run id
    /// and the new one written; `previous` is the archived run id.
    Diverged { previous: String },
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("manifest.json")
}

/// Write `manifest` to `dir/manifest.json` atomically, exactly once.
///
/// Returns how the freeze resolved — see [`Freeze`]. The caller must invoke
/// this before any model call; the returned value tells it whether the night
/// is fresh or a restart.
pub fn freeze(dir: &Path, manifest: &ExperimentManifest) -> Result<Freeze, ManifestError> {
    std::fs::create_dir_all(dir)?;
    let path = manifest_path(dir);
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(existing) = serde_json::from_str::<ExperimentManifest>(&text) {
            if existing.digest() == manifest.digest() {
                return Ok(Freeze::Resumed);
            }
            let archived = dir.join(format!("manifest-{}.json", existing.run_id));
            std::fs::rename(&path, &archived)?;
            write_atomic(&path, &serde_json::to_vec_pretty(manifest)?)?;
            return Ok(Freeze::Diverged {
                previous: existing.run_id,
            });
        }
        // Unparsable manifest: archive it under a fixed name rather than
        // destroying evidence, then write the good one.
        let _ = std::fs::rename(&path, dir.join("manifest-unparsable.json"));
    }
    write_atomic(&path, &serde_json::to_vec_pretty(manifest)?)?;
    Ok(Freeze::Written)
}

/// Read back a frozen manifest, if one exists.
pub fn load(dir: &Path) -> Option<ExperimentManifest> {
    let text = std::fs::read_to_string(manifest_path(dir)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write bytes to `path` via a temporary file and a rename, so a crash mid-write
/// leaves either the old content or the new — never a truncated document.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "tmp{}",
        std::process::id()
    ));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// Resolve the baseline revision and tree hash of a git checkout.
///
/// `git archive HEAD` is what the dispatcher ships, so the *tree* of HEAD is
/// the exact content the evaluators see — recording it (not just the commit)
/// makes the manifest bind to bytes rather than to a label.
pub fn baseline_of(repo: &Path) -> Result<(String, String), ManifestError> {
    let rev = git(repo, &["rev-parse", "HEAD"])?;
    let tree = git(repo, &["rev-parse", "HEAD^{tree}"])?;
    Ok((rev, tree))
}

pub(crate) fn git(repo: &Path, args: &[&str]) -> Result<String, ManifestError> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()?;
    if !out.status.success() {
        return Err(ManifestError::Git(
            args.join(" "),
            repo.display().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Build the manifest for tonight from the loaded config. `config_bytes` is the
/// raw `dream.config.json` so the digest binds the file, not our parse of it.
#[allow(clippy::too_many_arguments)]
pub fn build(
    cfg: &DreamConfig,
    config_bytes: &[u8],
    repo: &str,
    night_id: &str,
    date: &str,
    day_int: u32,
    deep: &str,
    scan: &[String],
    baseline_revision: &str,
    baseline_tree_hash: &str,
    model: ModelIdentity,
) -> ExperimentManifest {
    let config_digest = digest(config_bytes);
    let mut evaluators: Vec<EvaluatorIdentity> = cfg
        .evaluator_entrypoints
        .iter()
        .map(|(name, spec)| EvaluatorIdentity::from_spec(name, spec))
        .collect();
    // Deterministic order: a HashMap iteration order must never leak into the
    // frozen document, or the digest stops being reproducible.
    evaluators.sort_by(|a, b| a.name.cmp(&b.name));

    ExperimentManifest {
        schema: MANIFEST_SCHEMA,
        run_id: run_id(repo, date, deep, baseline_revision, &config_digest),
        night_id: night_id.to_string(),
        repo: repo.to_string(),
        repo_slug: cfg.repo.clone(),
        date: date.to_string(),
        day_int,
        deep: deep.to_string(),
        scan: scan.to_vec(),
        baseline_revision: baseline_revision.to_string(),
        baseline_tree_hash: baseline_tree_hash.to_string(),
        config_digest,
        evaluators,
        model,
        engine_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// The post-model record of the candidate that was actually applied and
/// re-evaluated. Written next to the frozen manifest; never merged into it,
/// because the manifest must stay byte-stable for restart comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateRecord {
    pub schema: u32,
    pub run_id: String,
    /// `sha256` of the unified diff extracted from the report.
    pub patch_digest: String,
    pub patch_bytes: usize,
    /// Tree hash of the patched candidate — the tree the rerun evaluated.
    pub candidate_tree_hash: String,
    pub branch: String,
    pub applied: bool,
    pub apply_error: Option<String>,
    pub created_at: String,
}

pub fn write_candidate(dir: &Path, record: &CandidateRecord) -> Result<(), ManifestError> {
    write_atomic(&dir.join("candidate.json"), &serde_json::to_vec_pretty(record)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::EvaluatorSpec;
    use std::collections::HashMap;

    fn spec(cmd: &str, required: bool) -> EvaluatorSpec {
        EvaluatorSpec {
            cmd: cmd.into(),
            required,
            deeps: vec![],
            timeout_secs: 900,
        }
    }

    fn test_cfg() -> DreamConfig {
        let mut evals = HashMap::new();
        evals.insert("tests".to_string(), spec("cargo test", true));
        evals.insert("lint".to_string(), spec("cargo clippy", false));
        serde_json::from_value(serde_json::json!({
            "repo": "o/r",
            "slots": [{"deep": "engine", "scan": ["a"]}],
            "evaluatorEntrypoints": {
                "tests": {"cmd": "cargo test", "required": true, "timeoutSecs": 900},
                "lint": {"cmd": "cargo clippy", "required": false, "timeoutSecs": 900}
            }
        }))
        .unwrap()
    }

    fn model() -> ModelIdentity {
        ModelIdentity {
            provider: "loom".into(),
            model: "qwen3.8-27B".into(),
            max_tokens: 16384,
            fallback: None,
        }
    }

    fn manifest_for(rev: &str) -> ExperimentManifest {
        let cfg = test_cfg();
        build(
            &cfg,
            b"{\"repo\":\"o/r\"}",
            "agentbox",
            "2026-09-05-agentbox",
            "2026-09-05",
            20260905,
            "engine",
            &["a".to_string()],
            rev,
            "tree0000",
            model(),
        )
    }

    #[test]
    fn run_id_is_deterministic_and_input_sensitive() {
        let a = run_id("agentbox", "2026-09-05", "engine", "abc123", "cfg1");
        let b = run_id("agentbox", "2026-09-05", "engine", "abc123", "cfg1");
        assert_eq!(a, b, "same inputs must recompute the same id (restart-safe)");
        assert_eq!(a.len(), 16);
        assert_ne!(a, run_id("agentbox", "2026-09-05", "engine", "abc124", "cfg1"));
        assert_ne!(a, run_id("agentbox", "2026-09-05", "engine", "abc123", "cfg2"));
        assert_ne!(a, run_id("agentbox", "2026-09-06", "engine", "abc123", "cfg1"));
        assert_ne!(a, run_id("other", "2026-09-05", "engine", "abc123", "cfg1"));
    }

    #[test]
    fn evaluator_identity_digests_the_command() {
        let id = EvaluatorIdentity::from_spec("tests", &spec("cargo test", true));
        assert_eq!(id.command_digest, digest(b"cargo test"));
        let changed = EvaluatorIdentity::from_spec("tests", &spec("cargo test --release", true));
        assert_ne!(id.command_digest, changed.command_digest);
    }

    #[test]
    fn required_filters_by_deep_and_requirement() {
        let mut m = manifest_for("abc123");
        m.evaluators.push(EvaluatorIdentity {
            name: "other-deep".into(),
            command: "true".into(),
            command_digest: digest(b"true"),
            required: true,
            deeps: vec!["hooks".into()],
            timeout_secs: 60,
        });
        let required: Vec<&str> = m.required().iter().map(|e| e.name.as_str()).collect();
        assert_eq!(required, vec!["tests"], "lint is advisory, other-deep is a different slot");
    }

    #[test]
    fn evaluator_order_is_stable_regardless_of_map_order() {
        let a = manifest_for("abc123");
        let b = manifest_for("abc123");
        let names: Vec<&str> = a.evaluators.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["lint", "tests"], "HashMap order must not leak into the document");
        assert_eq!(a.evaluators, b.evaluators);
    }

    /// A restart rebuilds the manifest and stamps a new `created_at`. That must
    /// not read as a different experiment, or every resumed night would archive
    /// its own predecessor and start over.
    #[test]
    fn the_digest_ignores_the_timestamp_but_not_the_content() {
        let mut a = manifest_for("abc123");
        let mut b = manifest_for("abc123");
        b.created_at = "2027-01-01T00:00:00Z".into();
        assert_eq!(a.digest(), b.digest());
        a.baseline_tree_hash = "different".into();
        assert_ne!(a.digest(), b.digest());
    }

    #[test]
    fn freeze_writes_once_and_resumes_identically() {
        let dir = tempfile::tempdir().unwrap();
        let m = manifest_for("abc123");
        assert_eq!(freeze(dir.path(), &m).unwrap(), Freeze::Written);
        assert_eq!(freeze(dir.path(), &m).unwrap(), Freeze::Resumed);
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded, m, "the frozen document round-trips byte-for-byte");
    }

    #[test]
    fn freeze_archives_a_diverged_manifest_instead_of_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let first = manifest_for("abc123");
        freeze(dir.path(), &first).unwrap();
        let second = manifest_for("def456");
        match freeze(dir.path(), &second).unwrap() {
            Freeze::Diverged { previous } => assert_eq!(previous, first.run_id),
            other => panic!("expected divergence, got {other:?}"),
        }
        assert!(
            dir.path().join(format!("manifest-{}.json", first.run_id)).exists(),
            "the superseded manifest must survive as evidence"
        );
        assert_eq!(load(dir.path()).unwrap().baseline_revision, "def456");
    }

    #[test]
    fn write_atomic_replaces_content_wholesale() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.json");
        write_atomic(&p, b"first").unwrap();
        write_atomic(&p, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "second");
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "no temporary files left behind"
        );
    }
}
