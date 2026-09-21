//! The copy ceiling: an input-exposure control for this rig's routing eval.
//!
//! Method and terminology follow *The Copy Ceiling: An Input-Exposure Control
//! for Ontology-Grounded Generation over Curated Corpora* (DreamLab AI,
//! 2026-09-11). Its closing recommendation is the reason this module exists:
//! *evaluations whose gold derives from the injected corpus should report a
//! copy ceiling as standard*.
//!
//! Why it is mandatory here rather than interesting. The routing eval shows a
//! judge the rubric of every candidate skill as a choice option, and the gold
//! label **is the name of one of those options**. Exposure is therefore total,
//! and some part of the measured accuracy is faithful delivery of exposed text
//! rather than judgement. The copy ceiling is what a deterministic, judge-free
//! procedure over exactly the same exposed text achieves; the signed *gain over
//! copy* is the per-item difference between the judge and that ceiling.
//!
//! Two ceilings are computed, because they bound different things:
//!
//! * **lexical (BM25)** — token overlap between the prompt and the rubric. No
//!   model at all, no network, so it can always be reported.
//! * **embedding (bge-small cosine)** — the façade's *own* shortlist ranking.
//!   This is the stronger and more honest ceiling: it is a component the
//!   pipeline already runs, so any gain below it is gain that was available for
//!   free.
//!
//! ## Two ceilings, and why the naive one is never printed alone
//!
//! A copy procedure ranks the exposed rubrics. `none` is not a skill and has no
//! rubric, so a naive copy procedure can never select it — the decline is
//! conceded to the judge by construction, and on this corpus that asymmetry
//! supplied the entire headline margin. The default here is therefore the
//! **fair** ceiling, in which each judge-free ranker is given the same
//! affordance the façade gives the engine: a score threshold below which it
//! answers `none`. [`CeilingMode::ConcedeNone`] reproduces the naive number,
//! and the renderer always states which one is on screen.
//!
//! ## Deliberate bias, in the honest direction
//!
//! The copy threshold is **oracle-tuned**: swept over this corpus and reported
//! at the value that maximises the *baseline's own* accuracy on the very data
//! it is evaluated on, and that tuning must actually FIND the maximum or the
//! floor argument it buys is void. The judge keeps whatever threshold the run used. That
//! handicaps the judge, so the reported gain is a **floor** on its advantage —
//! which is the direction an honest control should err in.
//!
//! ## Reproducibility
//!
//! Both rankers are deterministic: the tokeniser, the stoplist and the BM25
//! constants are fixed here, ties break to the lower candidate index (stable
//! sort), and the threshold sweep enumerates every breakpoint of the decline
//! rule — one below the smallest observed score, the midpoint of each adjacent
//! pair, and one above the largest — so the oracle search cannot miss the
//! maximum the way a fixed-width grid can. The embedding ranker sends **one text per
//! request, sequentially** — the estate's Xinference endpoint returns global
//! batch offsets in `data[].index` when concurrent requests merge (verified
//! 2026-09-20), so only positional order within a single-input request is
//! trustworthy.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::metrics::{Report, Scored};

/// The option key that means "no skill applies".
const NONE: &str = "none";

/// BM25 term-frequency saturation.
pub const BM25_K1: f64 = 1.5;
/// BM25 length normalisation.
pub const BM25_B: f64 = 0.75;

/// Retired: the oracle sweep no longer uses a fixed-width grid, because one
/// cannot be guaranteed to contain the maximising threshold. See
/// [`Ranked::grid`]. Kept only so a downstream reader of this constant fails
/// loudly rather than silently sweeping the wrong thing.
#[deprecated(note = "the threshold sweep is exhaustive over breakpoints; see Ranked::grid")]
pub const SWEEP_POINTS: usize = 41;

/// Characters of a text sent to the embeddings endpoint.
///
/// bge-small embeds only the first ~512 tokens (~2,500 chars) of a value, so
/// anything past this is invisible to the encoder anyway; clamping makes the
/// request size predictable instead of pretending the tail counted.
pub const EMBED_CHARS: usize = 2000;

/// Two-sided 95% normal quantile, used for the CI and the power calculation.
const Z95: f64 = 1.96;

/// The stoplist, verbatim from the measurement this module ports.
///
/// It is part of the instrument, not a tuning knob: changing it changes the
/// ceiling, and a ceiling computed with a different stoplist is not comparable
/// with a previously reported one.
pub const STOPLIST: &[&str] = &[
    "a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "with", "without", "is", "are",
    "be", "this", "that", "it", "its", "as", "at", "by", "from", "into", "over", "under", "when",
    "use", "used", "using", "not", "never", "only", "your", "you", "we", "our", "their", "they",
    "them", "there", "here", "what", "which", "who", "how", "why", "do", "does", "did", "can",
    "could", "should", "would", "may", "might", "will", "shall", "must", "if", "then", "than",
    "else", "also", "more", "most", "less", "least", "very",
];

/// Split a text into scoring tokens.
///
/// ASCII alphanumeric runs of the lowercased text, minus the stoplist, minus
/// anything three characters or shorter. Equivalent to the prototype's
/// `[t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in STOP and len(t) > 2]`:
/// Python's `[a-z0-9]` is ASCII-only, so a lowercased non-ASCII character is a
/// separator in both.
///
/// ```
/// # use system_one_eval::copy::tokenise;
/// assert_eq!(tokenise("Port the Python CLI to Rust!"), ["port", "python", "cli", "rust"]);
/// ```
pub fn tokenise(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    lowered
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() > 2 && !STOPLIST.contains(t))
        .map(str::to_string)
        .collect()
}

