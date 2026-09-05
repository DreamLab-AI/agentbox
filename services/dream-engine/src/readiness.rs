//! Evaluator-readiness admission — refuse the nomination before scheduling.
//!
//! ADR-072 (historical, proposed) and the ADR-2024 closeout both ask for the
//! same thing: a nomination whose evaluators are unusable must be refused
//! *before* the night is scheduled, not discovered after an annexe clone, a
//! build and a model call. The estate review reproduced the gap — the existing
//! validation "accepts an empty evaluator map, an inline echo command and a
//! nonexistent script command".
//!
//! This module is that admission gate. It is static: it reads the config and
//! the checked-out tree, runs nothing, and returns a typed disposition. The
//! refusal verdict is [`crate::verdict::Verdict::Handoff`] — the night is
//! handed back to a human, and because no evaluator ran it is not evidence
//! about the repository and never counts toward a dry streak.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::DreamConfig;

/// A specific way an evaluator is unusable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Unusable {
    /// The config declares no evaluators at all.
    NoEvaluators,
    /// Evaluators exist, but none of them covers tonight's deep.
    NoEvaluatorForDeep { deep: String },
    /// Evaluators cover the deep, but none of them is required — nothing could
    /// ever veto, so acceptance would be unfalsifiable.
    NoRequiredEvaluatorForDeep { deep: String },
    EmptyCommand { name: String },
    /// The command invokes a script that is not in the checked-out tree, so it
    /// cannot run on the annexe clone (which is `git archive HEAD`).
    MissingScript { name: String, path: String },
    /// The command cannot produce surface-dependent output — an `echo`, a
    /// `true`, a bare `:`. Green every night, informative never.
    NonProbativeCommand { name: String, command: String },
    /// A darwin entrypoint without `--sandbox mock|agent` (ADR-065). Config
    /// validation already rejects this at load; re-checked here so the
    /// admission report is complete on its own terms.
    DarwinSandboxMissing { name: String },
}

impl Unusable {
    pub fn describe(&self) -> String {
        match self {
            Unusable::NoEvaluators => "the repo declares no evaluatorEntrypoints at all".into(),
            Unusable::NoEvaluatorForDeep { deep } => {
                format!("no evaluator covers tonight's deep {deep:?}")
            }
            Unusable::NoRequiredEvaluatorForDeep { deep } => format!(
                "every evaluator covering deep {deep:?} is advisory — nothing could veto an ACCEPT"
            ),
            Unusable::EmptyCommand { name } => format!("evaluator {name:?} has an empty command"),
            Unusable::MissingScript { name, path } => {
                format!("evaluator {name:?} runs {path:?}, which is not in the checked-out tree")
            }
            Unusable::NonProbativeCommand { name, command } => format!(
                "evaluator {name:?} is non-probative ({command:?}): it cannot produce \
                 surface-dependent output, so it would pass every night regardless"
            ),
            Unusable::DarwinSandboxMissing { name } => format!(
                "evaluator {name:?} is a @metaharness/darwin entrypoint without \
                 --sandbox mock|agent (ADR-065)"
            ),
        }
    }
}

/// The admission ruling for one repo-night.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessReport {
    pub repo: String,
    pub deep: String,
    /// Names of the required evaluators that cover this deep.
    pub required: Vec<String>,
    /// Names of the advisory evaluators that cover this deep.
    pub advisory: Vec<String>,
    pub problems: Vec<Unusable>,
}

impl ReadinessReport {
    /// True when the night may be scheduled.
    pub fn admitted(&self) -> bool {
        self.problems.is_empty()
    }

    /// A single-line refusal reason for the ledger and the operator inbox.
    pub fn refusal(&self) -> String {
        self.problems
            .iter()
            .map(|p| p.describe())
            .collect::<Vec<_>>()
            .join("; ")
    }
}

/// Commands that produce no surface-dependent output whatever the tree says.
fn is_non_probative(command: &str) -> bool {
    // Split on the shell's sequencing operators and judge each segment. A
    // command is non-probative only if EVERY segment is inert.
    let segments: Vec<&str> = command
        .split("&&")
        .flat_map(|s| s.split("||"))
        .flat_map(|s| s.split(';'))
        .flat_map(|s| s.split('|'))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if segments.is_empty() {
        return true;
    }
    segments.iter().all(|seg| {
        let first = seg.split_whitespace().next().unwrap_or("");
        matches!(first, "echo" | "true" | ":" | "printf" | "cat")
            // `cat file` reads the tree, so it IS surface-dependent; only a
            // bare `cat` (or one fed a heredoc) is inert.
            && !(first == "cat" && seg.split_whitespace().count() > 1)
    })
}

