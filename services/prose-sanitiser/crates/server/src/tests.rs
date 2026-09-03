use super::*;

use base64::engine::general_purpose::STANDARD;

fn encode(data: &[u8]) -> String {
    STANDARD.encode(data)
}

#[test]
fn filenames_are_reduced_to_a_safe_basename() {
    assert_eq!(safe_name("notes.md"), "notes.md");
    assert_eq!(safe_name("../../etc/passwd"), "passwd");
    assert_eq!(safe_name("..\\..\\windows\\system32"), "system32");
    assert_eq!(safe_name(""), "input");
    assert_eq!(safe_name("."), "input");
    assert_eq!(safe_name(".."), "input");
    assert_eq!(safe_name("a/b/"), "input");
}

#[test]
fn temp_paths_cannot_escape_their_directory() {
    let dir = tempfile::tempdir().unwrap();
    assert!(tmp_path(dir.path(), "file.txt").is_ok());
    assert!(tmp_path(dir.path(), "sub/file.txt").is_err());
    assert!(tmp_path(dir.path(), "../escape").is_err());
}

#[test]
fn the_envelope_decoder_validates_its_fields() {
    let good = json!({"file": encode(b"hello"), "name": "a.txt"});
    let (data, name) = decode_input(&good).unwrap();
    assert_eq!(data, b"hello");
    assert_eq!(name, "a.txt");

    assert!(decode_input(&json!({}))
        .unwrap_err()
        .contains("missing string field"));
    assert!(decode_input(&json!({"file": 42}))
        .unwrap_err()
        .contains("missing string field"));
    assert!(decode_input(&json!({"file": encode(b"x"), "name": 7}))
        .unwrap_err()
        .contains("'name' must be a string"));
    assert!(decode_input(&json!({"file": "not!base64!"}))
        .unwrap_err()
        .contains("not valid base64"));
}

#[test]
fn inspect_routes_text_and_reports_suspicion() {
    let payload = handle_inspect("clean prose".as_bytes(), "a.txt").unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["kind"], "text");
    assert_eq!(payload["suspicious"], false);

    let dirty = handle_inspect("hidden\u{200b}mark".as_bytes(), "a.txt").unwrap();
    assert_eq!(dirty["suspicious"], true);
    assert_eq!(dirty["report"]["suspicious_total"], 1);
}

#[test]
fn inspect_routes_containers_by_the_supplied_name() {
    let payload = handle_inspect(b"---\ngenerator: Claude\n---\nBody\n", "post.md").unwrap();
    assert_eq!(payload["kind"], "container");
    assert_eq!(payload["suspicious"], true);
    assert_eq!(payload["report"]["format"], "markdown");
}

#[test]
fn inspect_refuses_a_binary_container_routed_as_text() {
    // A .txt name over PDF bytes: the extension says text, the sniff refuses.
    let error = handle_inspect(b"%PDF-1.7 body", "a.txt").unwrap_err();
    match error {
        HandlerError::BadRequest(message) => {
            assert!(message.contains("look like a binary container"))
        }
        HandlerError::Internal(message) => panic!("expected a 400, got {message}"),
    }
}

#[test]
fn clean_returns_the_cleaned_bytes_and_a_report() {
    let payload = handle_clean(
        "keep\u{200b}this".as_bytes(),
        "a.txt",
        &json!({"file": "", "options": {}}),
    )
    .unwrap();
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["kind"], "text");
    let cleaned = STANDARD
        .decode(payload["cleaned"].as_str().unwrap())
        .unwrap();
    assert_eq!(cleaned, b"keepthis");
    assert_eq!(payload["report"]["stats"]["removed_count"], 1);
}

#[test]
fn clean_honours_the_option_allowlist() {
    let error = handle_clean(b"x", "a.txt", &json!({"options": {"nope": true}})).unwrap_err();
    match error {
        HandlerError::BadRequest(message) => assert_eq!(message, "unknown option: nope"),
        HandlerError::Internal(message) => panic!("expected a 400, got {message}"),
    }

    let error = handle_clean(b"x", "a.txt", &json!({"options": []})).unwrap_err();
    match error {
        HandlerError::BadRequest(message) => assert_eq!(message, "'options' must be an object"),
        HandlerError::Internal(message) => panic!("expected a 400, got {message}"),
    }
}

#[test]
fn clean_passes_text_options_through() {
    let payload = handle_clean(
        "ﬁle".as_bytes(),
        "a.txt",
        &json!({"options": {"nfkc": true}}),
    )
    .unwrap();
    let cleaned = STANDARD
        .decode(payload["cleaned"].as_str().unwrap())
        .unwrap();
    assert_eq!(String::from_utf8(cleaned).unwrap(), "file");
}

#[test]
fn clean_validates_the_pixel_backend_name() {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&prose_sanitiser::image::png::build_chunk(
        b"IHDR",
        &[0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0],
    ));
    png.extend_from_slice(&prose_sanitiser::image::png::build_chunk(b"IEND", b""));

    let error = handle_clean(
        &png,
        "a.png",
        &json!({"options": {"remove_pixel": "magic"}}),
    )
    .unwrap_err();
    match error {
        HandlerError::BadRequest(message) => {
            assert_eq!(message, "remove_pixel must be one of: ctrlregen, diffusion")
        }
        HandlerError::Internal(message) => panic!("expected a 400, got {message}"),
    }
}

#[test]
fn clean_strips_container_metadata_and_hides_the_temp_paths() {
    let payload = handle_clean(
        b"---\ngenerator: Claude\ntitle: Hills\n---\nBody\n",
        "post.md",
        &json!({"options": {}}),
    )
    .unwrap();
    assert_eq!(payload["kind"], "container");
    let cleaned = STANDARD
        .decode(payload["cleaned"].as_str().unwrap())
        .unwrap();
    let text = String::from_utf8(cleaned).unwrap();
    assert!(!text.contains("Claude"));
    assert!(text.contains("title: Hills"));
    // The request temp directory must never leak into the response.
    assert!(payload["report"].get("input").is_none());
    assert!(payload["report"].get("output").is_none());
    assert_eq!(payload["report"]["kind"], "container");

    // Key order must survive the temp-path removal: `preserve_order`'s
    // `remove` is a swap-remove, which would drag `meta` and `post_findings`
    // forward and diverge from the Python's `dict.pop`.
    let keys: Vec<&str> = payload["report"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        vec![
            "kind",
            "format",
            "actions",
            "bytes_in",
            "bytes_out",
            "still_has_c2pa",
            "still_has_ai_metadata",
            "post_findings",
            "meta",
        ]
    );
}

#[test]
fn capabilities_reports_every_backend_slot() {
    let payload = capabilities();
    assert!(payload["tools"]["exiftool"].is_boolean());
    assert!(payload["tools"]["qpdf"].is_boolean());
    assert!(payload["pixel_backends"]["ctrlregen"].is_boolean());
    assert!(payload["pixel_backends"]["diffusion"].is_boolean());
    assert!(payload["scorers"]["synthid"].is_boolean());
    assert!(payload["harnesses"]["markllm"].is_boolean());
}

#[test]
fn the_body_cap_leaves_headroom_for_base64_inflation() {
    // Base64 inflates by 4/3, so the envelope cap must exceed the input cap.
    assert!(max_body_bytes() as u64 > max_input_bytes());
}
