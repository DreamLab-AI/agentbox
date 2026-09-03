//! The [`Finding`]-shaped view of Layer A, over a `&str` with byte spans.
//!
//! [`inspect_text`](crate::inspect_text) and [`clean_text`](crate::clean_text)
//! report per-codepoint counts, which is what the audit CLIs consume.
//! [`check_text`] reports the same surface as [`Finding`]s carrying byte spans,
//! which is what a SARIF exporter, an LSP server or a `fix()` pass needs. Both
//! read the same classifiers; neither mutates its input.
//!
//! Every finding here is [`ConfidenceTier::CertainMechanical`], because every
//! one is a deterministic classification of a codepoint and its context rather
//! than a judgement about style. Findings whose remedy is nonetheless a
//! human's call — an unbalanced isolate in genuine right-to-left prose — carry
//! no `replacement`, so they can never be auto-applied.

use prose_sanitiser_core::{ConfidenceTier, Finding, Severity, Span, Unit};

use crate::bidi::{self, BidiContext};
use crate::confusables;
use crate::decide::{decide, Action};
use crate::stego::{self, PayloadKind};

/// Rule identifier for an invisible or format-class carrier.
pub const RULE_INVISIBLE: &str = "unicode-invisible";
/// Rule identifier for a homoglyph or mixed-script substitution.
pub const RULE_HOMOGLYPH: &str = "unicode-homoglyph";
/// Rule identifier for a variation-selector smuggled payload.
pub const RULE_VS_PAYLOAD: &str = "unicode-vs-payload";
/// Rule identifier for a tag-block smuggled payload.
pub const RULE_TAG_PAYLOAD: &str = "unicode-tag-payload";
/// Rule identifier for a zero-width binary payload.
pub const RULE_ZW_PAYLOAD: &str = "unicode-zw-payload";
/// Rule identifier for a bidi control the context policy rejects.
pub const RULE_BIDI: &str = "unicode-bidi";
/// Rule identifier for a soft hyphen. Report-only: see [`RULE_SOFT_HYPHEN`].
pub const RULE_SOFT_HYPHEN: &str = "unicode-soft-hyphen";

/// How a [`check_text`] pass should read its input.
///
/// # The preview invariant
///
/// Every field here mirrors one on [`CleanOptions`](crate::CleanOptions), and
/// the defaults are chosen to match. That is deliberate and load-bearing:
/// applying the edits `check_text` offers must produce exactly what
/// `clean_text` produces under the corresponding options, so a SARIF consumer,
/// an LSP code action and the CLI never disagree about the same character. A
/// test asserts the equivalence directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextPolicy {
    /// Whether the text is prose or source code. Governs the bidi policy.
    pub context: BidiContext,
    /// Report space homoglyphs (`U+00A0`, `U+202F` and the rest).
    ///
    /// **On by default**, mirroring [`normalize_spaces`](crate::CleanOptions::normalize_spaces), which
    /// also defaults on. Turning it off here without turning that off too
    /// leaves `clean_text` silently rewriting characters this pass never
    /// mentioned.
    pub report_spaces: bool,
    /// Report every character with an ASCII confusable prototype, not only
    /// those the mixed-script and restricted-identifier rules catch. Finds
    /// same-script confusables such as Latin `ı` for `i`, at the cost of
    /// flagging honest Greek and Cyrillic prose.
    pub context_free_homoglyphs: bool,
    /// Offer the ASCII fold as a mechanical `replacement` on homoglyph
    /// findings.
    ///
    /// **Off by default**, mirroring [`aggressive_homoglyphs`](crate::CleanOptions::aggressive_homoglyphs).
    /// Detection is unconditional either way: a homoglyph is always reported,
    /// and the advice always names the character it is confusable with. This
    /// governs only whether the finding carries a fix, because folding rewrites
    /// letters inside words and would destroy, for example, a security note
    /// quoting an attack string verbatim.
    pub fold_homoglyphs: bool,
    /// Paranoid mode: report load-bearing invisibles too — emoji ZWJ glue,
    /// script joiners, flag tag sequences and same-script fillers.
    ///
    /// Off by default, and it should stay off for anything user-facing:
    /// acting on these findings corrupts genuine emoji, Indic and Persian
    /// text. It exists for auditing a document you already distrust.
    pub strip_emoji_glue: bool,
}

