//! What an engine says it can do — and what a façade must assume when it says
//! nothing.
//!
//! A capacity-adapting façade sits in front of engines that are structurally
//! different. One (an encoder with a shared `[MASK]` head) charges every option
//! against a single head budget and hard-truncates each option to a fixed token
//! cap. Another (a cross-encoder that scores each hypothesis in its own
//! sequence) has neither. The façade must adapt to those differences **without
//! ever branching on an engine's name**, because a name is not a capability and
//! the next engine will have a different one.
//!
//! So the engine declares itself at `GET /v1/models` and this module models the
//! declaration. Three rules make the declaration safe to trust:
//!
//! 1. **Absent is not null.** A field that is *missing* means the engine did not
//!    declare itself, and the façade falls back to the conservative,
//!    shared-head shape — an engine that fails to say it is unconstrained must
//!    not accidentally be given the unconstrained path. A field that is
//!    explicitly `null` is a *declaration* that the constraint does not exist.
//!    [`DeclaredCapabilities`] keeps the two apart with `Option<Option<_>>`;
//!    plain `Option` would silently collapse them.
//! 2. **`max_len` always binds.** Every engine has a sequence ceiling, so state
//!    windowing stays live even for an engine with no head budget at all.
//! 3. **No head budget means shortlisting is cost control, not correctness.**
//!    With [`EngineCapabilities::head_max_len`] `= None` the façade may offer
//!    every option the caller sent; dropping options becomes a latency choice
//!    the operator makes, not a budget the protocol forces.
//!
//! ```
//! use system_one_core::capability::{DeclaredCapabilities, EngineCapabilities};
//!
//! // An engine that declares itself unconstrained on options.
//! let declared: DeclaredCapabilities = serde_json::from_str(
//!     r#"{"max_len":4096,"head_max_len":null,"option_max_len":null,
//!         "scores_options_independently":true}"#,
//! )
//! .unwrap();
//! let caps = declared.resolve(&EngineCapabilities::conservative());
//! assert_eq!(caps.head_max_len, None);
//! assert!(caps.scores_options_independently);
//! assert!(!caps.caps_options());
//!
//! // An engine that declares nothing keeps the conservative shape.
//! let silent: DeclaredCapabilities = serde_json::from_str("{}").unwrap();
//! assert_eq!(silent.resolve(&EngineCapabilities::conservative()),
//!            EngineCapabilities::conservative());
//! ```

use serde::{Deserialize, Deserializer, Serialize};

use crate::budget::{OptionCostModel, DEFAULT_HEAD_MAX_LEN, DEFAULT_MAX_LEN, OPTION_TOKEN_CAP};

/// An engine's declared limits, after resolution against a fallback.
///
/// `None` on [`head_max_len`](Self::head_max_len) or
/// [`option_max_len`](Self::option_max_len) means *no such limit exists*, not
/// *unknown*: resolution through [`DeclaredCapabilities::resolve`] has already
/// turned "unknown" into the fallback.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineCapabilities {
    /// The whole-sequence ceiling. Always present: every engine has one, and it
    /// is what keeps state windowing live.
    pub max_len: usize,
    /// The shared head ceiling, or `None` when options do not share a budget.
    #[serde(default)]
    pub head_max_len: Option<usize>,
    /// The hard per-option token cap the engine's tokeniser applies, or `None`
    /// when it applies none and rubrics may be sent verbatim.
    #[serde(default)]
    pub option_max_len: Option<usize>,
    /// Whether each option is scored in its own sequence rather than competing
    /// for one shared head.
    #[serde(default)]
    pub scores_options_independently: bool,
}

impl Default for EngineCapabilities {
    fn default() -> Self {
        Self::conservative()
    }
}

