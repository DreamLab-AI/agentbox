//! The façade proper: one request in, one System One response out.
//!
//! The order of operations is the whole design, and every step after the first
//! is conditional on what the first one learns:
//!
//! 1. ask the engine what it **is** — never assume 512/192, and never branch on
//!    its name. An engine that declares nothing gets the conservative,
//!    shared-head shape (contract §11.4);
//! 2. *if the engine caps options*, compress every rubric to that ceiling
//!    **deliberately**, front-loading the discriminative clause, before the
//!    tokeniser would amputate it tail-first. If it declares no cap, the rubric
//!    goes verbatim — compressing it would be the façade inventing a
//!    constraint;
//! 3. *if the engine has a shared head budget*, shortlist options by similarity
//!    to the state until the head fits — there, a shortlist is correctness. If
//!    it has none, every option is offered and any limit is purely a latency
//!    lever an operator asked for;
//! 4. window the state once, at the tightest per-question budget, so a batch of
//!    questions can share engine calls. `max_len` always binds, so this stays
//!    live for a 25k-token compaction state whatever else the engine declares;
//! 5. aggregate across windows and re-expand over the caller's original keys —
//!    as a distribution, or, where options are scored independently, as
//!    absolute scores against a decline threshold (§11.3).
//!
//! Steps 3, 4 and 5 are [`system_one_core`]'s
//! ([`fit_options`](system_one_core::budget::fit_options),
//! [`window_state`](system_one_core::window::window_state), the
//! `aggregate_*` family and
//! [`expand_choice`](system_one_core::expand::expand_choice)). This module is
//! the *sequencing*, the embeddings that turn a state into a relevance order,
//! and the engine calls. Before the response leaves, it is checked against
//! [`validate_response`](system_one_core::validate::validate_response) — the
//! standard judging the server's own output.
//!
//! Every step that shrinks something is reported in `sso`. Nothing here has a
//! fallback that answers without the engine: if the engine cannot be reached,
//! the request fails loudly and the consumer takes its own fail-open path.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use indexmap::IndexMap;
use system_one_core::aggregate::{
    aggregate_absolute_scores, aggregate_choice, aggregate_noul, aggregate_score,
    aggregate_score_distribution, WindowResult,
};
use system_one_core::budget::{
    fit_options, head_tokens_for, offer_options, FitPlan, FittedOption, OptionBudget,
};
use system_one_core::capability::EngineCapabilities;
use system_one_core::expand::{expand_choice, expand_choice_with_decline};
use system_one_core::tokens::estimate_tokens;
use system_one_core::validate::{validate, validate_response};
use system_one_core::window::{window_state, WindowAlign, WindowOptions};
use system_one_core::wire::{
    Answer, CompressedOptionTokens, Decline, Question, QuestionKind, Request, RequestOptions,
    Response, Shortlisted, Sso, Usage, Windowed,
};

use crate::compress::compress_rubric;
use crate::config::Config;
use crate::embed::{cache_key, cosine, Embedder, Vector};
use crate::engine::{Engine, EngineAnswer, EngineQuestion, PredictRequest};
use crate::error::{FacadeError, Result};
use crate::plan::{query_text, rank_keys, resolve_key};

/// The façade's dependencies, built once at startup.
#[derive(Debug)]
pub struct Facade {
    cfg: Config,
    engine: Engine,
    embedder: Embedder,
}

/// A question after compression, shortlisting and budget fitting.
struct Prepared {
    name: String,
    kind: QuestionKind,
    question: EngineQuestion,
    /// The options actually sent, for re-expansion. Empty for score and noul.
    sent: Vec<FittedOption>,
    /// The caller's original option keys, in the caller's order.
    original: Vec<String>,
    /// Text used to rank state windows for this question.
    query_text: String,
    /// Tokens of state this question can still afford.
    state_budget: usize,
    shortlisted: Option<Shortlisted>,
    /// Scale labels, for a score question.
    bands: usize,
    /// The decline threshold to apply, when the engine's scores support one.
    decline: Option<DeclinePlan>,
}

/// The decline rule for one choice: which key means "nothing applies", and the
/// absolute score an option must reach to beat it.
#[derive(Clone, Debug)]
struct DeclinePlan {
    key: String,
    threshold: f64,
}

