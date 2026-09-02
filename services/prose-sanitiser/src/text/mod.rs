//! Layer A: invisible Unicode / homoglyph space detection and cleaning.

pub mod decide;
pub mod tables;

use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::common::Unit;
use decide::{char_label, decide, hit_confidence, is_glue, Action};

/// One flagged codepoint, with a sample of the offsets it was seen at.
#[derive(Debug, Clone)]
pub struct CharHit {
    pub codepoint: u32,
    pub label: String,
    pub count: usize,
    /// strip | bidi | tag_chars | variation_selector | zwj_family | private_use
    /// | space | confusable | other_cf
    pub kind: &'static str,
    /// Character offsets, capped at ten.
    pub samples: Vec<usize>,
}

/// The Layer A inspect result for one text.
#[derive(Debug, Clone)]
pub struct TextInspectReport {
    pub length: usize,
    pub suspicious_total: usize,
    pub hits: Vec<CharHit>,
    pub notes: Vec<String>,
}

impl TextInspectReport {
    pub fn to_json(&self) -> Value {
        json!({
            "length": self.length,
            "suspicious_total": self.suspicious_total,
            "hits": self.hits.iter().map(|hit| json!({
                "codepoint": format!("U+{:04X}", hit.codepoint),
                "label": hit.label,
                "count": hit.count,
                "kind": hit.kind,
                "confidence": hit_confidence(hit.kind),
                "sample_offsets": hit.samples,
            })).collect::<Vec<_>>(),
            "notes": self.notes,
        })
    }
}

const BASE_NOTES: [&str; 4] = [
    "Layer A only: invisible/format Unicode and space homoglyphs (edit-based carriers).",
    "Statistical (token-sampling) watermarks are not detectable here; use Layer B rewrite.",
    "Inspect kinds: strip, bidi, tag_chars, variation_selector, zwj_family, private_use, space, confusable, other_cf.",
    "Load-bearing invisibles are preserved by default: emoji glue (ZWJ/VS after an emoji base), script joiners (ZWNJ/ZWJ inside complex scripts), flag tag chars, same-script fillers/selectors (Mongolian FVS, Khmer inherent vowels, Hangul jamo fillers), and orthographic Arabic/Syriac Cf marks. Use --strip-emoji-glue for paranoid mode (strips them all).",
];

const CLEAN_NOTE: &str = "No deterministic Layer A (invisible Unicode/format) carriers detected; \
statistical and pixel-domain marks are out of scope here.";

/// Scan `units` for invisible carriers and space homoglyphs.
pub fn inspect_text(units: &[Unit], aggressive: bool, strip_emoji_glue: bool) -> TextInspectReport {
    // Insertion-ordered buckets keyed by (codepoint, kind), matching the
    // Python dict so equal-count hits keep first-seen order after sorting.
    let mut buckets: Vec<((u32, &'static str), Vec<usize>)> = Vec::new();
    let mut previous_kept: Option<Unit> = None;

    for (offset, unit) in units.iter().copied().enumerate() {
        let decision = decide(unit, previous_kept, true, aggressive, strip_emoji_glue);
        let Some(kind) = decision.kind else {
            // Kept; glue (emoji/script joiner/tag) does not advance the
            // "previous kept" base so ZWJ chains and flag runs stay bound.
            if !unit
                .as_char()
                .map(|c| is_glue(c as u32))
                .unwrap_or(false)
            {
                previous_kept = decision.output;
            }
            continue;
        };
        let codepoint = unit.as_char().map(|c| c as u32).unwrap_or(0);
        let key = (codepoint, kind);
        match buckets.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, offsets)) => offsets.push(offset),
            None => buckets.push((key, vec![offset])),
        }
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
    if hits.is_empty() {
        notes.push(CLEAN_NOTE.to_string());
    }
    TextInspectReport {
        length: units.len(),
        suspicious_total: total,
        hits,
        notes,
    }
}

/// Counts keyed by character label, in first-seen order.
#[derive(Debug, Clone, Default)]
pub struct LabelCounts(Vec<(String, u64)>);

impl LabelCounts {
    fn bump(&mut self, label: String, by: u64) {
        match self.0.iter_mut().find(|(existing, _)| *existing == label) {
            Some((_, count)) => *count += by,
            None => self.0.push((label, by)),
        }
    }

    fn total(&self) -> u64 {
        self.0.iter().map(|(_, count)| count).sum()
    }

    fn total_excluding(&self, skip: &str) -> u64 {
        self.0
            .iter()
            .filter(|(label, _)| label != skip)
            .map(|(_, count)| count)
            .sum()
    }

    fn to_json(&self) -> Value {
        let mut map = serde_json::Map::new();
        for (label, count) in &self.0 {
            map.insert(label.clone(), json!(count));
        }
        Value::Object(map)
    }
}

/// What a clean run removed and replaced.
#[derive(Debug, Clone)]
pub struct CleanStats {
    pub input_length: usize,
    pub output_length: usize,
    pub removed: LabelCounts,
    pub replaced: LabelCounts,
    pub removed_count: u64,
    pub replaced_count: u64,
}

impl CleanStats {
    pub fn to_json(&self) -> Value {
        json!({
            "input_length": self.input_length,
            "output_length": self.output_length,
            "removed": self.removed.to_json(),
            "replaced": self.replaced.to_json(),
            "removed_count": self.removed_count,
            "replaced_count": self.replaced_count,
        })
    }
}

/// Options for [`clean_text`].
#[derive(Debug, Clone, Copy)]
pub struct CleanOptions {
    pub nfkc: bool,
    pub aggressive_homoglyphs: bool,
    pub normalize_spaces: bool,
    pub strip_emoji_glue: bool,
}

impl Default for CleanOptions {
    fn default() -> Self {
        Self {
            nfkc: false,
            aggressive_homoglyphs: false,
            normalize_spaces: true,
            strip_emoji_glue: false,
        }
    }
}

const NFKC_LABEL: &str = "NFKC_normalize";

/// Strip invisible carriers and normalise homoglyphs, returning the cleaned
/// units and a stats block.
pub fn clean_text(units: &[Unit], options: CleanOptions) -> (Vec<Unit>, CleanStats) {
    let mut removed = LabelCounts::default();
    let mut replaced = LabelCounts::default();
    let mut output: Vec<Unit> = Vec::with_capacity(units.len());
    let mut previous_kept: Option<Unit> = None;

    for unit in units.iter().copied() {
        let decision = decide(
            unit,
            previous_kept,
            options.normalize_spaces,
            options.aggressive_homoglyphs,
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

/// The plain-text rendering of an inspect report.
pub fn human_report(report: &TextInspectReport) -> String {
    let mut lines = vec![
        format!("Length: {} chars", report.length),
        format!("Suspicious: {}", report.suspicious_total),
    ];
    if !report.hits.is_empty() {
        lines.push("Hits:".to_string());
        for hit in &report.hits {
            let samples: Vec<String> = hit
                .samples
                .iter()
                .take(5)
                .map(|offset| offset.to_string())
                .collect();
            lines.push(format!(
                "  [{}/{}] {} x{} @ [{}]",
                hit.kind,
                hit_confidence(hit.kind),
                hit.label,
                hit.count,
                samples.join(", ")
            ));
        }
    }
    for note in &report.notes {
        lines.push(format!("Note: {note}"));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests;