/// Extract script-like paths a command depends on.
///
/// Conservative on purpose: only tokens that look unmistakably like a
/// repo-relative script (a path separator or an explicit `./`, plus a known
/// script extension) are checked. Anything ambiguous is left alone rather than
/// producing a false refusal.
fn script_paths(command: &str) -> Vec<String> {
    const EXTS: [&str; 5] = [".sh", ".py", ".mjs", ".cjs", ".js"];
    command
        .split_whitespace()
        .map(|t| t.trim_matches(|c| c == '"' || c == '\'' || c == ';' || c == ')' || c == '('))
        .filter(|t| !t.starts_with('-') && !t.contains("://"))
        .filter(|t| t.starts_with("./") || t.contains('/'))
        .filter(|t| EXTS.iter().any(|e| t.ends_with(e)))
        .map(|t| t.trim_start_matches("./").to_string())
        .collect()
}

/// Directories a command `cd`s into, so a relative script path can be resolved
/// the way the annexe shell would resolve it.
fn cd_prefixes(command: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut tokens = command.split_whitespace().peekable();
    while let Some(t) = tokens.next() {
        if t == "cd" {
            if let Some(dir) = tokens.peek() {
                out.push(dir.trim_matches(|c| c == '"' || c == '\'').to_string());
            }
        }
    }
    out
}