impl Facade {
    /// Build the façade from resolved configuration.
    pub fn new(cfg: Config) -> Self {
        let engine = Engine::new(&cfg);
        let embedder = Embedder::new(&cfg);
        Self {
            cfg,
            engine,
            embedder,
        }
    }

    /// Resolved configuration.
    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// The engine client, for the health surface.
    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// The embeddings client, for the health surface.
    pub fn embedder(&self) -> &Embedder {
        &self.embedder
    }

    /// Answer one `POST /v1/systemone` request.
    pub async fn answer(&self, request: Request) -> Result<Response> {
        let started = Instant::now();
        validate(&request)?;

        // The engine declares itself; the façade adapts to the declaration and
        // never to an engine's name. An engine that declares nothing gets the
        // conservative, shared-head treatment (contract §11.4).
        let caps = self.engine.capabilities().await?;
        let overrides = request.sso.unwrap_or_default();
        let state_text = request.state.render();

        let prepared = self
            .prepare(&request, &state_text, caps, &overrides)
            .await?;

        // One split, at the tightest budget any question can afford, so a batch
        // of questions over one transcript shares its engine calls. The tail is
        // kept rather than the head (§10.5): for compaction, recency is what
        // the questions are about.
        let tightest = prepared
            .iter()
            .map(|p| p.state_budget)
            .min()
            .unwrap_or(caps.max_len);
        let windows = window_state(
            &state_text,
            tightest,
            &WindowOptions::default()
                .with_overlap(f64::from(self.cfg.window_overlap))
                .with_align(WindowAlign::End),
        );
        let selections = self.select_windows(&prepared, &windows).await?;

        let (answers_by_window, engine_ms, input_tokens) =
            self.ask_engine(&prepared, &windows, &selections).await?;

        let mut answers: IndexMap<String, Answer> = IndexMap::new();
        let mut sso = Sso {
            engine_ms,
            facade_ms: 0,
            capabilities: Some(caps),
            hypotheses_scored: Some(
                prepared
                    .iter()
                    .enumerate()
                    .map(|(index, item)| item.sent.len() * selections[index].len())
                    .sum(),
            ),
            ..Default::default()
        };

        for (index, item) in prepared.iter().enumerate() {
            let per_window: Vec<(f64, &EngineAnswer)> = selections[index]
                .iter()
                .filter_map(|(window_index, relevance)| {
                    answers_by_window
                        .get(window_index)
                        .and_then(|m| m.get(&item.name))
                        .map(|answer| (f64::from(*relevance), answer))
                })
                .collect();
            if per_window.is_empty() {
                return Err(FacadeError::EngineError(format!(
                    "engine returned no answer for question `{}`",
                    item.name
                )));
            }
            let (answer, decline) = self.assemble(item, &per_window)?;
            answers.insert(item.name.clone(), answer);
            if let Some(decline) = decline {
                sso.decline.insert(item.name.clone(), decline);
            }

            if let Some(s) = item.shortlisted {
                sso.shortlisted.insert(item.name.clone(), s);
            }
            if windows.len() > 1 {
                sso.windowed.insert(
                    item.name.clone(),
                    Windowed {
                        windows: windows.len(),
                        selected: selections[index].len(),
                        truncate_left: Some(true),
                    },
                );
            }
        }

        sso.facade_ms = started.elapsed().as_millis() as u64;
        let response = Response {
            model: self.cfg.model.clone(),
            answers,
            usage: Usage {
                input_tokens,
                output_tokens: 0,
            },
            sso: Some(sso),
        };
        // The standard judges this server's own output: `choice` is one of the
        // caller's keys and `probabilities` covers all of them. A façade that
        // only tested this in its own tests would be marking its own homework.
        validate_response(&request, &response)?;
        Ok(response)
    }

