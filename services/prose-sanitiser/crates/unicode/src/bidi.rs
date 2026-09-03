//! Bidi policy, split by context: reject in code, preserve in prose.
//!
//! The same codepoint is an attack in one context and load-bearing typography
//! in the other, so a single policy is wrong for one of them. This module is
//! the reason the crate asks callers whether they are scanning prose or source.
//!
//! # Code contexts: reject everything
//!
//! The Trojan Source attack ([Boucher and Anderson,
//! arXiv 2111.00169](https://arxiv.org/abs/2111.00169), CVE-2021-42574) uses
//! bidi controls to make source display in one logical order and compile in
//! another, demonstrated across C, C++, C#, JavaScript, Java, Rust, Go, Python,
//! SQL, Bash and Solidity. It forced out-of-band releases in GCC, Clang and
//! rustc 1.56.1. The standards answer is
//! [UTS #55](https://www.unicode.org/reports/tr55/): in source code **every**
//! bidi control is rejected, balanced or not.
//!
//! # Prose contexts: preserve, but report malformed nesting
//!
//! Genuine right-to-left prose needs these characters. Arabic and Hebrew text
//! interleaved with Latin names, numbers or identifiers relies on isolates and
//! marks to render correctly, so stripping them corrupts the document. Two
//! things are still worth reporting in prose:
//!
//! - **Unbalanced nesting.** An unterminated embedding or isolate reorders
//!   everything after it, which is the readable half of the same attack.
//! - **Controls with nothing to reorder.** A bidi control in text containing no
//!   RTL script at all is contraband whatever its nesting.

use prose_sanitiser_core::Unit;

/// Whether the text being scanned is source code or prose.
///
/// This is the single input that flips bidi policy. It defaults to
/// [`BidiContext::Prose`], the conservative choice: prose policy preserves
/// characters that code policy would remove, so a misclassified file is under-
/// rather than over-cleaned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BidiContext {
    /// Human-facing prose. Balanced controls in RTL text are load-bearing.
    #[default]
    Prose,
    /// Source code. Every bidi control is contraband (Trojan Source).
    Code,
}

impl BidiContext {
    /// The lowercase wire form used in reports and CLI flags.
    pub fn as_str(self) -> &'static str {
        match self {
            BidiContext::Prose => "prose",
            BidiContext::Code => "code",
        }
    }

    /// Parse the wire form, returning `None` for anything unrecognised.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "prose" => Some(BidiContext::Prose),
            "code" => Some(BidiContext::Code),
            _ => None,
        }
    }
}

/// The role a bidi control plays in the bidirectional algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BidiRole {
    /// `LRE`, `RLE`, `LRO`, `RLO`: opens a directional embedding or override.
    OpenEmbedding,
    /// `PDF`: closes the innermost embedding or override.
    PopEmbedding,
    /// `LRI`, `RLI`, `FSI`: opens a directional isolate.
    OpenIsolate,
    /// `PDI`: closes the innermost isolate.
    PopIsolate,
    /// `LRM`, `RLM`, `ALM`: a standalone mark, with nothing to balance.
    Mark,
}

/// Classify a codepoint's bidi role, or `None` if it is not a bidi control.
pub fn bidi_role(codepoint: u32) -> Option<BidiRole> {
    match codepoint {
        0x202A..=0x202B | 0x202D..=0x202E => Some(BidiRole::OpenEmbedding),
        0x202C => Some(BidiRole::PopEmbedding),
        0x2066..=0x2068 => Some(BidiRole::OpenIsolate),
        0x2069 => Some(BidiRole::PopIsolate),
        0x200E | 0x200F | 0x061C => Some(BidiRole::Mark),
        _ => None,
    }
}

/// Whether `codepoint` is any of the twelve bidi controls.
pub fn is_bidi_control(codepoint: u32) -> bool {
    bidi_role(codepoint).is_some()
}

