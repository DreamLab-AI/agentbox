//! Layer A: invisible-Unicode, steganographic-payload and homoglyph surgery on
//! plain text.
//!
//! Deterministic codepoint surgery. What it removes is contraband; what it
//! keeps is load-bearing. Every decision is a classification of a codepoint and
//! its context, so a strip is verifiable by diffing the output — no model, no
//! heuristics, no network.
//!
//! # The four things this crate does
//!
//! 1. **Classifies invisible and format-class carriers** ([`inspect_text`],
//!    [`clean_text`]): the zero-width family, the tag block, variation
//!    selectors, bidi controls, exotic whitespace, soft hyphen, Hangul fillers.
//!    Whitespace and the soft hyphen are reported but not rewritten by default:
//!    both are load-bearing typography as often as they are contraband.
//! 2. **Decodes smuggled payloads rather than only stripping them**
//!    ([`stego`]): variation-selector chains in Paul Butler's byte encoding,
//!    tag-block ASCII, and zero-width binary. A finding carries the recovered
//!    bytes as hex and as printable text.
//! 3. **Detects homoglyph and mixed-script substitution** ([`confusables`])
//!    using UTS #39 `confusables.txt` skeletons, Identifier_Status and
//!    mixed-script detection by way of the `unicode-security` crate.
//! 4. **Applies a bidi policy that depends on context** ([`bidi`]): every
//!    control is contraband in source code (Trojan Source, CVE-2021-42574);
//!    balanced controls are preserved in prose that genuinely contains
//!    right-to-left script.
//!
//! # Two views of the same surface
//!
//! [`inspect_text`] and [`clean_text`] count codepoints, which is what an audit
//! sweep wants. [`check::check_text`] reports the same surface as
//! [`Finding`](prose_sanitiser_core::Finding)s with byte spans, which is what a
//! SARIF exporter, an LSP server or a patch-building `fix()` pass wants.
//! Neither view mutates its input; [`clean_text`] returns a new buffer.
//!
//! ```
//! use prose_sanitiser_core::surrogate;
//! use prose_sanitiser_unicode::{clean_text, CleanOptions};
//!
//! let dirty = surrogate::decode("in\u{200B}vis\u{200D}ible".as_bytes());
//! let (clean, stats) = clean_text(&dirty, CleanOptions::default());
//! assert_eq!(surrogate::to_lossy_string(&clean), "invisible");
//! assert_eq!(stats.removed_count, 2);
//! ```
//!
//! # Honest scope
//!
//! From the capability matrix (section B of the design brief):
//!
//! **Can detect and losslessly strip (verifiable by diff)**
//!
//! | Capability | Basis |
//! |---|---|
//! | Invisible Cf-class controls in text: zero-width family, tag block, variation selectors, bidi controls, Hangul fillers | Deterministic codepoint classification with context rules |
//! | Variation-selector, tag-block and zero-width payloads, **including decoding them** | The Butler byte mapping and the tag block are fully specified |
//! | Homoglyph and mixed-script substitution | UTS #39 skeleton, Identifier_Status and restriction levels |
//!
//! **Must never touch**
//!
//! | Never modify | Rule |
//! |---|---|
//! | `U+200D` inside a well-formed emoji ZWJ sequence | UTS #51 ED-16 |
//! | `Mn`/`Mc` combining marks | Never blanket-strip; only `Cf`-class controls are candidates |
//! | ZWNJ/ZWJ after an Indic virama, or between Persian morphemes | Orthographically load-bearing |
//! | Balanced bidi controls in genuine RTL prose | Only reject them in source-code contexts (Trojan Source) |
//! | `U+FEFF` at byte offset 0 | It is a BOM there and only there |
//! | `U+00AD` SOFT HYPHEN, unless asked | A hyphenation hint as often as a carrier; reported, never fixed, stripped only via `CleanOptions::strip_soft_hyphen` |
//! | Exotic whitespace, unless asked | `U+00A0` and `U+202F` hold quantities and figure references together and are required before French punctuation; reported, rewritten only via `CleanOptions::normalize_spaces` |
//! | Regional-indicator pairs and RGI emoji tag sequences | Well-formed flags, not carriers |
//! | NFKC normalisation of user-facing prose | Lossy by design (UAX #15); NFC only, and only when asked |
//!
//! This crate does **not** detect statistical sampling watermarks. Those are
//! defined by which tokens a model selected, are undetectable without the
//! vendor key, and no amount of codepoint inspection can see them.