    /// Compress, shortlist and budget every question.
    async fn prepare(
        &self,
        request: &Request,
        state_text: &str,
        caps: EngineCapabilities,
        overrides: &RequestOptions,
    ) -> Result<Vec<Prepared>> {
        let model = caps.cost_model();
        let mut out = Vec::with_capacity(request.questions.len());
        for (name, question) in &request.questions {
            let item = match question {
                Question::Choice {
                    instructions,
                    criteria,
                } => {
                    self.prepare_choice(name, instructions, criteria, state_text, caps, overrides)
                        .await?
                }
                Question::Score {
                    instructions,
                    criteria,
                } => {
                    // A scale is ordinal and tiny: shortlisting it would change
                    // the question, so it is fitted whole or refused.
                    let head = head_cost(QuestionKind::Score, instructions, criteria.iter(), model);
                    Prepared {
                        name: name.clone(),
                        kind: QuestionKind::Score,
                        question: EngineQuestion::Score {
                            instructions: instructions.clone(),
                            criteria: criteria.clone(),
                        },
                        sent: Vec::new(),
                        original: Vec::new(),
                        query_text: query_text(question),
                        state_budget: state_budget_for(head, caps, name)?,
                        shortlisted: None,
                        bands: criteria.len(),
                        decline: None,
                    }
                }
                Question::Noul { instructions } => {
                    let head =
                        head_cost(QuestionKind::Noul, instructions, std::iter::empty(), model);
                    Prepared {
                        name: name.clone(),
                        kind: QuestionKind::Noul,
                        question: EngineQuestion::Noul {
                            instructions: instructions.clone(),
                        },
                        sent: Vec::new(),
                        original: Vec::new(),
                        query_text: query_text(question),
                        state_budget: state_budget_for(head, caps, name)?,
                        shortlisted: None,
                        bands: 0,
                        decline: None,
                    }
                }
            };
            out.push(item);
        }
        Ok(out)
    }

    /// The per-option token cap in force, or `None` when the engine caps none.
    ///
    /// `None` is not "unlimited by default": it is the engine having *declared*
    /// that it does not truncate options, at which point compressing a rubric
    /// would be the façade inventing a constraint and throwing away the clause
    /// that distinguishes one option from another.
    pub fn option_cap(&self, caps: EngineCapabilities) -> Option<usize> {
        caps.option_max_len.map(|engine_cap| {
            engine_cap
                .min(self.cfg.option_max_tokens)
                .saturating_sub(self.cfg.option_token_safety)
                .max(8)
        })
    }

    async fn prepare_choice(
        &self,
        name: &str,
        instructions: &str,
        criteria: &IndexMap<String, String>,
        state_text: &str,
        caps: EngineCapabilities,
        overrides: &RequestOptions,
    ) -> Result<Prepared> {
        let cap = self.option_cap(caps);
        // Step 1: deliberate, boundary-preserving compression (§10.1), cached
        // beside the option's embedding — but ONLY where the engine truncates
        // options. See `Self::option_cap`.
        let offered: IndexMap<String, String> = match cap {
            Some(cap) => self.compress_criteria(criteria, cap),
            None => criteria.clone(),
        };

        let plan = if caps.is_head_bounded() {
            self.fit_bounded(
                name,
                instructions,
                criteria,
                &offered,
                state_text,
                caps,
                overrides,
            )
            .await?
        } else {
            self.offer_unbounded(
                instructions,
                criteria,
                &offered,
                state_text,
                caps,
                overrides,
            )
            .await?
        };

        let shortlisted = Shortlisted {
            from: criteria.len(),
            to: plan.selected.len(),
            compressed_option_tokens: Some(compression_report(&plan, criteria)),
        };
        // The decline threshold is only meaningful where an option's score is
        // its own, not a share of one distribution (contract §11.3), and only
        // where the caller actually offered a way to decline.
        let decline = (caps.scores_options_independently
            && criteria.contains_key(self.cfg.none_key.as_str()))
        .then(|| DeclinePlan {
            key: self.cfg.none_key.clone(),
            threshold: overrides.none_threshold.unwrap_or(self.cfg.none_threshold),
        });

        Ok(Prepared {
            name: name.to_string(),
            kind: QuestionKind::Choice,
            question: EngineQuestion::Choice {
                instructions: instructions.to_string(),
                criteria: plan.criteria(),
            },
            original: criteria.keys().cloned().collect(),
            query_text: query_text(&Question::Choice {
                instructions: instructions.to_string(),
                criteria: criteria.clone(),
            }),
            state_budget: state_budget_for(plan.head_tokens, caps, name)?,
            sent: plan.selected,
            shortlisted: Some(shortlisted),
            bands: 0,
            decline,
        })
    }

