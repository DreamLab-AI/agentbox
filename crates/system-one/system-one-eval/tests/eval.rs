//! Integration tests: the real corpus, a synthetic skills tree, a stub backend.
//!
//! The corpus under test is the estate's own
//! `tests/system-one/routing-cases.json`, read from disk rather than mocked,
//! so a change to its schema breaks these tests rather than silently changing
//! what the rig measures.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use system_one_eval::client::Backend;
use system_one_eval::copy::{self, CeilingMode, Exposure, Ranker};
use system_one_eval::metrics;
use system_one_eval::runner::{load, run_backend, run_sweep};

/// The repository root, from this crate's manifest directory.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

fn corpus_path() -> PathBuf {
    repo_root().join("tests/system-one/routing-cases.json")
}

/// A skills tree built from the corpus itself: every label becomes a skill
/// whose description names it, with a late boundary clause for half of them.
fn synthetic_skills(dir: &Path) -> Vec<String> {
    let text = std::fs::read_to_string(corpus_path()).unwrap();
    let corpus: Value = serde_json::from_str(&text).unwrap();
    let mut labels: Vec<String> = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["expected_skill"].as_str().unwrap().to_string())
        .filter(|l| l != "none")
        .collect();
    labels.sort();
    labels.dedup();

    for (index, label) in labels.iter().enumerate() {
        let skill_dir = dir.join(label);
        std::fs::create_dir_all(&skill_dir).unwrap();
        // Half the corpus gets a boundary clause beyond the option budget, so
        // the late/early split under test is a real split.
        let filler = if index % 2 == 0 {
            "It covers planning, execution, review and the checked-in artefacts that result, \
             across the whole repository and every downstream consumer of them, end to end. "
        } else {
            ""
        };
        std::fs::write(
            skill_dir.join("SKILL.md"),
            format!(
                "---\nname: {label}\ndescription: Handles {label} work in this repository. \
                 {filler}NOT for anything another skill names explicitly.\nstatus: live\n---\n\n\
                 # {label}\n"
            ),
        )
        .unwrap();
    }
    // A skill the router must never be offered, to prove the status filter.
    let retired = dir.join("retired-thing");
    std::fs::create_dir_all(&retired).unwrap();
    std::fs::write(
        retired.join("SKILL.md"),
        "---\nname: retired-thing\ndescription: Does an old thing.\nstatus: superseded\n---\n",
    )
    .unwrap();
    labels
}

#[derive(Clone)]
struct BackendStub {
    /// Every request body the backend received.
    seen: Arc<Mutex<Vec<Value>>>,
    /// Answer with the expected label for this fraction of calls.
    correct_every: usize,
    /// Emit an `sso` block, as the sovereign façade does.
    with_sso: bool,
    /// Honour `sso.none_threshold`, as a façade over an independently-scoring
    /// engine does: the top option is worth `BEST_SCORE`, and anything above
    /// that declines.
    respects_threshold: bool,
    counter: Arc<Mutex<usize>>,
}

/// The absolute score the threshold-honouring stub gives its top option.
const BEST_SCORE: f64 = 0.6;

