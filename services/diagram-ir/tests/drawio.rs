//! draw.io behaviour: container decoding, geometry flattening, analysis signals
//! and the refusal paths.

mod common;

use std::io::Write;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use common::{drawio_output, drawio_pages, fixture};
use diagram_ir::drawio::analyse::{aligned, analyse, has_cycle, page_bounds};
use diagram_ir::drawio::decode::{
    decompress_limited, inflate, percent_decode, png_embedded_xml, svg_embedded_xml, DecodeError,
    Wrapper, MAX_XML_BYTES,
};
use diagram_ir::drawio::model::{load_mxfile, parse_file, Node, Page};
use diagram_ir::drawio::style::{classify_shape, clean_label, parse_style, shape_family};

const MODEL: &str = concat!(
    r#"<mxGraphModel dx="800" dy="600"><root>"#,
    r#"<mxCell id="0"/><mxCell id="1" parent="0"/>"#,
    r#"<mxCell id="a" value="Ingress" style="rounded=1;" vertex="1" parent="1">"#,
    r#"<mxGeometry x="10" y="20" width="120" height="40" as="geometry"/></mxCell>"#,
    r#"<mxCell id="b" value="Service" style="ellipse;" vertex="1" parent="1">"#,
    r#"<mxGeometry x="200" y="20" width="120" height="40" as="geometry"/></mxCell>"#,
    r#"<mxCell id="e1" edge="1" parent="1" source="a" target="b">"#,
    r#"<mxGeometry relative="1" as="geometry"/></mxCell>"#,
    "</root></mxGraphModel>"
);

/// `urllib.parse.quote(text, safe="")`, which is what draw.io applies before it
/// deflates.
fn percent_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-' | '~') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Exactly what draw.io writes: raw deflate over the URL-encoded model, base64.
fn drawio_payload(model: &str) -> String {
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    encoder
        .write_all(percent_encode(model).as_bytes())
        .expect("deflate accepts the model");
    STANDARD.encode(encoder.finish().expect("deflate finishes"))
}

fn png_chunk(kind: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    let mut crc = flate2::Crc::new();
    crc.update(kind);
    crc.update(body);
    out.extend_from_slice(&crc.sum().to_be_bytes());
    out
}

fn minimal_png(chunks: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    out.extend(png_chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]));
    for chunk in chunks {
        out.extend(chunk);
    }
    out.extend(png_chunk(b"IEND", b""));
    out
}

fn node<'a>(page: &'a Page, id: &str) -> &'a Node {
    page.nodes
        .iter()
        .find(|node| node.id == id)
        .unwrap_or_else(|| panic!("no node {id}"))
}

#[test]
fn raw_mxfile_xml_parses() {
    let xml = format!(r#"<mxfile><diagram id="p" name="One">{MODEL}</diagram></mxfile>"#);
    let pages = parse_file("inline.drawio", &xml).expect("parses");
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].name, "One");
    assert_eq!(pages[0].nodes.len(), 2);
    assert_eq!(pages[0].edges.len(), 1);
}

#[test]
fn deflate_base64_payload_round_trips() {
    let xml = format!(
        r#"<mxfile><diagram id="p" name="Packed">{}</diagram></mxfile>"#,
        drawio_payload(MODEL)
    );
    let pages = parse_file("packed.drawio", &xml).expect("parses");
    assert_eq!(pages[0].name, "Packed");
    assert_eq!(
        pages[0]
            .nodes
            .iter()
            .map(|node| node.label.as_str())
            .collect::<Vec<_>>(),
        vec!["Ingress", "Service"]
    );
}

#[test]
fn png_text_chunk_is_extracted() {
    let payload = percent_encode(&format!(
        r#"<mxfile><diagram id="p" name="Png">{MODEL}</diagram></mxfile>"#
    ));
    let mut body = b"mxfile\x00".to_vec();
    body.extend_from_slice(payload.as_bytes());
    let png = minimal_png(vec![png_chunk(b"tEXt", &body)]);
    let xml = load_mxfile("shot.drawio.png", &png).expect("PNG carries a diagram");
    assert!(xml.contains("<mxGraphModel"));
    assert_eq!(parse_file("shot.drawio.png", &xml).unwrap()[0].name, "Png");
}