    /// Fit a choice into an engine whose options share one head budget.
    ///
    /// Here the shortlist is a *correctness* constraint: exceed the head and
    /// the engine squeezes every option to four tokens without saying so.
    #[allow(clippy::too_many_arguments)]
    async fn fit_bounded(
        &self,
        name: &str,
        instructions: &str,
        criteria: &IndexMap<String, String>,
        offered: &IndexMap<String, String>,
        state_text: &str,
        caps: EngineCapabilities,
        overrides: &RequestOptions,
    ) -> Result<FitPlan> {
        let head_max_tokens = caps
            .head_max_len
            .expect("fit_bounded is only called for a head-bounded engine");
        let option_budget = OptionBudget {
            head_max_tokens,
            k: overrides.shortlist_k.unwrap_or(self.cfg.shortlist_k).max(2),
            pinned: self.cfg.shortlist_always.clone(),
            // The safety margin survives consolidation, through core's own
            // knob rather than a private one. Core's estimator is chars/4 while
            // the engine's tokeniser is WordPiece, which charges every
            // punctuation mark separately — so on a punctuation-heavy rubric
            // the estimate runs LOW, and compressing to exactly the cap can
            // still be amputated by the thing this all exists to prevent.
            option_token_cap: self.option_cap(caps),
            ..OptionBudget::default()
        };

        // Rank by similarity to the state, but only when the whole set will not
        // fit — an eight-option question must not pay for 116 embeds.
        let ranked: Vec<String> = if fits_whole(instructions, offered, &option_budget) {
            Vec::new()
        } else {
            let similarities = self.similarities(criteria, offered, state_text).await?;
            rank_keys(criteria, &similarities)
        };
        let ranked_refs: Vec<&str> = ranked.iter().map(String::as_str).collect();

        let plan: FitPlan = fit_options(
            QuestionKind::Choice,
            instructions,
            offered,
            &ranked_refs,
            &option_budget,
        )?;
        if plan.would_squeeze() {
            // Core reports this; reaching the engine's silent squeeze path is
            // the collapse §10.2 describes, so it is an error, not a warning.
            return Err(FacadeError::OptionsUnfittable(format!(
                "question `{name}`: the fitted options would reach the engine's squeeze path \
                 ({} tokens each); refusing to ask a question the engine would mangle",
                plan.squeeze_allowance()
            )));
        }
        if plan.selected.len() < option_budget.k && plan.selected.len() < criteria.len() {
            // Contract §10.4: k=8 at 48 tokens needs head_max_len ≈ 512, and
            // laya's default is 192. Collapsing to two options is legal and
            // honest, but it is also the difference between a judge and a coin
            // toss, so it is said out loud.
            tracing::warn!(
                question = name,
                wanted = option_budget.k,
                kept = plan.selected.len(),
                head_max_len = head_max_tokens,
                "shortlist collapsed below shortlist_k; raise the engine's head_max_len"
            );
        }
        Ok(plan)
    }

    /// Offer a choice to an engine that declares **no** head budget.
    ///
    /// There is no budget to protect, so there is no correctness reason to drop
    /// an option: every option the caller sent is offered unless an operator
    /// has asked for a cost limit. Keeping the head-bounded engine's `k = 8`
    /// here would import a constraint this engine does not have and answer a
    /// narrower question than the caller asked (contract §11.4).
    async fn offer_unbounded(
        &self,
        instructions: &str,
        criteria: &IndexMap<String, String>,
        offered: &IndexMap<String, String>,
        state_text: &str,
        caps: EngineCapabilities,
        overrides: &RequestOptions,
    ) -> Result<FitPlan> {
        let limit = overrides.shortlist_k.or(self.cfg.cost_shortlist_k);
        // Ranking is only worth its embeddings when something will be cut.
        let ranked: Vec<String> = match limit {
            Some(limit) if limit < criteria.len() => {
                let similarities = self.similarities(criteria, offered, state_text).await?;
                rank_keys(criteria, &similarities)
            }
            _ => Vec::new(),
        };
        let ranked_refs: Vec<&str> = ranked.iter().map(String::as_str).collect();
        Ok(offer_options(
            QuestionKind::Choice,
            instructions,
            offered,
            &ranked_refs,
            limit,
            &self.cfg.shortlist_always,
            self.option_cap(caps),
            caps.cost_model(),
        )?)
    }