/// Whether a character belongs to a right-to-left script.
///
/// Covers the RTL blocks that appear in running prose: Hebrew, Arabic, Syriac,
/// Thaana, N'Ko, Samaritan, Mandaic, the Arabic presentation forms, and the RTL
/// supplementary planes.
pub fn is_rtl_char(codepoint: u32) -> bool {
    matches!(codepoint,
        0x0590..=0x05FF     // Hebrew
        | 0x0600..=0x06FF   // Arabic
        | 0x0700..=0x074F   // Syriac
        | 0x0750..=0x077F   // Arabic Supplement
        | 0x0780..=0x07BF   // Thaana
        | 0x07C0..=0x07FF   // N'Ko
        | 0x0800..=0x083F   // Samaritan
        | 0x0840..=0x085F   // Mandaic
        | 0x08A0..=0x08FF   // Arabic Extended-A
        | 0xFB1D..=0xFDFF   // Hebrew and Arabic presentation forms
        | 0xFE70..=0xFEFF   // Arabic Presentation Forms-B
        | 0x10800..=0x10FFF // RTL historic scripts
        | 0x1E800..=0x1EFFF // Adlam, Arabic Mathematical
    )
}

/// Whether `units` contain any right-to-left script.
///
/// Prose policy only treats bidi controls as load-bearing where there is RTL
/// script for them to act on: balanced controls in Latin-only prose have
/// nothing to reorder and are contraband whatever the context.
pub fn contains_rtl(units: &[Unit]) -> bool {
    units
        .iter()
        .copied()
        .filter_map(Unit::as_char)
        .any(|character| is_rtl_char(character as u32))
}

/// Why a bidi control was reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BidiFault {
    /// Any bidi control in a code context (Trojan Source).
    InCode,
    /// A pop with no matching open before it.
    UnmatchedPop,
    /// An open that is never popped before end of text.
    UnclosedOpen,
    /// An open terminated implicitly by an enclosing pop, rather than its own.
    NestedUnbalanced,
    /// A control in text containing no RTL script to reorder.
    NoRtlContext,
}

impl BidiFault {
    /// The lowercase wire form used in reports.
    pub fn as_str(self) -> &'static str {
        match self {
            BidiFault::InCode => "in-code",
            BidiFault::UnmatchedPop => "unmatched-pop",
            BidiFault::UnclosedOpen => "unclosed-open",
            BidiFault::NestedUnbalanced => "nested-unbalanced",
            BidiFault::NoRtlContext => "no-rtl-context",
        }
    }

    /// What an editor should do about it.
    pub fn advice(self) -> &'static str {
        match self {
            BidiFault::InCode => {
                "Bidi control in a code context: the Trojan Source attack (CVE-2021-42574) \
                 makes source display in one order and compile in another. UTS #55 rejects \
                 every bidi control in source code. Remove it."
            }
            BidiFault::UnmatchedPop => {
                "Bidi pop with no matching open. The document's directional state is \
                 malformed; remove it, or add the missing open."
            }
            BidiFault::UnclosedOpen => {
                "Bidi embedding or isolate is never closed, so it reorders every following \
                 character to the end of the text. Add the matching pop, or remove it."
            }
            BidiFault::NestedUnbalanced => {
                "Bidi embedding is terminated implicitly by an enclosing isolate's pop \
                 rather than its own. Close it explicitly so the nesting is well formed."
            }
            BidiFault::NoRtlContext => {
                "Bidi control in text containing no right-to-left script, so it has nothing \
                 legitimate to reorder. Remove it."
            }
        }
    }
}

/// One reported bidi control.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BidiHit {
    /// Character offset into the scanned units.
    pub offset: usize,
    /// The offending control.
    pub control: char,
    /// Why it was reported.
    pub fault: BidiFault,
}

/// The outcome of a bidi pass: what to keep, and what to report.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BidiReport {
    /// Ascending character offsets of controls that are load-bearing and must
    /// survive a clean. Empty in a code context, where nothing is preserved.
    pub preserved: Vec<usize>,
    /// The controls worth reporting, in source order.
    pub hits: Vec<BidiHit>,
}

