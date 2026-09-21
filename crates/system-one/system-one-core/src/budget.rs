//! Fitting a choice's options into an encoder's head budget — without ever
//! letting the encoder amputate them.
//!
//! # The problem this module exists for
//!
//! A System One encoder builds one sequence per question:
//!
//! ```text
//! [CLS] "<type> question: <instructions>" [SEP] [MASK] opt0 [MASK] opt1 … [SEP] state [SEP]
//! ```
//!
//! Everything before the state is the *head*, and the head has its own ceiling
//! (`head_max_len`) separate from the sequence ceiling (`max_len`). Two things
//! happen inside the engine when a caller ignores that ceiling, and both of them
//! are silent:
//!
//! 1. **Every option is hard-truncated to [`OPTION_TOKEN_CAP`] tokens** before
//!    any budget logic runs at all — unconditionally, tail-first, mid-sentence.
//!    A 115-token rubric becomes its first 48 tokens and the discriminative
//!    clause may be in the half that was thrown away.
//! 2. **If the options still do not fit, every option is squeezed to
//!    `max(`[`SQUEEZE_FLOOR_TOKENS`]`, (head_max_len - `[`SQUEEZE_RESERVE_TOKENS`]`) / n)`
//!    tokens** — at 115 options that is four tokens each, which is not a rubric,
//!    it is a stub. No error is raised. The answer looks normal and means
//!    nothing.
//!
//! Provenance for all three constants: `laya 0.3.4, laya/common.py:build_sequence`,
//! read from the sdist on 2026-09-20. The `ValueError` raised when the option
//! markers are lost entirely is `laya 0.3.4, laya/agent.py:Agent.predict`.
//!
//! # The rule this module enforces
//!
//! [`fit_options`] **refuses** any plan that would reach the squeeze path. It
//! returns [`BudgetError::OptionsUnfittable`] instead, which a façade maps to
//! the wire code `options_unfittable`. A refusal is a correct answer; a squeezed
//! distribution is a wrong one that cannot be detected downstream.
//!
//! It also pre-compresses each rubric to the cap with
//! [`crate::compress::compress_rubric`], so the 48-token cut is made
//! deliberately and front-loaded rather than by the tokeniser's tail-first
//! amputation.
//!
//! ```
//! use indexmap::IndexMap;
//! use system_one_core::{budget::{fit_options, OptionBudget}, QuestionKind};
//!
//! let criteria: IndexMap<String, String> = (0..40)
//!     .map(|i| (format!("skill-{i}"), format!("does job number {i} for the operator")))
//!     .collect();
//! let ranked: Vec<&str> = criteria.keys().map(String::as_str).collect();
//!
//! let plan = fit_options(
//!     QuestionKind::Choice,
//!     "pick the best skill",
//!     &criteria,
//!     &ranked,
//!     &OptionBudget::default(),
//! )
//! .unwrap();
//!
//! assert_eq!(plan.selected.len(), 8);        // shortlisted to k
//! assert_eq!(plan.dropped.len(), 32);        // the rest are reported, not hidden
//! assert!(plan.head_tokens <= plan.head_max_tokens);
//! assert!(!plan.would_squeeze());            // the invariant, restated as an assertion
//! ```

use indexmap::IndexMap;

use crate::compress::{compress_rubric, CompressedRubric};
use crate::error::BudgetError;
use crate::tokens::estimate_tokens;
use crate::wire::QuestionKind;

/// The unconditional per-option token cap applied by the engine.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence` —
/// `tok(" " + opts[i])["input_ids"][:48]`. It is applied to every option before
/// any budget arithmetic, so it is not avoidable by making the head smaller.
pub const OPTION_TOKEN_CAP: usize = 48;

/// Tokens the engine reserves for instructions and special tokens when it
/// computes its emergency per-option squeeze.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence` — the `16` in
/// `per = max(4, (head_max_len - 16) // n)`. Reused here as the default safety
/// margin in [`OptionBudget::reserved_tokens`], so our arithmetic is at least as
/// conservative as the engine's own.
pub const SQUEEZE_RESERVE_TOKENS: usize = 16;

/// The floor the engine squeezes options down to before giving up.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence` — the `4` in
/// `per = max(4, (head_max_len - 16) // n)`. Four tokens is roughly three words:
/// reaching this path is the silent collapse this crate refuses to allow.
pub const SQUEEZE_FLOOR_TOKENS: usize = 4;

/// Special tokens framing the head: one `[CLS]` and two `[SEP]`.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence` — the sequence is
/// `[CLS] question [SEP] options [SEP] state [SEP]`; the third `[SEP]` closes
/// the state and so is charged to the state budget, not the head.
pub const SEQUENCE_OVERHEAD_TOKENS: usize = 3;

/// The `[MASK]` marker the engine inserts before each option, and reads the
/// per-option logit from.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence`.
pub const MASK_TOKENS_PER_OPTION: usize = 1;