    /// Compress every rubric, serving what it can from the persistent cache.
    fn compress_criteria(
        &self,
        criteria: &IndexMap<String, String>,
        cap: usize,
    ) -> IndexMap<String, String> {
        let namespace = format!("rubric/{cap}");
        let mut out = IndexMap::new();
        let mut fresh: Vec<(String, Arc<str>)> = Vec::new();
        for (key, rubric) in criteria {
            // Core charges the key against the option's cap, so the rubric is
            // compressed against what is left after the key is paid for.
            let allowance = cap
                .saturating_sub(estimate_tokens(&format!("{key}: ")))
                .max(1);
            let cache = cache_key(&format!("{namespace}/{allowance}"), rubric);
            if let Some(hit) = self.embedder.cache().get_text(&cache) {
                out.insert(key.clone(), hit.to_string());
                continue;
            }
            let compressed = compress_rubric(rubric, allowance);
            fresh.push((cache, Arc::from(compressed.text.as_str())));
            out.insert(key.clone(), compressed.text);
        }
        self.embedder.cache().put_texts(&fresh);
        out
    }

    /// Cosine similarity of every option to the state.
    async fn similarities(
        &self,
        criteria: &IndexMap<String, String>,
        compressed: &IndexMap<String, String>,
        state_text: &str,
    ) -> Result<IndexMap<String, f32>> {
        // Contract §3.1 step 2: the ranked text is `"<option>: <rubric>"`, and
        // it is the COMPRESSED rubric, so the embedding and the thing the judge
        // will read are the same text.
        let mut texts: Vec<String> = Vec::with_capacity(criteria.len() + 1);
        texts.push(state_text.to_string());
        for key in criteria.keys() {
            texts.push(format!("{key}: {}", compressed[key]));
        }
        let vectors = self.embedder.embed_many(&texts).await?;
        let state = vectors[0].clone();
        Ok(criteria
            .keys()
            .enumerate()
            .map(|(i, key)| (key.clone(), cosine(&state, &vectors[i + 1])))
            .collect())
    }

