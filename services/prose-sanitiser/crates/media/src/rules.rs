//! The published rule table, for the SARIF driver and `--explain` output.
//!
//! Every class of provenance this crate detects appears here exactly once, with
//! the standard or specification it rests on.
//!
//! # How the tiers were chosen
//!
//! [`ConfidenceTier`] answers one question and one question only: how far can
//! this detection be trusted? Container metadata is the workspace's strongest
//! case — a chunk or part either is an Exif block or is not, and the removal is
//! verifiable by diffing the output — so most of this table is
//! [`ConfidenceTier::CertainMechanical`]. Two rules are not:
//!
//! * `media-ooxml-revisions` is [`ConfidenceTier::HighConfidenceStylistic`].
//!   Resolving tracked changes and dropping comments is deterministic, but it
//!   changes what a reader sees: accepted deletions take their text with them.
//!   That belongs behind an explicit opt-in, not an automatic fix.
//! * `media-byte-scan` is [`ConfidenceTier::LowConfidenceJudgement`], because a
//!   whole-file byte scan collides with compressed image and stream data by
//!   chance. It is a signal to look, never a verdict.
//!
//! `media-c2pa-soft-binding` used to be a third, and it was the one place in
//! this table where the tier lied. Its detection is exact — the assertion is
//! either in the manifest or it is not — but **no repair exists**: a soft
//! binding is a fingerprint or invisible watermark in the pixels, out of reach
//! of container surgery. With only a confidence axis to work with, the sole way
//! to stop a consumer offering a fix was to file the crate's most reliable
//! detection under its least reliable label.
//!
//! `prose_sanitiser_core::Fixability` is the axis that resolves it: whether a
//! finding can be repaired is orthogonal to how much the detection is worth,
//! in the same way severity and confidence are orthogonal to each other. The
//! rule now carries the tier its evidence earns, and the CLI's fixability table
//! marks it `NoFixExists`, so it yields no edit under any configuration and
//! its SARIF entry carries no `fixes[]` and an explicit explanation of why.
//! "We decline to repair this" and "this cannot be repaired" are different
//! messages, and a reader is now told which one applies.
//!
//! `since` and `reviewed` are honest dates, not decoration. A rule whose
//! `reviewed` date has gone stale is a rule whose sources nobody has
//! re-checked.

use prose_sanitiser_core::{ConfidenceTier, RuleMeta, Severity};

const C2PA_SPEC: &str =
    "https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html";
const SOFT_BINDING: &str =
    "https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html";
const PNG_EXIF: &str = "https://ftp-osl.osuosl.org/pub/libpng/documents/pngext-1.5.0.html";
const XMP_SPEC: &str = "https://developer.adobe.com/xmp/docs/XMPSpecifications/";
const PDF_SPEC: &str =
    "https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf";
const OOXML_SPEC: &str =
    "https://ecma-international.org/publications-and-standards/standards/ecma-376/";
const ODF_SPEC: &str = "https://docs.oasis-open.org/office/OpenDocument/v1.3/";

