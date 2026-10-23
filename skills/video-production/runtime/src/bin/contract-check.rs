//! Gate-ledger checker: traceability, package paths and honest verdicts.
//!
//! Usage: `contract-check [--require-pass] MANIFEST PACKAGE_ROOT`.
//!
//! A manifest links requirements to expectations, tasks and gates, and records
//! a verdict for every gate and expectation: `PASS`, `FAIL`, `BLOCKED`,
//! `NOT_RUN` or `NOT_APPLICABLE`. A `PASS` must carry an evidence file that
//! exists inside the package root (symlink-safe) and whose SHA-256 matches the
//! recorded hash. `NOT_RUN` and `BLOCKED` never count as a pass.
//!
//! The report separates `valid` (the manifest is well formed and every claim
//! it makes is backed) from `passed` (every verdict is a PASS, or a justified
//! NOT_APPLICABLE, with at least one PASS). Exit status: 1 when invalid; 2 when
//! valid but not passed and `--require-pass` is given; otherwise 0.
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: String,
    artifacts: Vec<Artifact>,
    requirements: Vec<Requirement>,
    expectations: Vec<Expectation>,
    tasks: Vec<Task>,
    gates: Vec<Gate>,
    adr: Option<Adr>,
}

/// The outcome recorded for a gate or expectation.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Verdict {
    Pass,
    Fail,
    Blocked,
    NotRun,
    NotApplicable,
}