impl EngineCapabilities {
    /// The shape assumed of an engine that declares nothing: one shared head,
    /// a hard per-option cap, options competing for one budget.
    ///
    /// The numbers are laya's documented defaults
    /// ([`DEFAULT_MAX_LEN`], [`DEFAULT_HEAD_MAX_LEN`], [`OPTION_TOKEN_CAP`]),
    /// and the *shape* is the point: it is the shape under which every
    /// adaptation is applied, so an under-declared engine gets protection it
    /// may not need rather than freedom it may not have.
    ///
    /// ```
    /// # use system_one_core::capability::EngineCapabilities;
    /// let c = EngineCapabilities::conservative();
    /// assert_eq!((c.max_len, c.head_max_len, c.option_max_len), (512, Some(192), Some(48)));
    /// assert!(!c.scores_options_independently);
    /// ```
    #[must_use]
    pub const fn conservative() -> Self {
        Self {
            max_len: DEFAULT_MAX_LEN,
            head_max_len: Some(DEFAULT_HEAD_MAX_LEN),
            option_max_len: Some(OPTION_TOKEN_CAP),
            scores_options_independently: false,
        }
    }

    /// Whether options compete for one shared head budget.
    ///
    /// ```
    /// # use system_one_core::capability::EngineCapabilities;
    /// assert!(EngineCapabilities::conservative().is_head_bounded());
    /// ```
    #[must_use]
    pub const fn is_head_bounded(&self) -> bool {
        self.head_max_len.is_some()
    }

    /// Whether the engine truncates individual options, so rubrics must be
    /// compressed deliberately rather than amputated tail-first.
    #[must_use]
    pub const fn caps_options(&self) -> bool {
        self.option_max_len.is_some()
    }

    /// How this engine charges a question's options against its sequence.
    ///
    /// ```
    /// # use system_one_core::{budget::OptionCostModel, capability::EngineCapabilities};
    /// let mut c = EngineCapabilities::conservative();
    /// assert_eq!(c.cost_model(), OptionCostModel::Shared);
    /// c.scores_options_independently = true;
    /// assert_eq!(c.cost_model(), OptionCostModel::Independent);
    /// ```
    #[must_use]
    pub const fn cost_model(&self) -> OptionCostModel {
        if self.scores_options_independently {
            OptionCostModel::Independent
        } else {
            OptionCostModel::Shared
        }
    }

    /// State tokens left in one sequence beside a head of `head_tokens`,
    /// allowing for the closing separator.
    ///
    /// ```
    /// # use system_one_core::capability::EngineCapabilities;
    /// assert_eq!(EngineCapabilities::conservative().state_tokens_for(40), 471);
    /// ```
    #[must_use]
    pub const fn state_tokens_for(&self, head_tokens: usize) -> usize {
        self.max_len.saturating_sub(head_tokens).saturating_sub(1)
    }

    /// Check a declaration is self-consistent before anything is fitted into it.
    ///
    /// # Errors
    ///
    /// [`CapabilityError`] when a limit is zero, or when the head budget leaves
    /// no room for a state — both are declarations a façade must refuse rather
    /// than quietly work around.
    ///
    /// ```
    /// # use system_one_core::capability::{CapabilityError, EngineCapabilities};
    /// let bad = EngineCapabilities { max_len: 192, head_max_len: Some(192), ..Default::default() };
    /// assert!(matches!(bad.check(), Err(CapabilityError::HeadExceedsSequence { .. })));
    /// ```
    pub fn check(&self) -> Result<(), CapabilityError> {
        if self.max_len == 0 {
            return Err(CapabilityError::ZeroLimit { field: "max_len" });
        }
        if self.option_max_len == Some(0) {
            return Err(CapabilityError::ZeroLimit {
                field: "option_max_len",
            });
        }
        match self.head_max_len {
            Some(0) => Err(CapabilityError::ZeroLimit {
                field: "head_max_len",
            }),
            Some(head) if head >= self.max_len => Err(CapabilityError::HeadExceedsSequence {
                head_max_len: head,
                max_len: self.max_len,
            }),
            _ => Ok(()),
        }
    }
}