/// The engine's default head ceiling.
///
/// Provenance: `laya 0.3.4, laya/agent.py:Agent` config default
/// `head_max_len = 192`. It is a plain config key and is raisable, but raising
/// it departs from the training distribution, so it is a measured choice — ask
/// the engine at `/v1/models` rather than assuming.
pub const DEFAULT_HEAD_MAX_LEN: usize = 192;

/// The engine's default whole-sequence ceiling.
///
/// Provenance: `laya 0.3.4, laya/agent.py:Agent` config default `max_len = 512`.
pub const DEFAULT_MAX_LEN: usize = 512;

/// The smallest shortlist that is still a choice. One option is not a decision.
pub const MINIMUM_SHORTLIST: usize = 2;

/// What the engine says its limits are, as reported by `GET /v1/models`.
///
/// Prefer an engine-reported budget to the defaults: both fields are plain
/// config keys in the engine and a deployment may legitimately raise them (the
/// upstream suggestion for many-option questions is 512 / 1024+).
///
/// ```
/// use system_one_core::budget::EngineBudget;
///
/// let b = EngineBudget::default();
/// assert_eq!((b.max_len, b.head_max_len), (512, 192));
///
/// // With a 40-token head, this is what is left for state in one sequence.
/// assert_eq!(b.state_tokens_for(40), 471); // 512 - 40 - 1 closing [SEP]
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EngineBudget {
    /// The whole-sequence ceiling: head plus state plus specials.
    pub max_len: usize,
    /// The head ceiling: instructions plus every option plus their markers.
    pub head_max_len: usize,
}

impl Default for EngineBudget {
    fn default() -> Self {
        Self {
            max_len: DEFAULT_MAX_LEN,
            head_max_len: DEFAULT_HEAD_MAX_LEN,
        }
    }
}

impl EngineBudget {
    /// A budget with explicit limits.
    ///
    /// ```
    /// # use system_one_core::budget::EngineBudget;
    /// let b = EngineBudget::new(1024, 512);
    /// assert_eq!(b.head_max_len, 512);
    /// ```
    #[must_use]
    pub fn new(max_len: usize, head_max_len: usize) -> Self {
        Self {
            max_len,
            head_max_len,
        }
    }

    /// How many state tokens fit in one sequence alongside a head of
    /// `head_tokens`, allowing for the closing `[SEP]`.
    ///
    /// Saturates at zero rather than underflowing: a head that already exceeds
    /// the sequence leaves room for no state at all, which is a fact the caller
    /// should act on, not a panic.
    ///
    /// ```
    /// # use system_one_core::budget::EngineBudget;
    /// assert_eq!(EngineBudget::default().state_tokens_for(600), 0);
    /// ```
    #[must_use]
    pub fn state_tokens_for(&self, head_tokens: usize) -> usize {
        self.max_len.saturating_sub(head_tokens).saturating_sub(1)
    }
}

/// How a caller wants a choice's options fitted: how many to keep, which ones
/// may never be dropped, and how much headroom to leave for estimation error.
///
/// The defaults are the contract's defaults: `k = 8`, pins `none` and `other`
/// so a judge can always decline, and [`SQUEEZE_RESERVE_TOKENS`] of headroom.
///
/// ```
/// use system_one_core::budget::OptionBudget;
///
/// let b = OptionBudget::default();
/// assert_eq!(b.k, 8);
/// assert_eq!(b.pinned, vec!["none".to_string(), "other".to_string()]);
///
/// let tight = OptionBudget::default().with_k(4).with_pinned(["none"]);
/// assert_eq!(tight.k, 4);
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionBudget {
    /// The engine's head ceiling in estimated tokens.
    pub head_max_tokens: usize,
    /// Tokens held back from the head ceiling to absorb estimation error.
    ///
    /// Token counts here are an estimate (see [`crate::tokens`]), and an
    /// estimate that is 10% low on a full head is a silent squeeze. This margin
    /// is the structural mitigation; it defaults to the engine's own reserve,
    /// [`SQUEEZE_RESERVE_TOKENS`].
    pub reserved_tokens: usize,
    /// How many options to keep, budget permitting.
    pub k: usize,
    /// Option keys that must survive shortlisting whenever the caller offered
    /// them — typically the escape hatches (`none`, `other`) without which the
    /// judge cannot decline.
    pub pinned: Vec<String>,
    /// The per-option token cap to compress rubrics to, or `None` when the
    /// engine applies no per-option cap at all.
    ///
    /// Defaults to [`OPTION_TOKEN_CAP`], the shared-head encoder's own
    /// unconditional cut. Set it from the engine's declared
    /// [`option_max_len`](crate::capability::EngineCapabilities::option_max_len):
    /// setting it *higher* than the engine's cap hands the tokeniser back the
    /// tail-first amputation this crate exists to prevent, and `None` on an
    /// engine that does cap options would do the same.
    ///
    /// `None` means rubrics are sent verbatim — no compression, no truncation,
    /// no cap on the reported token count.
    pub option_token_cap: Option<usize>,
}