/// Assess whether tonight's nomination may be scheduled.
///
/// `repo_root` is the local checkout; script existence is checked against it
/// because the annexe receives `git archive HEAD` of exactly that tree.
pub fn assess(cfg: &DreamConfig, repo: &str, deep: &str, repo_root: &Path) -> ReadinessReport {
    let mut problems = Vec::new();
    let mut required = Vec::new();
    let mut advisory = Vec::new();

    if cfg.evaluator_entrypoints.is_empty() {
        problems.push(Unusable::NoEvaluators);
        return ReadinessReport {
            repo: repo.into(),
            deep: deep.into(),
            required,
            advisory,
            problems,
        };
    }

    let mut covering: Vec<(&String, &crate::config::EvaluatorSpec)> = cfg
        .evaluator_entrypoints
        .iter()
        .filter(|(_, spec)| spec.covers(deep))
        .collect();
    covering.sort_by(|a, b| a.0.cmp(b.0));

    if covering.is_empty() {
        problems.push(Unusable::NoEvaluatorForDeep { deep: deep.into() });
    }

    for (name, spec) in &covering {
        if spec.required {
            required.push((*name).clone());
        } else {
            advisory.push((*name).clone());
        }

        let cmd = spec.cmd.trim();
        if cmd.is_empty() {
            problems.push(Unusable::EmptyCommand { name: (*name).clone() });
            continue;
        }
        let is_darwin = cmd.contains("@metaharness/darwin") || cmd.contains("metaharness-darwin");
        if is_darwin && !cmd.contains("--sandbox mock") && !cmd.contains("--sandbox agent") {
            problems.push(Unusable::DarwinSandboxMissing { name: (*name).clone() });
        }
        if is_non_probative(cmd) {
            problems.push(Unusable::NonProbativeCommand {
                name: (*name).clone(),
                command: cmd.to_string(),
            });
        }
        let prefixes = cd_prefixes(cmd);
        for script in script_paths(cmd) {
            let found = prefixes.iter().any(|p| {
                let candidate = if p.is_empty() {
                    repo_root.join(&script)
                } else {
                    repo_root.join(p).join(&script)
                };
                candidate.exists()
            });
            if !found {
                problems.push(Unusable::MissingScript {
                    name: (*name).clone(),
                    path: script,
                });
            }
        }
    }

    if problems.is_empty() && required.is_empty() {
        problems.push(Unusable::NoRequiredEvaluatorForDeep { deep: deep.into() });
    }

    ReadinessReport {
        repo: repo.into(),
        deep: deep.into(),
        required,
        advisory,
        problems,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cfg(evaluators: serde_json::Value) -> DreamConfig {
        serde_json::from_value(json!({
            "repo": "DreamLab-AI/agentbox",
            "slots": [
                {"deep": "dream-engine", "scan": []},
                {"deep": "hooks-pipeline", "scan": []}
            ],
            "evaluatorEntrypoints": evaluators
        }))
        .unwrap()
    }

    fn tree_with(files: &[&str]) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for f in files {
            let p = d.path().join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, "#!/bin/bash\n").unwrap();
        }
        d
    }

    #[test]
    fn an_empty_evaluator_map_is_refused() {
        let c = cfg(json!({}));
        let d = tempfile::tempdir().unwrap();
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(!r.admitted());
        assert_eq!(r.problems, vec![Unusable::NoEvaluators]);
    }

    #[test]
    fn an_inline_echo_command_is_refused_as_non_probative() {
        let c = cfg(json!({"fitness": "echo ok"}));
        let d = tempfile::tempdir().unwrap();
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(!r.admitted());
        assert!(
            matches!(r.problems[0], Unusable::NonProbativeCommand { .. }),
            "{:?}",
            r.problems
        );
        // `true` and a bare `:` are the same fault.
        for inert in ["true", ":", "echo a && true", "echo a; echo b"] {
            let r = assess(&cfg(json!({ "f": inert })), "agentbox", "dream-engine", d.path());
            assert!(!r.admitted(), "{inert:?} should be refused");
        }
    }

    #[test]
    fn a_nonexistent_script_command_is_refused() {
        let d = tree_with(&["scripts/present.sh"]);
        let c = cfg(json!({"hooks": "bash scripts/absent.sh"}));
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(!r.admitted());
        assert_eq!(
            r.problems,
            vec![Unusable::MissingScript {
                name: "hooks".into(),
                path: "scripts/absent.sh".into()
            }]
        );
        // The same command with the script present is admitted.
        let c = cfg(json!({"hooks": "bash scripts/present.sh"}));
        assert!(assess(&c, "agentbox", "dream-engine", d.path()).admitted());
    }

    #[test]
    fn a_script_behind_a_cd_resolves_relative_to_that_directory() {
        let d = tree_with(&["services/dream-engine/check.sh"]);
        let c = cfg(json!({"tests": "cd services/dream-engine && bash ./check.sh"}));
        assert!(assess(&c, "agentbox", "dream-engine", d.path()).admitted());
    }

    #[test]
    fn a_wrong_deep_evaluator_leaves_the_night_with_nothing_to_run() {
        let d = tempfile::tempdir().unwrap();
        let c = cfg(json!({
            "hooks": {"cmd": "cargo test", "deeps": ["hooks-pipeline"]}
        }));
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(!r.admitted());
        assert_eq!(
            r.problems,
            vec![Unusable::NoEvaluatorForDeep { deep: "dream-engine".into() }]
        );
        // ...but the deep it does cover is admitted.
        assert!(assess(&c, "agentbox", "hooks-pipeline", d.path()).admitted());
    }

    #[test]
    fn an_all_advisory_roster_cannot_veto_and_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let c = cfg(json!({"lint": {"cmd": "cargo clippy", "required": false}}));
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(!r.admitted());
        assert_eq!(
            r.problems,
            vec![Unusable::NoRequiredEvaluatorForDeep { deep: "dream-engine".into() }]
        );
    }

    #[test]
    fn a_real_command_is_admitted_and_reports_its_roster() {
        let d = tempfile::tempdir().unwrap();
        let c = cfg(json!({
            "tests": "cd services/dream-engine && cargo test 2>&1 | tail -15",
            "lint": {"cmd": "cargo clippy", "required": false}
        }));
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(r.admitted(), "{:?}", r.problems);
        assert_eq!(r.required, vec!["tests".to_string()]);
        assert_eq!(r.advisory, vec!["lint".to_string()]);
    }

    #[test]
    fn darwin_without_a_sandbox_flag_is_refused_at_admission_too() {
        let d = tempfile::tempdir().unwrap();
        // Built directly: DreamConfig::load would already have rejected this,
        // so admission must not depend on load-time validation having run.
        let mut c = cfg(json!({"tests": "cargo test"}));
        c.evaluator_entrypoints.insert(
            "darwin".into(),
            crate::config::EvaluatorSpec::command("npx -y @metaharness/darwin evolve ."),
        );
        let r = assess(&c, "agentbox", "dream-engine", d.path());
        assert!(!r.admitted());
        assert!(
            r.problems.contains(&Unusable::DarwinSandboxMissing { name: "darwin".into() }),
            "{:?}",
            r.problems
        );
    }

    #[test]
    fn cat_of_a_file_is_surface_dependent_but_a_bare_cat_is_not() {
        assert!(!is_non_probative("cat Cargo.toml"));
        assert!(is_non_probative("cat"));
        assert!(!is_non_probative("cargo test"));
    }
}