/// Classic BM25 of one query against a fixed document set.
///
/// Deterministic, untrained and model-free — which is the whole point: a copy
/// ceiling that needed a model would be measuring a second judge.
///
/// ```
/// # use system_one_eval::copy::{bm25, tokenise, BM25_B, BM25_K1};
/// let docs: Vec<Vec<String>> = ["port python to rust", "render a mermaid diagram"]
///     .iter()
///     .map(|d| tokenise(d))
///     .collect();
/// let scores = bm25(&tokenise("rust port"), &docs, BM25_K1, BM25_B);
/// assert!(scores[0] > scores[1]);
/// ```
pub fn bm25(query: &[String], docs: &[Vec<String>], k1: f64, b: f64) -> Vec<f64> {
    if docs.is_empty() {
        return Vec::new();
    }
    let n = docs.len() as f64;
    let lengths: Vec<f64> = docs.iter().map(|d| d.len() as f64).collect();
    let avgdl = lengths.iter().sum::<f64>() / n;

    let mut df: BTreeMap<&str, f64> = BTreeMap::new();
    for doc in docs {
        let mut seen: Vec<&str> = doc.iter().map(String::as_str).collect();
        seen.sort_unstable();
        seen.dedup();
        for term in seen {
            *df.entry(term).or_insert(0.0) += 1.0;
        }
    }

    // The query's DISTINCT terms, as `set(query)` in the prototype.
    let mut terms: Vec<&str> = query.iter().map(String::as_str).collect();
    terms.sort_unstable();
    terms.dedup();

    docs.iter()
        .enumerate()
        .map(|(i, doc)| {
            let mut tf: BTreeMap<&str, f64> = BTreeMap::new();
            for term in doc {
                *tf.entry(term.as_str()).or_insert(0.0) += 1.0;
            }
            terms
                .iter()
                .filter_map(|term| {
                    let f = *tf.get(term)?;
                    let d = df.get(term).copied().unwrap_or(0.0);
                    let idf = (1.0 + (n - d + 0.5) / (d + 0.5)).ln();
                    Some(idf * (f * (k1 + 1.0)) / (f + k1 * (1.0 - b + b * lengths[i] / avgdl)))
                })
                .sum()
        })
        .collect()
}

/// Cosine similarity in `f64` over `f32` vectors.
///
/// bge-small returns unit vectors, so this equals the prototype's plain dot
/// product; normalising anyway means a non-normalising endpoint would degrade
/// the score rather than silently corrupt the ranking.
pub fn cosine(a: &[f32], b: &[f32]) -> f64 {
    let n = a.len().min(b.len());
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for i in 0..n {
        dot += a[i] as f64 * b[i] as f64;
        na += a[i] as f64 * a[i] as f64;
        nb += b[i] as f64 * b[i] as f64;
    }
    if na <= 0.0 || nb <= 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

/// A strictly sequential, one-text-per-request embeddings client.
///
/// Not the façade's [`system_one_facade::embed::Embedder`], and deliberately
/// so: that one batches and issues its batches concurrently, which is exactly
/// the condition under which this estate's Xinference endpoint renumbers
/// `data[].index` against a merged global batch. A measurement rig cannot
/// afford to rely on a guard against mis-numbering when it can simply never
/// create the ambiguity. One input, one request, one vector, in order.
#[derive(Debug)]
pub struct SequentialEmbedder {
    http: reqwest::Client,
    url: String,
    model: String,
}

#[derive(Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: [&'a str; 1],
}

#[derive(Deserialize)]
struct EmbedItem {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedItem>,
}

impl SequentialEmbedder {
    /// Build a client for an OpenAI-shaped `/v1/embeddings` endpoint.
    pub fn new(url: &str, model: &str, timeout: Duration) -> Result<Self, String> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(timeout)
                .build()
                .map_err(|e| format!("cannot build an embeddings client: {e}"))?,
            url: url.to_string(),
            model: model.to_string(),
        })
    }

    /// Embed one text.
    pub async fn embed_one(&self, text: &str) -> Result<Vec<f32>, String> {
        let clamped: String = text.chars().take(EMBED_CHARS).collect();
        let res = self
            .http
            .post(&self.url)
            .json(&EmbedRequest {
                model: &self.model,
                input: [clamped.as_str()],
            })
            .send()
            .await
            .map_err(|e| format!("embeddings request to {} failed: {e}", self.url))?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(format!(
                "embeddings endpoint returned {status}: {}",
                body.chars().take(200).collect::<String>()
            ));
        }
        let parsed: EmbedResponse = res
            .json()
            .await
            .map_err(|e| format!("embeddings response was not usable JSON: {e}"))?;
        match parsed.data.into_iter().next() {
            Some(item) if !item.embedding.is_empty() => Ok(item.embedding),
            _ => Err("embeddings endpoint returned no vector for a single input".into()),
        }
    }

    /// Embed every text in order, one request at a time.
    ///
    /// `what` names the batch in the progress line written to stderr; a 201-call
    /// sequential encode is slow enough that silence looks like a hang.
    pub async fn embed_all(&self, texts: &[String], what: &str) -> Result<Vec<Vec<f32>>, String> {
        let mut out = Vec::with_capacity(texts.len());
        for (i, text) in texts.iter().enumerate() {
            out.push(self.embed_one(text).await?);
            if (i + 1) % 25 == 0 || i + 1 == texts.len() {
                eprintln!("  embedded {}/{} {what}", i + 1, texts.len());
            }
        }
        Ok(out)
    }
}

/// The exposed text a copy procedure is allowed to see.
///
/// Exactly the candidate map the rig hands the judge, rendered as
/// `"<option key>: <rubric>"`. The key is included because the key is shown to
/// the judge too — it is part of the exposure, and a control that hid it would
/// be measuring a weaker copy than the one actually available.
#[derive(Debug, Clone)]
pub struct Exposure {
    /// Option keys, in candidate-map order.
    pub names: Vec<String>,
    /// The rendered rubric per option.
    pub rubrics: Vec<String>,
    /// Tokenised rubrics, for BM25.
    pub doc_tokens: Vec<Vec<String>>,
}