#![deny(missing_docs)]

pub mod bidi;
pub mod check;
pub mod confusables;
pub mod decide;
pub mod report;
pub mod rules;
pub mod stego;
pub mod tables;

use unicode_normalization::UnicodeNormalization;

use bidi::BidiContext;
pub use check::check_text;
use check::TextPolicy;
use decide::{char_label, decide, is_glue, Action};
use prose_sanitiser_core::Unit;
pub use report::{human_report, payload_json, CharHit, CleanStats, LabelCounts, TextInspectReport};
pub use rules::{FIXABILITY, RULES};

const BASE_NOTES: [&str; 5] = [
    "Layer A only: invisible/format Unicode, smuggled payloads and homoglyphs (edit-based carriers).",
    "Statistical (token-sampling) watermarks are not detectable here; use Layer B rewrite.",
    "Inspect kinds: strip, bidi, tag_chars, variation_selector, zwj_family, private_use, space, confusable, other_cf.",
    "Load-bearing invisibles are preserved by default: emoji glue (ZWJ/VS after an emoji base), script joiners (ZWNJ/ZWJ inside complex scripts), RGI flag tag sequences, same-script fillers/selectors (Mongolian FVS, Khmer inherent vowels, Hangul jamo fillers), orthographic Arabic/Syriac Cf marks, and balanced bidi controls in text that contains RTL script. Use --strip-emoji-glue for paranoid mode (strips them all).",
    "Homoglyphs are judged by UTS #39 skeleton plus mixed-script and Identifier_Status context, not by a hand-written table; see the `confusables` module for the one documented gap.",
];

const CLEAN_NOTE: &str = "No deterministic Layer A (invisible Unicode/format) carriers detected; \
statistical and pixel-domain marks are out of scope here.";

/// How an [`inspect_text_with`] pass should read its input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InspectOptions {
    /// Also report every character with an ASCII confusable prototype, not only
    /// those the mixed-script and restricted-identifier rules catch.
    pub aggressive_homoglyphs: bool,
    /// Treat emoji glue, script joiners and flag tags as contraband too.
    pub strip_emoji_glue: bool,
    /// Whether the text is prose or source code, for the bidi policy.
    pub bidi_context: BidiContext,
}

impl Default for InspectOptions {
    fn default() -> Self {
        Self {
            aggressive_homoglyphs: false,
            strip_emoji_glue: false,
            bidi_context: BidiContext::Prose,
        }
    }
}

/// Options for [`clean_text`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CleanOptions {
    /// Apply NFKC. Off by default and it should stay off for prose: NFKC is
    /// lossy by design (UAX #15). NFC is the form for storage and display.
    pub nfkc: bool,
    /// Fold characters confusable with ASCII to their prototype.
    pub aggressive_homoglyphs: bool,
    /// Restrict that fold to characters the mixed-script and
    /// restricted-identifier rules actually flag, so honest Greek, Cyrillic or
    /// Turkish prose is never folded into Latin. On by default.
    pub mixed_script_only: bool,
    /// Replace exotic whitespace with `U+0020`.
    ///
    /// **Off by default.** A no-break space is load-bearing typography, not a
    /// carrier: it holds "10 km" and "Figure 3" together, and French
    /// orthography requires one before `;`, `:`, `!` and `?`. Folding it to
    /// `U+0020` costs the document that property silently, and a diff cannot
    /// show it, because both render as a space. Exotic whitespace is always
    /// reported; this decides whether it is rewritten.
    pub normalize_spaces: bool,
    /// Strip emoji glue, script joiners and flag tags as well.
    pub strip_emoji_glue: bool,
    /// Whether the text is prose or source code, for the bidi policy.
    pub bidi_context: BidiContext,
    /// Remove `U+00AD` SOFT HYPHEN.
    ///
    /// Off by default. A soft hyphen is a legitimate hyphenation hint as often
    /// as it is a carrier, so removing it is a judgement about the author's
    /// intent rather than a mechanical fact. `inspect_text` and `check_text`
    /// always report it; only this makes a clean act on it.
    pub strip_soft_hyphen: bool,
}

