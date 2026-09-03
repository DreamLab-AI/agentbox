use super::*;

/// Build a zip from `(name, data, stored)` triples.
fn zip_with(parts: &[(&str, &[u8], bool)]) -> Vec<u8> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut buffer);
        for (name, data, stored) in parts {
            let options = SimpleFileOptions::default().compression_method(if *stored {
                CompressionMethod::Stored
            } else {
                CompressionMethod::Deflated
            });
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }
    buffer.into_inner()
}

/// A DOCX with the standard parts, each overridable by name.
fn docx_with(parts: &[(&str, &[u8], bool)]) -> Vec<u8> {
    let mut all: Vec<(&str, &[u8], bool)> = vec![
        ("[Content_Types].xml", b"<Types/>", false),
        ("word/document.xml", b"<w:document>Body</w:document>", false),
    ];
    for part in parts {
        match all.iter_mut().find(|existing| existing.0 == part.0) {
            Some(existing) => *existing = *part,
            None => all.push(*part),
        }
    }
    zip_with(&all)
}

fn part_of(data: &[u8], name: &str) -> Option<Vec<u8>> {
    read_entries(data)
        .unwrap()
        .into_iter()
        .find(|entry| entry.name == name)
        .map(|entry| entry.data)
}

#[test]
fn a_non_zip_is_reported_not_panicked_on() {
    assert_eq!(
        inspect_docx(b"not a zip").2,
        vec!["not a valid DOCX zip".to_string()]
    );
    assert_eq!(
        inspect_odt(b"not a zip").2,
        vec!["not a valid ODT zip".to_string()]
    );
    assert!(clean_docx(b"not a zip").is_err());
}

#[test]
fn docx_scans_only_metadata_parts_not_the_visible_body() {
    // "Claude" in the body is a legitimate mention, not provenance.
    let docx = docx_with(&[(
        "word/document.xml",
        b"<w:document>An article about Claude</w:document>",
        false,
    )]);
    let (c2pa, ai, findings, _) = inspect_docx(&docx);
    assert!(!c2pa && !ai);
    assert!(findings.is_empty());
}

#[test]
fn docx_finds_provenance_in_docprops() {
    let docx = docx_with(&[(
        "docProps/core.xml",
        b"<cp:coreProperties><dc:creator>Claude</dc:creator></cp:coreProperties>",
        false,
    )]);
    let (_, ai, findings, details) = inspect_docx(&docx);
    assert!(ai);
    assert!(findings[0].starts_with("docProps/core.xml: "));
    assert_eq!(details["parts"], 3);
}

#[test]
fn docx_clean_scrubs_ai_fields_but_keeps_human_ones() {
    let docx = docx_with(&[(
        "docProps/core.xml",
        b"<x><dc:creator>Claude</dc:creator><cp:lastModifiedBy>Jo Bloggs</cp:lastModifiedBy></x>",
        false,
    )]);
    let (cleaned, actions) = clean_docx(&docx).unwrap();
    assert!(actions.contains(&"scrub docProps/core.xml field dc:creator".to_string()));
    let core = String::from_utf8(part_of(&cleaned, "docProps/core.xml").unwrap()).unwrap();
    assert_eq!(
        core,
        "<x><dc:creator></dc:creator><cp:lastModifiedBy>Jo Bloggs</cp:lastModifiedBy></x>"
    );
}

#[test]
fn docx_clean_blanks_an_ai_application_field() {
    let docx = docx_with(&[(
        "docProps/app.xml",
        b"<Properties><Application>ChatGPT</Application></Properties>",
        false,
    )]);
    let (cleaned, actions) = clean_docx(&docx).unwrap();
    assert!(actions.contains(&"scrub docProps/app.xml field Application".to_string()));
    let app = String::from_utf8(part_of(&cleaned, "docProps/app.xml").unwrap()).unwrap();
    assert!(!app.contains("ChatGPT"));
}

#[test]
fn docx_clean_drops_customxml_and_its_content_type_overrides() {
    let docx = docx_with(&[
        ("customXml/item1.xml", b"<provenance>c2pa</provenance>", false),
        (
            "[Content_Types].xml",
            br#"<Types><Override PartName="/customXml/item1.xml" ContentType="x"/><Override PartName="/word/document.xml" ContentType="y"/></Types>"#,
            false,
        ),
    ]);
    let (_, ai, findings, _) = inspect_docx(&docx);
    assert!(ai);
    assert!(findings.iter().any(|f| f == "customXml parts: 1"));

    let (cleaned, actions) = clean_docx(&docx).unwrap();
    assert!(actions.contains(&"drop part customXml/item1.xml".to_string()));
    assert!(actions.contains(&"drop Content_Types customXml overrides x1".to_string()));

    let names: Vec<String> = zip_namelist(&cleaned).unwrap();
    assert!(!names.iter().any(|name| name.starts_with("customXml/")));
    assert!(names.contains(&"word/document.xml".to_string()));
    let types = String::from_utf8(part_of(&cleaned, "[Content_Types].xml").unwrap()).unwrap();
    assert!(!types.contains("customXml"));
    assert!(types.contains("/word/document.xml"));
    // And the cleaned archive is genuinely clean.
    assert!(!inspect_docx(&cleaned).1);
}