    /// Choose which windows each question is evaluated over.
    ///
    /// Returns, per prepared question, the `(window index, relevance)` pairs it
    /// will be asked about. A single window is the router's case and costs no
    /// embeddings at all.
    async fn select_windows(
        &self,
        prepared: &[Prepared],
        windows: &[system_one_core::window::Window],
    ) -> Result<Vec<Vec<(usize, f32)>>> {
        if windows.len() <= 1 {
            return Ok(prepared.iter().map(|_| vec![(0usize, 1.0f32)]).collect());
        }
        let mut texts: Vec<String> = windows.iter().map(|w| w.text.clone()).collect();
        texts.extend(prepared.iter().map(|p| p.query_text.clone()));
        let vectors = self.embedder.embed_many(&texts).await?;
        let window_vectors: Vec<Vector> = vectors[..windows.len()].to_vec();

        Ok(prepared
            .iter()
            .enumerate()
            .map(|(i, _)| {
                let query = &vectors[windows.len() + i];
                let mut scored: Vec<(usize, f32)> = window_vectors
                    .iter()
                    .enumerate()
                    .map(|(w, v)| (w, cosine(query, v)))
                    .collect();
                scored.sort_by(|a, b| {
                    b.1.partial_cmp(&a.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(a.0.cmp(&b.0))
                });
                scored.truncate(self.cfg.window_k.max(1));
                // Stable order for reproducible engine batching.
                scored.sort_by_key(|(w, _)| *w);
                scored
            })
            .collect())
    }

    /// Run one engine call per window, batching the questions that selected it.
    async fn ask_engine(
        &self,
        prepared: &[Prepared],
        windows: &[system_one_core::window::Window],
        selections: &[Vec<(usize, f32)>],
    ) -> Result<(BTreeMap<usize, IndexMap<String, EngineAnswer>>, u64, u64)> {
        let mut batches: BTreeMap<usize, IndexMap<String, EngineQuestion>> = BTreeMap::new();
        for (index, item) in prepared.iter().enumerate() {
            for (window, _) in &selections[index] {
                batches
                    .entry(*window)
                    .or_default()
                    .insert(item.name.clone(), item.question.clone());
            }
        }

        let started = Instant::now();
        let calls = batches.iter().map(|(window, questions)| {
            let request = PredictRequest {
                state: windows
                    .get(*window)
                    .map(|w| w.text.clone())
                    .unwrap_or_default(),
                questions: questions.clone(),
                truncate_left: true,
            };
            async move {
                self.engine
                    .predict(&request)
                    .await
                    .map(|(r, _)| (*window, r))
            }
        });
        let results = futures::future::try_join_all(calls).await?;
        let engine_ms = started.elapsed().as_millis() as u64;

        let mut input_tokens = 0u64;
        let mut by_window = BTreeMap::new();
        for (window, response) in results {
            input_tokens += response.usage.input_tokens;
            by_window.insert(window, response.answers);
        }
        Ok((by_window, engine_ms, input_tokens))
    }

    /// Aggregate a question's windows and re-expand it over the caller's keys.
    fn assemble(
        &self,
        item: &Prepared,
        per_window: &[(f64, &EngineAnswer)],
    ) -> Result<(Answer, Option<Decline>)> {
        let missing = |field: &str| {
            FacadeError::EngineError(format!(
                "engine answered question `{}` without a {field}",
                item.name
            ))
        };

        match item.kind {
            QuestionKind::Choice => {
                let mut answer = match &item.decline {
                    Some(plan) => self.assemble_with_decline(item, per_window, plan)?,
                    None => self.assemble_distribution(item, per_window)?,
                };
                // Laya's own metadata, from the most relevant window (§10.7).
                if let Answer::Choice { action, .. } = &mut answer.0 {
                    *action = per_window
                        .iter()
                        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
                        .and_then(|(_, a)| a.action);
                }
                Ok(answer)
            }
            QuestionKind::Score => {
                let scores: Vec<WindowResult<f64>> = per_window
                    .iter()
                    .filter_map(|(relevance, a)| a.score.map(|s| WindowResult::new(*relevance, s)))
                    .collect();
                if scores.is_empty() {
                    return Err(missing("score"));
                }
                let confidences: Vec<WindowResult<f64>> = per_window
                    .iter()
                    .map(|(relevance, a)| {
                        WindowResult::new(*relevance, a.confidence.unwrap_or(0.0))
                    })
                    .collect();
                let bands: Vec<WindowResult<Vec<f64>>> = per_window
                    .iter()
                    .filter_map(|(relevance, a)| {
                        a.distribution
                            .as_ref()
                            .filter(|d| d.len() == item.bands)
                            .map(|d| WindowResult::new(*relevance, d.clone()))
                    })
                    .collect();
                Ok((
                    Answer::Score {
                        score: aggregate_score(&scores)?,
                        distribution: if bands.is_empty() {
                            Vec::new()
                        } else {
                            aggregate_score_distribution(&bands)?
                        },
                        confidence: aggregate_score(&confidences)?,
                        legend: IndexMap::new(),
                        probabilities: IndexMap::new(),
                    },
                    None,
                ))
            }
            QuestionKind::Noul => {
                let nouls: Vec<WindowResult<f64>> = per_window
                    .iter()
                    .filter_map(|(relevance, a)| a.noul.map(|n| WindowResult::new(*relevance, n)))
                    .collect();
                if nouls.is_empty() {
                    return Err(missing("noul probability"));
                }
                Ok((
                    Answer::Noul {
                        noul: aggregate_noul(&nouls)?.clamp(0.0, 1.0),
                    },
                    None,
                ))
            }
        }
    }

    /// The ordinary choice path: merge per-window distributions and re-expand.
    fn assemble_distribution(
        &self,
        item: &Prepared,
        per_window: &[(f64, &EngineAnswer)],
    ) -> Result<(Answer, Option<Decline>)> {
        // Per-window distributions, with every engine-side key mapped back to a
        // caller key first: core's re-expansion refuses an option it was never
        // offered, which is what it is for.
        let mut merged: Vec<WindowResult<IndexMap<String, f64>>> =
            Vec::with_capacity(per_window.len());
        for (relevance, answer) in per_window {
            let probabilities = answer.probabilities.as_ref().ok_or_else(|| {
                FacadeError::EngineError(format!(
                    "engine answered question `{}` without a probabilities",
                    item.name
                ))
            })?;
            merged.push(WindowResult::new(
                *relevance,
                self.resolve_keys(item, probabilities, |a, b| a + b)?,
            ));
        }
        let distribution = aggregate_choice(&merged)?;
        Ok((expand_choice(&item.original, &distribution)?, None))
    }

    /// The independent-scoring path: absolute scores, with a decline threshold.
    ///
    /// The scores are the engine's — either reported directly or reconstructed
    /// from its own `confidence` (see
    /// [`EngineAnswer::absolute_scores`](crate::engine::EngineAnswer::absolute_scores)).
    /// An engine that declares independent scoring but publishes no absolute
    /// scale at all is a loud failure, not a silent fallback: a threshold
    /// compared against a number that does not mean what it is assumed to mean
    /// is exactly the kind of quiet wrongness this façade refuses.
    fn assemble_with_decline(
        &self,
        item: &Prepared,
        per_window: &[(f64, &EngineAnswer)],
        plan: &DeclinePlan,
    ) -> Result<(Answer, Option<Decline>)> {
        let mut merged: Vec<WindowResult<IndexMap<String, f64>>> =
            Vec::with_capacity(per_window.len());
        for (relevance, answer) in per_window {
            let scores = answer.absolute_scores().ok_or_else(|| {
                FacadeError::EngineError(format!(
                    "engine declared that it scores options independently but answered question \
                     `{}` with no absolute score for any option; refusing to compare a decline \
                     threshold against a number that is not one",
                    item.name
                ))
            })?;
            merged.push(WindowResult::new(
                *relevance,
                self.resolve_keys(item, &scores, f64::max)?,
            ));
        }
        let scores = aggregate_absolute_scores(&merged)?;
        let outcome =
            expand_choice_with_decline(&item.original, &scores, &plan.key, plan.threshold)?;
        Ok((
            outcome.answer,
            Some(Decline {
                key: plan.key.clone(),
                threshold: plan.threshold,
                applied: true,
                best_score: Some(outcome.best_score),
                fired: outcome.fired,
            }),
        ))
    }

    /// Map every key the engine used back onto a key the caller sent.
    ///
    /// `combine` resolves the (rare) case of two engine-side keys mapping to
    /// one caller key, and the right answer depends on what the numbers are:
    /// probability *mass* adds, an absolute score does not — it takes the
    /// larger, because both were claims about the same option.
    fn resolve_keys(
        &self,
        item: &Prepared,
        raw: &IndexMap<String, f64>,
        combine: fn(f64, f64) -> f64,
    ) -> Result<IndexMap<String, f64>> {
        let mut resolved: IndexMap<String, f64> = IndexMap::new();
        for (key, value) in raw {
            let Some(key) = resolve_key(key, &item.sent) else {
                return Err(FacadeError::EngineError(format!(
                    "engine answered question `{}` with option `{key}`, which the façade never \
                     sent; refusing to guess which was meant",
                    item.name
                )));
            };
            match resolved.entry(key) {
                indexmap::map::Entry::Occupied(mut slot) => {
                    let merged = combine(*slot.get(), *value);
                    slot.insert(merged);
                }
                indexmap::map::Entry::Vacant(slot) => {
                    slot.insert(*value);
                }
            }
        }
        Ok(resolved)
    }
}

/// Head cost of a non-choice question, using core's own arithmetic.
fn head_cost<'a>(
    kind: QuestionKind,
    instructions: &str,
    options: impl Iterator<Item = &'a String>,
    model: system_one_core::budget::OptionCostModel,
) -> usize {
    head_tokens_for(
        kind,
        instructions,
        options.map(|o| estimate_tokens(o)),
        model,
    )
}

