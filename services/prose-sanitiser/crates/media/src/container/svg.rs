//! Provenance in SVG: `<metadata>` blocks, XMP packets and generator attributes.

use std::sync::OnceLock;

use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};

use super::patterns::{ai_meta_name_re_bytes, blob_hits};

fn metadata_block_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?is-u)<metadata\b[^>]*>.*?</metadata\s*>").expect("static regex compiles")
    })
}

fn xmpmeta_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?is-u)<x:xmpmeta\b[^>]*>.*?</x:xmpmeta\s*>")
            .expect("static regex compiles")
    })
}

fn comment_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| ByteRegex::new(r"(?s-u)<!--.*?-->").expect("static regex compiles"))
}

fn generator_attr_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r#"(?i-u)\s(inkscape:version|sodipodi:docname|generator)\s*=\s*"[^"]*""#)
            .expect("static regex compiles")
    })
}

/// Inspect an SVG for provenance.
pub fn inspect_svg(data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let (mut has_c2pa, mut has_ai, mut findings) = blob_hits(data);

    if ByteRegex::new(r"(?i-u)<metadata[\s>]")
        .expect("static regex compiles")
        .is_match(data)
    {
        findings.push("svg <metadata> present".to_string());
        // Often an XMP payload; treat its presence as an inspect signal.
        has_ai = true;
    }
    if ByteRegex::new(r"(?i-u)xmpmeta|rdf:RDF|contentcredentials")
        .expect("static regex compiles")
        .is_match(data)
    {
        has_ai = true;
        findings.push("XMP/RDF-like content in SVG".to_string());
    }
    if ByteRegex::new(r"(?i-u)c2pa|jumbf")
        .expect("static regex compiles")
        .is_match(data)
    {
        has_c2pa = true;
    }
    (has_c2pa, has_ai || has_c2pa, findings, json!({}))
}

/// Strip provenance blocks and attributes from an SVG.
pub fn clean_svg(data: &[u8]) -> (Vec<u8>, Vec<String>) {
    let mut actions: Vec<String> = Vec::new();
    let mut text = data.to_vec();

    let metadata_count = metadata_block_re().find_iter(&text).count();
    if metadata_count > 0 {
        actions.push(format!("drop <metadata> x{metadata_count}"));
        text = metadata_block_re()
            .replace_all(&text, &b""[..])
            .into_owned();
    }

    let xmp_count = xmpmeta_re().find_iter(&text).count();
    if xmp_count > 0 {
        actions.push(format!("drop xmpmeta x{xmp_count}"));
        text = xmpmeta_re().replace_all(&text, &b""[..]).into_owned();
    }

    // Comments that look like provenance.
    let mut out = Vec::with_capacity(text.len());
    let mut last = 0;
    for comment in comment_re().find_iter(&text) {
        out.extend_from_slice(&text[last..comment.start()]);
        if ai_meta_name_re_bytes().is_match(comment.as_bytes()) {
            actions.push("drop SVG comment with AI markers".to_string());
        } else {
            out.extend_from_slice(comment.as_bytes());
        }
        last = comment.end();
    }
    out.extend_from_slice(&text[last..]);
    text = out;

    // Always strip generator-like attributes, not only as a fallback. An SVG
    // with both a metadata block and inkscape:version attributes must lose both.
    let gen_count = generator_attr_re().find_iter(&text).count();
    if gen_count > 0 {
        actions.push(format!("drop generator-like attrs x{gen_count}"));
        text = generator_attr_re()
            .replace_all(&text, &b""[..])
            .into_owned();
    }
    if actions.is_empty() {
        actions.push("no SVG metadata removed".to_string());
    }
    (text, actions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn a_metadata_block_is_flagged_and_dropped() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><metadata><rdf:RDF>x</rdf:RDF></metadata><rect/></svg>"#;
        let (_, ai, findings, _) = inspect_svg(svg);
        assert!(ai);
        assert!(findings.contains(&"svg <metadata> present".to_string()));
        assert!(findings.contains(&"XMP/RDF-like content in SVG".to_string()));

        let (cleaned, actions) = clean_svg(svg);
        assert!(actions.contains(&"drop <metadata> x1".to_string()));
        let cleaned = text(cleaned);
        assert!(!cleaned.contains("rdf:RDF"));
        assert!(cleaned.contains("<rect/>"));
    }

    #[test]
    fn an_adobe_xmp_packet_is_dropped() {
        let svg = br#"<svg><x:xmpmeta xmlns:x="adobe:ns:meta/">packet</x:xmpmeta><rect/></svg>"#;
        let (cleaned, actions) = clean_svg(svg);
        assert!(actions.contains(&"drop xmpmeta x1".to_string()));
        assert!(!text(cleaned).contains("packet"));
    }

    #[test]
    fn c2pa_content_sets_the_c2pa_flag() {
        let (c2pa, ai, _, _) = inspect_svg(br#"<svg><desc>c2pa manifest</desc></svg>"#);
        assert!(c2pa && ai);
    }

    #[test]
    fn only_provenance_comments_are_removed() {
        let svg = br#"<svg><!-- drawn by hand --><!-- generator: Claude --><rect/></svg>"#;
        let (cleaned, actions) = clean_svg(svg);
        assert!(actions.contains(&"drop SVG comment with AI markers".to_string()));
        let cleaned = text(cleaned);
        assert!(cleaned.contains("drawn by hand"));
        assert!(!cleaned.contains("Claude"));
    }

    #[test]
    fn generator_attributes_are_always_removed() {
        let svg = br#"<svg inkscape:version="1.1" sodipodi:docname="a.svg"><rect/></svg>"#;
        let (cleaned, actions) = clean_svg(svg);
        assert!(actions.contains(&"drop generator-like attrs x2".to_string()));
        let cleaned = text(cleaned);
        assert!(!cleaned.contains("inkscape:version"));
        assert!(cleaned.starts_with("<svg>"));
    }

    #[test]
    fn generator_attributes_are_removed_alongside_metadata() {
        // An SVG with both a metadata block and generator attributes must lose both.
        let svg = br#"<svg inkscape:version="1.1"><metadata><rdf:RDF>x</rdf:RDF></metadata><rect/></svg>"#;
        let (cleaned, actions) = clean_svg(svg);
        assert!(
            actions.contains(&"drop <metadata> x1".to_string()),
            "metadata block must be removed"
        );
        assert!(
            actions.contains(&"drop generator-like attrs x1".to_string()),
            "generator attributes must also be removed even when metadata was stripped"
        );
        let cleaned = text(cleaned);
        assert!(!cleaned.contains("inkscape:version"));
        assert!(!cleaned.contains("rdf:RDF"));
    }

    #[test]
    fn a_clean_svg_is_untouched() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>"#;
        let (c2pa, ai, findings, _) = inspect_svg(svg);
        assert!(!c2pa && !ai && findings.is_empty());
        let (cleaned, actions) = clean_svg(svg);
        assert_eq!(text(cleaned), String::from_utf8_lossy(svg));
        assert_eq!(actions, vec!["no SVG metadata removed".to_string()]);
    }
}