impl Default for CleanOptions {
    fn default() -> Self {
        Self {
            nfkc: false,
            aggressive_homoglyphs: false,
            mixed_script_only: true,
            normalize_spaces: false,
            strip_emoji_glue: false,
            bidi_context: BidiContext::Prose,
            strip_soft_hyphen: false,
        }
    }
}

const NFKC_LABEL: &str = "NFKC_normalize";

/// The inspect kind for a carrier inside a decoded payload.
fn payload_kind_of(payloads: &[stego::Payload], offset: usize) -> &'static str {
    payloads
        .iter()
        .find(|payload| (payload.start..payload.end).contains(&offset))
        .map(|payload| match payload.kind {
            stego::PayloadKind::VariationSelector => "variation_selector",
            stego::PayloadKind::TagBlock => "tag_chars",
            stego::PayloadKind::ZeroWidthBinary => "zwj_family",
        })
        .unwrap_or("strip")
}

/// Offsets whose character the context-aware passes have already ruled on.
struct Context {
    /// Bidi controls the policy preserves; `decide` would otherwise strip them.
    preserved_bidi: Vec<usize>,
    /// Confusables the run-level UTS #39 rules flagged, and their prototypes.
    confusables: Vec<(usize, char)>,
    /// Whether the input opens with a byte-order mark, which is framing rather
    /// than a carrier and must survive.
    preserve_bom: bool,
    /// Character offsets covered by a decoded steganographic payload.
    ///
    /// These override every preservation rule. A carrier inside a payload is
    /// contraband whatever else it looks like: tag characters after a flag base
    /// and joiners after an Arabic letter are ordinarily load-bearing, and that
    /// is exactly what a smuggler hides behind.
    payload_carriers: Vec<usize>,
}

impl Context {
    fn build(units: &[Unit], bidi_context: BidiContext, strip_emoji_glue: bool) -> Self {
        let preserved_bidi = if strip_emoji_glue {
            Vec::new()
        } else {
            bidi::analyse(units, bidi_context).preserved
        };
        let confusables = confusables::scan(units)
            .into_iter()
            .map(|hit| (hit.offset, hit.prototype))
            .collect();
        let preserve_bom = !strip_emoji_glue
            && units
                .first()
                .copied()
                .is_some_and(|unit| decide::is_bom_at_start(0, unit));
        // `stego::scan` has already excluded the legitimate shapes: an RGI
        // subdivision flag yields no payload, so anything it does return is
        // contraband and every carrier in it must go.
        let mut payload_carriers: Vec<usize> = stego::scan(units)
            .iter()
            .flat_map(|payload| payload.start..payload.end)
            .collect();
        payload_carriers.sort_unstable();
        Self {
            preserved_bidi,
            confusables,
            preserve_bom,
            payload_carriers,
        }
    }

    /// Whether the character at `offset` is a carrier inside a decoded payload.
    fn in_payload(&self, offset: usize) -> bool {
        self.payload_carriers.binary_search(&offset).is_ok()
    }

    /// Whether the character at `offset` is the document's byte-order mark.
    fn keeps_bom(&self, offset: usize) -> bool {
        self.preserve_bom && offset == 0
    }

    fn keeps_bidi(&self, offset: usize) -> bool {
        self.preserved_bidi.binary_search(&offset).is_ok()
    }

    fn confusable_at(&self, offset: usize) -> Option<char> {
        self.confusables
            .iter()
            .find(|(at, _)| *at == offset)
            .map(|(_, prototype)| *prototype)
    }
}

/// Scan `units` for invisible carriers, smuggled payloads and homoglyphs.
///
/// `aggressive` widens homoglyph reporting from the context-aware UTS #39 rules
/// to every character with an ASCII prototype; `strip_emoji_glue` treats
/// load-bearing invisibles as contraband too.
pub fn inspect_text(units: &[Unit], aggressive: bool, strip_emoji_glue: bool) -> TextInspectReport {
    inspect_text_with(
        units,
        InspectOptions {
            aggressive_homoglyphs: aggressive,
            strip_emoji_glue,
            ..InspectOptions::default()
        },
    )
}