/// Whether a choice's whole option set fits without any shortlisting.
///
/// Only asked of a head-bounded engine: where there is no head budget there is
/// nothing for the options to fail to fit into.
fn fits_whole(
    instructions: &str,
    criteria: &IndexMap<String, String>,
    budget: &OptionBudget,
) -> bool {
    let cap = budget.option_token_cap;
    let options = criteria.iter().map(|(key, rubric)| {
        let tokens = estimate_tokens(&format!("{key}: {rubric}"));
        cap.map_or(tokens, |cap| tokens.min(cap))
    });
    head_tokens_for(
        QuestionKind::Choice,
        instructions,
        options,
        system_one_core::budget::OptionCostModel::Shared,
    ) <= budget.usable_head_tokens()
}

/// What compression cost this question's options, for the `sso` block (§10.1).
fn compression_report(
    plan: &FitPlan,
    criteria: &IndexMap<String, String>,
) -> CompressedOptionTokens {
    let max = plan.selected.iter().map(|o| o.tokens).max().unwrap_or(0);
    let mean = if plan.selected.is_empty() {
        0.0
    } else {
        plan.selected.iter().map(|o| o.tokens).sum::<usize>() as f64 / plan.selected.len() as f64
    };
    debug_assert!(
        plan.selected
            .iter()
            .all(|o| criteria.contains_key(o.key.as_str())),
        "every fitted option is one the caller sent"
    );
    CompressedOptionTokens { max, mean }
}

