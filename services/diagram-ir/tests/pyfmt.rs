//! The Python-compatibility layer the digests depend on: `repr`, `splitlines`,
//! `PurePath` normalisation and `html.unescape`.

use diagram_ir::entities::{escape_no_quote, unescape};
use diagram_ir::markdown::escape_markdown;
use diagram_ir::pyfmt::{
    char_len, path_name, path_stem, path_str, path_suffix, py_bool, repr_dict_int_int,
    repr_dict_str_int, repr_list_int, repr_list_str, repr_str, splitlines, strip,
};

#[test]
fn repr_matches_python_quoting_rules() {
    assert_eq!(repr_str("plain"), "'plain'");
    assert_eq!(repr_str("it's"), "\"it's\"");
    assert_eq!(repr_str("it's \"both\""), "'it\\'s \"both\"'");
    assert_eq!(repr_str("line\nbreak"), "'line\\nbreak'");
    assert_eq!(repr_str("tab\there"), "'tab\\there'");
    assert_eq!(repr_str("back\\slash"), "'back\\\\slash'");
    assert_eq!(repr_str("bell\u{7}"), "'bell\\x07'");
    assert_eq!(repr_str("é"), "'é'");
}

#[test]
fn container_reprs_match_python() {
    assert_eq!(
        repr_dict_str_int(&[("rect".into(), 3), ("swimlane".into(), 2)]),
        "{'rect': 3, 'swimlane': 2}"
    );
    assert_eq!(repr_dict_str_int(&[]), "{}");
    assert_eq!(repr_dict_int_int(&[(2, 4)]), "{2: 4}");
    assert_eq!(
        repr_list_str(&["loop".into(), "none".into()]),
        "['loop', 'none']"
    );
    assert_eq!(repr_list_int(&[1, 2, 4]), "[1, 2, 4]");
    assert_eq!(repr_list_int(&[]), "[]");
    assert_eq!(py_bool(true), "True");
    assert_eq!(py_bool(false), "False");
}

#[test]
fn splitlines_uses_pythons_boundary_set() {
    assert_eq!(splitlines("a\nb"), vec!["a", "b"]);
    assert_eq!(splitlines("a\r\nb"), vec!["a", "b"]);
    assert_eq!(splitlines("a\rb"), vec!["a", "b"]);
    assert_eq!(splitlines("a\u{b}b\u{c}c"), vec!["a", "b", "c"]);
    assert_eq!(splitlines("a\u{2028}b"), vec!["a", "b"]);
    assert_eq!(splitlines("trailing\n"), vec!["trailing"]);
    assert!(splitlines("").is_empty());
}

#[test]
fn strip_removes_unicode_whitespace() {
    assert_eq!(strip("  a b  "), "a b");
    assert_eq!(strip("\u{a0}a\u{a0}"), "a");
    assert_eq!(strip("\t\nx\r\n"), "x");
}

#[test]
fn path_normalisation_matches_purepath() {
    assert_eq!(path_str("./a.html"), "a.html");
    assert_eq!(path_str("a//b"), "a/b");
    assert_eq!(path_str("a/./b"), "a/b");
    assert_eq!(path_str("a/../b"), "a/../b");
    assert_eq!(path_str("/abs/x"), "/abs/x");
    assert_eq!(path_str(""), ".");
    assert_eq!(path_str("/"), "/");
    assert_eq!(path_name("dir/file.drawio"), "file.drawio");
    assert_eq!(path_stem("dir/archive.tar.gz"), "archive.tar");
    assert_eq!(path_stem(".hidden"), ".hidden");
    assert_eq!(path_suffix("a.MMD"), ".MMD");
    assert_eq!(path_suffix("noext"), "");
}

#[test]
fn char_len_counts_code_points_like_python() {
    assert_eq!(char_len("abc"), 3);
    assert_eq!(char_len("→ é"), 3);
}

#[test]
fn unescape_matches_html_unescape() {
    assert_eq!(unescape("&amp;&lt;&gt;&quot;&#39;"), "&<>\"'");
    assert_eq!(unescape("&nbsp;"), "\u{a0}");
    assert_eq!(unescape("&#65;&#x42;"), "AB");
    // Legacy semicolon-less aliases resolve, longest prefix first.
    assert_eq!(unescape("&amp"), "&");
    assert_eq!(unescape("&notit;"), "\u{ac}it;");
    assert_eq!(unescape("&nothing"), "\u{ac}hing");
    // Windows-1252 remapping and invalid codepoints.
    assert_eq!(unescape("&#128;"), "\u{20ac}");
    assert_eq!(unescape("&#0;"), "\u{fffd}");
    assert_eq!(unescape("&#x110000;"), "\u{fffd}");
    assert_eq!(unescape("&#xD800;"), "\u{fffd}");
    assert_eq!(unescape("&#1;"), "");
    // A name with no prefix in the table is left alone.
    assert_eq!(unescape("&zzz;"), "&zzz;");
    assert_eq!(unescape("&notarealentity;"), "\u{ac}arealentity;");
    assert_eq!(unescape("plain & simple"), "plain & simple");
}

#[test]
fn escape_matches_html_escape_without_quotes() {
    assert_eq!(
        escape_no_quote("a & b < c > d \" e"),
        "a &amp; b &lt; c &gt; d \" e"
    );
}

#[test]
fn markdown_escaping_runs_after_html_escaping() {
    assert_eq!(escape_markdown("a_b"), "a\\_b");
    assert_eq!(escape_markdown("[x](y)"), "\\[x\\]\\(y\\)");
    assert_eq!(escape_markdown("a & b"), "a &amp; b");
    assert_eq!(escape_markdown("x > y"), "x &gt; y");
    assert_eq!(escape_markdown("100%"), "100%");
    assert_eq!(escape_markdown("a.b-c!"), "a\\.b\\-c\\!");
}
