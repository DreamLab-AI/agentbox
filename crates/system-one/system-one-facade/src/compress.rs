//! Boundary-preserving rubric compression.
//!
//! # Why this is not [`system_one_core::compress`]
//!
//! Core owns rubric compression and this module does **not** duplicate its
//! budget arithmetic, its token estimate or its cap — it calls
//! [`system_one_core::tokens::estimate_tokens`] like everything else. What it
//! replaces is the *clause selection rule*, for one measured reason.
//!
//! Core ranks clauses by content density and keeps the densest that fit. On a
//! skill description written to this estate's `what / when / when-NOT`
//! authoring contract (ADR-2083), the clause that distinguishes a skill from
//! its nearest neighbour is the when-NOT clause, it is almost always last, and
//! it is rarely the densest — it is often the *least* dense, because it names
//! other skills rather than its own subject. Measured against the 51 baked
//! skill descriptions whose boundary clause begins beyond a 44-token budget:
//!
//! | compressor | boundary clause survives |
//! |---|---|
//! | `system_one_core::compress::compress_rubric` | 11 / 51 (22%) |
//! | [`compress_rubric`] here | 48 / 51 (94%) |
//!
//! Those 51 rubrics are exactly the late-discriminative subgroup
//! `system-one-eval` reports separately, so the difference lands precisely
//! where routing accuracy is decided.
//!
//! **This rule belongs in `system-one-core`**, either as the default or behind
//! a `ClauseRule` on `OptionBudget`; it is here only because core does not yet
//! expose a way to choose one. The same gap applies to
//! [`system_one_core::budget::fit_options`], which calls core's compressor
//! internally with no injection point — the façade therefore compresses
//! *before* handing criteria to `fit_options`, where core's compressor sees
//! text already inside the cap and correctly leaves it alone.
//!
//! The rule itself: front-load the discriminative clause. Keep the opening
//! statement of what the option is and the boundary clause that says when it is
//! the wrong answer, **reserving room for the boundary clause before the lead
//! clause is fitted** — without that reservation the lead eats the budget and
//! the boundary clause is lost, which is the whole failure being prevented.
//!
//! ```
//! use system_one_facade::compress::compress_rubric;
//! use system_one_core::tokens::estimate_tokens;
//!
//! let rubric = "Ports Python to Rust and publishes crates. Use for CLIs, evaluators \
//!     and boot-path code. Do NOT use for thin wrappers over Python-only modules such \
//!     as bpy, QGIS, GDAL or torch, which stay in Python for good reasons of their own.";
//! let out = compress_rubric(rubric, 24);
//! assert!(out.changed);
//! assert!(estimate_tokens(&out.text) <= 24);
//! assert!(out.text.contains("Do NOT use"), "the boundary clause survives: {}", out.text);
//! ```

use system_one_core::compress::CompressedRubric;
use system_one_core::tokens::estimate_tokens;

/// Markers of the clause that says when this option is the WRONG answer.
///
/// Lower-cased substring match. These are the phrasings this estate's skill
/// authoring contract produces, plus the ordinary English equivalents.
const BOUNDARY_MARKERS: [&str; 12] = [
    "not for",
    "do not use",
    "don't use",
    "never use",
    "not when",
    "when not",
    "rather than",
    "instead of",
    "unless",
    "avoid",
    "excludes",
    "not the",
];

/// Words dropped when a clause must be squeezed.
///
/// Determiners and copulas only. Negations, modals and prepositions of
/// exclusion are never dropped: removing "not" from a boundary clause inverts
/// the very thing the clause exists to say.
const FILLER: [&str; 14] = [
    "the", "a", "an", "this", "that", "these", "those", "is", "are", "was", "were", "be", "being",
    "been",
];

