//! Archive-layer defences: budgets, entry counts and entry names.
//!
//! Kept apart from the part-level tests because these are about the zip
//! container as an attack surface, not about OOXML or ODF semantics.

use super::*;

#[test]
fn a_zip_bomb_is_refused_before_decompression() {
    // One entry whose declared uncompressed size blows the per-entry cap. A run
    // of zeroes compresses to almost nothing, so the archive stays small, and
    // the declared size lets it be rejected without decompressing at all.
    let payload = vec![0u8; (MAX_ZIP_ENTRY_BYTES + 1) as usize];
    let bomb = zip_with(&[("word/document.xml", &payload, false)]);
    assert!(bomb.len() < 1 << 20, "the bomb must be small on disk");

    let error = clean_docx(&bomb).unwrap_err();
    assert!(
        error.contains("over the per-entry cap"),
        "error was {error}"
    );
    assert_eq!(inspect_docx(&bomb).2.len(), 1);
}

#[test]
fn the_budget_bounds_the_bytes_produced_not_the_bytes_declared() {
    // The central directory is attacker-controlled data. Checking the declared
    // size and then calling `read_to_end` bounds nothing, so the real test is
    // whether an entry that passes the declared check still cannot exceed the
    // budget while decompressing. Driving it with a tiny budget exercises the
    // `take(budget + 1)` path deterministically.
    let archive = zip_with(&[("word/document.xml", &vec![b'x'; 4096], false)]);

    let generous = ZipBudget {
        max_entry_bytes: 8192,
        max_total_bytes: 8192,
        ..ZipBudget::default()
    };
    assert_eq!(read_entries_with(&archive, generous).unwrap().len(), 1);

    let tight = ZipBudget {
        max_entry_bytes: 4095,
        max_total_bytes: 8192,
        ..ZipBudget::default()
    };
    let error = read_entries_with(&archive, tight).unwrap_err();
    assert!(
        error.contains("over the per-entry cap") || error.contains("exceeds cap"),
        "error was {error}"
    );

    // And the archive total is enforced across entries, not just per entry.
    let two = zip_with(&[
        ("a.xml", &vec![b'x'; 4096], false),
        ("b.xml", &vec![b'y'; 4096], false),
    ]);
    let total = ZipBudget {
        max_entry_bytes: 8192,
        max_total_bytes: 6000,
        ..ZipBudget::default()
    };
    assert!(read_entries_with(&two, total).is_err());
}

#[test]
fn the_entry_count_is_capped() {
    let parts: Vec<(String, Vec<u8>, bool)> = (0..12)
        .map(|index| (format!("part{index}.xml"), b"<x/>".to_vec(), false))
        .collect();
    let refs: Vec<(&str, &[u8], bool)> = parts
        .iter()
        .map(|(name, data, stored)| (name.as_str(), data.as_slice(), *stored))
        .collect();
    let archive = zip_with(&refs);

    let budget = ZipBudget {
        max_entries: 8,
        ..ZipBudget::default()
    };
    let error = read_entries_with(&archive, budget).unwrap_err();
    assert!(error.contains("entry count 12 exceeds cap"), "was {error}");
}

#[test]
fn unsafe_and_duplicated_entry_names_are_refused() {
    // Nothing here extracts to the filesystem, so this is not a live traversal
    // defence. It stops this crate emitting an archive whose names would make a
    // downstream extractor dangerous.
    for name in [
        "../../etc/passwd",
        "/etc/passwd",
        "word\\document.xml",
        "C:/windows/system32",
    ] {
        let archive = zip_with(&[(name, b"<x/>", false)]);
        let error = read_entries(&archive).unwrap_err();
        assert!(
            error.contains("unsafe name"),
            "{name} was accepted: {error}"
        );
    }

    // A duplicated part name lets two readers disagree about which bytes a part
    // holds. The `zip` writer refuses to *create* one, so the guard is tested
    // directly rather than through a fixture: a hostile archive is written by
    // hand, not by this crate.
    let mut seen = BTreeSet::new();
    assert!(check_entry_name("word/document.xml", &mut seen).is_ok());
    let error = check_entry_name("word/document.xml", &mut seen).unwrap_err();
    assert!(error.contains("duplicate entry name"), "was {error}");
    assert!(check_entry_name("../escape", &mut seen).is_err());
}