/// A declaration that cannot be used as-is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum CapabilityError {
    /// A limit was declared as zero, which is not a limit but a mistake.
    #[error("engine declared `{field}` as 0; refusing to guess a budget")]
    ZeroLimit {
        /// The offending field.
        field: &'static str,
    },
    /// The head budget consumes the whole sequence, leaving no room for state.
    #[error(
        "engine declared head_max_len={head_max_len} >= max_len={max_len}; no state would fit"
    )]
    HeadExceedsSequence {
        /// The declared head ceiling.
        head_max_len: usize,
        /// The declared sequence ceiling.
        max_len: usize,
    },
}

/// Deserialise a field so that *absent* and *null* stay distinguishable.
///
/// serde maps both to `None` for a plain `Option<T>`. Wrapping in a second
/// `Option` and only ever constructing the outer `Some` here means the outer
/// layer answers "was the field present?" and the inner one "was it null?".
fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// An engine's `/v1/models` capability fields exactly as sent, before the
/// absent-versus-null distinction has been resolved away.
///
/// ```
/// use system_one_core::capability::{DeclaredCapabilities, EngineCapabilities};
///
/// // Explicit null: the engine says it has no per-option cap.
/// let declared: DeclaredCapabilities =
///     serde_json::from_str(r#"{"option_max_len":null}"#).unwrap();
/// assert_eq!(declared.option_max_len, Some(None));
/// assert_eq!(declared.resolve(&EngineCapabilities::conservative()).option_max_len, None);
///
/// // Absent: the engine says nothing, so the conservative cap stands.
/// let silent: DeclaredCapabilities = serde_json::from_str("{}").unwrap();
/// assert_eq!(silent.option_max_len, None);
/// assert_eq!(silent.resolve(&EngineCapabilities::conservative()).option_max_len, Some(48));
/// ```
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
pub struct DeclaredCapabilities {
    /// The sequence ceiling, if declared.
    #[serde(default, deserialize_with = "present")]
    pub max_len: Option<Option<usize>>,
    /// The head ceiling: `Some(None)` is a declaration that there is none.
    #[serde(default, deserialize_with = "present")]
    pub head_max_len: Option<Option<usize>>,
    /// The per-option cap: `Some(None)` is a declaration that there is none.
    #[serde(default, deserialize_with = "present")]
    pub option_max_len: Option<Option<usize>>,
    /// Whether options are scored independently, if declared.
    #[serde(default)]
    pub scores_options_independently: Option<bool>,
}

impl DeclaredCapabilities {
    /// Whether the engine declared anything at all.
    #[must_use]
    pub const fn is_silent(&self) -> bool {
        self.max_len.is_none()
            && self.head_max_len.is_none()
            && self.option_max_len.is_none()
            && self.scores_options_independently.is_none()
    }

    /// Take every field this declaration states, falling back to `other`
    /// field by field.
    ///
    /// Used where one payload carries the fields at the top level and another
    /// nests them under `data[0]`: the outer declaration wins per field, and a
    /// field only one of them states is still honoured.
    ///
    /// ```
    /// # use system_one_core::capability::DeclaredCapabilities;
    /// let flat: DeclaredCapabilities = serde_json::from_str(r#"{"max_len":4096}"#).unwrap();
    /// let nested: DeclaredCapabilities =
    ///     serde_json::from_str(r#"{"max_len":512,"head_max_len":null}"#).unwrap();
    /// let merged = flat.or(nested);
    /// assert_eq!(merged.max_len, Some(Some(4096)));
    /// assert_eq!(merged.head_max_len, Some(None));
    /// ```
    #[must_use]
    pub fn or(self, other: Self) -> Self {
        Self {
            max_len: self.max_len.or(other.max_len),
            head_max_len: self.head_max_len.or(other.head_max_len),
            option_max_len: self.option_max_len.or(other.option_max_len),
            scores_options_independently: self
                .scores_options_independently
                .or(other.scores_options_independently),
        }
    }