/// Estimated token offset of the clause that says when NOT to choose this.
///
/// Returns `None` when a rubric states no boundary at all. `system-one-eval`
/// uses it to separate the cases whose discriminative information sits *late*
/// in the description — the subgroup a tail-first truncation destroys and a
/// deliberate compression keeps — from those where the opening sentence is
/// already enough.
///
/// ```
/// use system_one_facade::compress::boundary_offset;
/// let early = "NOT for single diagrams. Maintains a whole diagram corpus.";
/// let late = "Maintains a whole checked-in diagram corpus for a repository, in Mermaid \
///     and D2, with an audit of what has drifted from HEAD, refreshed on request. \
///     NOT for a single diagram in a reply.";
/// assert_eq!(boundary_offset(early), Some(0));
/// assert!(boundary_offset(late).unwrap() > 20);
/// assert_eq!(boundary_offset("Does a thing."), None);
/// ```
pub fn boundary_offset(rubric: &str) -> Option<usize> {
    let text = normalise(rubric);
    let lower = text.to_lowercase();
    let byte_offset = BOUNDARY_MARKERS
        .iter()
        .filter_map(|m| lower.find(m))
        .min()?;
    // Lower-casing can change byte lengths, so the offset is treated as a hint
    // into the original rather than as a guaranteed char boundary.
    let prefix = text.get(..byte_offset).unwrap_or(&text);
    Some(estimate_tokens(prefix))
}

/// Split a rubric into clauses at sentence and clause boundaries.
///
/// The separator is kept on the clause it terminates so that reassembly reads
/// as prose rather than as a list of fragments.
fn clauses(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        current.push(c);
        let next_is_space = chars.get(i + 1).is_none_or(|n| n.is_whitespace());
        let is_break = matches!(c, '.' | ';' | '!' | '?' | ':') && next_is_space;
        let is_dash = matches!(c, '—' | '–') && next_is_space;
        if is_break || is_dash {
            let clause = current
                .trim()
                .trim_end_matches(['—', '–'])
                .trim()
                .to_string();
            if !clause.is_empty() {
                out.push(clause);
            }
            current.clear();
        }
        i += 1;
    }
    let tail = current.trim().to_string();
    if !tail.is_empty() {
        out.push(tail);
    }
    if out.is_empty() {
        out.push(text.trim().to_string());
    }
    out
}