async fn systemone(State(stub): State<BackendStub>, Json(body): Json<Value>) -> Json<Value> {
    stub.seen.lock().unwrap().push(body.clone());
    let mut counter = stub.counter.lock().unwrap();
    let index = *counter;
    *counter += 1;
    drop(counter);

    let criteria = body["questions"]["skill"]["criteria"].as_object().unwrap();
    let keys: Vec<&String> = criteria.keys().collect();
    // Deterministic pick: every `correct_every`-th call picks the option whose
    // name appears in the prompt, otherwise the next one along.
    let request = body["state"]["user_request"].as_str().unwrap_or("");
    let matching = keys.iter().position(|k| request.contains(k.as_str()));
    let position = match matching {
        Some(p) if index % stub.correct_every == 0 => p,
        Some(p) => (p + 1) % keys.len(),
        None => index % keys.len(),
    };
    let mut probabilities = serde_json::Map::new();
    for (slot, key) in keys.iter().enumerate() {
        let p = if slot == position {
            0.7
        } else if slot == (position + 1) % keys.len() {
            0.2
        } else {
            0.1 / (keys.len() as f64 - 2.0).max(1.0)
        };
        probabilities.insert((*key).clone(), json!(p));
    }
    let threshold = stub
        .respects_threshold
        .then(|| body["sso"]["none_threshold"].as_f64())
        .flatten();
    let declined = threshold.is_some_and(|t| t > BEST_SCORE) && criteria.contains_key("none");
    let choice = if declined {
        "none".to_string()
    } else {
        keys[position].clone()
    };
    let mut response = json!({
        "model": "stub-laya",
        "answers": {"skill": {
            "choice": choice,
            "confidence": 0.7,
            "probabilities": probabilities,
        }},
        "usage": {"input_tokens": 1234, "output_tokens": 0},
    });
    if stub.with_sso {
        response["sso"] = json!({
            "shortlisted": {"skill": {"from": keys.len(), "to": 8,
                "compressed_option_tokens": {"max": 42, "mean": 37.5}}},

            "engine_ms": 31,
            "facade_ms": 48,
        });
    }
    if let Some(threshold) = threshold {
        response["sso"]["decline"] = json!({"skill": {
            "key": "none", "threshold": threshold, "applied": true,
            "best_score": BEST_SCORE, "fired": declined,
        }});
        response["sso"]["hypotheses_scored"] = json!(keys.len());
    }
    Json(response)
}

async fn spawn(stub: BackendStub) -> SocketAddr {
    let app = Router::new()
        .route("/v1/systemone", post(systemone))
        .with_state(stub);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    addr
}

fn stub(correct_every: usize, with_sso: bool) -> BackendStub {
    BackendStub {
        seen: Arc::new(Mutex::new(Vec::new())),
        correct_every,
        with_sso,
        respects_threshold: false,
        counter: Arc::new(Mutex::new(0)),
    }
}

fn backend(label: &str, addr: SocketAddr, usd: f64) -> Backend {
    Backend {
        label: label.to_string(),
        url: format!("http://127.0.0.1:{}/v1/systemone", addr.port()),
        model: "laya-typed-decisions".into(),
        key: None,
        timeout: std::time::Duration::from_secs(10),
        retries: 0,
        usd_per_mtok_in: usd,
        none_threshold: None,
        shortlist_k: None,
    }
}

struct Tree {
    dir: PathBuf,
}