impl Default for OptionBudget {
    fn default() -> Self {
        Self {
            head_max_tokens: DEFAULT_HEAD_MAX_LEN,
            reserved_tokens: SQUEEZE_RESERVE_TOKENS,
            k: 8,
            pinned: vec!["none".to_owned(), "other".to_owned()],
            option_token_cap: Some(OPTION_TOKEN_CAP),
        }
    }
}

impl OptionBudget {
    /// Take the head ceiling from an engine-reported budget, keeping the other
    /// defaults.
    ///
    /// ```
    /// use system_one_core::budget::{EngineBudget, OptionBudget};
    /// let b = OptionBudget::from_engine(&EngineBudget::new(1024, 512));
    /// assert_eq!(b.head_max_tokens, 512);
    /// ```
    #[must_use]
    pub fn from_engine(engine: &EngineBudget) -> Self {
        Self {
            head_max_tokens: engine.head_max_len,
            ..Self::default()
        }
    }

    /// Set the shortlist size, builder style.
    #[must_use]
    pub fn with_k(mut self, k: usize) -> Self {
        self.k = k;
        self
    }

    /// Set the pinned option keys, builder style.
    #[must_use]
    pub fn with_pinned<I, S>(mut self, pinned: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.pinned = pinned.into_iter().map(Into::into).collect();
        self
    }

    /// The head tokens actually available to instructions and options.
    ///
    /// ```
    /// # use system_one_core::budget::OptionBudget;
    /// assert_eq!(OptionBudget::default().usable_head_tokens(), 176); // 192 - 16
    /// ```
    #[must_use]
    pub fn usable_head_tokens(&self) -> usize {
        self.head_max_tokens.saturating_sub(self.reserved_tokens)
    }
}

/// One option as it will actually be sent to the engine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FittedOption {
    /// The caller's original option key. Never rewritten — the answer must come
    /// back under this name.
    pub key: String,
    /// The rubric after deliberate compression, which may equal the original.
    pub rubric: String,
    /// The rubric before compression, for the honesty block.
    pub original_rubric: String,
    /// Estimated tokens for the rendered `key: rubric` option text.
    pub tokens: usize,
    /// Whether compression actually changed the rubric.
    pub compressed: bool,
}

impl FittedOption {
    /// The text the engine sees for this option.
    ///
    /// ```
    /// # use indexmap::IndexMap;
    /// # use system_one_core::{budget::{fit_options, OptionBudget}, QuestionKind};
    /// let criteria: IndexMap<String, String> =
    ///     [("a".to_string(), "does A".to_string()), ("b".to_string(), "does B".to_string())]
    ///         .into_iter()
    ///         .collect();
    /// let plan = fit_options(QuestionKind::Choice, "pick", &criteria, &["a", "b"],
    ///                        &OptionBudget::default()).unwrap();
    /// assert_eq!(plan.selected[0].text(), "a: does A");
    /// ```
    #[must_use]
    pub fn text(&self) -> String {
        format!("{}: {}", self.key, self.rubric)
    }
}

/// The result of fitting: which options go to the engine, which were dropped,
/// and the arithmetic that justified it.
///
/// `dropped` is not a diagnostic nicety. The protocol requires every original
/// option to reappear in the response's `probabilities` at `0.0`, and this is
/// the list that makes that possible.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FitPlan {
    /// The options to send, in the order they will be rendered: pinned keys
    /// first, then by descending relevance.
    pub selected: Vec<FittedOption>,
    /// The original keys that did not make the shortlist, in the caller's order.
    pub dropped: Vec<String>,
    /// Estimated head cost of `selected` including specials and markers.
    pub head_tokens: usize,
    /// The ceiling `head_tokens` was checked against, i.e.
    /// [`OptionBudget::usable_head_tokens`].
    pub head_max_tokens: usize,
    /// Estimated cost of the instructions alone, including the engine's
    /// `"<type> question: "` prefix.
    pub instruction_tokens: usize,
    /// The number of options the caller offered.
    pub from: usize,
}

impl FitPlan {
    /// The shortlisted criteria map, ready to put on the wire to the engine.
    #[must_use]
    pub fn criteria(&self) -> IndexMap<String, String> {
        self.selected
            .iter()
            .map(|o| (o.key.clone(), o.rubric.clone()))
            .collect()
    }

    /// Whether this plan would trigger the engine's silent per-option squeeze.
    ///
    /// Always `false` for a plan returned by [`fit_options`] — the function
    /// returns [`BudgetError::OptionsUnfittable`] rather than such a plan. It is
    /// public so that a façade, or a test, can assert the invariant instead of
    /// trusting it.
    #[must_use]
    pub fn would_squeeze(&self) -> bool {
        self.head_tokens > self.head_max_tokens
    }