/// Scan `units` under explicit [`InspectOptions`].
pub fn inspect_text_with(units: &[Unit], options: InspectOptions) -> TextInspectReport {
    let context = Context::build(units, options.bidi_context, options.strip_emoji_glue);
    let payloads = stego::scan(units);
    // Insertion-ordered buckets keyed by (codepoint, kind), matching the
    // Python dict so equal-count hits keep first-seen order after sorting.
    let mut buckets: Vec<((u32, &'static str), Vec<usize>)> = Vec::new();
    let mut push = |codepoint: u32, kind: &'static str, offset: usize| {
        let key = (codepoint, kind);
        match buckets.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, offsets)) => offsets.push(offset),
            None => buckets.push((key, vec![offset])),
        }
    };
    let mut previous_kept: Option<Unit> = None;

    for (offset, unit) in units.iter().copied().enumerate() {
        let codepoint = unit.as_char().map(|c| c as u32).unwrap_or(0);
        if context.in_payload(offset) {
            push(codepoint, payload_kind_of(&payloads, offset), offset);
            continue;
        }
        if context.keeps_bidi(offset) || context.keeps_bom(offset) {
            // A preserved bidi control is an invisible mark, not a base: it
            // must not break a joiner's binding to the letter before it. A
            // byte-order mark at offset 0 is framing, not a carrier.
            continue;
        }
        let confusable = context
            .confusable_at(offset)
            .or_else(|| {
                options
                    .aggressive_homoglyphs
                    .then(|| unit.as_char().and_then(confusables::prototype))
                    .flatten()
            })
            .is_some();
        if confusable {
            push(codepoint, "confusable", offset);
            previous_kept = Some(unit);
            continue;
        }
        // A soft hyphen is reported under its own kind: it is worth a reader's
        // attention, but it is a hyphenation hint as often as a carrier, so it
        // is never counted alongside the mechanical certainties.
        if decide::is_soft_hyphen(unit) {
            push(codepoint, "soft_hyphen", offset);
            previous_kept = Some(unit);
            continue;
        }
        let decision = decide(unit, previous_kept, true, false, options.strip_emoji_glue);
        let Some(kind) = decision.kind else {
            // Kept; glue (emoji/script joiner/tag) does not advance the
            // "previous kept" base so ZWJ chains and flag runs stay bound.
            if !unit.as_char().map(|c| is_glue(c as u32)).unwrap_or(false) {
                previous_kept = decision.output;
            }
            continue;
        };
        push(codepoint, kind, offset);
        if decision.action == Action::Replace {
            previous_kept = decision.output;
        }
        // strip: previous_kept unchanged
    }

    // Sort by descending count, then by codepoint; a stable sort preserves
    // first-seen order for full ties, as Python's `sorted` does.
    buckets.sort_by_key(|((codepoint, _), offsets)| (std::cmp::Reverse(offsets.len()), *codepoint));

    let mut hits = Vec::with_capacity(buckets.len());
    let mut total = 0;
    for ((codepoint, kind), offsets) in buckets {
        total += offsets.len();
        hits.push(CharHit {
            codepoint,
            label: char_label(Unit::Char(
                char::from_u32(codepoint).unwrap_or(char::REPLACEMENT_CHARACTER),
            )),
            count: offsets.len(),
            kind,
            samples: offsets.into_iter().take(10).collect(),
        });
    }

    let mut notes: Vec<String> = BASE_NOTES.iter().map(|note| note.to_string()).collect();
    if hits.is_empty() && payloads.is_empty() {
        notes.push(CLEAN_NOTE.to_string());
    }
    TextInspectReport {
        length: units.len(),
        suspicious_total: total,
        hits,
        payloads,
        notes,
    }
}