#[test]
fn png_ztxt_chunk_is_inflated() {
    let payload = percent_encode(&format!(
        r#"<mxfile><diagram id="p" name="Zipped">{MODEL}</diagram></mxfile>"#
    ));
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    encoder.write_all(payload.as_bytes()).unwrap();
    let mut body = b"mxfile\x00\x00".to_vec();
    body.extend(encoder.finish().unwrap());
    let png = minimal_png(vec![png_chunk(b"zTXt", &body)]);
    let xml = load_mxfile("shot.drawio.png", &png).expect("PNG carries a diagram");
    assert_eq!(
        parse_file("shot.drawio.png", &xml).unwrap()[0].name,
        "Zipped"
    );
}

#[test]
fn png_without_an_mxfile_chunk_is_rejected() {
    let png = minimal_png(vec![png_chunk(b"tEXt", b"Comment\x00hello")]);
    assert_eq!(
        png_embedded_xml(&png).expect("well-formed chunks"),
        None,
        "a non-mxfile text chunk yields nothing"
    );
    let error = load_mxfile("shot.drawio.png", &png).unwrap_err();
    assert_eq!(
        error.0,
        "shot.drawio.png: PNG has no embedded draw.io diagram"
    );
}

#[test]
fn png_with_a_truncated_chunk_is_rejected() {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&99_999u32.to_be_bytes());
    png.extend_from_slice(b"tEXt");
    png.extend_from_slice(b"short");
    let error = png_embedded_xml(&png).unwrap_err();
    assert_eq!(error.0, "PNG has a truncated metadata chunk");
}