/// Apply the bidi policy for `context` to `units`.
///
/// In [`BidiContext::Code`] every control is reported and none preserved. In
/// [`BidiContext::Prose`] a control is preserved when the text contains RTL
/// script and its nesting is well formed; unbalanced, nested-unbalanced and
/// no-RTL cases are reported.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::surrogate;
/// use prose_sanitiser_unicode::bidi::{analyse, BidiContext};
///
/// // Balanced isolates around genuine Hebrew: load-bearing, so preserved.
/// let prose = surrogate::decode("\u{2067}\u{05E9}\u{05DC}\u{05D5}\u{05DD}\u{2069}".as_bytes());
/// let report = analyse(&prose, BidiContext::Prose);
/// assert!(report.hits.is_empty());
/// assert_eq!(report.preserved, vec![0, 5]);
///
/// // The identical bytes in source code are the Trojan Source attack.
/// let code = analyse(&prose, BidiContext::Code);
/// assert_eq!(code.hits.len(), 2);
/// assert!(code.preserved.is_empty());
/// ```
pub fn analyse(units: &[Unit], context: BidiContext) -> BidiReport {
    let rtl = contains_rtl(units);
    let mut hits: Vec<BidiHit> = Vec::new();
    let mut preserved: Vec<usize> = Vec::new();
    // Unmatched opens, innermost last: (offset, control).
    let mut open: Vec<(usize, char, BidiRole)> = Vec::new();

    for (offset, unit) in units.iter().copied().enumerate() {
        let Some(control) = unit.as_char() else {
            continue;
        };
        let Some(role) = bidi_role(control as u32) else {
            continue;
        };
        let hit = |fault| BidiHit {
            offset,
            control,
            fault,
        };

        // Source code: every control is contraband, balanced or not.
        if context == BidiContext::Code {
            hits.push(hit(BidiFault::InCode));
            continue;
        }
        // Prose with no RTL script anywhere: the control has nothing
        // legitimate to reorder, whatever its nesting.
        if !rtl {
            hits.push(hit(BidiFault::NoRtlContext));
            continue;
        }

        match role {
            BidiRole::OpenEmbedding | BidiRole::OpenIsolate => open.push((offset, control, role)),
            BidiRole::PopIsolate => {
                // Per UAX #9 a PDI matches the nearest preceding unmatched
                // isolate initiator. Embeddings opened inside that isolate are
                // terminated implicitly: the nested-unbalanced case.
                match open
                    .iter()
                    .rposition(|(_, _, open_role)| *open_role == BidiRole::OpenIsolate)
                {
                    Some(position) => {
                        let mut tail = open.split_off(position);
                        // tail[0] is the isolate this PDI matches: balanced, so
                        // both ends are load-bearing and preserved.
                        let (isolate_offset, _, _) = tail.remove(0);
                        preserved.push(isolate_offset);
                        preserved.push(offset);
                        for (nested_offset, nested, _) in tail {
                            hits.push(BidiHit {
                                offset: nested_offset,
                                control: nested,
                                fault: BidiFault::NestedUnbalanced,
                            });
                        }
                    }
                    None => hits.push(hit(BidiFault::UnmatchedPop)),
                }
            }
            BidiRole::PopEmbedding => {
                // A PDF matches the innermost embedding only. An intervening
                // isolate blocks it, which the top-of-stack test gives free.
                match open.last() {
                    Some((open_offset, _, BidiRole::OpenEmbedding)) => {
                        preserved.push(*open_offset);
                        preserved.push(offset);
                        open.pop();
                    }
                    _ => hits.push(hit(BidiFault::UnmatchedPop)),
                }
            }
            // Marks balance nothing, and in RTL prose they are load-bearing.
            BidiRole::Mark => preserved.push(offset),
        }
    }

    // Whatever is still open at end of text was never closed.
    for (offset, control, _) in open {
        hits.push(BidiHit {
            offset,
            control,
            fault: BidiFault::UnclosedOpen,
        });
    }

    hits.sort_by_key(|hit| hit.offset);
    preserved.sort_unstable();
    BidiReport { preserved, hits }
}

#[cfg(test)]
mod tests;