impl Default for TextPolicy {
    fn default() -> Self {
        Self {
            context: BidiContext::Prose,
            // Mirrors CleanOptions::normalize_spaces, which defaults on.
            report_spaces: true,
            context_free_homoglyphs: false,
            // Mirrors CleanOptions::aggressive_homoglyphs, which defaults off.
            fold_homoglyphs: false,
            strip_emoji_glue: false,
        }
    }
}

/// Byte offset of every character in `source`, plus the total length.
fn byte_offsets(source: &str) -> Vec<usize> {
    let mut offsets: Vec<usize> = source.char_indices().map(|(index, _)| index).collect();
    offsets.push(source.len());
    offsets
}

fn span_of(offsets: &[usize], start: usize, end: usize) -> Span {
    let last = offsets.len().saturating_sub(1);
    Span::new(offsets[start.min(last)], offsets[end.min(last)])
}

/// Check `source` for every Layer A carrier, returning byte-spanned findings.
///
/// ```
/// use prose_sanitiser_unicode::check::{check_text, TextPolicy, RULE_VS_PAYLOAD};
///
/// let findings = check_text("a\u{E0158}\u{E0159}", &TextPolicy::default());
/// assert_eq!(findings[0].rule_id, RULE_VS_PAYLOAD);
/// assert!(findings[0].advice.contains("\"hi\""));
/// ```
pub fn check_text(source: &str, policy: &TextPolicy) -> Vec<Finding> {
    let units: Vec<Unit> = source.chars().map(Unit::Char).collect();
    let offsets = byte_offsets(source);
    let mut findings = Vec::new();

    findings.extend(payload_findings(&units, &offsets));
    findings.extend(bidi_findings(&units, &offsets, policy.context));
    findings.extend(homoglyph_findings(&units, &offsets, policy));
    findings.extend(invisible_findings(&units, &offsets, policy));

    findings.sort_by_key(|finding| (finding.span.start, finding.rule_id.clone()));
    findings
}

fn payload_findings(units: &[Unit], offsets: &[usize]) -> Vec<Finding> {
    stego::scan(units)
        .into_iter()
        .map(|payload| {
            let rule_id = match payload.kind {
                PayloadKind::VariationSelector => RULE_VS_PAYLOAD,
                PayloadKind::TagBlock => RULE_TAG_PAYLOAD,
                PayloadKind::ZeroWidthBinary => RULE_ZW_PAYLOAD,
            };
            let decoded = match payload.as_text() {
                Some(text) if !text.is_empty() => format!("{text:?}"),
                _ => format!("{:?} (not UTF-8)", payload.printable()),
            };
            Finding {
                rule_id: rule_id.to_string(),
                label: format!("smuggled payload: {}", payload.kind.as_str()),
                span: span_of(offsets, payload.start, payload.end),
                matched: format!("{} carrier characters", payload.len()),
                severity: Severity::High,
                confidence: ConfidenceTier::CertainMechanical,
                advice: format!(
                    "Decoded payload {decoded}, hex {}. {}. Remove the carrier characters; \
                     treat the payload as untrusted input.",
                    payload.hex(),
                    payload.note
                ),
                replacement: Some(String::new()),
            }
        })
        .collect()
}

fn bidi_findings(units: &[Unit], offsets: &[usize], context: BidiContext) -> Vec<Finding> {
    let report = bidi::analyse(units, context);
    report
        .hits
        .into_iter()
        .map(|hit| Finding {
            rule_id: RULE_BIDI.to_string(),
            label: format!("bidi control: {}", hit.fault.as_str()),
            span: span_of(offsets, hit.offset, hit.offset + 1),
            matched: format!("U+{:04X}", hit.control as u32),
            severity: Severity::High,
            confidence: ConfidenceTier::CertainMechanical,
            advice: hit.fault.advice().to_string(),
            // Strippability follows the fault, not the context. An unclosed
            // open may want the missing pop added rather than the open dropped,
            // so it carries no replacement in either context; everything else
            // is mechanically junk and `clean_text` removes it, which is what
            // the two surfaces must agree on.
            replacement: hit.fault.strippable().then(String::new),
        })
        .collect()
}