#[test]
fn svg_content_attribute_is_unescaped() {
    let inner = format!(r#"<mxfile><diagram id="p" name="Svg">{MODEL}</diagram></mxfile>"#);
    let escaped = inner
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let svg =
        format!(r#"<svg xmlns="http://www.w3.org/2000/svg" content="{escaped}"><rect/></svg>"#);
    let extracted = svg_embedded_xml(&svg).expect("content attribute holds an mxfile");
    assert_eq!(extracted, inner);
    let xml = load_mxfile("shot.drawio.svg", svg.as_bytes()).expect("SVG carries a diagram");
    assert_eq!(parse_file("shot.drawio.svg", &xml).unwrap()[0].name, "Svg");
}

#[test]
fn doctype_and_entity_declarations_are_rejected() {
    for hostile in [
        r#"<!DOCTYPE mxfile [<!ENTITY x "y">]><mxfile/>"#,
        r#"<!doctype mxfile><mxfile/>"#,
        r#"<mxfile><!ENTITY x SYSTEM "file:///etc/passwd"></mxfile>"#,
    ] {
        let error = parse_file("hostile.drawio", hostile).unwrap_err();
        assert_eq!(
            error.0,
            "hostile.drawio: DTD and entity declarations are not supported"
        );
    }
}

#[test]
fn decompression_is_bounded() {
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    encoder.write_all(&vec![b'a'; 200_000]).unwrap();
    let bomb = encoder.finish().unwrap();
    assert_eq!(
        decompress_limited(&bomb, Wrapper::Raw, 1024),
        Err(DecodeError::TooLarge)
    );
    assert!(decompress_limited(&bomb, Wrapper::Raw, MAX_XML_BYTES).is_ok());
    assert_eq!(
        decompress_limited(b"not deflate at all", Wrapper::Raw, 1024),
        Err(DecodeError::Stream)
    );
}

#[test]
fn oversized_payloads_fail_with_the_documented_message() {
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    encoder
        .write_all(&vec![b'a'; MAX_XML_BYTES + 1024])
        .unwrap();
    let payload = STANDARD.encode(encoder.finish().unwrap());
    let error = inflate(&payload).unwrap_err();
    assert_eq!(error.0, "decoded diagram exceeds the 64 MiB limit");
}

#[test]
fn unrecognised_input_is_refused() {
    let error = load_mxfile("notes.drawio", b"just some prose").unwrap_err();
    assert_eq!(
        error.0,
        "notes.drawio: not a draw.io file (no mxfile, mxGraphModel, or payload)"
    );
    let error = parse_file("empty.drawio", "<mxfile/>").unwrap_err();
    assert_eq!(error.0, "empty.drawio: mxfile contains no <diagram> pages");
}

#[test]
fn percent_decoding_is_utf8_lossy() {
    assert_eq!(percent_decode("a%20b%2Fc"), "a b/c");
    assert_eq!(percent_decode("%E2%9C%93"), "✓");
    assert_eq!(percent_decode("100%"), "100%");
    assert_eq!(percent_decode("%zz"), "%zz");
}

#[test]
fn absolute_geometry_resolves_through_nested_parents() {
    let page = &drawio_pages(&fixture("sample-architecture.drawio")).unwrap()[0];
    // `edgeGroup` sits at 40,40 and `web` is 20,40 inside it.
    assert_eq!(
        (node(page, "edgeGroup").x, node(page, "edgeGroup").y),
        (40.0, 40.0)
    );
    assert_eq!((node(page, "web").x, node(page, "web").y), (60.0, 80.0));
    assert_eq!(node(page, "web").depth, 1);
    assert_eq!(node(page, "edgeGroup").depth, 0);
    assert_eq!(
        node(page, "edgeGroup").children,
        vec!["web".to_string(), "mobile".to_string()]
    );
    assert!(node(page, "edgeGroup").container);
}

#[test]
fn labels_are_flattened_from_html_fragments() {
    assert_eq!(
        clean_label(Some("<b>Web App</b><br/>browser")),
        "Web App\nbrowser"
    );
    assert_eq!(
        clean_label(Some("Docs&amp;nbsp;portal")),
        "Docs&nbsp;portal"
    );
    assert_eq!(clean_label(Some("<div>a</div><div>b</div>")), "a\nb");
    assert_eq!(clean_label(Some("<p>one</p><p></p><p>two</p>")), "one\ntwo");
    assert_eq!(clean_label(Some("keep\u{a0}space")), "keep space");
    assert_eq!(clean_label(Some("  lots    of   space  ")), "lots of space");
    assert_eq!(clean_label(None), "");
}

#[test]
fn edge_label_vertices_fold_into_their_edge() {
    let page = &drawio_pages(&fixture("sample-architecture.drawio")).unwrap()[0];
    let edge = page
        .edges
        .iter()
        .find(|edge| edge.id == "e2")
        .expect("edge e2");
    assert_eq!(edge.label, "login / via\nTLS");
    assert!(
        !page.nodes.iter().any(|node| node.id == "e2label"),
        "the label vertex is not a node"
    );
}

#[test]
fn edge_arrow_styles_are_classified() {
    let page = &drawio_pages(&fixture("sample-architecture.drawio")).unwrap()[0];
    let find = |id: &str| page.edges.iter().find(|edge| edge.id == id).unwrap();
    assert!(find("e3").dashed && find("e3").undirected && !find("e3").bidirectional);
    assert!(find("e4").bidirectional && !find("e4").undirected);
    assert_eq!(find("e1").style_name, "orthogonal");
    assert_eq!(
        find("e1").waypoints,
        2,
        "the `as` mxPoint is not a waypoint"
    );
    // A source that names a deleted cell is dangling, not a link.
    assert_eq!(find("e8").source, None);
    assert_eq!(find("e8").target.as_deref(), Some("pg"));
}

#[test]
fn object_wrappers_expose_link_and_attributes() {
    let page = &drawio_pages(&fixture("sample-architecture.drawio")).unwrap()[0];
    let linked = node(page, "linked");
    assert_eq!(linked.link, "https://example.invalid/docs");
    assert_eq!(
        linked.label, "Docs portal",
        "the doubly-escaped nbsp survives both unescape passes and folds to a space"
    );
    assert_eq!(
        linked.attrs.keys().collect::<Vec<_>>(),
        vec!["owner"],
        "link and tooltip are held separately, not in attrs"
    );
}

#[test]
fn analysis_reports_hubs_budgets_and_collapsible_groups() {
    let pages = drawio_pages(&fixture("sample-architecture.drawio")).unwrap();
    let info = analyse(&pages[0]);
    assert_eq!(info.hubs[0].label, "API Gateway");
    assert_eq!(info.hubs[0].degree, 6);
    assert!(info.has_cycle, "gw -> auth -> gw is a cycle");
    assert!(info.over_node_budget, "11 drawable nodes exceeds 9");
    assert!(!info.over_edge_budget);
    assert!(info
        .orphans
        .iter()
        .any(|label| label.starts_with("Legacy path")));
    let groups: Vec<&str> = info
        .collapsible_groups
        .iter()
        .map(|group| group.label.as_str())
        .collect();
    assert_eq!(groups, vec!["Core Services", "Edge"]);
    assert_eq!(info.collapsible_groups[0].children, 3);
    assert!(info
        .type_candidates
        .iter()
        .any(|candidate| candidate == "swimlane"));
}

#[test]
fn swimlane_alignment_drives_the_swimlane_candidate() {
    let pages = drawio_pages(&fixture("sample-architecture.drawio")).unwrap();
    let lanes: Vec<&Node> = pages[0]
        .nodes
        .iter()
        .filter(|node| node.shape == "swimlane")
        .collect();
    assert_eq!(lanes.len(), 2);
    assert!(
        aligned(&lanes, 8.0),
        "both lanes share a top edge and height"
    );
    assert!(!aligned(&lanes[..1], 8.0), "one lane is never aligned");
}

#[test]
fn second_page_reports_er_candidates() {
    let pages = drawio_pages(&fixture("sample-architecture.drawio")).unwrap();
    let info = analyse(&pages[1]);
    assert_eq!(info.type_candidates[0], "er");
    assert_eq!(info.shapes.get("table").and_then(|v| v.as_i64()), Some(2));
    assert!(!info.has_cycle);
}

#[test]
fn cycle_detection_ignores_dangling_edges() {
    let pages = drawio_pages(&fixture("compressed.drawio")).unwrap();
    assert!(has_cycle(&pages[0].nodes, &pages[0].edges));
    let acyclic: Vec<_> = pages[0]
        .edges
        .iter()
        .filter(|edge| edge.id != "e3")
        .cloned()
        .collect();
    assert!(!has_cycle(&pages[0].nodes, &acyclic));
}

#[test]
fn shape_classification_covers_stencils_and_style_keys() {
    assert_eq!(
        classify_shape(&parse_style(Some("shape=cylinder3;"))),
        "cylinder"
    );
    assert_eq!(
        classify_shape(&parse_style(Some("shape=mxgraph.aws4.s3;"))),
        "icon:aws"
    );
    assert_eq!(
        classify_shape(&parse_style(Some("shape=mxgraph.unknown.thing;"))),
        "shape:mxgraph.unknown.thing"
    );
    assert_eq!(
        classify_shape(&parse_style(Some("swimlane;startSize=20;"))),
        "swimlane"
    );
    assert_eq!(classify_shape(&parse_style(Some("rounded=1;"))), "rect");
    assert_eq!(classify_shape(&parse_style(Some("ellipse=1;"))), "ellipse");
    assert_eq!(shape_family("icon:aws"), "aws");
    assert_eq!(shape_family("shape:custom.thing"), "custom");
    assert_eq!(shape_family("rect"), "rect");
}

#[test]
fn style_parsing_treats_a_bare_key_as_one() {
    let style = parse_style(Some("swimlane;fillColor=#dae8fc;dashed=0; rounded = 1 ;"));
    assert_eq!(
        style,
        vec![
            ("swimlane".to_string(), "1".to_string()),
            ("fillColor".to_string(), "#dae8fc".to_string()),
            ("dashed".to_string(), "0".to_string()),
            ("rounded".to_string(), "1".to_string()),
        ]
    );
    assert!(parse_style(None).is_empty());
}

#[test]
fn page_bounds_ignore_zero_sized_cells() {
    let pages = drawio_pages(&fixture("compressed.drawio")).unwrap();
    assert_eq!(page_bounds(&pages[0]), (10.0, 20.0, 470.0, 80.0));
    assert_eq!(page_bounds(&Page::default()), (0.0, 0.0, 0.0, 0.0));
}

#[test]
fn page_selection_reports_what_is_available() {
    use diagram_ir::drawio::digest::select_pages;
    let pages = drawio_pages(&fixture("sample-architecture.drawio")).unwrap();
    assert_eq!(select_pages(&pages, None).unwrap().len(), 1);
    assert_eq!(select_pages(&pages, Some("all")).unwrap().len(), 2);
    assert_eq!(
        select_pages(&pages, Some("1")).unwrap()[0].name,
        "Data Model"
    );
    assert_eq!(
        select_pages(&pages, Some("data model")).unwrap()[0].index,
        1,
        "name matching is case-insensitive"
    );
    assert_eq!(
        select_pages(&pages, Some("7")).unwrap_err().0,
        "no page with index 7 (have 0..1)"
    );
    assert_eq!(
        select_pages(&pages, Some("Nope")).unwrap_err().0,
        "no page named 'Nope' (have: Architecture, Data Model)"
    );
}

#[test]
fn digest_truncates_tables_at_max_rows() {
    let digest = drawio_output("sample-architecture.drawio", None, false, 2);
    assert!(digest.contains("| … | +10 more (use --json) | | | | | |"));
    assert!(digest.contains("| … | +6 more (use --json) | | |"));
}

#[test]
fn text_shapes_are_not_drawable() {
    let pages = drawio_pages(&fixture("sample-architecture.drawio")).unwrap();
    let info = analyse(&pages[0]);
    assert_eq!(info.nodes_total, 12);
    assert_eq!(info.nodes_drawable, 11, "the floating caption is excluded");
}
