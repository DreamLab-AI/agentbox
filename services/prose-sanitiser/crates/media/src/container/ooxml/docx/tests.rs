use super::*;

#[test]
fn relationship_targets_resolve_against_the_rels_directory() {
    assert_eq!(
        resolve_target("word/_rels/document.xml.rels", "comments.xml"),
        "word/comments.xml"
    );
    assert_eq!(
        resolve_target("word/_rels/document.xml.rels", "../customXml/item1.xml"),
        "customXml/item1.xml"
    );
    assert_eq!(
        resolve_target("_rels/.rels", "docProps/core.xml"),
        "docProps/core.xml"
    );
    assert_eq!(
        resolve_target("word/_rels/document.xml.rels", "/word/styles.xml"),
        "word/styles.xml"
    );
}

#[test]
fn only_the_named_elements_are_removed() {
    let xml = br#"<Types><Override PartName="/a.xml" ContentType="x"/><Override PartName="/b.xml" ContentType="y"/><Default Extension="rels"/></Types>"#;
    let doomed = |value: &str| value == "/a.xml";
    let (out, removed) =
        remove_elements_by_attribute(xml, b"Override", b"PartName", &doomed).unwrap();
    assert_eq!(removed, vec!["/a.xml".to_string()]);
    let out = String::from_utf8(out).unwrap();
    assert!(!out.contains("a.xml"));
    assert!(out.contains("b.xml"));
    assert!(out.contains("<Default"));
}

#[test]
fn an_untouched_part_is_returned_byte_identical() {
    let xml = br#"<Types><Override PartName="/b.xml"/></Types>"#;
    let doomed = |_: &str| false;
    let (out, removed) =
        remove_elements_by_attribute(xml, b"Override", b"PartName", &doomed).unwrap();
    assert!(removed.is_empty());
    assert_eq!(out, xml.to_vec());
}
