//! Loading the corpus and driving a backend over it.
//!
//! Separated from the CLI so an integration test can produce exactly the
//! numbers the CLI prints, against a stub backend, without shelling out.

use std::path::Path;

use futures::stream::StreamExt;
use indexmap::IndexMap;

use crate::client::{self, Backend};
use crate::corpus::{load_candidates, Corpus};
use crate::metrics;

/// Corpus plus candidate map plus the derived late-discriminator flags.
pub struct Loaded {
    /// The labelled cases, after any `--limit`.
    pub corpus: Corpus,
    /// The candidate map every backend is asked to choose from.
    pub candidates: IndexMap<String, String>,
    /// Per case, whether its discriminative clause sits late in the rubric.
    pub late: Vec<bool>,
    /// Labels no live skill provides.
    pub unscorable: Vec<String>,
}

/// Load the corpus, build the candidate map, derive the subgroup flags.
///
/// Fails loudly on a missing corpus or an empty skills tree: a rig that
/// silently scored zero candidates would report 0% and look like a backend
/// problem.
pub fn load(
    cases_path: &Path,
    skills_dir: &Path,
    limit: Option<usize>,
    option_budget: usize,
) -> Result<Loaded, String> {
    let mut corpus = Corpus::load(cases_path)?;
    if let Some(limit) = limit {
        corpus.cases.truncate(limit);
    }
    let candidates = load_candidates(skills_dir)?;
    let unscorable = corpus.unscorable(&candidates);
    let late = corpus
        .cases
        .iter()
        .map(|case| case.late_discriminator(&candidates, option_budget))
        .collect();
    Ok(Loaded {
        corpus,
        candidates,
        late,
        unscorable,
    })
}

/// Run the corpus once per threshold, reporting each run in full.
///
/// Sequential by threshold on purpose: the runs share a backend, and a sweep
/// whose points each measured the others' queueing would report latency that
/// belongs to the rig rather than to the engine.
pub async fn run_sweep(
    loaded: &Loaded,
    backend: &Backend,
    concurrency: usize,
    thresholds: &[f64],
) -> Result<metrics::Sweep, String> {
    if thresholds.is_empty() {
        return Err("a sweep needs at least one threshold".into());
    }
    let mut points = Vec::with_capacity(thresholds.len());
    for threshold in thresholds {
        let at = Backend {
            none_threshold: Some(*threshold),
            ..backend.clone()
        };
        let report = run_backend(loaded, &at, concurrency).await?;
        points.push(metrics::SweepPoint {
            none_threshold: *threshold,
            report,
        });
    }
    Ok(metrics::Sweep {
        backend: backend.label.clone(),
        url: backend.url.clone(),
        model: points
            .first()
            .map(|p| p.report.model.clone())
            .unwrap_or_default(),
        points,
    })
}

/// Run every case against one backend, `concurrency` in flight.
pub async fn run_backend(
    loaded: &Loaded,
    backend: &Backend,
    concurrency: usize,
) -> Result<metrics::Report, String> {
    let client = backend.client()?;

    let mut results: Vec<(
        metrics::Scored,
        Option<String>,
        Option<system_one_core::wire::Sso>,
    )> = futures::stream::iter(loaded.corpus.cases.iter().enumerate().map(|(index, case)| {
        let client = &client;
        async move {
            let outcome = client::route(client, backend, &loaded.candidates, &case.prompt).await;
            let scored = metrics::score(
                index,
                case,
                loaded.late[index],
                &outcome,
                backend.usd_per_mtok_in,
            );
            match outcome {
                client::Outcome::Routed(routed) => {
                    (scored, Some(routed.model.clone()), routed.sso.clone())
                }
                client::Outcome::Failed { .. } => (scored, None, None),
            }
        }
    }))
    .buffer_unordered(concurrency.max(1))
    .collect::<Vec<_>>()
    .await;
    results.sort_by_key(|(s, _, _)| s.index);

    // The model reported is the one that ANSWERED, not the one we asked for:
    // a façade serving whatever checkpoint the engine loaded must be able to
    // say so, or two runs of "laya-typed-decisions" could be two models.
    let model = results
        .iter()
        .find_map(|(_, model, _)| model.clone())
        .unwrap_or_else(|| format!("{} (never answered)", backend.model));
    let sso_samples: Vec<system_one_core::wire::Sso> = results
        .iter()
        .filter_map(|(_, _, sso)| sso.clone())
        .collect();
    let scored: Vec<metrics::Scored> = results.into_iter().map(|(s, _, _)| s).collect();

    Ok(metrics::summarise(
        &backend.label,
        &backend.url,
        &model,
        loaded.candidates.len() + 1,
        loaded.unscorable.clone(),
        scored,
        metrics::SsoSummary::from_samples(&sso_samples),
    ))
}
