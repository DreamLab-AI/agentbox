use super::*;
use prose_sanitiser_core::surrogate;

fn units(text: &str) -> Vec<Unit> {
    surrogate::decode(text.as_bytes())
}

fn cleaned(text: &str, options: CleanOptions) -> String {
    let (output, _) = clean_text(&units(text), options);
    String::from_utf8(surrogate::encode(&output)).unwrap()
}

#[test]
fn clean_strips_zero_width_carriers_and_keeps_the_prose() {
    let dirty = "in\u{200b}vis\u{200d}ible\u{feff} text";
    assert_eq!(cleaned(dirty, CleanOptions::default()), "invisible text");
}

#[test]
fn clean_preserves_exotic_whitespace_unless_asked() {
    // A no-break space is load-bearing typography, not a carrier: it holds
    // "10 km" together and French orthography requires one before a colon.
    // Folding it is invisible in a diff, so it is never done by default.
    let dirty = "a\u{00a0}b\u{2009}c\u{3000}d";
    assert_eq!(cleaned(dirty, CleanOptions::default()), dirty);

    let normalise = CleanOptions {
        normalize_spaces: true,
        ..CleanOptions::default()
    };
    assert_eq!(cleaned(dirty, normalise), "a b c d");
}

#[test]
fn aggressive_mode_folds_cyrillic_and_fullwidth_lookalikes() {
    let dirty = "\u{0410}\u{0430}\u{ff21}";
    assert_eq!(cleaned(dirty, CleanOptions::default()), dirty);
    let aggressive = CleanOptions {
        aggressive_homoglyphs: true,
        ..CleanOptions::default()
    };
    assert_eq!(cleaned(dirty, aggressive), "AaA");
}

#[test]
fn emoji_sequences_survive_a_default_clean() {
    // Heart-on-fire: U+2764 VS16 ZWJ U+1F525 — every invisible is load-bearing.
    let emoji = "\u{2764}\u{fe0f}\u{200d}\u{1f525}";
    assert_eq!(cleaned(emoji, CleanOptions::default()), emoji);

    // Paranoid mode strips the glue and leaves the bare bases.
    let paranoid = CleanOptions {
        strip_emoji_glue: true,
        ..CleanOptions::default()
    };
    assert_eq!(cleaned(emoji, paranoid), "\u{2764}\u{1f525}");
}

#[test]
fn flag_tag_sequences_stay_bound_to_their_base() {
    // Scotland: black flag + tag characters + cancel tag.
    let flag = "\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}";
    assert_eq!(cleaned(flag, CleanOptions::default()), flag);
}

#[test]
fn nfkc_is_opt_in_and_counted_once_per_change() {
    let ligature = "ﬁle";
    assert_eq!(cleaned(ligature, CleanOptions::default()), ligature);

    let options = CleanOptions {
        nfkc: true,
        ..CleanOptions::default()
    };
    let (output, stats) = clean_text(&units(ligature), options);
    assert_eq!(
        String::from_utf8(surrogate::encode(&output)).unwrap(),
        "file"
    );
    let json = stats.to_json();
    assert_eq!(json["replaced"]["NFKC_normalize"], 1);
    // The NFKC bookkeeping entry is excluded from replaced_count.
    assert_eq!(json["replaced_count"], 0);
}

#[test]
fn a_soft_hyphen_survives_a_default_clean() {
    // A hyphenation hint in a real compound word. Removing it is a judgement
    // about the author's intent, so the default must not make it.
    let hyphenated = "co\u{00AD}operate";
    assert_eq!(cleaned(hyphenated, CleanOptions::default()), hyphenated);
}

#[test]
fn a_soft_hyphen_is_stripped_only_when_asked() {
    let hyphenated = "co\u{00AD}operate";
    let options = CleanOptions {
        strip_soft_hyphen: true,
        ..CleanOptions::default()
    };
    assert_eq!(cleaned(hyphenated, options), "cooperate");

    // Paranoid mode strips every load-bearing invisible, this one included.
    let paranoid = CleanOptions {
        strip_emoji_glue: true,
        ..CleanOptions::default()
    };
    assert_eq!(cleaned(hyphenated, paranoid), "cooperate");
}