/// Markers that open an option's EXCLUSION clause — the part of a rubric that
/// says what the option is *not* for, and which option to use instead.
///
/// Lower-cased substring match, first hit wins, everything from the marker to
/// the end of the rubric is dropped before indexing.
pub const EXCLUSION_MARKERS: &[&str] = &[
    "not for",
    "never for",
    "skip for",
    "skip when",
    "do not use",
    "do not choose",
    "choose this only when",
    "rather than this",
    ", not this",
    "instead of this",
    "use the ",
];

/// Everything before the first exclusion marker, or the whole rubric.
///
/// Why a copy control MUST do this. A rubric's exclusion clause names the
/// option's topical NEIGHBOURS: "NOT for distributed sync, use X" is dense in
/// exactly the vocabulary of the thing it disclaims. Indexed as ordinary
/// positive text — which is what a single undifferentiated bag does — it scores
/// a turn about distributed sync HIGHEST on the rubric that exists to say it is
/// not for distributed sync. That is not a conservative ceiling, it is a
/// mis-indexed one, and it understates the copy a real copier could perform.
///
/// Deletion, not subtraction. Subtracting an exclusion field as negative
/// evidence was measured WORSE at every weight tried, for the same reason the
/// clause is dangerous in the first place: penalising a rubric on its own
/// neighbourhood pushes it down precisely where it is most relevant.
///
/// The paper this instrument implements argues that a copy ceiling must be the
/// strongest judge-free procedure available, because the whole value of the
/// control is that the gain above it is a floor. On this repository's routing
/// corpus, indexing exclusion clauses positively cost the ceiling 5.8 points
/// (79.1% to 84.9%) and manufactured most of a judge advantage that does not
/// survive their removal. An instrument that deflates other people's results
/// has to survive its own test first.
fn strip_exclusion_clause(rubric: &str) -> &str {
    let lower = rubric.to_lowercase();
    match EXCLUSION_MARKERS
        .iter()
        .filter_map(|m| lower.find(m))
        .min()
    {
        Some(cut) => rubric[..cut].trim_end(),
        None => rubric,
    }
}

impl Exposure {
    /// Build the exposure from the rig's candidate map.
    ///
    /// Each option is rendered `"<key>: <rubric>"` with its exclusion clause
    /// removed (see [`strip_exclusion_clause`]). The key is kept because the
    /// judge sees it too.
    pub fn new(candidates: &indexmap::IndexMap<String, String>) -> Self {
        let names: Vec<String> = candidates.keys().cloned().collect();
        let rubrics: Vec<String> = candidates
            .iter()
            .map(|(name, rubric)| format!("{name}: {}", strip_exclusion_clause(rubric)))
            .collect();
        let doc_tokens = rubrics.iter().map(|r| tokenise(r)).collect();
        Self {
            names,
            rubrics,
            doc_tokens,
        }
    }

    /// How many options carried an exclusion clause that was dropped.
    pub fn excluded_clause_count(candidates: &indexmap::IndexMap<String, String>) -> usize {
        candidates
            .values()
            .filter(|r| strip_exclusion_clause(r).len() < r.len())
            .count()
    }
}

/// What one judge-free ranker produced for one case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pick {
    /// The ranker's top three option keys, best first.
    pub top: Vec<String>,
    /// The absolute score of the best option — what the decline threshold sees.
    pub best_score: f64,
    /// Every option scored identically, so this "pick" is the tie-break order
    /// and nothing else. Overwhelmingly the all-zero case: no option's text
    /// shares a content token with the state.
    ///
    /// Reported rather than hidden because a ceiling built from degenerate
    /// picks is not a measurement of what a copier achieves — it is the rate at
    /// which the candidate-map order happens to put the gold first, which is
    /// chance. Long, overlapping rubrics hide this completely (it never occurs
    /// on this repository's routing corpus); short option labels do not, and
    /// external suites reach 100% degenerate on some slices.
    #[serde(default)]
    pub degenerate: bool,
}