/// Every rule this crate emits, in report order.
///
/// ```
/// use prose_sanitiser_core::ConfidenceTier;
/// use prose_sanitiser_media::RULES;
///
/// // Rule ids are unique and namespaced to this crate.
/// let mut ids: Vec<&str> = RULES.iter().map(|rule| rule.id).collect();
/// let count = ids.len();
/// ids.sort_unstable();
/// ids.dedup();
/// assert_eq!(ids.len(), count);
/// assert!(RULES.iter().all(|rule| rule.id.starts_with("media-")));
///
/// // Container surgery is the workspace's strongest auto-fix case, so most of
/// // the table is mechanical.
/// let mechanical = RULES
///     .iter()
///     .filter(|rule| rule.confidence == ConfidenceTier::CertainMechanical)
///     .count();
/// assert!(mechanical > RULES.len() / 2);
/// ```
pub const RULES: &[RuleMeta] = &[
    RuleMeta {
        id: "media-c2pa-manifest",
        name: "C2PA manifest store",
        description:
            "A C2PA manifest store embedded in the container: a JUMBF superbox labelled `c2pa`, \
             carried in the PNG `caBX` chunk, one or more JPEG `APP11` segments, the WebP `C2PA` \
             RIFF chunk, a PDF embedded-file specification with `AFRelationship = \
             C2PA_Manifest`, or an SVG `c2pa:manifest` element. Deletion is byte-level and the \
             surrounding container is re-encoded unchanged.",
        severity: Severity::High,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(C2PA_SPEC),
        sources: &[
            C2PA_SPEC,
            "ISO/IEC 19566-5:2023 (JUMBF), box type UUID 63327061-0011-0010-8000-00AA00389B71",
        ],
    },
    RuleMeta {
        id: "media-c2pa-soft-binding",
        name: "Durable Content Credential declared",
        description:
            "The manifest carries a `c2pa.soft-binding` assertion, meaning the asset is a \
             Durable Content Credential: a fingerprint or invisible watermark in the pixels lets \
             a validator rediscover the original signed manifest from a cloud repository even \
             after the container is stripped. Adobe runs a live implementation of the Soft \
             Binding Resolution API. No fix exists: this crate does lossless container surgery \
             and cannot detect, identify or remove a pixel-domain watermark, so the finding is \
             reported and never repaired. Absence of the assertion is not evidence that no \
             watermark is present.",
        severity: Severity::High,
        // Certain, because the assertion either is in the manifest or is not.
        // That no repair exists is a separate fact, carried on the fixability
        // axis rather than smuggled in here as doubt about the detection.
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(SOFT_BINDING),
        sources: &[
            SOFT_BINDING,
            "CAI Soft Binding Resolution API, https://developer.adobe.com/cai-soft-binding-api/",
        ],
    },
    RuleMeta {
        id: "media-exif",
        name: "Exif metadata block",
        description:
            "An Exif block: the PNG `eXIf` chunk, a JPEG `APP1` segment with the `Exif\\0\\0` \
             prefix, or the WebP `EXIF` RIFF chunk. Removed as a whole segment or chunk, so no \
             tag-level rewriting takes place and the pixel data is untouched. Removing the WebP \
             chunk also clears its VP8X feature-flag bit, leaving the container self-consistent.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(PNG_EXIF),
        sources: &[PNG_EXIF, "CIPA DC-008 (Exif 3.0)"],
    },
    RuleMeta {
        id: "media-xmp",
        name: "XMP packet",
        description:
            "An XMP metadata packet: the PNG `iTXt` chunk keyed `XML:com.adobe.xmp`, a JPEG \
             `APP1` segment under the `http://ns.adobe.com/xap/1.0/` namespace including \
             multi-segment Extended XMP, the WebP `XMP ` chunk, a PDF `/Metadata` stream, or an \
             `x:xmpmeta` element in SVG. XMP is metadata by definition, so the packet is removed \
             even when other text is being kept.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(XMP_SPEC),
        sources: &[XMP_SPEC, "ISO 16684-1:2019 (XMP part 1)"],
    },
    RuleMeta {
        id: "media-iptc",
        name: "IPTC or Photoshop image resource block",
        description:
            "A JPEG `APP13` segment carrying a Photoshop image resource block, which is where \
             IPTC IIM captions, credit lines and origin fields live. Removed as a whole segment.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &["IPTC Information Interchange Model, version 4.2"],
    },
    RuleMeta {
        id: "media-text-chunk",
        name: "Generator or vendor string in a text field",
        description:
            "A free-text container field naming the tool or model that produced the file: PNG \
             `tEXt`, `zTXt` and `iTXt` chunks, a JPEG `COM` comment, an SVG `<metadata>` block or \
             generator attribute, or an ODF `meta:generator`. Matched against the vendor and \
             provenance marker tables rather than parsed, so a field is dropped on a marker hit \
             or when a full metadata strip was requested.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &["PNG (Portable Network Graphics) Specification, version 1.2, chapter 4.2.3"],
    },
    RuleMeta {
        id: "media-editing-telemetry",
        name: "Editing telemetry",
        description:
            "A field recording how the file was produced rather than what it contains: the PNG \
             `tIME` last-modification chunk, OOXML `TotalTime` (minutes the document was open) \
             and `Company`, and ODF `meta:editing-cycles` and `meta:editing-duration`. These are \
             behavioural fingerprints whatever their value, so they are removed unconditionally.",
        severity: Severity::Low,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(OOXML_SPEC),
        sources: &[OOXML_SPEC, ODF_SPEC],
    },
    RuleMeta {
        id: "media-pdf-info",
        name: "PDF document information and metadata",
        description:
            "The PDF trailer's `/Info` dictionary and the catalogue's `/Metadata` stream, \
             carrying author, producer, creator and timestamps. Removal is a full object-graph \
             rewrite rather than an appended update: a PDF is appended to, not overwritten, so a \
             tool that edits metadata incrementally leaves the original dictionary fully \
             recoverable earlier in the byte stream.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(PDF_SPEC),
        sources: &[
            PDF_SPEC,
            "ISO 32000-1:2008 section 7.5.6 (incremental updates)",
        ],
    },
    RuleMeta {
        id: "media-ooxml-docprops",
        name: "OOXML document properties",
        description: "Package-level provenance in an Office Open XML file: `docProps/core.xml` \
             (`dc:creator`, `cp:lastModifiedBy`), `docProps/app.xml` (`Application`), \
             `docProps/custom.xml`, and the `customXml/` tree, which is a common injection point \
             for arbitrary properties. Dropping a part also removes its `[Content_Types]` \
             override and its `_rels` relationship, without which Office reports the file as \
             corrupt.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(OOXML_SPEC),
        sources: &[OOXML_SPEC, ODF_SPEC],
    },
    RuleMeta {
        id: "media-ooxml-rsid",
        name: "Editing-session identifiers",
        description: "WordprocessingML `w:rsid*` attributes and the `w:rsids` table in \
             `word/settings.xml`. Word stamps a fresh 32-bit id on each save session and tags \
             every run, paragraph and table row with the session that touched it, so the \
             attribute set is a record of how the document was written: how many sittings, and \
             which passages arrived together. They carry no formatting or content.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::CertainMechanical,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(OOXML_SPEC),
        sources: &[OOXML_SPEC, "ECMA-376 part 1, section 17.15.1.86 (rsid)"],
    },
    RuleMeta {
        id: "media-ooxml-revisions",
        name: "Tracked changes and comments",
        description:
            "WordprocessingML revision marks (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo` and the \
             `w:*PrChange` formatting records) and the `word/comments*.xml` parts with their \
             anchors, all of which carry author names and edit timestamps. Resolution follows \
             Word's own accept-all semantics: an insertion is unwrapped so its text stays, a \
             deletion is dropped with its contents. Not auto-fixed, because accepting a deletion \
             removes text a reader would otherwise see.",
        severity: Severity::Medium,
        confidence: ConfidenceTier::HighConfidenceStylistic,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: Some(OOXML_SPEC),
        sources: &[OOXML_SPEC, "ECMA-376 part 1, section 17.13 (annotations)"],
    },
    RuleMeta {
        id: "media-byte-scan",
        name: "Provenance marker outside a known structure",
        description:
            "A C2PA or vendor marker found by scanning the whole file rather than inside a \
             recognised chunk, segment or part. Kept as a signal because it catches a manifest \
             in a container this crate cannot parse, but compressed image and stream bytes \
             collide with short markers by chance, so it is reported and never acted on.",
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        since: "2026-09-03",
        reviewed: "2026-09-03",
        help_uri: None,
        sources: &["Whole-file substring scan; see `image::markers`"],
    },
];

