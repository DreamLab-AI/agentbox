//! Classify a scanner finding by confidence.
//!
//! The four buckets are a heuristic mapping of *how strong* a finding is:
//!
//! - `confirmed`: a recognised provenance structure (C2PA/JUMBF manifest, or a
//!   parsed field such as digitalSourceType / trainedAlgorithmicMedia).
//! - `probable`: an AI/vendor marker found inside a recognised metadata
//!   structure, but not a fully parsed provenance claim.
//! - `informational`: context-only notes (CMS generators, presence of an XMP
//!   packet or customXml parts, unsupported/partial inspection).
//! - `likely_false_positive`: raw whole-file byte scans that can collide with
//!   compressed image/stream data.
//!
//! The mapping is intentionally conservative; a scanner finding is a signal,
//! not a verdict.

pub const CONFIDENCE_LEVELS: [&str; 4] = [
    "confirmed",
    "probable",
    "informational",
    "likely_false_positive",
];

const CONFIRMED: &[&str] = &[
    "c2patool reports",
    "c2pa-related manifest",
    "png chunk c2",
    "png chunk cabx",
    "png chunk jumb",
    "png chunk jumd",
    "jpeg app11 segment",
    "digital_source_type",
    "digitalsourcetype",
    "trainedalgorithmicmedia",
    "compositewithtrainedalgorithmicmedia",
    "softwareagent",
];

const INFORMATIONAL: &[&str] = &[
    "cms generator",
    "customxml parts",
    "xmp packet present",
    "unsupported",
    "not fully inspected",
    "format not",
    "svg <metadata> present",
    "not a valid",
    "truncated chunk",
    "bad segment length",
    "svg decode note",
];

const PROBABLE: &[&str] = &[
    "ai:",
    "marker:",
    "meta:",
    "frontmatter",
    "json-ld",
    "attr:",
    "png ",
    "jpeg app",
    "exif",
    "xmp",
    "interesting",
    "pdf-structured",
    "layer-a",
];

/// Bucket one finding string. See the module docs for the four levels.
pub fn classify_finding_confidence(finding: &str) -> &'static str {
    let text = finding.to_lowercase();

    if CONFIRMED.iter().any(|needle| text.contains(needle)) {
        return "confirmed";
    }
    if text.starts_with("info:") || INFORMATIONAL.iter().any(|needle| text.contains(needle)) {
        return "informational";
    }
    if text.contains("byte-scan") {
        return "likely_false_positive";
    }
    if PROBABLE.iter().any(|needle| text.contains(needle)) {
        return "probable";
    }
    "informational"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmed_beats_every_other_bucket() {
        // Contains "byte-scan" too, but a parsed provenance field wins.
        assert_eq!(
            classify_finding_confidence("byte-scan digitalSourceType"),
            "confirmed"
        );
        assert_eq!(
            classify_finding_confidence("JPEG APP11 segment (JUMBF/C2PA common)"),
            "confirmed"
        );
    }

    #[test]
    fn informational_precedes_the_byte_scan_bucket() {
        assert_eq!(
            classify_finding_confidence("info: cms generator: <meta ...>"),
            "informational"
        );
        assert_eq!(
            classify_finding_confidence("unsupported format (PNG/JPEG/WebP)"),
            "informational"
        );
    }

    #[test]
    fn byte_scans_are_likely_false_positives() {
        assert_eq!(
            classify_finding_confidence("byte-scan C2PA markers: c2pa"),
            "likely_false_positive"
        );
    }

    #[test]
    fn markers_inside_structures_are_probable() {
        assert_eq!(classify_finding_confidence("PNG iTXt: c2pa"), "probable");
        assert_eq!(
            classify_finding_confidence("layer-a [bidi] U+202E ... x3"),
            "probable"
        );
    }

    #[test]
    fn unrecognised_findings_default_to_informational() {
        assert_eq!(classify_finding_confidence("something else"), "informational");
    }
}