    /// The per-option token allowance the engine would impose if this plan *did*
    /// reach the squeeze path: `max(4, (head_max_len - 16) / n)`.
    ///
    /// Provenance: `laya 0.3.4, laya/common.py:build_sequence`. Useful for an
    /// error message that explains what was avoided.
    ///
    /// ```
    /// # use indexmap::IndexMap;
    /// # use system_one_core::{budget::{fit_options, OptionBudget}, QuestionKind};
    /// let criteria: IndexMap<String, String> =
    ///     (0..8).map(|i| (format!("k{i}"), "r".to_string())).collect();
    /// let keys: Vec<String> = criteria.keys().cloned().collect();
    /// let ranked: Vec<&str> = keys.iter().map(String::as_str).collect();
    /// let plan = fit_options(QuestionKind::Choice, "pick", &criteria, &ranked,
    ///                        &OptionBudget::default()).unwrap();
    /// // (176 - 16) / 8: the ceiling here is the *usable* head, reserve deducted.
    /// assert_eq!(plan.squeeze_allowance(), 20);
    /// ```
    #[must_use]
    pub fn squeeze_allowance(&self) -> usize {
        squeeze_allowance(self.head_max_tokens, self.selected.len())
    }
}

/// The engine's emergency per-option allowance for `n` options against a head
/// ceiling of `head_max_tokens`.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence` —
/// `per = max(4, (head_max_len - 16) // n)`.
///
/// ```
/// use system_one_core::budget::squeeze_allowance;
/// assert_eq!(squeeze_allowance(192, 115), 4); // the measured collapse
/// assert_eq!(squeeze_allowance(192, 8), 22);
/// ```
#[must_use]
pub fn squeeze_allowance(head_max_tokens: usize, n: usize) -> usize {
    if n == 0 {
        return SQUEEZE_FLOOR_TOKENS;
    }
    SQUEEZE_FLOOR_TOKENS.max(head_max_tokens.saturating_sub(SQUEEZE_RESERVE_TOKENS) / n)
}

/// The engine's instruction prefix for a question kind.
///
/// Provenance: `laya 0.3.4, laya/common.py:build_sequence` —
/// `f"{kind} question: {instructions}"`. It is charged to the head, so it is
/// charged here too.
///
/// ```
/// use system_one_core::{budget::instruction_prefix, QuestionKind};
/// assert_eq!(instruction_prefix(QuestionKind::Choice), "choice question: ");
/// ```
#[must_use]
pub fn instruction_prefix(kind: QuestionKind) -> String {
    format!("{} question: ", kind.as_str())
}

/// Append `key` to `order` if the caller offered it and it is not there yet,
/// borrowing the key from `criteria` so the order outlives the lookup.
fn push_key<'c>(criteria: &'c IndexMap<String, String>, key: &str, order: &mut Vec<&'c str>) {
    if let Some((found, _)) = criteria.get_key_value(key) {
        if !order.contains(&found.as_str()) {
            order.push(found.as_str());
        }
    }
}

/// Estimated head cost of the instructions, prefix and specials included.
#[must_use]
fn instruction_cost(kind: QuestionKind, instructions: &str) -> usize {
    SEQUENCE_OVERHEAD_TOKENS + estimate_tokens(&(instruction_prefix(kind) + instructions))
}

/// Render one option against a per-option cap, compressing only if there is one.
fn fit_one(key: &str, original: &str, cap: Option<usize>) -> FittedOption {
    let Some(cap) = cap else {
        // No cap: the rubric goes verbatim. Compressing here would be the
        // façade importing a constraint the engine does not have, which is the
        // mistake this whole capability path exists to avoid.
        return FittedOption {
            key: key.to_owned(),
            rubric: original.to_owned(),
            original_rubric: original.to_owned(),
            tokens: estimate_tokens(&format!("{key}: {original}")),
            compressed: false,
        };
    };
    // The engine caps the whole option text, key included, so compress against
    // the allowance that is left after the key is charged.
    let key_tokens = estimate_tokens(&format!("{key}: "));
    let CompressedRubric {
        text,
        changed,
        tokens: _,
    } = compress_rubric(original, cap.saturating_sub(key_tokens).max(1));
    let tokens = estimate_tokens(&format!("{key}: {text}")).min(cap);
    FittedOption {
        key: key.to_owned(),
        rubric: text,
        original_rubric: original.to_owned(),
        tokens,
        compressed: changed,
    }
}

/// How an engine charges a question's options against its sequence budget.
///
/// This is the structural difference between the two engine families the
/// façade serves, and it is a *capability*, never an engine name.
///
/// ```
/// use system_one_core::budget::{head_tokens_for, OptionCostModel};
/// use system_one_core::QuestionKind;
///
/// let options = [40usize, 12, 30];
/// // Shared: every option is in one sequence, so they add up.
/// let shared = head_tokens_for(QuestionKind::Choice, "pick", options, OptionCostModel::Shared);
/// // Independent: each option is its own suffix, so only the largest binds.
/// let independent =
///     head_tokens_for(QuestionKind::Choice, "pick", options, OptionCostModel::Independent);
/// assert!(shared > independent);
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum OptionCostModel {
    /// Every option shares one head budget in one sequence, so their costs sum
    /// and more candidates crowd each other out. The `[MASK]`-per-option
    /// encoder (laya) works this way.
    Shared,
    /// Each option is scored in its own sequence against the same state, so
    /// only the *largest* option binds the budget and adding candidates costs
    /// throughput rather than context. A cross-encoder scoring hypotheses
    /// against a shared premise (openjev `predict_hypotheses`) works this way.
    Independent,
}