/// Rank scores into a [`Pick`], ties breaking to the lower candidate index.
fn pick_from(scores: &[f64], names: &[String]) -> Pick {
    let first = scores.first().copied().unwrap_or(0.0);
    let degenerate = scores.len() > 1 && scores.iter().all(|s| (s - first).abs() < f64::EPSILON);
    let mut order: Vec<usize> = (0..names.len()).collect();
    // Stable sort: equal scores keep candidate-map order, so the ranking is
    // reproducible rather than dependent on the sort's internals.
    order.sort_by(|a, b| {
        scores[*b]
            .partial_cmp(&scores[*a])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Pick {
        top: order
            .iter()
            .take(3)
            .map(|i| names[*i].clone())
            .collect::<Vec<_>>(),
        best_score: order.first().map_or(f64::NEG_INFINITY, |i| scores[*i]),
        degenerate,
    }
}

/// One judge-free procedure over the exposed rubrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ranker {
    /// Human label used in the report.
    pub label: String,
    /// One pick per corpus case, in corpus order.
    pub picks: Vec<Pick>,
}

impl Ranker {
    /// The lexical ceiling: BM25 over the exposed rubrics. No model, no network.
    pub fn bm25(exposure: &Exposure, prompts: &[String]) -> Self {
        let picks = prompts
            .iter()
            .map(|prompt| {
                let scores = bm25(&tokenise(prompt), &exposure.doc_tokens, BM25_K1, BM25_B);
                pick_from(&scores, &exposure.names)
            })
            .collect();
        Self {
            label: "lexical (BM25)".into(),
            picks,
        }
    }

    /// The embedding ceiling: bge-small cosine, the façade's own shortlist rank.
    pub async fn embedding(
        exposure: &Exposure,
        prompts: &[String],
        embedder: &SequentialEmbedder,
    ) -> Result<Self, String> {
        let rubric_vectors = embedder.embed_all(&exposure.rubrics, "rubrics").await?;
        let prompt_vectors = embedder.embed_all(prompts, "prompts").await?;
        let picks = prompt_vectors
            .iter()
            .map(|prompt| {
                let scores: Vec<f64> = rubric_vectors.iter().map(|r| cosine(prompt, r)).collect();
                pick_from(&scores, &exposure.names)
            })
            .collect();
        Ok(Self {
            label: "embedding (bge-small)".into(),
            picks,
        })
    }

    /// Per-item top-1 and top-3 correctness at one decline threshold.
    ///
    /// Below the threshold the ranker answers `none`, and its top-3 becomes
    /// `none` followed by its own top two — the same shape the judge's advisory
    /// line has when the façade's decline rule fires.
    pub fn per_item(&self, expected: &[String], threshold: f64) -> Vec<(bool, bool)> {
        self.picks
            .iter()
            .zip(expected)
            .map(|(pick, want)| {
                if pick.best_score < threshold {
                    let mut top3 = vec![NONE.to_string()];
                    top3.extend(pick.top.iter().take(2).cloned());
                    (want == NONE, top3.iter().any(|t| t == want))
                } else {
                    (
                        pick.top.first().is_some_and(|t| t == want),
                        pick.top.iter().take(3).any(|t| t == want),
                    )
                }
            })
            .collect()
    }

    /// Accuracy at one decline threshold.
    pub fn score_at(&self, expected: &[String], threshold: f64) -> CeilingPoint {
        let items = self.per_item(expected, threshold);
        let n = items.len().max(1) as f64;
        CeilingPoint {
            threshold,
            top1: items.iter().filter(|(t1, _)| *t1).count() as f64 / n,
            top3: items.iter().filter(|(_, t3)| *t3).count() as f64 / n,
            declines: self
                .picks
                .iter()
                .filter(|p| p.best_score < threshold)
                .count(),
        }
    }

    /// Every threshold that can change this ranker's answer: one below the
    /// smallest observed score, the midpoint between each adjacent pair of
    /// observed scores, and one above the largest.
    ///
    /// A `decline if best_score < t` rule is a step function of `t` whose only
    /// breakpoints are the observed scores, so this enumeration is exhaustive:
    /// it is guaranteed to contain the accuracy-maximising threshold. An
    /// evenly-spaced grid is NOT, and the difference is not academic — the
    /// previous 41-point grid stepped over the true optimum on this repository's
    /// own routing corpus, reporting a BM25 ceiling of 66/86 where 68/86 was
    /// attainable in the window `9.5715 < t <= 9.7420`. That understated the
    /// ceiling by 2.3 points and so OVERSTATED the judge's gain by the same
    /// amount, which is the one direction an oracle-tuned control must never
    /// err in: the whole argument for tuning the baseline on its own evaluation
    /// set is that doing so makes the reported gain a floor, and a grid search
    /// that misses the maximum silently withdraws that guarantee.
    pub fn grid(&self) -> Vec<f64> {
        let mut scores: Vec<f64> = self
            .picks
            .iter()
            .map(|p| p.best_score)
            .filter(|s| s.is_finite())
            .collect();
        if scores.is_empty() {
            return vec![f64::NEG_INFINITY];
        }
        scores.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
        scores.dedup();
        let mut out = Vec::with_capacity(scores.len() + 1);
        // Below every score: decline nothing.
        out.push(scores[0] - 1.0);
        for pair in scores.windows(2) {
            out.push(f64::midpoint(pair[0], pair[1]));
        }
        // Above every score: decline everything.
        out.push(scores[scores.len() - 1] + 1.0);
        out
    }

    /// The threshold that maximises this ranker's OWN top-1 accuracy here.
    ///
    /// Oracle tuning, and the report says so. It is the baseline that is being
    /// flattered, so the judge's reported gain is a floor. Ties go to the lower
    /// threshold, which declines less and therefore concedes less.
    pub fn oracle(&self, expected: &[String]) -> CeilingPoint {
        let mut best: Option<CeilingPoint> = None;
        for threshold in self.grid() {
            let point = self.score_at(expected, threshold);
            if best.as_ref().is_none_or(|b| point.top1 > b.top1) {
                best = Some(point);
            }
        }
        best.unwrap_or(CeilingPoint {
            threshold: f64::NEG_INFINITY,
            top1: 0.0,
            top3: 0.0,
            declines: 0,
        })
    }
}

/// Accuracy of a judge-free ranker at one decline threshold.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CeilingPoint {
    /// The decline threshold in force. `-inf` means "never declines".
    pub threshold: f64,
    /// Top-1 accuracy over every case.
    pub top1: f64,
    /// Top-3 accuracy over every case.
    pub top3: f64,
    /// Cases where the threshold fired.
    pub declines: usize,
}

/// Which ceiling is being reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CeilingMode {
    /// Each ranker gets an oracle-tuned decline threshold. The default.
    Fair,
    /// No decline for the ranker: `none` is conceded to the judge outright.
    ///
    /// Flatters the judge by construction, so it is never rendered alone.
    ConcedeNone,
}

impl CeilingMode {
    /// One line naming the mode, for the report header.
    pub fn describe(self) -> &'static str {
        match self {
            CeilingMode::Fair => {
                "FAIR — each judge-free ranker gets an oracle-tuned decline threshold"
            }
            CeilingMode::ConcedeNone => {
                "NAIVE — the ranker cannot decline, so `none` is conceded to the judge"
            }
        }
    }
}

/// Signed per-item gain over copy, with its interval and its power.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gain {
    /// Items compared.
    pub n: usize,
    /// Mean of the signed per-item difference, judge minus copy.
    pub mean: f64,
    /// Sample variance of that difference.
    pub variance: f64,
    /// Lower bound of the 95% normal-approximation interval.
    pub ci_low: f64,
    /// Upper bound of the 95% normal-approximation interval.
    pub ci_high: f64,
    /// Items the judge got right and the copy procedure did not.
    pub judge_only: usize,
    /// Items the copy procedure got right and the judge did not.
    pub copy_only: usize,
    /// Items needed for the interval to exclude zero at the observed effect.
    ///
    /// `None` when the mean is zero, where no sample size suffices.
    pub required_n: Option<usize>,
}