    /// Resolve against a fallback: absent takes the fallback, `null` means the
    /// limit does not exist.
    ///
    /// A `null` `max_len` is treated as absent, because a sequence ceiling
    /// always exists — an engine that says otherwise is declaring something it
    /// cannot mean, and the safe reading is the fallback.
    #[must_use]
    pub fn resolve(&self, fallback: &EngineCapabilities) -> EngineCapabilities {
        EngineCapabilities {
            max_len: self.max_len.flatten().unwrap_or(fallback.max_len),
            head_max_len: self.head_max_len.unwrap_or(fallback.head_max_len),
            option_max_len: self.option_max_len.unwrap_or(fallback.option_max_len),
            scores_options_independently: self
                .scores_options_independently
                .unwrap_or(fallback.scores_options_independently),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_falls_back_and_null_declares_the_absence_of_a_limit() {
        let fallback = EngineCapabilities::conservative();

        let silent: DeclaredCapabilities = serde_json::from_str("{}").unwrap();
        assert!(silent.is_silent());
        assert_eq!(silent.resolve(&fallback), fallback);

        let openjev: DeclaredCapabilities = serde_json::from_str(
            r#"{"max_len":4096,"head_max_len":null,"option_max_len":null,
                "scores_options_independently":true}"#,
        )
        .unwrap();
        let caps = openjev.resolve(&fallback);
        assert_eq!(caps.max_len, 4096);
        assert_eq!(caps.head_max_len, None);
        assert_eq!(caps.option_max_len, None);
        assert!(caps.scores_options_independently);
        assert_eq!(caps.cost_model(), OptionCostModel::Independent);
    }

    #[test]
    fn a_partially_declared_engine_keeps_the_conservative_rest() {
        // Raising head_max_len alone must not also unset the option cap.
        let partial: DeclaredCapabilities =
            serde_json::from_str(r#"{"head_max_len":768}"#).unwrap();
        let caps = partial.resolve(&EngineCapabilities::conservative());
        assert_eq!(caps.head_max_len, Some(768));
        assert_eq!(caps.option_max_len, Some(OPTION_TOKEN_CAP));
        assert!(!caps.scores_options_independently);
    }

    #[test]
    fn inconsistent_declarations_are_refused_rather_than_worked_around() {
        assert!(EngineCapabilities::conservative().check().is_ok());
        assert_eq!(
            EngineCapabilities {
                max_len: 0,
                ..Default::default()
            }
            .check(),
            Err(CapabilityError::ZeroLimit { field: "max_len" })
        );
        assert_eq!(
            EngineCapabilities {
                option_max_len: Some(0),
                ..Default::default()
            }
            .check(),
            Err(CapabilityError::ZeroLimit {
                field: "option_max_len"
            })
        );
        assert!(EngineCapabilities {
            max_len: 4096,
            head_max_len: None,
            option_max_len: None,
            scores_options_independently: true
        }
        .check()
        .is_ok());
    }

    #[test]
    fn a_null_sequence_ceiling_is_read_as_absent() {
        let declared: DeclaredCapabilities = serde_json::from_str(r#"{"max_len":null}"#).unwrap();
        assert_eq!(
            declared
                .resolve(&EngineCapabilities::conservative())
                .max_len,
            DEFAULT_MAX_LEN
        );
    }

    #[test]
    fn capabilities_round_trip_through_the_honesty_block() {
        let caps = EngineCapabilities {
            max_len: 4096,
            head_max_len: None,
            option_max_len: None,
            scores_options_independently: true,
        };
        let json = serde_json::to_string(&caps).unwrap();
        assert!(json.contains(r#""head_max_len":null"#), "{json}");
        assert_eq!(
            serde_json::from_str::<EngineCapabilities>(&json).unwrap(),
            caps
        );
    }
}