/// Strip invisible carriers and normalise homoglyphs, returning the cleaned
/// units and a stats block.
///
/// The input is never mutated. Bidi controls the [`CleanOptions::bidi_context`]
/// policy preserves survive; smuggled payloads are decoded into
/// [`CleanStats::payloads`] before their carriers are removed.
pub fn clean_text(units: &[Unit], options: CleanOptions) -> (Vec<Unit>, CleanStats) {
    let context = Context::build(units, options.bidi_context, options.strip_emoji_glue);
    let payloads = stego::scan(units);
    let mut removed = LabelCounts::default();
    let mut replaced = LabelCounts::default();
    let mut output: Vec<Unit> = Vec::with_capacity(units.len());
    let mut previous_kept: Option<Unit> = None;

    for (offset, unit) in units.iter().copied().enumerate() {
        if context.in_payload(offset) {
            // A decoded payload outranks every preservation rule: reporting a
            // hidden byte string and then leaving it in place is the one
            // outcome worse than not detecting it.
            removed.bump(char_label(unit), 1);
            continue;
        }
        if context.keeps_bidi(offset) || context.keeps_bom(offset) {
            // Load-bearing: a preserved bidi control, or the document's own
            // byte-order mark at offset 0.
            output.push(unit);
            continue;
        }
        if decide::is_soft_hyphen(unit) && !options.strip_soft_hyphen && !options.strip_emoji_glue {
            // Preserved by default: removing a hyphenation hint is a judgement
            // about the author's intent, not a mechanical fact.
            output.push(unit);
            previous_kept = Some(unit);
            continue;
        }
        if options.aggressive_homoglyphs {
            let prototype = if options.mixed_script_only {
                context.confusable_at(offset)
            } else {
                context
                    .confusable_at(offset)
                    .or_else(|| unit.as_char().and_then(confusables::prototype))
            };
            if let Some(prototype) = prototype {
                output.push(Unit::Char(prototype));
                replaced.bump(char_label(unit), 1);
                previous_kept = Some(Unit::Char(prototype));
                continue;
            }
        }
        let decision = decide(
            unit,
            previous_kept,
            options.normalize_spaces,
            false,
            options.strip_emoji_glue,
        );
        match decision.action {
            Action::Keep => {
                if let Some(kept) = decision.output {
                    output.push(kept);
                }
                // Glue does not advance the "previous kept" base, so ZWJ chains
                // and flag runs stay bound.
                if !unit.as_char().map(|c| is_glue(c as u32)).unwrap_or(false) {
                    previous_kept = decision.output;
                }
            }
            Action::Replace => {
                if let Some(kept) = decision.output {
                    output.push(kept);
                }
                replaced.bump(char_label(unit), 1);
                previous_kept = decision.output;
            }
            Action::Strip => {
                removed.bump(char_label(unit), 1);
                // previous_kept unchanged
            }
        }
    }

    if options.nfkc {
        let normalised = normalize_nfkc(&output);
        if normalised != output {
            // `abs(len(before) - len(result)) or 1`: a change that preserves
            // length still counts as one replacement.
            let delta = (normalised.len() as i64 - output.len() as i64).unsigned_abs();
            replaced.bump(NFKC_LABEL.to_string(), delta.max(1));
            output = normalised;
        }
    }

    let stats = CleanStats {
        input_length: units.len(),
        output_length: output.len(),
        removed_count: removed.total(),
        replaced_count: replaced.total_excluding(NFKC_LABEL),
        removed,
        replaced,
        payloads,
    };
    (output, stats)
}

/// NFKC-normalise, splitting at undecodable bytes (lone surrogates never
/// participate in composition, so the split is behaviour-preserving).
fn normalize_nfkc(units: &[Unit]) -> Vec<Unit> {
    let mut output = Vec::with_capacity(units.len());
    let mut run = String::new();
    for unit in units.iter().copied() {
        match unit {
            Unit::Char(character) => run.push(character),
            Unit::Raw(byte) => {
                output.extend(run.nfkc().map(Unit::Char));
                run.clear();
                output.push(Unit::Raw(byte));
            }
        }
    }
    output.extend(run.nfkc().map(Unit::Char));
    output
}

/// Check `source` for every Layer A carrier under the default prose policy.
///
/// A convenience over [`check::check_text`] for callers that do not need to
/// choose a context.
pub fn check_prose(source: &str) -> Vec<prose_sanitiser_core::Finding> {
    check_text(source, &TextPolicy::default())
}

#[cfg(test)]
mod tests;