/// Look a rule up by its id.
pub fn rule(id: &str) -> Option<&'static RuleMeta> {
    RULES.iter().find(|rule| rule.id == id)
}

/// Map one of this crate's free-text finding or action strings onto a rule.
///
/// The inspect and clean paths report human-readable strings rather than typed
/// findings, so this is the bridge a SARIF or JSON Lines emitter needs to key a
/// result to a `reportingDescriptor`. Matching is by substring and
/// case-insensitive, in specificity order: the whole-file byte scan and the
/// soft-binding notice are tested first, then the container structures, so a
/// finding naming both a chunk type and a C2PA marker resolves to the manifest
/// rule rather than to the chunk.
///
/// Returns `None` for structural notes that are not provenance findings — a
/// malformed container, an unsupported format, a part count.
///
/// ```
/// use prose_sanitiser_media::rule_for_finding;
///
/// assert_eq!(
///     rule_for_finding("PNG chunk caBX (possible C2PA container)").map(|r| r.id),
///     Some("media-c2pa-manifest")
/// );
/// assert_eq!(
///     rule_for_finding("byte-scan C2PA markers: c2pa, jumb").map(|r| r.id),
///     Some("media-byte-scan")
/// );
/// assert_eq!(rule_for_finding("malformed PNG: a truncated chunk was read"), None);
/// ```
pub fn rule_for_finding(finding: &str) -> Option<&'static RuleMeta> {
    let text = finding.to_lowercase();
    let has = |needle: &str| text.contains(needle);

    // Specificity order. The byte scan and the soft-binding notice both also
    // mention C2PA, so they must be tested before the manifest rule.
    let id = if has("byte-scan") {
        "media-byte-scan"
    } else if has("soft binding") {
        "media-c2pa-soft-binding"
    } else if has("c2pa") || has("jumb") || has("cabx") || has("app11") {
        "media-c2pa-manifest"
    } else if has("xmp") {
        "media-xmp"
    } else if has("exif") {
        "media-exif"
    } else if has("app13") || has("iptc") || has("photoshop") {
        "media-iptc"
    } else if has("/info") || has("/metadata") {
        "media-pdf-info"
    } else if has("time") || has("editing-cycles") || has("editing-duration") || has("company") {
        // `TotalTime`, `tIME`, `meta:editing-*`.
        "media-editing-telemetry"
    } else if has("tracked")
        || has("word/comments")
        || has("comment parts")
        || has("comment and move anchors")
        || has("formatting-change")
    {
        // Deliberately narrow: a JPEG `COM` comment and an SVG comment are text
        // fields, not Word annotations, and belong to `media-text-chunk`.
        "media-ooxml-revisions"
    } else if has("rsid") {
        "media-ooxml-rsid"
    } else if has("docprops") || has("customxml") || has("meta.xml") {
        "media-ooxml-docprops"
    } else if has("text") || has("generator") || has("comment") {
        "media-text-chunk"
    } else {
        return None;
    };
    rule(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_rule_carries_at_least_one_source() {
        for rule in RULES {
            assert!(
                !rule.sources.is_empty(),
                "{} has no evidence behind it",
                rule.id
            );
            assert!(!rule.description.is_empty());
            assert_eq!(rule.since.len(), 10, "{} has a malformed date", rule.id);
            assert_eq!(rule.reviewed.len(), 10, "{} has a malformed date", rule.id);
        }
    }

    #[test]
    fn only_the_two_uncertain_rules_are_outside_the_mechanical_tier() {
        let uncertain: Vec<&str> = RULES
            .iter()
            .filter(|rule| rule.confidence != ConfidenceTier::CertainMechanical)
            .map(|rule| rule.id)
            .collect();
        assert_eq!(uncertain, vec!["media-ooxml-revisions", "media-byte-scan"]);
    }

    #[test]
    fn the_soft_binding_rule_states_certain_detection_and_no_repair() {
        // The rule this table got wrong until `Fixability` existed. Its
        // detection is exact, so it belongs in the mechanical tier; that no
        // repair is possible is a separate fact carried on the fixability axis,
        // not doubt about the evidence smuggled into the confidence label.
        let rule = rule("media-c2pa-soft-binding").expect("the rule is published");
        assert_eq!(rule.confidence, ConfidenceTier::CertainMechanical);
        assert_eq!(rule.severity, Severity::High);
        assert!(
            rule.description.contains("No fix exists"),
            "the description must say so in words, for a reader who sees only the text"
        );
    }

    #[test]
    fn no_media_rule_claims_certainty_it_cannot_verify() {
        // The mechanical tier is a promise that the finding is verifiable by
        // diffing the output, or — for the soft binding — by reading a field
        // that is either present or absent. A rule resting on a heuristic scan
        // must not sit there.
        for rule in RULES {
            if rule.confidence != ConfidenceTier::CertainMechanical {
                continue;
            }
            assert!(
                !rule.description.contains("by chance"),
                "{} rests on a collision-prone scan and cannot be mechanical",
                rule.id
            );
        }
    }

    /// The finding strings the scanners actually emit, mapped to their rules.
    #[test]
    fn real_finding_strings_resolve_to_the_right_rule() {
        let cases = [
            (
                "PNG chunk caBX (possible C2PA container)",
                "media-c2pa-manifest",
            ),
            (
                "JPEG APP11 segment (JUMBF/C2PA common)",
                "media-c2pa-manifest",
            ),
            (
                "JPEG APP11 JUMBF box 1 reassembled from 2 segments",
                "media-c2pa-manifest",
            ),
            ("WebP C2PA chunk", "media-c2pa-manifest"),
            ("C2PA manifest store present", "media-c2pa-manifest"),
            (
                "C2PA soft binding declared: this is a durable Content Credential",
                "media-c2pa-soft-binding",
            ),
            ("byte-scan C2PA markers: c2pa, jumb", "media-byte-scan"),
            ("PNG iTXt XMP packet (XML:com.adobe.xmp)", "media-xmp"),
            ("XMP packet present", "media-xmp"),
            ("drop chunk eXIf", "media-exif"),
            ("PDF /Info keys: Author, Producer", "media-pdf-info"),
            ("PDF /Metadata streams: 1", "media-pdf-info"),
            ("drop chunk tIME", "media-editing-telemetry"),
            (
                "scrub docProps/app.xml field TotalTime",
                "media-editing-telemetry",
            ),
            ("drop meta:editing-duration", "media-editing-telemetry"),
            (
                "strip 4 w:rsid editing-session attributes from word/document.xml",
                "media-ooxml-rsid",
            ),
            (
                "accept 2 tracked deletions in word/document.xml",
                "media-ooxml-revisions",
            ),
            ("comment parts: 1", "media-ooxml-revisions"),
            ("customXml parts: 1", "media-ooxml-docprops"),
            ("meta.xml generator-like fields", "media-ooxml-docprops"),
            ("drop chunk tEXt", "media-text-chunk"),
            // A JPEG comment is a text field, not a Word annotation.
            ("drop COM comment", "media-text-chunk"),
            ("drop SVG comment with AI markers", "media-text-chunk"),
            ("drop part word/comments.xml", "media-ooxml-revisions"),
        ];
        for (finding, expected) in cases {
            assert_eq!(
                rule_for_finding(finding).map(|rule| rule.id),
                Some(expected),
                "{finding}"
            );
        }
    }

    #[test]
    fn structural_notes_are_not_provenance_findings() {
        for note in [
            "malformed PNG: a truncated chunk was read",
            "not a JPEG",
            "unsupported format (PNG/JPEG/WebP)",
            "no PNG metadata chunks removed (already clean or none matched)",
        ] {
            assert!(
                rule_for_finding(note).is_none(),
                "{note} should not resolve to a rule"
            );
        }
    }

    #[test]
    fn an_unknown_id_looks_up_to_nothing() {
        assert!(rule("media-does-not-exist").is_none());
    }
}