impl Gain {
    /// Whether the interval already excludes zero.
    pub fn significant(&self) -> bool {
        self.ci_low > 0.0 || self.ci_high < 0.0
    }
}

/// Signed per-item gain of the judge over a copy procedure.
///
/// The interval is a **normal approximation** on the paired mean difference —
/// the prototype's method, and adequate for a bounded ±1 difference at this
/// sample size. `required_n` inverts the same approximation: the interval
/// excludes zero once `z·sqrt(s²/n) < |mean|`, i.e. `n > z²s²/mean²`, holding
/// the observed mean and variance fixed. That is a projection, not a promise:
/// more items will move both.
///
/// ```
/// # use system_one_eval::copy::gain;
/// let judge = [true, true, false, true];
/// let copy = [true, false, false, false];
/// let g = gain(&judge, &copy);
/// assert_eq!((g.judge_only, g.copy_only), (2, 0));
/// assert!((g.mean - 0.5).abs() < 1e-12);
/// ```
pub fn gain(judge: &[bool], copy: &[bool]) -> Gain {
    let diffs: Vec<f64> = judge
        .iter()
        .zip(copy)
        .map(|(j, c)| f64::from(*j) - f64::from(*c))
        .collect();
    let n = diffs.len();
    if n == 0 {
        return Gain {
            n: 0,
            mean: 0.0,
            variance: 0.0,
            ci_low: 0.0,
            ci_high: 0.0,
            judge_only: 0,
            copy_only: 0,
            required_n: None,
        };
    }
    let mean = diffs.iter().sum::<f64>() / n as f64;
    let variance = if n > 1 {
        diffs.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1) as f64
    } else {
        0.0
    };
    let half_width = Z95 * (variance / n as f64).sqrt();
    let required_n = if mean.abs() <= f64::EPSILON {
        None
    } else {
        // Strictly `n > z²s²/mean²`, so step past an exact boundary.
        let exact = Z95 * Z95 * variance / (mean * mean);
        let next = exact.floor() as usize + 1;
        Some(next.max(1))
    };
    Gain {
        n,
        mean,
        variance,
        ci_low: mean - half_width,
        ci_high: mean + half_width,
        judge_only: diffs.iter().filter(|d| **d > 0.0).count(),
        copy_only: diffs.iter().filter(|d| **d < 0.0).count(),
        required_n,
    }
}

/// One judge-free ranker's contribution to the report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankerReport {
    /// Ranker label.
    pub label: String,
    /// Accuracy with no decline mechanism at all — the naive ceiling.
    pub without_decline: CeilingPoint,
    /// Accuracy at the threshold in force for this report's mode.
    pub applied: CeilingPoint,
    /// Whether `applied.threshold` was oracle-tuned on this corpus.
    pub oracle_tuned: bool,
    /// Judge top-1 minus ceiling top-1, in points.
    pub gain_top1_points: f64,
    /// Judge top-3 minus ceiling top-3, in points.
    pub gain_top3_points: f64,
    /// Signed per-item gain over this ceiling, top-1.
    pub per_item: Gain,
}

/// A subgroup row: the judge and each ceiling over one slice of the corpus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubgroupRow {
    /// Slice label.
    pub label: String,
    /// Cases in the slice.
    pub n: usize,
    /// Judge top-1 accuracy over the slice.
    pub judge_top1: f64,
    /// Ceiling top-1 accuracy over the slice, per ranker, in ranker order.
    pub ceiling_top1: Vec<f64>,
}

/// The judge half of the comparison, as the run reported it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgeSummary {
    /// Backend label.
    pub backend: String,
    /// Model that answered.
    pub model: String,
    /// Top-1 accuracy.
    pub top1: f64,
    /// Top-3 accuracy.
    pub top3: f64,
    /// The decline threshold the run used, when the backend reported one.
    pub none_threshold: Option<f64>,
}

/// A complete copy-ceiling control over one run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyCeiling {
    /// Which ceiling is reported.
    pub mode: CeilingMode,
    /// Cases compared.
    pub cases: usize,
    /// Exposed options a copy procedure could rank (`none` is not one of them).
    pub exposed_options: usize,
    /// The judge's own numbers.
    pub judge: JudgeSummary,
    /// One entry per judge-free ranker.
    pub rankers: Vec<RankerReport>,
    /// Subgroup breakdown, judge against every ceiling.
    pub subgroups: Vec<SubgroupRow>,
}

/// Build the control from a run's report and one or more judge-free rankers.
///
/// Cases the backend failed to answer stay in, counted as wrong, exactly as the
/// run itself counts them: a control that dropped them would compare the
/// judge's good days against the ceiling's every day.
pub fn build(
    report: &Report,
    exposure: &Exposure,
    rankers: &[Ranker],
    mode: CeilingMode,
) -> CopyCeiling {
    let expected: Vec<String> = report.cases.iter().map(|c| c.expected.clone()).collect();
    let judge_top1: Vec<bool> = report.cases.iter().map(|c| c.correct).collect();
    let judge_top3: Vec<bool> = report.cases.iter().map(|c| c.soft_correct).collect();

    let reports: Vec<RankerReport> = rankers
        .iter()
        .map(|ranker| {
            let without_decline = ranker.score_at(&expected, f64::NEG_INFINITY);
            let applied = match mode {
                CeilingMode::Fair => ranker.oracle(&expected),
                CeilingMode::ConcedeNone => without_decline.clone(),
            };
            let copy_top1: Vec<bool> = ranker
                .per_item(&expected, applied.threshold)
                .into_iter()
                .map(|(t1, _)| t1)
                .collect();
            let judge_t1 = fraction(&judge_top1);
            let judge_t3 = fraction(&judge_top3);
            RankerReport {
                label: ranker.label.clone(),
                gain_top1_points: (judge_t1 - applied.top1) * 100.0,
                gain_top3_points: (judge_t3 - applied.top3) * 100.0,
                per_item: gain(&judge_top1, &copy_top1),
                oracle_tuned: mode == CeilingMode::Fair,
                without_decline,
                applied,
            }
        })
        .collect();

    let subgroups = subgroups(report, rankers, &expected, &reports);

    CopyCeiling {
        mode,
        cases: report.cases.len(),
        exposed_options: exposure.names.len(),
        judge: JudgeSummary {
            backend: report.backend.clone(),
            model: report.model.clone(),
            top1: fraction(&judge_top1),
            top3: fraction(&judge_top3),
            none_threshold: report.sso.as_ref().and_then(|s| s.none_threshold),
        },
        rankers: reports,
        subgroups,
    }
}