fn homoglyph_findings(units: &[Unit], offsets: &[usize], policy: &TextPolicy) -> Vec<Finding> {
    let mut findings: Vec<Finding> = confusables::scan(units)
        .into_iter()
        .map(|hit| Finding {
            rule_id: RULE_HOMOGLYPH.to_string(),
            label: format!("homoglyph: {}", hit.reason.as_str()),
            span: span_of(offsets, hit.offset, hit.offset + 1),
            matched: hit.character.to_string(),
            severity: Severity::High,
            confidence: ConfidenceTier::CertainMechanical,
            advice: format!(
                "U+{:04X} is confusable with ASCII {:?} in {:?}; UTS #39 skeleton folding \
                 restores the intended text. Folding is opt-in, because it rewrites letters \
                 inside words.",
                hit.character as u32, hit.prototype, hit.word
            ),
            replacement: policy.fold_homoglyphs.then(|| hit.prototype.to_string()),
        })
        .collect();

    if policy.context_free_homoglyphs {
        let seen: Vec<usize> = findings.iter().map(|finding| finding.span.start).collect();
        for (offset, character) in units
            .iter()
            .copied()
            .enumerate()
            .filter_map(|(offset, unit)| unit.as_char().map(|c| (offset, c)))
        {
            let Some(prototype) = confusables::prototype(character) else {
                continue;
            };
            let span = span_of(offsets, offset, offset + 1);
            if seen.contains(&span.start) {
                continue;
            }
            findings.push(Finding {
                rule_id: RULE_HOMOGLYPH.to_string(),
                label: "homoglyph: context-free".to_string(),
                span,
                matched: character.to_string(),
                severity: Severity::Medium,
                confidence: ConfidenceTier::CertainMechanical,
                advice: format!(
                    "U+{:04X} is confusable with ASCII {prototype:?}. No mixed-script or \
                     restricted-identifier evidence, so this may be honest text in its own \
                     script.",
                    character as u32
                ),
                replacement: policy.fold_homoglyphs.then(|| prototype.to_string()),
            });
        }
    }
    findings
}

fn invisible_findings(units: &[Unit], offsets: &[usize], policy: &TextPolicy) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut previous_kept: Option<Unit> = None;
    for (offset, unit) in units.iter().copied().enumerate() {
        // U+FEFF at offset 0 is a byte-order mark, which is document framing
        // rather than a carrier. Anywhere else it is a stray ZWNBSP.
        if crate::decide::is_bom_at_start(offset, unit) {
            previous_kept = Some(unit);
            continue;
        }
        // A soft hyphen is reported but never fixed: it is a legitimate
        // hyphenation hint as often as it is a carrier, and only the author
        // knows which. `CleanOptions::strip_soft_hyphen` is the opt-in.
        if crate::decide::is_soft_hyphen(unit) {
            findings.push(Finding {
                rule_id: RULE_SOFT_HYPHEN.to_string(),
                label: "soft hyphen".to_string(),
                span: span_of(offsets, offset, offset + 1),
                matched: crate::decide::SOFT_HYPHEN.to_string(),
                severity: Severity::Low,
                confidence: ConfidenceTier::LowConfidenceJudgement,
                advice: "U+00AD SOFT HYPHEN is invisible unless a line break falls on it. \
                         That makes it a legitimate hyphenation hint and a known invisible \
                         carrier, and only the author can say which this is. Review it; \
                         clean with --strip-soft-hyphen if it is not wanted."
                    .to_string(),
                replacement: None,
            });
            previous_kept = Some(unit);
            continue;
        }
        let decision = decide(
            unit,
            previous_kept,
            policy.report_spaces,
            false,
            policy.strip_emoji_glue,
        );
        let Some(kind) = decision.kind else {
            if !unit
                .as_char()
                .map(|c| crate::decide::is_glue(c as u32))
                .unwrap_or(false)
            {
                previous_kept = decision.output;
            }
            continue;
        };
        if decision.action == Action::Replace {
            previous_kept = decision.output;
        }
        // Bidi and smuggled payloads have their own, better-informed rules.
        if kind == "bidi" || kind == "tag_chars" || kind == "variation_selector" {
            continue;
        }
        let character = unit.as_char().unwrap_or(char::REPLACEMENT_CHARACTER);
        let (severity, replacement) = match decision.action {
            Action::Replace => (
                Severity::Low,
                decision.output.and_then(Unit::as_char).map(String::from),
            ),
            _ => (Severity::Medium, Some(String::new())),
        };
        findings.push(Finding {
            rule_id: RULE_INVISIBLE.to_string(),
            label: format!("invisible carrier: {kind}"),
            span: span_of(offsets, offset, offset + 1),
            matched: character.to_string(),
            severity,
            confidence: ConfidenceTier::CertainMechanical,
            advice: format!(
                "{} carries no visible content here and is a known steganographic carrier.",
                crate::decide::char_label(unit)
            ),
            replacement,
        });
    }
    findings
}

#[cfg(test)]
mod tests;