impl Verdict {
    fn name(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::Blocked => "BLOCKED",
            Self::NotRun => "NOT_RUN",
            Self::NotApplicable => "NOT_APPLICABLE",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Evidence {
    path: String,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    id: String,
    path: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Requirement {
    id: String,
    expectations: Vec<String>,
    tasks: Vec<String>,
    gates: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Expectation {
    id: String,
    requirement: String,
    category: String,
    regression_critical: bool,
    verification: Verdict,
    evidence: Option<Evidence>,
    reason: Option<String>,
    tests: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Task {
    id: String,
    requires: Vec<String>,
    status: String,
    implementation_paths: Vec<String>,
    checks: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Gate {
    id: String,
    kind: String,
    automated: bool,
    verdict: Verdict,
    evidence: Option<Evidence>,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Adr {
    id: String,
    status: String,
    verified_commit: Option<String>,
    verified_paths: Vec<String>,
    describes_implemented_runtime: bool,
}

/// Check every existing ancestor so a future path cannot hide a symlink escape.
/// The caller provides a canonical package root; paths must be portable relative
/// paths with normal components only. No filesystem content is modified.
fn package_path(root: &Path, path: &str, required: bool, file: bool) -> Result<(), String> {
    let relative = Path::new(path);
    if path.is_empty()
        || path.contains('\\')
        || relative.is_absolute()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(format!("unsafe package path: {path}"));
    }
    let mut candidate = root.to_path_buf();
    for component in relative.components() {
        candidate.push(component);
        match fs::symlink_metadata(&candidate) {
            Ok(_) => {
                let resolved = fs::canonicalize(&candidate)
                    .map_err(|error| format!("cannot resolve package path {path}: {error}"))?;
                if !resolved.starts_with(root) {
                    return Err(format!("package path escapes root through symlink: {path}"));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("cannot inspect package path {path}: {error}")),
        }
    }
    if required && !candidate.exists() {
        return Err(format!("missing package path: {path}"));
    }
    if file && !candidate.is_file() {
        return Err(format!("artifact must be a file: {path}"));
    }
    Ok(())
}

fn links(
    owner: &str,
    kind: &str,
    values: &[String],
    available: &BTreeSet<&str>,
    required: bool,
    errors: &mut Vec<String>,
) {
    if required && values.is_empty() {
        errors.push(format!("{owner} has no {kind} links"));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        if !available.contains(value.as_str()) {
            errors.push(format!("{owner} has dangling {kind} link: {value}"));
        }
        if !seen.insert(value) {
            errors.push(format!("{owner} repeats {kind} link: {value}"));
        }
    }
}

/// SHA-256 of an in-package file as lower-case hex.
fn file_digest(root: &Path, relative: &str) -> Result<String, String> {
    let bytes = fs::read(root.join(relative))
        .map_err(|error| format!("cannot read {relative}: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// Validate one verdict and its evidence; returns whether it is a *backed* PASS.
fn check_verdict(
    root: &Path,
    owner: &str,
    verdict: Verdict,
    evidence: Option<&Evidence>,
    reason: Option<&str>,
    errors: &mut Vec<String>,
) -> bool {
    let reasoned = reason.is_some_and(|text| !text.trim().is_empty());
    match verdict {
        Verdict::Pass if evidence.is_none() => {
            errors.push(format!("{owner} is PASS without evidence path and hash"));
        }
        Verdict::Fail | Verdict::Blocked | Verdict::NotApplicable if !reasoned => {
            errors.push(format!("{owner} is {} without a reason", verdict.name()));
        }
        _ => {}
    }
    let Some(evidence) = evidence else {
        return false;
    };
    if let Err(error) = package_path(root, &evidence.path, true, true) {
        errors.push(format!("{owner} evidence: {error}"));
        return false;
    }
    let claimed = &evidence.sha256;
    if claimed.len() != 64 || !claimed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        errors.push(format!("{owner} evidence hash is not a SHA-256"));
        return false;
    }
    match file_digest(root, &evidence.path) {
        Ok(actual) if actual.eq_ignore_ascii_case(claimed) => verdict == Verdict::Pass,
        Ok(_) => {
            errors.push(format!(
                "{owner} evidence hash does not match {}",
                evidence.path
            ));
            false
        }
        Err(error) => {
            errors.push(format!("{owner} evidence: {error}"));
            false
        }
    }
}

struct Outcome {
    errors: Vec<String>,
    verdicts: BTreeMap<Verdict, usize>,
    passed: bool,
}

fn validate(manifest: &Manifest, package_root: &Path) -> Outcome {
    let mut errors = Vec::new();
    let mut verdicts: BTreeMap<Verdict, usize> = BTreeMap::new();
    let mut unbacked = false;
    if manifest.schema != "contract-check/1" {
        errors.push("unsupported manifest schema".into());
    }
    let root = match fs::canonicalize(package_root) {
        Ok(path) if path.is_dir() => path,
        _ => {
            return Outcome {
                errors: vec!["package root must be an existing directory".into()],
                verdicts,
                passed: false,
            };
        }
    };
    for (name, empty) in [
        ("artifacts", manifest.artifacts.is_empty()),
        ("requirements", manifest.requirements.is_empty()),
        ("expectations", manifest.expectations.is_empty()),
        ("tasks", manifest.tasks.is_empty()),
        ("gates", manifest.gates.is_empty()),
    ] {
        if empty {
            errors.push(format!("manifest has no {name}"));
        }
    }
    let mut global_ids = BTreeSet::new();
    for id in manifest
        .artifacts
        .iter()
        .map(|row| &row.id)
        .chain(manifest.requirements.iter().map(|row| &row.id))
        .chain(manifest.expectations.iter().map(|row| &row.id))
        .chain(manifest.tasks.iter().map(|row| &row.id))
        .chain(manifest.gates.iter().map(|row| &row.id))
        .chain(manifest.adr.iter().map(|adr| &adr.id))
    {
        if id.trim().is_empty() || !global_ids.insert(id.as_str()) {
            errors.push(format!("empty or globally duplicate ID: {id}"));
        }
    }
    let expectations: BTreeMap<_, _> = manifest
        .expectations
        .iter()
        .map(|row| (row.id.as_str(), row))
        .collect();
    let requirements: BTreeMap<_, _> = manifest
        .requirements
        .iter()
        .map(|row| (row.id.as_str(), row))
        .collect();
    let expectation_ids = expectations.keys().copied().collect();
    let task_ids = manifest.tasks.iter().map(|row| row.id.as_str()).collect();
    let gate_ids = manifest.gates.iter().map(|row| row.id.as_str()).collect();
    for requirement in &manifest.requirements {
        for (kind, values, available) in [
            ("expectation", &requirement.expectations, &expectation_ids),
            ("task", &requirement.tasks, &task_ids),
            ("gate", &requirement.gates, &gate_ids),
        ] {
            links(&requirement.id, kind, values, available, true, &mut errors);
        }
        for id in &requirement.expectations {
            if let Some(expectation) = expectations.get(id.as_str())
                && expectation.requirement != requirement.id
            {
                errors.push(format!(
                    "{} expectation link is not bidirectional: {id}",
                    requirement.id
                ));
            }
        }
    }
    for expectation in &manifest.expectations {
        if !requirements
            .get(expectation.requirement.as_str())
            .is_some_and(|requirement| requirement.expectations.contains(&expectation.id))
        {
            errors.push(format!(
                "orphan expectation or missing reverse requirement link: {}",
                expectation.id
            ));
        }
        if expectation.category.trim().is_empty() {
            errors.push(format!("{} requires a category", expectation.id));
        }
        if (expectation.regression_critical && expectation.tests.is_empty())
            || expectation.tests.iter().any(|name| name.trim().is_empty())
        {
            errors.push(format!(
                "{} lacks named tests for its critical regression expectation",
                expectation.id
            ));
        }
        *verdicts.entry(expectation.verification).or_default() += 1;
        let backed = check_verdict(
            &root,
            &expectation.id,
            expectation.verification,
            expectation.evidence.as_ref(),
            expectation.reason.as_deref(),
            &mut errors,
        );
        unbacked |= expectation.verification == Verdict::Pass && !backed;
    }
    for artifact in &manifest.artifacts {
        if artifact.status.trim().is_empty() {
            errors.push(format!("{} artifact has empty status", artifact.id));
        }
        if let Err(error) = package_path(&root, &artifact.path, true, true) {
            errors.push(format!("{}: {error}", artifact.id));
        }
    }
    for gate in &manifest.gates {
        if gate.kind.trim().is_empty() {
            errors.push(format!("{} gate has no kind", gate.id));
        }
        *verdicts.entry(gate.verdict).or_default() += 1;
        let backed = check_verdict(
            &root,
            &gate.id,
            gate.verdict,
            gate.evidence.as_ref(),
            gate.reason.as_deref(),
            &mut errors,
        );
        unbacked |= gate.verdict == Verdict::Pass && !backed;
    }
    let mut indegrees: BTreeMap<_, usize> = manifest
        .tasks
        .iter()
        .map(|task| (task.id.as_str(), 0))
        .collect();
    let mut dependants: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for task in &manifest.tasks {
        links(
            &task.id,
            "task dependency",
            &task.requires,
            &task_ids,
            false,
            &mut errors,
        );
        if ![
            "planned",
            "partial",
            "implemented",
            "verified",
            "blocked",
            "deferred",
        ]
        .contains(&task.status.as_str())
        {
            errors.push(format!("{} has unsupported task status", task.id));
        }
        let claims_done = ["implemented", "verified"].contains(&task.status.as_str());
        if claims_done && (task.implementation_paths.is_empty() || task.checks.is_empty()) {
            errors.push(format!(
                "{} premature implemented claim: paths and named checks are required",
                task.id
            ));
        }
        if task.checks.iter().any(|name| name.trim().is_empty()) {
            errors.push(format!("{} has an empty check name", task.id));
        }
        for path in &task.implementation_paths {
            if let Err(error) = package_path(&root, path, claims_done, false) {
                errors.push(format!("{}: {error}", task.id));
            }
        }
        for dependency in task.requires.iter().collect::<BTreeSet<_>>() {
            if task_ids.contains(dependency.as_str()) {
                *indegrees.get_mut(task.id.as_str()).unwrap() += 1;
                dependants
                    .entry(dependency.as_str())
                    .or_default()
                    .push(task.id.as_str());
            }
        }
    }
    let mut ready: VecDeque<_> = indegrees
        .iter()
        .filter_map(|(&id, &count)| (count == 0).then_some(id))
        .collect();
    let mut visited = 0;
    while let Some(id) = ready.pop_front() {
        visited += 1;
        for dependant in dependants.get(id).into_iter().flatten() {
            let count = indegrees.get_mut(dependant).unwrap();
            *count -= 1;
            if *count == 0 {
                ready.push_back(*dependant);
            }
        }
    }
    if visited != indegrees.len() {
        errors.push("task dependency cycle".into());
    }
    let all_gates_pass = manifest
        .gates
        .iter()
        .all(|gate| matches!(gate.verdict, Verdict::Pass | Verdict::NotApplicable));
    if let Some(adr) = &manifest.adr {
        if !["proposed", "accepted", "superseded", "rejected"].contains(&adr.status.as_str()) {
            errors.push(format!("{} has unsupported ADR status", adr.id));
        }
        let claims_proof = adr.status == "accepted" || adr.describes_implemented_runtime;
        if adr.status == "proposed" && adr.describes_implemented_runtime {
            errors.push(format!(
                "{} is proposed but claims implemented runtime",
                adr.id
            ));
        }
        if claims_proof {
            let commit_ok = adr.verified_commit.as_deref().is_some_and(|commit| {
                commit.len() == 40
                    && commit
                        .bytes()
                        .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
            });
            if !commit_ok || adr.verified_paths.is_empty() {
                errors.push(format!(
                    "{} claims acceptance or runtime without a 40-hex verified_commit and verified_paths",
                    adr.id
                ));
            }
            for path in &adr.verified_paths {
                if let Err(error) = package_path(&root, path, true, true) {
                    errors.push(format!("{}: {error}", adr.id));
                }
            }
            if adr.describes_implemented_runtime && !all_gates_pass {
                errors.push(format!(
                    "{} describes implemented runtime while a gate is not PASS or NOT_APPLICABLE",
                    adr.id
                ));
            }
        }
    }
    let count = |verdict| verdicts.get(&verdict).copied().unwrap_or(0);
    let passed = errors.is_empty()
        && !unbacked
        && count(Verdict::Fail) + count(Verdict::Blocked) + count(Verdict::NotRun) == 0
        && count(Verdict::Pass) > 0;
    Outcome {
        errors,
        verdicts,
        passed,
    }
}

fn run(args: &[PathBuf]) -> serde_json::Value {
    let result = (|| -> Result<Manifest, String> {
        if args.len() != 2 {
            return Err("usage: contract-check [--require-pass] MANIFEST PACKAGE_ROOT".into());
        }
        let bytes = fs::read(&args[0]).map_err(|error| format!("read manifest: {error}"))?;
        serde_json::from_slice(&bytes).map_err(|error| format!("parse manifest: {error}"))
    })();
    let (outcome, counts) = match result {
        Ok(manifest) => (
            validate(&manifest, &args[1]),
            json!({"artifacts":manifest.artifacts.len(),"requirements":manifest.requirements.len(),
                "expectations":manifest.expectations.len(),"tasks":manifest.tasks.len(),
                "gates":manifest.gates.len(),"automated_gates_declared":manifest.gates.iter().filter(|gate|gate.automated).count()}),
        ),
        Err(error) => (
            Outcome {
                errors: vec![error],
                verdicts: BTreeMap::new(),
                passed: false,
            },
            serde_json::Value::Null,
        ),
    };
    let verdict_counts: serde_json::Map<_, _> = [
        Verdict::Pass,
        Verdict::Fail,
        Verdict::Blocked,
        Verdict::NotRun,
        Verdict::NotApplicable,
    ]
    .into_iter()
    .map(|verdict| {
        (
            verdict.name().to_owned(),
            json!(outcome.verdicts.get(&verdict).copied().unwrap_or(0)),
        )
    })
    .collect();
    json!({"schema":"contract-check-report/1","valid":outcome.errors.is_empty(),
        "passed":outcome.passed,
        "scope":"Gate ledger: package paths, traceability, dependency DAG, hash-backed PASS evidence. Evidence is verified for existence and hash only; the checker does not re-run any gate.",
        "verdict_counts":verdict_counts,"counts":counts,"errors":outcome.errors})
}

fn main() {
    let mut args: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    let require_pass = args
        .iter()
        .position(|arg| arg.as_os_str() == "--require-pass")
        .map(|index| args.remove(index))
        .is_some();
    let report = run(&args);
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    if report["valid"] != true {
        std::process::exit(1);
    }
    if require_pass && report["passed"] != true {
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        base: PathBuf,
        root: PathBuf,
        manifest: serde_json::Value,
    }

    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let base =
                std::env::temp_dir().join(format!("contract-check-{}-{nonce}", std::process::id()));
            let root = base.join("package");
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("design.md"), "Design\n").unwrap();
            fs::write(root.join("evidence.txt"), "gate output\n").unwrap();
            Self {
                base,
                root,
                manifest: json!({"schema":"contract-check/1",
                    "artifacts":[{"id":"DOC-1","path":"design.md","status":"design-ready"}],
                    "requirements":[{"id":"REQ-1","expectations":["EXP-1"],"tasks":["TASK-1"],"gates":["GATE-1","GATE-2"]}],
                    "expectations":[{"id":"EXP-1","requirement":"REQ-1","category":"continuity","regression_critical":true,"verification":"NOT_RUN","tests":["continuous_cut"]}],
                    "tasks":[{"id":"TASK-1","requires":[],"status":"planned","implementation_paths":["future/module.rs"],"checks":["continuous_cut"]}],
                    "gates":[
                        {"id":"GATE-1","kind":"integration","automated":true,"verdict":"NOT_RUN"},
                        {"id":"GATE-2","kind":"review","automated":false,"verdict":"NOT_RUN"}],
                    "adr":{"id":"ADR-1","status":"proposed","verified_commit":null,"verified_paths":[],"describes_implemented_runtime":false}}),
            }
        }

        fn evidence(&self) -> serde_json::Value {
            json!({"path":"evidence.txt","sha256":digest(b"gate output\n")})
        }

        /// Mark every verdict PASS with real evidence.
        fn all_pass(&mut self) {
            let evidence = self.evidence();
            self.manifest["expectations"][0]["verification"] = json!("PASS");
            self.manifest["expectations"][0]["evidence"] = evidence.clone();
            for gate in 0..2 {
                self.manifest["gates"][gate]["verdict"] = json!("PASS");
                self.manifest["gates"][gate]["evidence"] = evidence.clone();
            }
        }

        fn outcome(&self) -> Outcome {
            validate(
                &serde_json::from_value(self.manifest.clone()).unwrap(),
                &self.root,
            )
        }

        fn errors(&self) -> Vec<String> {
            self.outcome().errors
        }

        fn rejects(&self, message: &str) {
            let errors = self.errors();
            assert!(
                errors.iter().any(|error| error.contains(message)),
                "expected {message:?}, got {errors:?}"
            );
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.base).unwrap();
        }
    }

    #[test]
    fn not_run_ledger_is_valid_but_never_passed() {
        let fixture = Fixture::new();
        let outcome = fixture.outcome();
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert!(!outcome.passed);
        let path = fixture.base.join("manifest.json");
        fs::write(&path, serde_json::to_vec(&fixture.manifest).unwrap()).unwrap();
        let report = run(&[path, fixture.root.clone()]);
        assert_eq!(report["valid"], true);
        assert_eq!(report["passed"], false);
        assert_eq!(report["verdict_counts"]["PASS"], 0);
        assert_eq!(report["verdict_counts"]["NOT_RUN"], 3);
    }

    #[test]
    fn one_pass_beside_a_not_run_gate_is_not_passed() {
        let mut fixture = Fixture::new();
        fixture.all_pass();
        fixture.manifest["gates"][1]["verdict"] = json!("NOT_RUN");
        fixture.manifest["gates"][1]["evidence"] = json!(null);
        let outcome = fixture.outcome();
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert!(!outcome.passed, "NOT_RUN must never count as PASS");
        assert_eq!(outcome.verdicts[&Verdict::Pass], 2); // gate 1 and the expectation
        assert_eq!(outcome.verdicts[&Verdict::NotRun], 1);
    }

    #[test]
    fn blocked_and_failed_gates_do_not_pass_and_need_reasons() {
        for verdict in ["BLOCKED", "FAIL"] {
            let mut fixture = Fixture::new();
            fixture.all_pass();
            fixture.manifest["gates"][1]["verdict"] = json!(verdict);
            fixture.manifest["gates"][1]["evidence"] = json!(null);
            fixture.rejects("without a reason");
            fixture.manifest["gates"][1]["reason"] = json!("waiting on a render");
            let outcome = fixture.outcome();
            assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
            assert!(!outcome.passed, "{verdict} counted as a pass");
        }
    }

    #[test]
    fn all_backed_passes_pass_and_not_applicable_needs_a_reason() {
        let mut fixture = Fixture::new();
        fixture.all_pass();
        assert!(fixture.outcome().passed);
        fixture.manifest["gates"][1]["verdict"] = json!("NOT_APPLICABLE");
        fixture.manifest["gates"][1]["evidence"] = json!(null);
        fixture.rejects("NOT_APPLICABLE without a reason");
        fixture.manifest["gates"][1]["reason"] = json!("no audio in this cut");
        let outcome = fixture.outcome();
        assert!(outcome.errors.is_empty() && outcome.passed);
    }

    #[test]
    fn pass_requires_existing_evidence_and_a_matching_hash() {
        let mut fixture = Fixture::new();
        fixture.all_pass();
        fixture.manifest["gates"][0]["evidence"] = json!(null);
        fixture.rejects("PASS without evidence");
        assert!(!fixture.outcome().passed);
        fixture.manifest["gates"][0]["evidence"] =
            json!({"path":"absent.txt","sha256":digest(b"x")});
        fixture.rejects("missing package path");
        fixture.manifest["gates"][0]["evidence"] =
            json!({"path":"evidence.txt","sha256":digest(b"other bytes")});
        fixture.rejects("evidence hash does not match");
        assert!(!fixture.outcome().passed);
        fixture.manifest["gates"][0]["evidence"] =
            json!({"path":"evidence.txt","sha256":"not-a-hash"});
        fixture.rejects("not a SHA-256");
        fixture.manifest["gates"][0]["evidence"] = json!({"path":"evidence.txt","sha256":""});
        fixture.rejects("not a SHA-256");
    }

    #[test]
    fn evidence_cannot_be_a_directory_or_escape_the_root() {
        let mut fixture = Fixture::new();
        fixture.all_pass();
        fs::create_dir(fixture.root.join("dir")).unwrap();
        fixture.manifest["gates"][0]["evidence"] = json!({"path":"dir","sha256":digest(b"")});
        fixture.rejects("artifact must be a file");
        fixture.manifest["gates"][0]["evidence"] =
            json!({"path":"../outside.txt","sha256":digest(b"")});
        fixture.rejects("unsafe package path");
    }

    #[test]
    fn dangling_requirement_links_are_rejected_by_type() {
        for (field, kind) in [
            ("expectations", "expectation"),
            ("tasks", "task"),
            ("gates", "gate"),
        ] {
            let mut fixture = Fixture::new();
            fixture.manifest["requirements"][0][field] = json!(["UNKNOWN"]);
            fixture.rejects(&format!("dangling {kind} link"));
        }
    }

    #[test]
    fn critical_tests_and_bidirectional_links_are_required() {
        let mut fixture = Fixture::new();
        fixture.manifest["expectations"][0]["tests"] = json!([]);
        fixture.rejects("lacks named tests");
        fixture.manifest["expectations"][0]["requirement"] = json!("UNKNOWN");
        fixture.rejects("orphan expectation");
        fixture.rejects("not bidirectional");
        fixture.manifest["requirements"][0]["expectations"] = json!([]);
        fixture.rejects("has no expectation links");
    }

    #[test]
    fn ids_are_unique_across_collections() {
        let mut fixture = Fixture::new();
        fixture.manifest["adr"]["id"] = json!("REQ-1");
        fixture.rejects("globally duplicate ID");
    }

    #[test]
    fn dependency_cycle_and_dangling_dependency_are_rejected() {
        let mut fixture = Fixture::new();
        fixture.manifest["tasks"][0]["requires"] = json!(["TASK-2"]);
        fixture.rejects("dangling task dependency");
        let mut second = fixture.manifest["tasks"][0].clone();
        second["id"] = json!("TASK-2");
        second["requires"] = json!(["TASK-1"]);
        fixture.manifest["tasks"]
            .as_array_mut()
            .unwrap()
            .push(second);
        fixture.rejects("task dependency cycle");
        fixture.manifest["tasks"][1]["requires"] = json!([]);
        assert!(fixture.errors().is_empty());
    }

    #[test]
    fn artifacts_must_exist_and_be_files() {
        let mut fixture = Fixture::new();
        fixture.manifest["artifacts"][0]["path"] = json!("absent.md");
        fixture.rejects("missing package path");
        fs::create_dir(fixture.root.join("directory")).unwrap();
        fixture.manifest["artifacts"][0]["path"] = json!("directory");
        fixture.rejects("artifact must be a file");
    }

    #[test]
    fn unsafe_paths_are_rejected_even_for_future_tasks() {
        for path in [
            "../outside",
            "/tmp/absolute",
            "nested/../../outside",
            "",
            ".",
        ] {
            let mut fixture = Fixture::new();
            fixture.manifest["tasks"][0]["implementation_paths"] = json!([path]);
            fixture.rejects("unsafe package path");
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected_for_artifacts_evidence_and_future_paths() {
        let mut fixture = Fixture::new();
        fs::write(fixture.base.join("outside.md"), "outside").unwrap();
        std::os::unix::fs::symlink(&fixture.base, fixture.root.join("escape")).unwrap();
        fixture.manifest["artifacts"][0]["path"] = json!("escape/outside.md");
        fixture.rejects("escapes root through symlink");
        fixture.manifest["artifacts"][0]["path"] = json!("design.md");
        fixture.manifest["tasks"][0]["implementation_paths"] = json!(["escape/future.rs"]);
        fixture.rejects("escapes root through symlink");
        fixture.manifest["tasks"][0]["implementation_paths"] = json!([]);
        fixture.all_pass();
        fixture.manifest["gates"][0]["evidence"] =
            json!({"path":"escape/outside.md","sha256":digest(b"outside")});
        fixture.rejects("escapes root through symlink");
        assert!(!fixture.outcome().passed);
    }

    #[test]
    fn task_statuses_beyond_planned_are_accepted_with_proof() {
        let mut fixture = Fixture::new();
        for status in ["partial", "blocked", "deferred"] {
            fixture.manifest["tasks"][0]["status"] = json!(status);
            assert!(fixture.errors().is_empty(), "{status}");
        }
        fixture.manifest["tasks"][0]["status"] = json!("bogus");
        fixture.rejects("unsupported task status");
        for status in ["implemented", "verified"] {
            fixture.manifest["tasks"][0]["status"] = json!(status);
            fixture.manifest["tasks"][0]["implementation_paths"] = json!(["future/module.rs"]);
            fixture.rejects("missing package path");
            fixture.manifest["tasks"][0]["implementation_paths"] = json!([]);
            fixture.rejects("premature implemented claim");
            fixture.manifest["tasks"][0]["implementation_paths"] = json!(["design.md"]);
            fixture.manifest["tasks"][0]["checks"] = json!([]);
            fixture.rejects("premature implemented claim");
            fixture.manifest["tasks"][0]["checks"] = json!(["named_static_check"]);
            assert!(fixture.errors().is_empty(), "{status}");
        }
    }

    #[test]
    fn adr_acceptance_needs_proof_and_runtime_claims_need_passing_gates() {
        let mut fixture = Fixture::new();
        fixture.manifest["adr"]["describes_implemented_runtime"] = json!(true);
        fixture.rejects("is proposed but claims implemented runtime");
        fixture.manifest["adr"]["status"] = json!("accepted");
        fixture.rejects("without a 40-hex verified_commit");
        fixture.manifest["adr"]["verified_commit"] = json!("a".repeat(40));
        fixture.manifest["adr"]["verified_paths"] = json!(["design.md"]);
        fixture.rejects("while a gate is not PASS");
        fixture.all_pass();
        assert!(fixture.errors().is_empty(), "{:?}", fixture.errors());
        fixture.manifest["adr"]["status"] = json!("withdrawn");
        fixture.rejects("unsupported ADR status");
        fixture.manifest["adr"]["status"] = json!("superseded");
        fixture.manifest["adr"]["describes_implemented_runtime"] = json!(false);
        assert!(fixture.errors().is_empty());
        fixture.manifest["adr"] = json!(null);
        assert!(fixture.errors().is_empty(), "the ADR is optional");
    }

    #[test]
    fn unknown_verdicts_are_parse_errors() {
        let mut fixture = Fixture::new();
        fixture.manifest["gates"][0]["verdict"] = json!("planned");
        let path = fixture.base.join("m.json");
        fs::write(&path, serde_json::to_vec(&fixture.manifest).unwrap()).unwrap();
        let report = run(&[path, fixture.root.clone()]);
        assert_eq!(report["valid"], false);
        assert!(
            report["errors"][0]
                .as_str()
                .unwrap()
                .contains("parse manifest")
        );
    }

    #[test]
    fn invocation_and_parse_errors_return_invalid_json_reports() {
        assert_eq!(run(&[])["valid"], false);
        let fixture = Fixture::new();
        assert_eq!(
            run(&[fixture.root.join("missing.json"), fixture.root.clone()])["valid"],
            false
        );
        let path = fixture.root.join("invalid.json");
        fs::write(&path, "{broken").unwrap();
        let report = run(&[path, fixture.root.clone()]);
        assert_eq!(report["valid"], false);
        assert!(
            report["errors"][0]
                .as_str()
                .unwrap()
                .contains("parse manifest")
        );
    }
}