fn fraction(flags: &[bool]) -> f64 {
    if flags.is_empty() {
        0.0
    } else {
        flags.iter().filter(|f| **f).count() as f64 / flags.len() as f64
    }
}

/// The slices the report breaks down by, in the order they are printed.
fn slices(report: &Report) -> Vec<(String, Vec<usize>)> {
    let index_where = |f: &dyn Fn(&Scored) -> bool| -> Vec<usize> {
        report
            .cases
            .iter()
            .enumerate()
            .filter(|(_, c)| f(c))
            .map(|(i, _)| i)
            .collect()
    };
    let mut out = vec![
        ("all items".to_string(), index_where(&|_| true)),
        (
            "skill items (copyable)".to_string(),
            index_where(&|c| c.expected != NONE),
        ),
        (
            "`none` items".to_string(),
            index_where(&|c| c.expected == NONE),
        ),
        (
            "late discriminator".to_string(),
            index_where(&|c| c.late_discriminator),
        ),
        (
            "early discriminator".to_string(),
            index_where(&|c| !c.late_discriminator),
        ),
    ];
    let mut classes: Vec<String> = report
        .cases
        .iter()
        .map(|c| {
            if c.class.is_empty() {
                "unclassified".to_string()
            } else {
                c.class.clone()
            }
        })
        .collect();
    classes.sort();
    classes.dedup();
    for class in classes {
        let wanted = class.clone();
        out.push((
            format!("class {class}"),
            index_where(&|c| {
                let name = if c.class.is_empty() {
                    "unclassified"
                } else {
                    c.class.as_str()
                };
                name == wanted
            }),
        ));
    }
    out
}

fn subgroups(
    report: &Report,
    rankers: &[Ranker],
    expected: &[String],
    reports: &[RankerReport],
) -> Vec<SubgroupRow> {
    let per_ranker: Vec<Vec<bool>> = rankers
        .iter()
        .zip(reports)
        .map(|(ranker, r)| {
            ranker
                .per_item(expected, r.applied.threshold)
                .into_iter()
                .map(|(t1, _)| t1)
                .collect()
        })
        .collect();

    slices(report)
        .into_iter()
        .filter(|(_, idx)| !idx.is_empty())
        .map(|(label, idx)| SubgroupRow {
            n: idx.len(),
            judge_top1: fraction(
                &idx.iter()
                    .map(|i| report.cases[*i].correct)
                    .collect::<Vec<_>>(),
            ),
            ceiling_top1: per_ranker
                .iter()
                .map(|flags| fraction(&idx.iter().map(|i| flags[*i]).collect::<Vec<_>>()))
                .collect(),
            label,
        })
        .collect()
}

/// Render the control as the text an operator reads.
///
/// The FAIR ceiling is always present. When the naive one is asked for it is
/// printed *beside* the fair one, never instead of it, because a naive ceiling
/// alone reads as a larger judge advantage than the evidence supports.
pub fn render(ceiling: &CopyCeiling) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "{}\nCOPY CEILING — judge-free procedures over the SAME exposed rubrics\n\
         method: DreamLab AI, 'The Copy Ceiling' (2026-09-11), §Making it Runnable\n{}\n",
        "=".repeat(86),
        "=".repeat(86),
    ));
    out.push_str(&format!(
        "mode        {}\n\
         judge       {} / {}\n\
         exposure    {} option rubrics shown to the judge; the gold label is one of them\n\
         cases       {}\n",
        ceiling.mode.describe(),
        ceiling.judge.backend,
        ceiling.judge.model,
        ceiling.exposed_options,
        ceiling.cases,
    ));
    match ceiling.judge.none_threshold {
        Some(t) => out.push_str(&format!(
            "judge thr   {t:.3} — the value the run deployed, NOT its own best\n"
        )),
        None => {
            out.push_str("judge thr   none reported — the backend did not apply a decline rule\n")
        }
    }
    out.push_str(&format!(
        "\njudge       top-1 {:>6.1}%   top-3 {:>6.1}%\n\n",
        ceiling.judge.top1 * 100.0,
        ceiling.judge.top3 * 100.0
    ));

    for r in &ceiling.rankers {
        out.push_str(&format!("{}\n", r.label));
        out.push_str(&format!(
            "  no decline      top-1 {:>6.1}%   top-3 {:>6.1}%   (naive ceiling: `none` is \
             unreachable, so it is conceded to the judge)\n",
            r.without_decline.top1 * 100.0,
            r.without_decline.top3 * 100.0,
        ));
        if r.oracle_tuned {
            out.push_str(&format!(
                "  with decline    top-1 {:>6.1}%   top-3 {:>6.1}%   (threshold {:.4}, \
                 ORACLE-TUNED on this corpus, fired on {} of {})\n",
                r.applied.top1 * 100.0,
                r.applied.top3 * 100.0,
                r.applied.threshold,
                r.applied.declines,
                ceiling.cases,
            ));
        }
        out.push_str(&format!(
            "  gain over copy  top-1 {:>+6.1} pts   top-3 {:>+6.1} pts\n",
            r.gain_top1_points, r.gain_top3_points
        ));
        let g = &r.per_item;
        out.push_str(&format!(
            "  signed/item     mean {:+.3}   95% CI [{:+.3},{:+.3}]   judge-only-right {}   \
             copy-only-right {}\n",
            g.mean, g.ci_low, g.ci_high, g.judge_only, g.copy_only,
        ));
        out.push_str(&format!("  POWER           {}\n\n", power_line(g)));
    }

    // One column per ranker, not a fixed two: a `run` that computed only the
    // lexical ceiling should not print an empty column headed by a dash.
    // Headers are clipped to the column so a long label cannot run into it.
    out.push_str("subgroup breakdown, top-1\n");
    let mut header = format!("  {:<24}{:>4}{:>9}", "population", "n", "judge");
    for ranker in &ceiling.rankers {
        let label: String = ranker.label.chars().take(24).collect();
        header.push_str(&format!("{label:>26}"));
    }
    out.push_str(&header);
    out.push('\n');
    for row in &ceiling.subgroups {
        let mut line = format!(
            "  {:<24}{:>4}{:>8.1}%",
            row.label,
            row.n,
            row.judge_top1 * 100.0
        );
        for value in &row.ceiling_top1 {
            line.push_str(&format!(
                "{:>15.1}% {:>+8.1}",
                value * 100.0,
                (row.judge_top1 - value) * 100.0
            ));
        }
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str(
        "\n  (each ceiling column shows the ceiling's accuracy and the judge's gain over it)\n",
    );
    out.push_str(
        "\nreading: the copy threshold is tuned on the corpus it is scored on, so the ceiling is\n\
         flattered and the judge's gain is a FLOOR. `none` items are the ones a copy procedure\n\
         can only reach through its decline rule — if the judge's advantage concentrates there,\n\
         the advantage is in declining, not in picking among exposed options.\n",
    );
    out
}