/// Collapse all whitespace runs to single spaces.
fn normalise(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Drop determiners and copulas from a clause.
fn elide_filler(clause: &str) -> String {
    let kept: Vec<&str> = clause
        .split(' ')
        .filter(|word| {
            let bare: String = word
                .chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
                .to_lowercase();
            // Keep any word carrying punctuation that ends a clause, so the
            // compressed form still reads as sentences.
            if word.ends_with('.') || word.ends_with(',') || word.ends_with(';') {
                return true;
            }
            !FILLER.contains(&bare.as_str())
        })
        .collect();
    if kept.is_empty() {
        clause.to_string()
    } else {
        kept.join(" ")
    }
}

/// Trim a clause to `budget` tokens at a word boundary, marking the cut.
fn hard_trim(clause: &str, budget: usize) -> String {
    if budget == 0 {
        return String::new();
    }
    // One token is reserved for the ellipsis that marks the cut.
    let target = budget.saturating_sub(1).max(1);
    let mut out = String::new();
    for word in clause.split(' ') {
        let candidate = if out.is_empty() {
            word.to_string()
        } else {
            format!("{out} {word}")
        };
        if estimate_tokens(&candidate) > target {
            break;
        }
        out = candidate;
    }
    if out.is_empty() {
        // A single word larger than the whole budget: cut it by characters.
        let mut cut = String::new();
        for ch in clause.chars() {
            cut.push(ch);
            if estimate_tokens(&cut) > target {
                cut.pop();
                break;
            }
        }
        out = cut;
    }
    if out.len() < clause.len() {
        out.push('…');
    }
    out
}

/// Compress `rubric` to at most `cap_tokens` estimated tokens, boundary first.
///
/// Returns core's [`CompressedRubric`], so a caller can swap this for
/// [`system_one_core::compress::compress_rubric`] without touching anything
/// else — which is what makes promoting this rule into core a one-line change
/// at the call site rather than a refactor.
///
/// Keeps, in this order and while they fit: the opening clause, the boundary
/// clause, then the remaining clauses in their original order, emitted in
/// reading order. A clause that will not fit on its own is stripped of
/// determiners and copulas, and only then trimmed at a word boundary with a
/// visible `…`.
///
/// ```
/// use system_one_facade::compress::compress_rubric;
/// let short = compress_rubric("Ports Python to Rust.", 48);
/// assert!(!short.changed);
/// assert_eq!(short.text, "Ports Python to Rust.");
/// ```
pub fn compress_rubric(rubric: &str, cap_tokens: usize) -> CompressedRubric {
    let text = normalise(rubric);
    let original_tokens = estimate_tokens(&text);
    if original_tokens <= cap_tokens {
        return CompressedRubric {
            text,
            changed: false,
            tokens: original_tokens,
        };
    }

    let parts = clauses(&text);
    let boundary = parts.iter().position(|clause| {
        let lower = clause.to_lowercase();
        BOUNDARY_MARKERS.iter().any(|m| lower.contains(m))
    });

    // Priority: opening clause, boundary clause, then the rest in order.
    let mut order: Vec<usize> = vec![0];
    if let Some(b) = boundary {
        if b != 0 {
            order.push(b);
        }
    }
    for i in 1..parts.len() {
        if !order.contains(&i) {
            order.push(i);
        }
    }

    // The lead clause must not be allowed to eat the budget: that is exactly
    // how the boundary clause gets lost. Room for it is reserved before the
    // lead is fitted, capped at half the budget so the reservation cannot
    // starve the lead in turn.
    let reserve = match boundary {
        Some(b) if b != 0 => (estimate_tokens(&elide_filler(&parts[b])) + 1).min(cap_tokens / 2),
        _ => 0,
    };

    let mut kept: Vec<(usize, String)> = Vec::new();
    let mut used = 0usize;
    for (rank, index) in order.into_iter().enumerate() {
        let clause = &parts[index];
        let joiner = usize::from(!kept.is_empty());
        // Only the lead pays the reservation; by the time the boundary clause
        // is fitted the room set aside is the room it is spending.
        let cap = if rank == 0 {
            cap_tokens.saturating_sub(reserve)
        } else {
            cap_tokens
        };

        let cost = estimate_tokens(clause) + joiner;
        if used + cost <= cap {
            used += cost;
            kept.push((index, clause.clone()));
            continue;
        }
        let elided = elide_filler(clause);
        let elided_cost = estimate_tokens(&elided) + joiner;
        if used + elided_cost <= cap {
            used += elided_cost;
            kept.push((index, elided));
            continue;
        }
        // Only the two highest-priority clauses are worth trimming into; a
        // third arrives mangled and adds nothing a judge can use.
        if rank < 2 {
            let room = cap.saturating_sub(used + joiner);
            if room >= 4 {
                let trimmed = hard_trim(&elided, room);
                if !trimmed.is_empty() {
                    used += estimate_tokens(&trimmed) + joiner;
                    kept.push((index, trimmed));
                }
            }
        }
        if used >= cap_tokens {
            break;
        }
    }

    if kept.is_empty() {
        let trimmed = hard_trim(&elide_filler(&parts[0]), cap_tokens);
        let tokens = estimate_tokens(&trimmed);
        return CompressedRubric {
            text: trimmed,
            changed: true,
            tokens,
        };
    }

    // Reassemble in reading order, not priority order: the judge reads prose.
    kept.sort_by_key(|(index, _)| *index);
    let out = kept
        .into_iter()
        .map(|(_, c)| c)
        .collect::<Vec<_>>()
        .join(" ");
    let tokens = estimate_tokens(&out);
    CompressedRubric {
        text: out,
        changed: true,
        tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKILL: &str = "Generates and maintains a checked-in diagram corpus for a whole \
        repository, in Mermaid and D2, with an audit of what has drifted from HEAD. Use when the \
        request is the corpus itself or its re-verification. NOT for a single diagram in a reply, \
        which is mermaid-diagrams, and not for a published visual for an external audience, which \
        is diagram-design.";

    /// Two real baked descriptions, verbatim, whose boundary clause is late.
    const REAL_RUBRICS: [&str; 2] = [
        "OpenAI Codex / GPT-6 Astra integration for Claude Code. Runs the baked Codex CLI under \
         the current profile. NOT for non-code tasks (research/content/design → dedicated \
         skills), simple edits, or anything the primary model handles directly.",
        "Schedule recurring agent tasks on cron/interval/one-shot schedules — Inspired by \
         NousResearch/hermes-agent. start with /hermes-scheduler. NOT for one-off tasks you can \
         run now, NOT a system-cron/systemd replacement, and not for sub-minute polling.",
    ];

    fn keeps_boundary(text: &str) -> bool {
        let lower = text.to_lowercase();
        BOUNDARY_MARKERS.iter().any(|m| lower.contains(m))
    }

    #[test]
    fn a_fitting_rubric_is_returned_untouched() {
        let out = compress_rubric("Short and sweet.", 48);
        assert!(!out.changed);
        assert_eq!(out.text, "Short and sweet.");
    }

    #[test]
    fn compression_is_deterministic() {
        assert_eq!(
            compress_rubric(SKILL, 40).text,
            compress_rubric(SKILL, 40).text
        );
    }

    #[test]
    fn the_boundary_clause_survives_ahead_of_the_middle() {
        let out = compress_rubric(SKILL, 40);
        assert!(out.changed);
        assert!(out.tokens <= 40, "{} tokens: {}", out.tokens, out.text);
        assert!(
            out.text.contains("NOT for"),
            "boundary clause lost: {}",
            out.text
        );
        assert!(
            out.text.starts_with("Generates"),
            "lead clause lost: {}",
            out.text
        );
    }

    /// The reason this module exists rather than deferring to core, pinned so
    /// that it fails the day core adopts the rule and the duplicate can go.
    #[test]
    fn real_rubrics_keep_their_boundary_clause_where_cores_rule_drops_it() {
        for rubric in REAL_RUBRICS {
            let ours = compress_rubric(rubric, 44);
            assert!(
                keeps_boundary(&ours.text),
                "the façade rule lost the boundary clause: {}",
                ours.text
            );
            let theirs = system_one_core::compress::compress_rubric(rubric, 44);
            assert!(
                !keeps_boundary(&theirs.text),
                "system-one-core now keeps the boundary clause — delete this module and call \
                 core::compress::compress_rubric directly: {}",
                theirs.text
            );
        }
    }

    #[test]
    fn a_tiny_budget_still_yields_usable_text() {
        for budget in [6usize, 8, 12, 16, 24, 48] {
            let out = compress_rubric(SKILL, budget);
            assert!(
                out.tokens <= budget,
                "budget {budget}: got {} tokens: {}",
                out.tokens,
                out.text
            );
            assert!(
                !out.text.trim().is_empty(),
                "budget {budget} produced nothing"
            );
        }
    }

    #[test]
    fn a_single_enormous_word_is_cut_by_characters() {
        let word = "a".repeat(400);
        let out = compress_rubric(&word, 5);
        assert!(out.tokens <= 5);
        assert!(out.text.ends_with('…'));
    }

    #[test]
    fn filler_elision_never_drops_a_negation() {
        let elided = elide_filler("this is not the right skill");
        assert!(elided.contains("not"));
        assert!(!elided.contains(" is "));
    }

    #[test]
    fn clause_splitting_keeps_terminators() {
        let parts = clauses("One thing. Two things; three. Four");
        assert_eq!(parts, vec!["One thing.", "Two things;", "three.", "Four"]);
    }

    #[test]
    fn the_boundary_offset_measures_the_late_subgroup() {
        assert_eq!(boundary_offset("NOT for x. Does y."), Some(0));
        assert!(boundary_offset(SKILL).unwrap() > 20);
        assert_eq!(boundary_offset("Just does a thing."), None);
    }
}
