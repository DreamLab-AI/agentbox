//! The shapes an inspect or clean pass reports in.
//!
//! These are the per-codepoint counting views the audit CLIs consume. The
//! byte-spanned [`Finding`](prose_sanitiser_core::Finding) view of the same
//! surface lives in [`crate::check`].

use serde_json::{json, Value};

use crate::decide::hit_confidence;
use crate::stego::Payload;

/// One flagged codepoint, with a sample of the offsets it was seen at.
#[derive(Debug, Clone)]
pub struct CharHit {
    /// The codepoint that was flagged.
    pub codepoint: u32,
    /// `U+XXXX NAME (Gc)`, the human label.
    pub label: String,
    /// How many times it occurred.
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
    /// Length of the input in characters.
    pub length: usize,
    /// Total number of flagged characters.
    pub suspicious_total: usize,
    /// One entry per distinct (codepoint, kind), by descending count.
    pub hits: Vec<CharHit>,
    /// Smuggled payloads, decoded rather than merely counted.
    pub payloads: Vec<Payload>,
    /// Notes explaining the scope of the scan.
    pub notes: Vec<String>,
}

impl TextInspectReport {
    /// The JSON wire form, as the `inspect-text` CLI emits it.
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
            "payloads": self.payloads.iter().map(payload_json).collect::<Vec<_>>(),
            "notes": self.notes,
        })
    }
}

/// The JSON wire form of one decoded payload.
pub fn payload_json(payload: &Payload) -> Value {
    json!({
        "kind": payload.kind.as_str(),
        "start": payload.start,
        "end": payload.end,
        "base": payload.base.map(|base| format!("U+{:04X}", base as u32)),
        "bytes": payload.bytes.len(),
        "hex": payload.hex(),
        "printable": payload.printable(),
        "text": payload.as_text(),
        "note": payload.note,
        "confidence": "certain-mechanical",
    })
}

/// Counts keyed by character label, in first-seen order.
#[derive(Debug, Clone, Default)]
pub struct LabelCounts(Vec<(String, u64)>);

impl LabelCounts {
    /// Add `by` to `label`'s count, appending it if it is new.
    pub fn bump(&mut self, label: String, by: u64) {
        match self.0.iter_mut().find(|(existing, _)| *existing == label) {
            Some((_, count)) => *count += by,
            None => self.0.push((label, by)),
        }
    }

    /// The sum of every count.
    pub fn total(&self) -> u64 {
        self.0.iter().map(|(_, count)| count).sum()
    }

    /// The sum of every count except `skip`'s.
    pub fn total_excluding(&self, skip: &str) -> u64 {
        self.0
            .iter()
            .filter(|(label, _)| label != skip)
            .map(|(_, count)| count)
            .sum()
    }

    /// The label/count pairs, in first-seen order.
    pub fn entries(&self) -> &[(String, u64)] {
        &self.0
    }

    /// The JSON object form.
    pub fn to_json(&self) -> Value {
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
    /// Length of the input in characters.
    pub input_length: usize,
    /// Length of the output in characters.
    pub output_length: usize,
    /// Removed characters, by label.
    pub removed: LabelCounts,
    /// Replaced characters, by label.
    pub replaced: LabelCounts,
    /// Total removals.
    pub removed_count: u64,
    /// Total replacements, excluding the NFKC bookkeeping entry.
    pub replaced_count: u64,
    /// Smuggled payloads decoded out of the input before it was cleaned.
    pub payloads: Vec<Payload>,
}

impl CleanStats {
    /// The JSON wire form, as the `clean-text` CLI emits it.
    pub fn to_json(&self) -> Value {
        json!({
            "input_length": self.input_length,
            "output_length": self.output_length,
            "removed": self.removed.to_json(),
            "replaced": self.replaced.to_json(),
            "removed_count": self.removed_count,
            "replaced_count": self.replaced_count,
            "payloads": self.payloads.iter().map(payload_json).collect::<Vec<_>>(),
        })
    }
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
    if !report.payloads.is_empty() {
        lines.push("Decoded payloads:".to_string());
        for payload in &report.payloads {
            lines.push(format!(
                "  [{}/certain-mechanical] chars {}..{}: {:?} (hex {}) — {}",
                payload.kind.as_str(),
                payload.start,
                payload.end,
                payload.printable(),
                payload.hex(),
                payload.note
            ));
        }
    }
    for note in &report.notes {
        lines.push(format!("Note: {note}"));
    }
    lines.join("\n")
}