#[test]
fn a_soft_hyphen_is_reported_under_its_own_kind() {
    // Preserved is not the same as unreported: a reader still wants to know.
    let report = inspect_text(&units("co\u{00AD}operate"), false, false);
    assert_eq!(report.suspicious_total, 1);
    assert_eq!(report.hits[0].kind, "soft_hyphen");
    assert_eq!(report.hits[0].codepoint, 0x00AD);
    let json = report.to_json();
    assert_eq!(json["hits"][0]["confidence"], "informational");
}

#[test]
fn stats_report_labels_counts_and_lengths() {
    let options = CleanOptions {
        normalize_spaces: true,
        ..CleanOptions::default()
    };
    let (_, stats) = clean_text(&units("a\u{200b}\u{200b}b\u{00a0}c"), options);
    let json = stats.to_json();
    assert_eq!(json["input_length"], 6);
    assert_eq!(json["output_length"], 4);
    assert_eq!(json["removed_count"], 2);
    assert_eq!(json["replaced_count"], 1);
    assert_eq!(json["removed"]["U+200B ZERO WIDTH SPACE (Cf)"], 2);
    assert_eq!(json["replaced"]["U+00A0 NO-BREAK SPACE (Zs)"], 1);
}

#[test]
fn inspect_buckets_hits_and_orders_by_descending_count() {
    let report = inspect_text(&units("\u{202e}a\u{200b}\u{200b}\u{200b}b"), false, false);
    assert_eq!(report.suspicious_total, 4);
    assert_eq!(report.hits.len(), 2);
    assert_eq!(report.hits[0].codepoint, 0x200B);
    assert_eq!(report.hits[0].count, 3);
    assert_eq!(report.hits[0].kind, "zwj_family");
    assert_eq!(report.hits[1].codepoint, 0x202E);
    assert_eq!(report.hits[1].kind, "bidi");
}

#[test]
fn inspect_offsets_are_python_character_offsets() {
    let report = inspect_text(&units("héllo\u{200b}"), false, false);
    assert_eq!(report.length, 6);
    assert_eq!(report.hits[0].samples, vec![5]);
}

#[test]
fn inspect_caps_samples_at_ten() {
    let text: String = "\u{200b}".repeat(25);
    let report = inspect_text(&units(&text), false, false);
    assert_eq!(report.hits[0].count, 25);
    assert_eq!(report.hits[0].samples.len(), 10);
}

#[test]
fn a_clean_text_gains_the_reassurance_note() {
    let report = inspect_text(&units("ordinary prose"), false, false);
    assert_eq!(report.suspicious_total, 0);
    assert_eq!(report.notes.len(), 6);
    assert!(report.notes.last().unwrap().starts_with("No deterministic"));

    let dirty = inspect_text(&units("x\u{200b}"), false, false);
    assert_eq!(dirty.notes.len(), 5);
}

#[test]
fn inspect_json_carries_confidence_per_hit() {
    let report = inspect_text(&units("a\u{00a0}b\u{202e}"), false, false);
    let json = report.to_json();
    let hits = json["hits"].as_array().unwrap();
    let space = hits
        .iter()
        .find(|hit| hit["codepoint"] == "U+00A0")
        .unwrap();
    assert_eq!(space["confidence"], "informational");
    assert_eq!(space["kind"], "space");
    let bidi = hits
        .iter()
        .find(|hit| hit["codepoint"] == "U+202E")
        .unwrap();
    assert_eq!(bidi["confidence"], "probable");
}

#[test]
fn undecodable_bytes_survive_a_clean_untouched() {
    let raw = vec![b'a', 0xff, 0xe2, 0x80, 0x8b, b'b'];
    let (output, stats) = clean_text(&surrogate::decode(&raw), CleanOptions::default());
    // The ZWSP goes; the invalid byte stays exactly where it was.
    assert_eq!(surrogate::encode(&output), vec![b'a', 0xff, b'b']);
    assert_eq!(stats.removed_count, 1);
}

#[test]
fn human_report_renders_hits_and_notes() {
    let report = inspect_text(&units("x\u{200b}"), false, false);
    let text = human_report(&report);
    assert!(text.starts_with("Length: 2 chars\nSuspicious: 1\nHits:\n"));
    assert!(text.contains("[zwj_family/probable] U+200B ZERO WIDTH SPACE (Cf) x1 @ [1]"));
    assert!(text.contains("Note: Layer A only:"));
}
