use super::*;

fn scrub(xml: &str) -> (String, WordmlEdits) {
    let (out, edits) = scrub_wordml(xml.as_bytes()).unwrap();
    (String::from_utf8(out).unwrap(), edits)
}

#[test]
fn a_clean_part_comes_back_byte_identical() {
    let xml = r#"<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(out, xml);
    assert!(edits.is_empty());
}

#[test]
fn editing_session_ids_are_stripped_from_every_element() {
    let xml = r#"<w:p w:rsidR="00A1" w:rsidRDefault="00A1" w14:paraId="1"><w:r w:rsidRPr="00B2"><w:t>Text</w:t></w:r></w:p>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(edits.rsid_attributes, 3);
    assert!(!out.contains("rsid"), "output was {out}");
    // Non-rsid attributes survive.
    assert!(out.contains(r#"w14:paraId="1""#));
    assert!(out.contains("<w:t>Text</w:t>"));
}

#[test]
fn an_insertion_is_accepted_and_its_text_kept() {
    let xml = r#"<w:p><w:ins w:id="1" w:author="Jo" w:date="2026-09-03T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(edits.insertions_accepted, 1);
    assert!(!out.contains("w:ins"));
    assert!(!out.contains("Jo"));
    assert!(out.contains("<w:t>added</w:t>"));
}

#[test]
fn a_deletion_is_accepted_and_its_text_removed() {
    let xml = r#"<w:p><w:del w:id="2" w:author="Jo"><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(edits.deletions_removed, 1);
    assert!(!out.contains("gone"));
    assert!(!out.contains("Jo"));
    assert!(out.contains("kept"));
}

#[test]
fn nested_revisions_do_not_confuse_the_skip() {
    // An insertion inside a deletion: the whole deletion goes, and the
    // paragraph after it is untouched. A regex would stop at the first
    // </w:del> and leave the tail behind.
    let xml = concat!(
        r#"<w:body><w:del w:id="1"><w:ins w:id="2"><w:r><w:delText>x</w:delText></w:r>"#,
        r#"</w:ins><w:del w:id="3"><w:r><w:delText>y</w:delText></w:r></w:del></w:del>"#,
        r#"<w:p><w:r><w:t>tail</w:t></w:r></w:p></w:body>"#
    );
    let (out, edits) = scrub(xml);
    assert_eq!(edits.deletions_removed, 1, "the outer w:del is one removal");
    assert!(!out.contains("delText"));
    assert!(!out.contains("w:ins"));
    assert!(out.contains("<w:t>tail</w:t>"));
    assert!(out.starts_with("<w:body>") && out.ends_with("</w:body>"));
}

#[test]
fn formatting_change_records_are_counted_separately() {
    let xml = r#"<w:p><w:pPr><w:pPrChange w:id="4" w:author="Jo"><w:pPr/></w:pPrChange></w:pPr><w:r><w:rPr><w:rPrChange w:id="5"><w:rPr/></w:rPrChange></w:rPr></w:r></w:p>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(edits.format_changes_removed, 2);
    assert_eq!(edits.deletions_removed, 0);
    assert!(!out.contains("Change"));
}

#[test]
fn comment_anchors_are_removed() {
    let xml = r#"<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(edits.anchors_removed, 3);
    assert!(!out.contains("comment"));
    assert!(out.contains("<w:t>text</w:t>"));
}

#[test]
fn the_settings_rsid_table_goes_with_its_contents() {
    let xml = r#"<w:settings><w:rsids><w:rsidRoot w:val="00A1"/><w:rsid w:val="00B2"/></w:rsids><w:zoom w:percent="100"/></w:settings>"#;
    let (out, edits) = scrub(xml);
    assert_eq!(edits.deletions_removed, 1);
    assert!(!out.contains("rsid"));
    assert!(out.contains("w:zoom"));
}

#[test]
fn a_malformed_attribute_is_an_error_rather_than_a_silent_drop() {
    // The tag has an rsid, so it must be rebuilt — and rebuilding a tag
    // whose attributes cannot all be read would lose the unreadable ones.
    let error = scrub_wordml(br#"<w:p w:rsidR="00A1" broken=unquoted/>"#).unwrap_err();
    assert!(error.contains("attribute"), "error was {error}");
}

#[test]
fn an_unclosed_tag_at_end_of_input_is_rejected() {
    // Previously tolerated. A part that does not close its elements is not
    // a document this crate may claim to have cleaned: if an edit happened
    // before the malformed tail, the truncated result would otherwise be
    // returned as a successful rewrite.
    let error = scrub_wordml(b"<w:p><w:r>").unwrap_err();
    assert!(
        error.contains("still open") || error.contains("malformed"),
        "error was {error}"
    );
}

#[test]
fn input_ending_inside_a_dropped_element_is_rejected() {
    // The dangerous case: end of input while a deletion is being skipped
    // means everything after it was silently discarded.
    let error =
        scrub_wordml(br#"<w:body><w:p><w:r><w:t>kept</w:t></w:r></w:p><w:del w:id="1"><w:r>"#)
            .unwrap_err();
    assert!(error.contains("ended inside <w:del>"), "error was {error}");
}

#[test]
fn a_mismatched_end_tag_is_rejected() {
    let error = scrub_wordml(b"<w:p><w:r></w:p></w:r>").unwrap_err();
    assert!(error.contains("malformed"), "error was {error}");
}

#[test]
fn an_element_with_too_many_attributes_is_refused() {
    // Bounded independently of the parser: quick-xml before 0.41 checked
    // for duplicate attributes in quadratic time, and a dependency fix
    // should not be the only thing standing between a hostile part and the
    // CPU.
    let mut xml = br#"<w:p w:rsidR="00A1""#.to_vec();
    for index in 0..=MAX_ATTRIBUTES_PER_ELEMENT {
        xml.extend_from_slice(format!(r#" a{index}="x""#).as_bytes());
    }
    xml.extend_from_slice(b"/>");
    let error = scrub_wordml(&xml).unwrap_err();
    assert!(error.contains("attributes"), "error was {error}");
}

#[test]
fn deeply_nested_input_is_refused() {
    let mut xml = Vec::new();
    for _ in 0..=MAX_ELEMENT_DEPTH {
        xml.extend_from_slice(b"<w:tbl>");
    }
    let error = scrub_wordml(&xml).unwrap_err();
    assert!(error.contains("nested deeper"), "error was {error}");
}

#[test]
fn the_action_log_names_each_kind_of_edit() {
    let edits = WordmlEdits {
        rsid_attributes: 4,
        insertions_accepted: 1,
        deletions_removed: 2,
        format_changes_removed: 0,
        anchors_removed: 3,
    };
    let actions = edits.actions("word/document.xml");
    assert_eq!(actions.len(), 4);
    assert!(actions[0].contains("4 w:rsid"));
    assert!(actions.iter().all(|a| a.contains("word/document.xml")));
}