/// Head tokens a question costs under a given cost model.
///
/// `options` is the per-option token cost, markers excluded — this function
/// adds [`MASK_TOKENS_PER_OPTION`] itself so both models charge the marker
/// consistently.
///
/// ```
/// use system_one_core::budget::{head_tokens_for, OptionCostModel};
/// use system_one_core::QuestionKind;
///
/// // A noul has no options at all, so the two models agree.
/// let a = head_tokens_for(QuestionKind::Noul, "true?", [], OptionCostModel::Shared);
/// let b = head_tokens_for(QuestionKind::Noul, "true?", [], OptionCostModel::Independent);
/// assert_eq!(a, b);
/// ```
#[must_use]
pub fn head_tokens_for(
    kind: QuestionKind,
    instructions: &str,
    options: impl IntoIterator<Item = usize>,
    model: OptionCostModel,
) -> usize {
    let base = instruction_cost(kind, instructions);
    let charged = options.into_iter().map(|t| t + MASK_TOKENS_PER_OPTION);
    match model {
        OptionCostModel::Shared => base + charged.sum::<usize>(),
        OptionCostModel::Independent => base + charged.max().unwrap_or(0),
    }
}

/// Offer a choice's options to an engine that imposes **no head budget**.
///
/// This is the counterpart to [`fit_options`] for an engine whose
/// [`head_max_len`](crate::capability::EngineCapabilities::head_max_len) is
/// `None`. There is no budget to protect, so there is no correctness reason to
/// drop an option: by default every option the caller sent is offered, and
/// `limit` exists only as a *cost* control an operator may choose. Keeping a
/// shortlist of eight here would import the other engine's constraint into one
/// that does not have it, and answer a narrower question than the caller asked.
///
/// `ranked` is the relevance order used when `limit` does cut the list; `pinned`
/// keys are offered first so a judge can always decline. `cap` is the
/// per-option token cap, normally `None` for such an engine.
///
/// The returned plan has [`FitPlan::head_max_tokens`] of [`usize::MAX`], so
/// [`FitPlan::would_squeeze`] is false by construction — there is no squeeze
/// path to reach.
///
/// # Errors
///
/// [`BudgetError::TooFewOptions`] when fewer than two options were offered, or
/// when `limit` would cut below two.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::budget::{offer_options, OptionCostModel};
/// use system_one_core::QuestionKind;
///
/// let criteria: IndexMap<String, String> = (0..115)
///     .map(|i| (format!("skill-{i}"), format!("a long rubric for skill {i}")))
///     .collect();
///
/// // No limit: all 115 options are offered, verbatim.
/// let plan = offer_options(
///     QuestionKind::Choice, "which skill?", &criteria, &[], None, &[], None,
///     OptionCostModel::Independent,
/// )
/// .unwrap();
/// assert_eq!(plan.selected.len(), 115);
/// assert!(plan.dropped.is_empty());
/// assert!(!plan.selected[0].compressed);
/// assert!(!plan.would_squeeze());
/// ```
#[allow(clippy::too_many_arguments)]
pub fn offer_options(
    kind: QuestionKind,
    instructions: &str,
    criteria: &IndexMap<String, String>,
    ranked: &[&str],
    limit: Option<usize>,
    pinned: &[String],
    cap: Option<usize>,
    model: OptionCostModel,
) -> Result<FitPlan, BudgetError> {
    let from = criteria.len();
    if from < MINIMUM_SHORTLIST {
        return Err(BudgetError::TooFewOptions { available: from });
    }

    let mut order: Vec<&str> = Vec::with_capacity(from);
    for key in pinned {
        push_key(criteria, key, &mut order);
    }
    for key in ranked {
        push_key(criteria, key, &mut order);
    }
    for key in criteria.keys() {
        push_key(criteria, key, &mut order);
    }

    let take = match limit {
        Some(limit) if limit < MINIMUM_SHORTLIST => {
            return Err(BudgetError::TooFewOptions { available: limit })
        }
        Some(limit) => limit.min(from),
        None => from,
    };

    let selected: Vec<FittedOption> = order
        .iter()
        .take(take)
        .map(|key| fit_one(key, &criteria[*key], cap))
        .collect();
    let kept: Vec<&str> = selected.iter().map(|o| o.key.as_str()).collect();
    let dropped = criteria
        .keys()
        .filter(|k| !kept.contains(&k.as_str()))
        .cloned()
        .collect();

    Ok(FitPlan {
        head_tokens: head_tokens_for(kind, instructions, selected.iter().map(|o| o.tokens), model),
        head_max_tokens: usize::MAX,
        instruction_tokens: instruction_cost(kind, instructions),
        selected,
        dropped,
        from,
    })
}