/// The POWER line: what n the observed effect would need.
fn power_line(g: &Gain) -> String {
    if g.n == 0 {
        return "no items compared".into();
    }
    if g.significant() {
        return format!(
            "the interval already excludes zero at n={} (it holds from about n={})",
            g.n,
            g.required_n.unwrap_or(g.n)
        );
    }
    match g.required_n {
        Some(required) if required > g.n => format!(
            "UNDERPOWERED at n={}: holding the observed mean {:+.3} and variance {:.4}, the 95% \
             interval excludes zero from about n={} — {} more labelled cases",
            g.n,
            g.mean,
            g.variance,
            required,
            required - g.n
        ),
        Some(required) => format!(
            "n={} already meets the projected n={}, yet the interval includes zero — read the \
             projection as an approximation, not a guarantee",
            g.n, required
        ),
        None => format!(
            "the observed mean is exactly zero at n={}, so no sample size separates it",
            g.n
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;

    fn exposure() -> Exposure {
        let mut map = IndexMap::new();
        map.insert(
            "rust-engineer".to_string(),
            "Ports Python glue, CLIs and evaluators to Rust.".to_string(),
        );
        map.insert(
            "mermaid-diagrams".to_string(),
            "Renders a single Mermaid diagram inside a reply.".to_string(),
        );
        map.insert(
            "diagrams-as-code".to_string(),
            "Maintains a checked-in diagram corpus for a whole repository.".to_string(),
        );
        Exposure::new(&map)
    }

    #[test]
    fn the_tokeniser_is_the_prototypes_tokeniser() {
        assert_eq!(
            tokenise("Port the Python CLI to Rust, not to Go!"),
            ["port", "python", "cli", "rust"]
        );
        // Short tokens and stopwords go; digits stay; non-ASCII separates.
        assert_eq!(tokenise("a of 42 caf\u{e9}s 007"), ["caf", "007"]);
    }

    #[test]
    fn bm25_prefers_the_rubric_that_shares_rare_terms() {
        let exposure = exposure();
        let scores = bm25(
            &tokenise("port this python cli to rust"),
            &exposure.doc_tokens,
            BM25_K1,
            BM25_B,
        );
        let pick = pick_from(&scores, &exposure.names);
        assert_eq!(pick.top[0], "rust-engineer");
        assert!(pick.best_score > 0.0);
    }

    #[test]
    fn bm25_matches_a_hand_computed_value() {
        // One document set, one query term present in exactly one document:
        // idf = ln(1 + (2 - 1 + 0.5)/(1 + 0.5)) = ln(2).
        let docs = vec![
            vec!["alpha".to_string(), "beta".to_string()],
            vec!["gamma".to_string(), "delta".to_string()],
        ];
        let scores = bm25(&["alpha".to_string()], &docs, BM25_K1, BM25_B);
        let expected = 2f64.ln() * (1.0 * (BM25_K1 + 1.0))
            / (1.0 + BM25_K1 * (1.0 - BM25_B + BM25_B * 2.0 / 2.0));
        assert!((scores[0] - expected).abs() < 1e-12, "{scores:?}");
        assert_eq!(scores[1], 0.0);
    }

    #[test]
    fn ties_break_to_the_lower_candidate_index() {
        let exposure = exposure();
        let pick = pick_from(&[1.0, 1.0, 1.0], &exposure.names);
        assert_eq!(pick.top, exposure.names[..3]);
    }

    fn ranker() -> Ranker {
        Ranker {
            label: "t".into(),
            picks: vec![
                Pick {
                    top: vec!["a".into(), "b".into(), "c".into()],
                    best_score: 0.9,
                    degenerate: false,
                },
                Pick {
                    top: vec!["b".into(), "a".into(), "c".into()],
                    best_score: 0.1,
                    degenerate: false,
                },
            ],
        }
    }

    #[test]
    fn without_a_decline_rule_none_is_unreachable() {
        let expected = vec!["a".to_string(), NONE.to_string()];
        let point = ranker().score_at(&expected, f64::NEG_INFINITY);
        assert!(
            (point.top1 - 0.5).abs() < 1e-12,
            "only the skill item lands"
        );
        assert_eq!(point.declines, 0);
        assert!(
            (point.top3 - 0.5).abs() < 1e-12,
            "`none` is not in any top-3 either"
        );
    }

    #[test]
    fn a_decline_threshold_lets_the_copy_procedure_reach_none() {
        let expected = vec!["a".to_string(), NONE.to_string()];
        let point = ranker().score_at(&expected, 0.5);
        assert!((point.top1 - 1.0).abs() < 1e-12);
        assert_eq!(point.declines, 1);
    }

    #[test]
    fn the_oracle_threshold_maximises_the_baselines_own_accuracy() {
        let expected = vec!["a".to_string(), NONE.to_string()];
        let best = ranker().oracle(&expected);
        assert!((best.top1 - 1.0).abs() < 1e-12);
        assert!(best.threshold > 0.1 && best.threshold <= 0.9);
        // The sweep enumerates the decline rule's breakpoints: one below the
        // smallest score, a midpoint per adjacent pair, one above the largest.
        let grid = ranker().grid();
        assert_eq!(grid.len(), 3, "two distinct scores yield below/mid/above");
        assert!(grid[0] < 0.1, "first threshold declines nothing");
        assert!(grid[2] > 0.9, "last threshold declines everything");
        assert!(grid[1] > 0.1 && grid[1] < 0.9, "midpoint separates the two");
    }

    #[test]
    fn an_all_equal_score_vector_is_flagged_degenerate() {
        // No option's text shares a content token with the state, so BM25
        // returns zeros and the "pick" is only the candidate-map order. On
        // external suites with short option labels this reaches 100% of a
        // slice; a ceiling built from these is chance, not a copy.
        let names = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let flat = pick_from(&[0.0, 0.0, 0.0], &names);
        assert!(flat.degenerate, "an all-zero score vector is not a ranking");
        assert_eq!(flat.top[0], "a", "ties still break to candidate-map order");
        let real = pick_from(&[0.0, 2.0, 0.0], &names);
        assert!(!real.degenerate);
        assert_eq!(real.top[0], "b");
    }

    #[test]
    fn a_fixed_width_grid_can_miss_the_maximum_that_the_breakpoint_sweep_finds() {
        // The regression this guards: on the routing corpus a 41-point even
        // grid reported a BM25 ceiling of 66/86 where 68/86 was attainable,
        // because the winning window was narrower than one grid step. Two
        // `none` items sat just under a cluster of correctly-answered skill
        // items, so only a threshold inside that gap recovers them.
        let scores = [0.10_f64, 9.5715, 9.5716, 9.7420, 9.7421];
        let picks: Vec<Pick> = scores
            .iter()
            .map(|s| Pick {
                top: vec!["a".into(), "b".into(), "c".into()],
                best_score: *s,
                degenerate: false,
            })
            .collect();
        let ranked = Ranker {
            label: "t".into(),
            picks,
        };
        let grid = ranked.grid();
        // Exhaustive: a threshold strictly inside the narrow gap exists.
        assert!(
            grid.iter().any(|t| *t > 9.5716 && *t <= 9.7420),
            "breakpoint sweep must contain a threshold inside the winning window"
        );
        // A 41-point even sweep over the same range does not.
        let (lo, hi) = (0.10_f64, 9.7421_f64);
        let even: Vec<f64> = (0..=40).map(|i| lo + (hi - lo) * i as f64 / 40.0).collect();
        assert!(
            !even.iter().any(|t| *t > 9.5716 && *t <= 9.7420),
            "the even grid is expected to step over the window — that was the bug"
        );
    }

    #[test]
    fn gain_reports_both_directions_and_its_own_power() {
        // 15 judge-only wins, 7 copy-only wins over 86 items: the measured
        // shape of this corpus. Mean +8/86 = +0.093.
        let mut judge = Vec::new();
        let mut copy = Vec::new();
        let mut push = |j: bool, c: bool, times: usize| {
            for _ in 0..times {
                judge.push(j);
                copy.push(c);
            }
        };
        push(true, false, 15); // judge-only-right
        push(false, true, 7); // copy-only-right
        push(true, true, 64); // both right
        let g = gain(&judge, &copy);
        assert_eq!(g.n, 86);
        assert_eq!(g.judge_only, 15);
        assert_eq!(g.copy_only, 7);
        assert!((g.mean - 8.0 / 86.0).abs() < 1e-12);
        assert!(g.ci_low < 0.0 && g.ci_high > 0.0, "underpowered at n=86");
        let required = g.required_n.expect("a non-zero mean has a projected n");
        assert!(required > 86, "more items are needed, got {required}");
        assert!(power_line(&g).contains("UNDERPOWERED"));
    }

    #[test]
    fn a_significant_gain_says_so_instead_of_asking_for_more_cases() {
        let judge = vec![true; 50];
        let mut copy = vec![false; 25];
        copy.extend(vec![true; 25]);
        let g = gain(&judge, &copy);
        assert!(g.significant());
        assert!(power_line(&g).contains("already excludes zero"));
    }

    #[test]
    fn a_zero_mean_has_no_sample_size_that_separates_it() {
        let judge = vec![true, false];
        let copy = vec![true, false];
        let g = gain(&judge, &copy);
        assert_eq!(g.required_n, None);
        assert!(power_line(&g).contains("exactly zero"));
    }

    #[test]
    fn required_n_inverts_the_interval() {
        // A mean of +0.5 with variance 0.25 needs z²s²/m² = 3.8416 items.
        let judge = vec![true, true, true, true];
        let copy = vec![true, false, true, false];
        let g = gain(&judge, &copy);
        assert!((g.mean - 0.5).abs() < 1e-12);
        assert!((g.variance - 1.0 / 3.0).abs() < 1e-12);
        let exact = Z95 * Z95 * g.variance / (g.mean * g.mean);
        assert_eq!(g.required_n, Some(exact.floor() as usize + 1));
    }

    #[test]
    fn the_exposure_is_the_key_plus_the_rubric() {
        let exposure = exposure();
        assert_eq!(exposure.names.len(), 3);
        assert!(exposure.rubrics[0].starts_with("rust-engineer: "));
        assert!(
            !exposure.names.iter().any(|n| n == NONE),
            "`none` is not an exposed rubric"
        );
    }
}
