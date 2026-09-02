use super::*;

#[test]
fn content_type_wins_over_suffix_and_bytes() {
    assert_eq!(
        guess_kind("https://x.example/a.txt", b"\x89PNG", Some("image/png")),
        "png"
    );
    assert_eq!(
        guess_kind("https://x.example/a", b"", Some("text/html; charset=utf-8")),
        "html"
    );
    assert_eq!(
        guess_kind("https://x.example/a", b"", Some("application/pdf")),
        "pdf"
    );
}

#[test]
fn the_path_suffix_is_the_second_signal() {
    assert_eq!(guess_kind("https://x.example/a.png", b"", None), "png");
    assert_eq!(guess_kind("https://x.example/doc.PDF", b"", None), "pdf");
    assert_eq!(guess_kind("https://x.example/n.md?v=2", b"", None), "markdown");
}

#[test]
fn magic_bytes_are_the_last_resort() {
    assert_eq!(guess_kind("https://x.example/a", b"\x89PNG\r\n", None), "png");
    assert_eq!(guess_kind("https://x.example/a", b"%PDF-1.7", None), "pdf");
    assert_eq!(guess_kind("https://x.example/a", b"<svg xmlns='x'>", None), "svg");
    assert_eq!(guess_kind("https://x.example/a", b"<html><body>", None), "html");
    assert_eq!(guess_kind("https://x.example/a", b"plain words", None), "text");
}

#[test]
fn a_urlset_sitemap_yields_its_locations() {
    let xml = br#"<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc></url>
</urlset>"#;
    let (kind, urls) = parse_sitemap(xml).unwrap();
    assert_eq!(kind, "urlset");
    assert_eq!(urls, vec!["https://example.com/a", "https://example.com/b"]);
}

#[test]
fn a_sitemap_index_is_distinguished_by_its_root() {
    let xml = br#"<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/s1.xml</loc></sitemap>
</sitemapindex>"#;
    let (kind, urls) = parse_sitemap(xml).unwrap();
    assert_eq!(kind, "sitemapindex");
    assert_eq!(urls, vec!["https://example.com/s1.xml"]);
}

#[test]
fn a_gzipped_sitemap_is_decompressed() {
    use flate2::write::GzEncoder;
    use std::io::Write;

    let xml = b"<urlset><url><loc>https://example.com/a</loc></url></urlset>";
    let mut encoder = GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(xml).unwrap();
    let gz = encoder.finish().unwrap();
    assert_eq!(&gz[..2], &[0x1F, 0x8B]);

    let (kind, urls) = parse_sitemap(&gz).unwrap();
    assert_eq!(kind, "urlset");
    assert_eq!(urls, vec!["https://example.com/a"]);
}

#[test]
fn a_gzip_bomb_is_refused_on_the_decompressed_size() {
    use flate2::write::GzEncoder;
    use std::io::Write;

    let payload = vec![b'x'; MAX_SITEMAP_DECOMPRESSED_BYTES + 1024];
    let mut encoder = GzEncoder::new(Vec::new(), flate2::Compression::best());
    encoder.write_all(&payload).unwrap();
    let gz = encoder.finish().unwrap();
    assert!(gz.len() < 1 << 20, "the bomb must be small on the wire");

    let error = parse_sitemap(&gz).unwrap_err();
    assert!(error.contains("decompressed size exceeds cap"));
}

#[test]
fn malformed_sitemap_xml_is_an_error_not_a_panic() {
    assert!(parse_sitemap(b"not xml at all").is_err());
    assert!(parse_sitemap(b"").is_err());
}

#[test]
fn namespaced_loc_elements_are_still_found() {
    let xml = br#"<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sm:url><sm:loc>https://example.com/a</sm:loc></sm:url>
</sm:urlset>"#;
    let (kind, urls) = parse_sitemap(xml).unwrap();
    assert_eq!(kind, "urlset");
    assert_eq!(urls, vec!["https://example.com/a"]);
}

#[test]
fn a_fetch_of_a_private_address_is_refused_before_connecting() {
    // No socket is opened: the policy check rejects the target first.
    let error = fetch("http://127.0.0.1:1/x", 1, 1024, None).unwrap_err();
    assert!(error.contains("refusing non-public address"));

    let error = fetch("http://169.254.169.254/latest/meta-data/", 1, 1024, None).unwrap_err();
    assert!(error.contains("refusing non-public address"));
}

#[test]
fn non_http_schemes_are_refused() {
    assert!(fetch("file:///etc/passwd", 1, 1024, None)
        .unwrap_err()
        .contains("unsupported URL scheme"));
}

#[test]
fn collect_urls_refuses_a_cross_origin_sitemap_target() {
    // The origin check runs before any network access for the nested URL.
    let expected = ("https".to_string(), "example.com".to_string(), 443);
    assert!(!net::origin_allowed(
        &net::url_origin("https://evil.example/page").unwrap(),
        &expected
    ));
}

#[test]
fn extensions_cover_every_kind_the_guesser_returns() {
    for kind in [
        "png", "jpeg", "svg", "pdf", "docx", "odt", "html", "markdown", "text",
    ] {
        assert_ne!(extension_for_kind(kind), ".bin", "{kind} needs an extension");
    }
    assert_eq!(extension_for_kind("something-else"), ".bin");
}

#[test]
fn inspect_remote_routes_bytes_through_the_local_pipeline() {
    let item = inspect_remote(
        "https://example.com/post.md",
        b"---\ngenerator: Claude\n---\nBody\n",
        Some("text/markdown"),
    );
    assert_eq!(item["path"], "https://example.com/post.md");
    assert_eq!(item["kind"], "markdown");
    assert_eq!(item["has_ai_metadata"], true);
}