/// Shortlist and compress a choice's options so that the engine never has to
/// truncate or squeeze one.
///
/// `ranked` is the caller's relevance order, best first — for the façade that is
/// the cosine ranking of each `"<key>: <rubric>"` against the state. Keys in
/// `ranked` that are not in `criteria` are ignored; keys in `criteria` that are
/// missing from `ranked` are appended in the caller's original order, so a
/// caller with no ranking at all can pass `&[]` and get first-`k` behaviour.
///
/// Selection order is: pinned keys that the caller actually offered, then
/// `ranked`. `k` is reduced one option at a time until the head fits; if it
/// would fall below `max(2, pinned)` the call fails with
/// [`BudgetError::OptionsUnfittable`] rather than returning a plan that the
/// engine would silently squeeze.
///
/// # Errors
///
/// * [`BudgetError::TooFewOptions`] — fewer than two options were offered.
/// * [`BudgetError::NoHeadroom`] — the instructions alone exhaust the ceiling.
/// * [`BudgetError::OptionsUnfittable`] — even the smallest admissible
///   shortlist does not fit.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::{budget::{fit_options, OptionBudget}, QuestionKind, BudgetError};
///
/// // Two options whose rubrics are already at the cap cannot fit a 32-token head.
/// let criteria: IndexMap<String, String> = [
///     ("a".to_string(), "a".repeat(400)),
///     ("b".to_string(), "b".repeat(400)),
/// ]
/// .into_iter()
/// .collect();
/// let mut budget = OptionBudget::default();
/// budget.head_max_tokens = 32;
/// budget.pinned.clear();
///
/// let err = fit_options(QuestionKind::Choice, "pick", &criteria, &["a", "b"], &budget)
///     .unwrap_err();
/// assert!(matches!(err, BudgetError::OptionsUnfittable { .. }));
/// assert_eq!(err.code(), "options_unfittable");
/// ```
pub fn fit_options(
    kind: QuestionKind,
    instructions: &str,
    criteria: &IndexMap<String, String>,
    ranked: &[&str],
    budget: &OptionBudget,
) -> Result<FitPlan, BudgetError> {
    let from = criteria.len();
    if from < MINIMUM_SHORTLIST {
        return Err(BudgetError::TooFewOptions { available: from });
    }

    let head_max_tokens = budget.usable_head_tokens();
    let instruction_tokens = instruction_cost(kind, instructions);
    if instruction_tokens >= head_max_tokens {
        return Err(BudgetError::NoHeadroom {
            head_max_tokens: budget.head_max_tokens,
            reserved_tokens: budget.reserved_tokens + instruction_tokens,
        });
    }

    let cap = budget.option_token_cap.map(|cap| cap.max(1));

    // Selection order: pins the caller actually offered, then relevance order,
    // then anything the ranking forgot, in the caller's own order.
    let mut order: Vec<&str> = Vec::with_capacity(from);
    for key in &budget.pinned {
        push_key(criteria, key, &mut order);
    }
    for key in ranked {
        push_key(criteria, key, &mut order);
    }
    for key in criteria.keys() {
        push_key(criteria, key, &mut order);
    }

    let pinned_present = budget
        .pinned
        .iter()
        .filter(|k| criteria.contains_key(k.as_str()))
        .count();
    let floor_k = MINIMUM_SHORTLIST.max(pinned_present).min(from);

    // Compress once; the cost of every candidate option is then fixed.
    let fitted: Vec<FittedOption> = order
        .iter()
        .map(|key| fit_one(key, &criteria[*key], cap))
        .collect();

    let cost = |take: usize| -> usize {
        instruction_tokens
            + fitted
                .iter()
                .take(take)
                .map(|o| o.tokens + MASK_TOKENS_PER_OPTION)
                .sum::<usize>()
    };

    let start_k = budget.k.clamp(floor_k, from);
    for take in (floor_k..=start_k).rev() {
        let head_tokens = cost(take);
        if head_tokens <= head_max_tokens {
            let selected: Vec<FittedOption> = fitted.into_iter().take(take).collect();
            let kept: Vec<&str> = selected.iter().map(|o| o.key.as_str()).collect();
            let dropped = criteria
                .keys()
                .filter(|k| !kept.contains(&k.as_str()))
                .cloned()
                .collect();
            return Ok(FitPlan {
                selected,
                dropped,
                head_tokens,
                head_max_tokens,
                instruction_tokens,
                from,
            });
        }
    }

    Err(BudgetError::OptionsUnfittable {
        head_max_tokens,
        required_tokens: cost(floor_k),
        floor_k,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn criteria(n: usize, rubric_len: usize) -> IndexMap<String, String> {
        (0..n)
            .map(|i| {
                (
                    format!("opt{i}"),
                    "word ".repeat(rubric_len).trim().to_owned(),
                )
            })
            .collect()
    }

    fn ranked_of(criteria: &IndexMap<String, String>) -> Vec<String> {
        criteria.keys().cloned().collect()
    }

    #[test]
    fn a_fitted_plan_never_reaches_the_squeeze_path() {
        for n in [2usize, 8, 40, 115] {
            for rubric_len in [1usize, 5, 30, 200] {
                let c = criteria(n, rubric_len);
                let keys = ranked_of(&c);
                let ranked: Vec<&str> = keys.iter().map(String::as_str).collect();
                let budget = OptionBudget::default();
                match fit_options(
                    QuestionKind::Choice,
                    "pick the right one",
                    &c,
                    &ranked,
                    &budget,
                ) {
                    Ok(plan) => {
                        assert!(
                            !plan.would_squeeze(),
                            "n={n} len={rubric_len} head={} max={}",
                            plan.head_tokens,
                            plan.head_max_tokens
                        );
                        assert!(plan.selected.len() >= MINIMUM_SHORTLIST);
                        assert_eq!(plan.selected.len() + plan.dropped.len(), n);
                        for option in &plan.selected {
                            assert!(estimate_tokens(&option.text()) <= OPTION_TOKEN_CAP);
                        }
                    }
                    Err(BudgetError::OptionsUnfittable { floor_k, .. }) => {
                        assert_eq!(floor_k, MINIMUM_SHORTLIST);
                    }
                    Err(other) => panic!("unexpected error: {other}"),
                }
            }
        }
    }

    #[test]
    fn unfittable_is_refused_rather_than_squeezed() {
        let c = criteria(115, 200);
        let keys = ranked_of(&c);
        let ranked: Vec<&str> = keys.iter().map(String::as_str).collect();
        let mut budget = OptionBudget::default().with_k(115);
        budget.pinned.clear();
        // k = 115 cannot fit, but fitting reduces k rather than failing.
        let plan = fit_options(QuestionKind::Choice, "pick", &c, &ranked, &budget).unwrap();
        assert!(plan.selected.len() < 115);
        assert!(!plan.would_squeeze());

        // With room for the instructions but not for two options, it refuses
        // rather than handing the engine a plan it would silently squeeze.
        budget.head_max_tokens = 40;
        let err = fit_options(QuestionKind::Choice, "pick", &c, &ranked, &budget).unwrap_err();
        assert_eq!(err.code(), "options_unfittable");
    }

    #[test]
    fn pinned_options_always_survive() {
        let mut c = criteria(60, 20);
        c.insert("none".into(), "decline to route".into());
        let keys: Vec<String> = c.keys().filter(|k| *k != "none").cloned().collect();
        let ranked: Vec<&str> = keys.iter().map(String::as_str).collect();
        let plan = fit_options(
            QuestionKind::Choice,
            "pick",
            &c,
            &ranked,
            &OptionBudget::default(),
        )
        .unwrap();
        assert_eq!(plan.selected[0].key, "none");
    }

    #[test]
    fn ranking_decides_who_survives() {
        let c = criteria(20, 10);
        let plan = fit_options(
            QuestionKind::Choice,
            "pick",
            &c,
            &["opt19", "opt18", "opt17"],
            &OptionBudget::default()
                .with_k(3)
                .with_pinned(Vec::<String>::new()),
        )
        .unwrap();
        let kept: Vec<&str> = plan.selected.iter().map(|o| o.key.as_str()).collect();
        assert_eq!(kept, vec!["opt19", "opt18", "opt17"]);
        assert_eq!(plan.dropped.len(), 17);
        assert_eq!(plan.dropped[0], "opt0"); // dropped keeps the caller's order
    }

    #[test]
    fn an_empty_ranking_falls_back_to_caller_order() {
        let c = criteria(20, 10);
        let plan = fit_options(
            QuestionKind::Choice,
            "pick",
            &c,
            &[],
            &OptionBudget::default()
                .with_k(3)
                .with_pinned(Vec::<String>::new()),
        )
        .unwrap();
        let kept: Vec<&str> = plan.selected.iter().map(|o| o.key.as_str()).collect();
        assert_eq!(kept, vec!["opt0", "opt1", "opt2"]);
    }

    #[test]
    fn fewer_than_two_options_is_not_a_choice() {
        let c = criteria(1, 3);
        let err = fit_options(
            QuestionKind::Choice,
            "pick",
            &c,
            &[],
            &OptionBudget::default(),
        )
        .unwrap_err();
        assert_eq!(err, BudgetError::TooFewOptions { available: 1 });
    }

    #[test]
    fn instructions_that_fill_the_head_are_no_headroom() {
        let c = criteria(4, 3);
        let err = fit_options(
            QuestionKind::Choice,
            &"instruction ".repeat(200),
            &c,
            &[],
            &OptionBudget::default(),
        )
        .unwrap_err();
        assert!(matches!(err, BudgetError::NoHeadroom { .. }));
        assert_eq!(err.code(), "invalid_request");
    }

    #[test]
    fn an_unbounded_engine_is_offered_every_option_verbatim() {
        let c = criteria(115, 200);
        let keys = ranked_of(&c);
        let ranked: Vec<&str> = keys.iter().map(String::as_str).collect();
        let plan = offer_options(
            QuestionKind::Choice,
            "which one?",
            &c,
            &ranked,
            None,
            &["none".to_owned()],
            None,
            OptionCostModel::Independent,
        )
        .unwrap();

        assert_eq!(plan.selected.len(), 115, "no option is dropped for budget");
        assert!(plan.dropped.is_empty());
        assert!(!plan.would_squeeze());
        for option in &plan.selected {
            assert!(!option.compressed);
            assert_eq!(option.rubric, option.original_rubric);
            assert!(
                estimate_tokens(&option.text()) > OPTION_TOKEN_CAP,
                "a 200-word rubric is not silently cut back to 48 tokens"
            );
        }
        // Independent scoring: the head is one option's worth, not 115.
        assert!(
            plan.head_tokens < 300,
            "head_tokens={} should be bounded by the largest option",
            plan.head_tokens
        );
    }

    #[test]
    fn a_cost_limit_keeps_the_pins_and_the_ranking() {
        let mut c = criteria(50, 10);
        c.insert("none".into(), "decline".into());
        let plan = offer_options(
            QuestionKind::Choice,
            "pick",
            &c,
            &["opt49", "opt48"],
            Some(3),
            &["none".to_owned()],
            None,
            OptionCostModel::Independent,
        )
        .unwrap();
        let kept: Vec<&str> = plan.selected.iter().map(|o| o.key.as_str()).collect();
        assert_eq!(kept, vec!["none", "opt49", "opt48"]);
        assert_eq!(plan.dropped.len(), 48);
        assert_eq!(plan.selected.len() + plan.dropped.len(), plan.from);
    }

    #[test]
    fn a_cost_limit_below_two_is_not_a_choice() {
        let c = criteria(10, 5);
        assert_eq!(
            offer_options(
                QuestionKind::Choice,
                "pick",
                &c,
                &[],
                Some(1),
                &[],
                None,
                OptionCostModel::Independent
            )
            .unwrap_err(),
            BudgetError::TooFewOptions { available: 1 }
        );
    }

    #[test]
    fn an_unbounded_engine_that_still_caps_options_gets_compression() {
        // head_max_len null but option_max_len set: no shortlisting pressure,
        // but the rubrics are still compressed deliberately.
        let c = criteria(20, 200);
        let plan = offer_options(
            QuestionKind::Choice,
            "pick",
            &c,
            &[],
            None,
            &[],
            Some(OPTION_TOKEN_CAP),
            OptionCostModel::Independent,
        )
        .unwrap();
        assert_eq!(plan.selected.len(), 20);
        for option in &plan.selected {
            assert!(option.compressed);
            assert!(estimate_tokens(&option.text()) <= OPTION_TOKEN_CAP);
        }
    }

    #[test]
    fn the_cost_models_differ_exactly_where_options_compete() {
        let options = [30usize, 10, 20];
        let shared = head_tokens_for(
            QuestionKind::Choice,
            "pick",
            options,
            OptionCostModel::Shared,
        );
        let independent = head_tokens_for(
            QuestionKind::Choice,
            "pick",
            options,
            OptionCostModel::Independent,
        );
        let base = head_tokens_for(
            QuestionKind::Choice,
            "pick",
            Vec::<usize>::new(),
            OptionCostModel::Shared,
        );
        assert_eq!(shared - base, 60 + 3 * MASK_TOKENS_PER_OPTION);
        assert_eq!(independent - base, 30 + MASK_TOKENS_PER_OPTION);
    }

    #[test]
    fn squeeze_allowance_reproduces_the_measured_collapse() {
        assert_eq!(squeeze_allowance(192, 115), SQUEEZE_FLOOR_TOKENS);
        assert_eq!(squeeze_allowance(192, 1), 176);
        assert_eq!(squeeze_allowance(0, 4), SQUEEZE_FLOOR_TOKENS);
    }

    #[test]
    fn multibyte_rubrics_do_not_panic_and_stay_under_the_cap() {
        let c: IndexMap<String, String> = (0..12)
            .map(|i| (format!("opt{i}"), "日本語のルーブリック、".repeat(30)))
            .collect();
        let keys = ranked_of(&c);
        let ranked: Vec<&str> = keys.iter().map(String::as_str).collect();
        let plan = fit_options(
            QuestionKind::Choice,
            "選んでください",
            &c,
            &ranked,
            &OptionBudget::default(),
        )
        .unwrap();
        for option in &plan.selected {
            assert!(estimate_tokens(&option.text()) <= OPTION_TOKEN_CAP);
            assert!(option.rubric.is_char_boundary(0));
        }
    }
}