#[test]
fn docx_clean_drops_a_provenance_custom_xml_part_entirely() {
    let docx = docx_with(&[(
        "docProps/custom.xml",
        b"<Properties><property name=\"generator\">Claude</property></Properties>",
        false,
    )]);
    let (cleaned, actions) = clean_docx(&docx).unwrap();
    assert!(actions.contains(&"drop part docProps/custom.xml".to_string()));
    assert!(part_of(&cleaned, "docProps/custom.xml").is_none());
}

#[test]
fn a_clean_docx_reports_no_removals_and_round_trips() {
    let docx = docx_with(&[(
        "docProps/core.xml",
        b"<x><dc:creator>Jo</dc:creator></x>",
        false,
    )]);
    let (cleaned, actions) = clean_docx(&docx).unwrap();
    assert_eq!(actions, vec!["no DOCX metadata parts removed".to_string()]);
    assert_eq!(
        part_of(&cleaned, "word/document.xml").unwrap(),
        b"<w:document>Body</w:document>"
    );
}

#[test]
fn odt_keeps_its_stored_mimetype_first() {
    let odt = zip_with(&[
        ("mimetype", b"application/vnd.oasis.opendocument.text", true),
        ("content.xml", b"<office:document-content/>", false),
        (
            "meta.xml",
            b"<office:meta><meta:generator>Claude/1.0</meta:generator></office:meta>",
            false,
        ),
    ]);
    let (cleaned, actions) = clean_odt(&odt).unwrap();
    assert!(actions.contains(&"drop meta:generator".to_string()));

    let entries = read_entries(&cleaned).unwrap();
    assert_eq!(entries[0].name, "mimetype");
    assert_eq!(
        entries[0].compression,
        CompressionMethod::Stored,
        "the ODT mimetype must stay uncompressed and first"
    );
    let meta = String::from_utf8(part_of(&cleaned, "meta.xml").unwrap()).unwrap();
    assert!(!meta.contains("Claude"));
}

#[test]
fn odt_drops_marked_side_parts_but_never_the_content() {
    let odt = zip_with(&[
        ("mimetype", b"application/vnd.oasis.opendocument.text", true),
        // The visible content mentions a vendor; it must survive regardless.
        (
            "content.xml",
            b"<office:document-content>About Claude</office:document-content>",
            false,
        ),
        ("Thumbnails/provenance.bin", b"c2pa manifest", false),
    ]);
    let (c2pa, _, _, _) = inspect_odt(&odt);
    assert!(c2pa);

    let (cleaned, actions) = clean_odt(&odt).unwrap();
    assert!(actions.contains(&"drop part Thumbnails/provenance.bin (AI/C2PA markers)".to_string()));
    assert!(part_of(&cleaned, "content.xml").is_some());
    assert!(part_of(&cleaned, "Thumbnails/provenance.bin").is_none());
}

#[test]
fn odt_scrubs_an_ai_creator_but_keeps_a_human_one() {
    let odt = zip_with(&[
        ("mimetype", b"application/vnd.oasis.opendocument.text", true),
        (
            "meta.xml",
            b"<m><dc:creator>Jo Bloggs</dc:creator></m>",
            false,
        ),
    ]);
    let (cleaned, actions) = clean_odt(&odt).unwrap();
    assert_eq!(actions, vec!["no ODT metadata removed".to_string()]);
    assert!(String::from_utf8(part_of(&cleaned, "meta.xml").unwrap())
        .unwrap()
        .contains("Jo Bloggs"));

    let ai_odt = zip_with(&[
        ("mimetype", b"application/vnd.oasis.opendocument.text", true),
        ("meta.xml", b"<m><dc:creator>OpenAI</dc:creator></m>", false),
    ]);
    let (cleaned, actions) = clean_odt(&ai_odt).unwrap();
    assert!(actions.contains(&"scrub creator-like meta".to_string()));
    assert!(!String::from_utf8(part_of(&cleaned, "meta.xml").unwrap())
        .unwrap()
        .contains("OpenAI"));
}

#[test]
fn odt_flags_generator_like_meta_fields() {
    let odt = zip_with(&[
        ("mimetype", b"application/vnd.oasis.opendocument.text", true),
        (
            "meta.xml",
            b"<m><meta:generator>LibreOffice</meta:generator></m>",
            false,
        ),
    ]);
    let (_, ai, findings, _) = inspect_odt(&odt);
    assert!(ai);
    assert!(findings.contains(&"meta.xml generator-like fields".to_string()));
}

#[test]
fn a_zip_bomb_is_refused_before_decompression() {
    // One entry whose declared uncompressed size blows the budget. A run of
    // zeroes compresses to almost nothing, so the archive stays small.
    let payload = vec![0u8; (MAX_ZIP_DECOMPRESSED_BYTES + 1) as usize];
    let bomb = zip_with(&[("word/document.xml", &payload, false)]);
    assert!(bomb.len() < 1 << 20, "the bomb must be small on disk");

    let error = clean_docx(&bomb).unwrap_err();
    assert!(error.contains("zip decompressed size exceeds cap"));
    assert_eq!(inspect_docx(&bomb).2, vec![budget_error()]);
}