impl Tree {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("sso-eval-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        synthetic_skills(&dir);
        Self { dir }
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test]
async fn the_real_corpus_loads_and_splits_into_subgroups() {
    let tree = Tree::new("load");
    let loaded = load(&corpus_path(), &tree.dir, None, 44).unwrap();

    assert_eq!(
        loaded.corpus.cases.len(),
        86,
        "the corpus on disk is 86 cases"
    );
    assert!(
        !loaded.corpus.role.is_empty(),
        "the corpus states its own role"
    );
    assert!(
        loaded.unscorable.is_empty(),
        "every label resolves in the synthetic tree"
    );
    assert!(
        !loaded.candidates.contains_key("retired-thing"),
        "a superseded skill is never offered"
    );

    let late = loaded.late.iter().filter(|l| **l).count();
    assert!(
        late > 0 && late < loaded.corpus.cases.len(),
        "the split is a real split: {late}"
    );

    // The corpus's own classes survive into scoring.
    let classes: std::collections::BTreeSet<&str> = loaded
        .corpus
        .cases
        .iter()
        .map(|c| c.class.as_str())
        .collect();
    assert!(classes.contains("near-neighbour"));
    assert!(classes.contains("none"));
}

#[tokio::test]
async fn a_run_reports_accuracy_latency_tokens_cost_and_subgroups() {
    let tree = Tree::new("run");
    let loaded = load(&corpus_path(), &tree.dir, None, 44).unwrap();
    let stub = stub(2, true);
    let addr = spawn(stub.clone()).await;

    let report = run_backend(&loaded, &backend("sso", addr, 0.0), 8)
        .await
        .unwrap();

    assert_eq!(report.overall.n, 86);
    assert_eq!(report.overall.answered, 86, "the stub answered everything");
    assert!(report.failures.is_empty());
    assert_eq!(
        report.model, "stub-laya",
        "the model that ANSWERED is reported"
    );
    assert_eq!(
        report.candidates,
        loaded.candidates.len() + 1,
        "none is offered too"
    );

    assert!(report.overall.accuracy() > 0.0, "the stub gets some right");
    assert!(
        report.overall.soft_accuracy() >= report.overall.accuracy(),
        "top-3 can never be worse than top-1"
    );
    assert_eq!(
        report.mean_input_tokens, 1234,
        "tokens come from the backend"
    );
    assert_eq!(report.total_usd, 0.0, "a local backend costs nothing");
    assert!(report.p95_ms >= report.p50_ms);

    // Both subgroup breakdowns are populated.
    assert!(report.by_discriminator.contains_key("late"));
    assert!(report.by_discriminator.contains_key("early"));
    assert!(report.by_class.contains_key("near-neighbour"));

    // The façade's honesty block is summarised rather than ignored.
    let sso = report.sso.as_ref().expect("sso block summarised");
    assert_eq!(sso.samples, 86);
    assert!((sso.mean_option_tokens - 37.5).abs() < 1e-9);
    assert_eq!(sso.max_option_tokens, 42);
    assert!((sso.mean_options_to - 8.0).abs() < 1e-9);

    // The rendered report mentions the things an operator must not miss.
    let rendered = metrics::render(&report);
    for needle in [
        "accuracy",
        "soft accuracy",
        "p50",
        "by class",
        "late",
        "adaptation",
    ] {
        assert!(
            rendered.contains(needle),
            "report omits `{needle}`:\n{rendered}"
        );
    }

    // And the request really was the router's request.
    let seen = stub.seen.lock().unwrap();
    assert_eq!(seen.len(), 86);
    let question = &seen[0]["questions"]["skill"];
    assert_eq!(question["type"], "choice");
    assert!(question["criteria"]["none"]
        .as_str()
        .unwrap()
        .starts_with("No skill applies"));
    assert!(question["instructions"]
        .as_str()
        .unwrap()
        .starts_with("Which skill should handle `user_request`?"));
    assert!(seen[0]["state"]["user_request"].is_string());
}

#[tokio::test]
async fn cost_is_charged_at_the_backends_price() {
    let tree = Tree::new("cost");
    let loaded = load(&corpus_path(), &tree.dir, Some(10), 44).unwrap();
    let addr = spawn(stub(1, false)).await;

    let report = run_backend(&loaded, &backend("jev", addr, 0.042), 4)
        .await
        .unwrap();
    assert_eq!(report.overall.n, 10, "--limit is honoured");
    // 10 routes x 1234 tokens x $0.042/MTok.
    let expected = 10.0 * 1234.0 * 0.042 / 1e6;
    assert!(
        (report.total_usd - expected).abs() < 1e-12,
        "{} vs {expected}",
        report.total_usd
    );
    assert!(
        report.sso.is_none(),
        "a cloud backend reports no adaptation"
    );
}

#[tokio::test]
async fn a_backend_that_is_down_counts_as_wrong_and_says_so() {
    let tree = Tree::new("down");
    let loaded = load(&corpus_path(), &tree.dir, Some(5), 44).unwrap();

    // Bind then drop, so the port is certainly closed.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);

    let report = run_backend(&loaded, &backend("sso", addr, 0.0), 2)
        .await
        .unwrap();
    assert_eq!(report.overall.n, 5);
    assert_eq!(report.overall.answered, 0);
    assert_eq!(
        report.overall.accuracy(),
        0.0,
        "failures are counted as wrong"
    );
    assert_eq!(report.failures.values().sum::<usize>(), 5);
    assert!(report.model.contains("never answered"));
}

#[tokio::test]
async fn parity_diffs_two_backends_case_by_case() {
    let tree = Tree::new("parity");
    let loaded = load(&corpus_path(), &tree.dir, Some(20), 44).unwrap();
    let a_addr = spawn(stub(1, false)).await;
    let b_addr = spawn(stub(3, true)).await;

    let a = run_backend(&loaded, &backend("jev", a_addr, 0.042), 4)
        .await
        .unwrap();
    let b = run_backend(&loaded, &backend("sso", b_addr, 0.0), 4)
        .await
        .unwrap();
    let parity = metrics::compare(a, b);

    assert_eq!(parity.compared, 20);
    assert!(
        parity.agreed < 20,
        "the two stubs deliberately disagree somewhere"
    );
    assert_eq!(parity.agreed + parity.disagreements.len(), 20);
    assert!(
        parity.a_only_correct > 0,
        "backend A answers correctly more often"
    );

    let rendered = metrics::render_parity(&parity);
    assert!(rendered.contains("parity:"));
    assert!(rendered.contains("disagreements"));
    assert!(rendered.contains("jev"));
    assert!(rendered.contains("sso"));
}

#[tokio::test]
async fn a_threshold_sweep_runs_the_corpus_once_per_threshold() {
    let tree = Tree::new("sweep");
    let loaded = load(&corpus_path(), &tree.dir, Some(12), 44).unwrap();
    let mut backend_stub = stub(2, true);
    backend_stub.respects_threshold = true;
    let addr = spawn(backend_stub.clone()).await;

    let thresholds = [0.0, 0.5, 0.7, 1.0];
    let sweep = run_sweep(&loaded, &backend("sso", addr, 0.0), 4, &thresholds)
        .await
        .unwrap();

    assert_eq!(sweep.points.len(), thresholds.len());
    assert_eq!(
        backend_stub.seen.lock().unwrap().len(),
        12 * thresholds.len(),
        "every threshold sees the whole corpus, not a sample of it"
    );

    // Each request carried its threshold, which is what makes the sweep a
    // sweep rather than four identical runs.
    let sent: Vec<f64> = backend_stub
        .seen
        .lock()
        .unwrap()
        .iter()
        .map(|body| body["sso"]["none_threshold"].as_f64().unwrap())
        .collect();
    for (point, chunk) in sweep.points.iter().zip(sent.chunks(12)) {
        assert!(chunk
            .iter()
            .all(|t| (*t - point.none_threshold).abs() < 1e-9));
    }

    // Above the stub's best score, everything declines; below it, nothing does.
    for point in &sweep.points {
        let declined = point.report.none.picked;
        if point.none_threshold > 0.6 {
            assert_eq!(
                declined, 12,
                "threshold {} declines all",
                point.none_threshold
            );
        } else {
            assert_eq!(
                declined, 0,
                "threshold {} declines none",
                point.none_threshold
            );
        }
        let sso = point.report.sso.as_ref().unwrap();
        assert_eq!(sso.none_threshold, Some(point.none_threshold));
        assert!(sso.mean_hypotheses_scored > 0.0);
    }

    // The subgroup reporting the contract asks for survives the sweep.
    let first = &sweep.points[0].report;
    assert!(first.by_class.contains_key("near-neighbour"));
    assert!(first.by_discriminator.contains_key("late"));

    let rendered = metrics::render_sweep(&sweep);
    assert!(rendered.contains("threshold sweep"));
    assert!(rendered.contains("best top-1 accuracy at threshold"));
    assert!(
        !rendered.contains("NOTE: no run reported a decline rule"),
        "this backend did report one"
    );
}

#[tokio::test]
async fn a_sweep_against_a_backend_that_ignores_the_threshold_says_so() {
    let tree = Tree::new("sweep-flat");
    let loaded = load(&corpus_path(), &tree.dir, Some(6), 44).unwrap();
    // `respects_threshold` is false: a shared-head engine behind the façade.
    let addr = spawn(stub(2, true)).await;
    let sweep = run_sweep(&loaded, &backend("sso", addr, 0.0), 2, &[0.2, 0.8])
        .await
        .unwrap();
    let rendered = metrics::render_sweep(&sweep);
    assert!(
        rendered.contains("NOTE: no run reported a decline rule"),
        "a sweep that measured nothing must say so:\n{rendered}"
    );
}

/// The copy ceiling, end to end over the real corpus and a stub judge.
///
/// No network: the lexical ranker is BM25 over the same candidate map the stub
/// was shown, which is the whole point of having a judge-free control.
#[tokio::test]
async fn the_copy_ceiling_controls_a_run_for_input_exposure() {
    let tree = Tree::new("ceiling");
    let loaded = load(&corpus_path(), &tree.dir, None, 44).unwrap();
    let addr = spawn(stub(2, true)).await;
    let report = run_backend(&loaded, &backend("sso", addr, 0.0), 8)
        .await
        .unwrap();

    let exposure = Exposure::new(&loaded.candidates);
    assert_eq!(exposure.names.len(), loaded.candidates.len());
    assert!(
        !exposure.names.iter().any(|n| n == "none"),
        "`none` has no rubric, so no copy procedure can rank it"
    );

    let prompts: Vec<String> = loaded
        .corpus
        .cases
        .iter()
        .map(|c| c.prompt.clone())
        .collect();
    let rankers = vec![Ranker::bm25(&exposure, &prompts)];

    let fair = copy::build(&report, &exposure, &rankers, CeilingMode::Fair);
    let naive = copy::build(&report, &exposure, &rankers, CeilingMode::ConcedeNone);

    assert_eq!(fair.cases, 86);
    assert_eq!(fair.judge.backend, "sso");
    assert!(fair.rankers[0].oracle_tuned);
    assert!(!naive.rankers[0].oracle_tuned);

    // The fair ceiling can only be at least the naive one: the oracle sweep
    // includes a threshold that declines nothing.
    assert!(
        fair.rankers[0].applied.top1 >= naive.rankers[0].applied.top1,
        "fair {:.3} < naive {:.3}",
        fair.rankers[0].applied.top1,
        naive.rankers[0].applied.top1
    );
    // Which is exactly why the naive gain is the flattering one.
    assert!(
        fair.rankers[0].gain_top1_points <= naive.rankers[0].gain_top1_points,
        "the naive ceiling must not understate the judge's apparent advantage"
    );

    // The synthetic tree has no rubric for `none`, so without a decline rule
    // the copy procedure scores exactly zero on every `none` case.
    let none_row = naive
        .subgroups
        .iter()
        .find(|s| s.label == "`none` items")
        .expect("the corpus has `none` items");
    assert_eq!(none_row.ceiling_top1[0], 0.0);
    assert!(none_row.n > 0);

    // Per-item gain is a paired statistic over every case, failures included.
    let g = &fair.rankers[0].per_item;
    assert_eq!(g.n, 86);
    assert!(g.ci_low <= g.mean && g.mean <= g.ci_high);
    assert_eq!(
        g.mean,
        (g.judge_only as f64 - g.copy_only as f64) / g.n as f64
    );

    let rendered = copy::render(&fair);
    for needle in [
        "COPY CEILING",
        "FAIR",
        "ORACLE-TUNED",
        "gain over copy",
        "signed/item",
        "POWER",
        "subgroup breakdown",
        "`none` items",
        "late discriminator",
        "class near-neighbour",
    ] {
        assert!(
            rendered.contains(needle),
            "report omits `{needle}`:\n{rendered}"
        );
    }
    assert!(
        copy::render(&naive).contains("NAIVE"),
        "the naive ceiling names itself"
    );
}