/// State tokens a question can afford, or a loud error when the answer is none.
fn state_budget_for(head: usize, caps: EngineCapabilities, name: &str) -> Result<usize> {
    let left = caps.state_tokens_for(head);
    if left < 16 {
        return Err(FacadeError::QuestionTooLarge(format!(
            "question `{name}` costs {head} tokens of the engine's {} token sequence, \
             leaving no room for the state",
            caps.max_len
        )));
    }
    Ok(left)
}

#[cfg(test)]
mod tests {
    use super::*;
    use system_one_core::budget::OptionCostModel;

    fn laya(max_len: usize, head_max_len: usize) -> EngineCapabilities {
        EngineCapabilities {
            max_len,
            head_max_len: Some(head_max_len),
            option_max_len: Some(48),
            scores_options_independently: false,
        }
    }

    fn openjev() -> EngineCapabilities {
        EngineCapabilities {
            max_len: 4096,
            head_max_len: None,
            option_max_len: None,
            scores_options_independently: true,
        }
    }

    #[test]
    fn a_question_that_eats_the_whole_sequence_is_refused() {
        assert!(state_budget_for(510, laya(512, 500), "q").is_err());
        // Core's arithmetic: max_len - head - the closing [SEP].
        assert_eq!(state_budget_for(100, laya(512, 500), "q").unwrap(), 411);
    }

    #[test]
    fn whole_option_sets_that_fit_skip_the_embedder() {
        let small: IndexMap<String, String> = [("a", "short"), ("b", "also short")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let budget = OptionBudget {
            head_max_tokens: 192,
            ..OptionBudget::default()
        };
        assert!(fits_whole("pick one", &small, &budget));

        let many: IndexMap<String, String> = (0..115)
            .map(|i| {
                (
                    format!("k{i}"),
                    "a rubric of roughly forty tokens".repeat(4),
                )
            })
            .collect();
        assert!(!fits_whole("pick one", &many, &budget));
    }

    #[test]
    fn the_option_cap_follows_the_engines_declaration() {
        let facade = Facade::new(Config::default());
        // Declared cap: honoured, minus the estimator safety margin.
        assert_eq!(facade.option_cap(laya(512, 192)), Some(44));
        // Declared absence of a cap: no compression at all.
        assert_eq!(facade.option_cap(openjev()), None);
    }

    #[test]
    fn an_unbounded_engine_is_charged_for_one_option_not_all_of_them() {
        let criteria: IndexMap<String, String> = (0..115)
            .map(|i| (format!("k{i}"), "a rubric of some length".repeat(6)))
            .collect();
        let shared = head_cost(
            QuestionKind::Choice,
            "pick",
            criteria.values(),
            OptionCostModel::Shared,
        );
        let independent = head_cost(
            QuestionKind::Choice,
            "pick",
            criteria.values(),
            OptionCostModel::Independent,
        );
        assert!(shared > 3000, "115 options share one head: {shared}");
        assert!(
            independent < 100,
            "each option is its own sequence: {independent}"
        );
        // Which is what keeps a 116-option routing question answerable at all.
        assert!(state_budget_for(shared, openjev(), "q").is_err());
        assert!(state_budget_for(independent, openjev(), "q").unwrap() > 3900);
    }
}
