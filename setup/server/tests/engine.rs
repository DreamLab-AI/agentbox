//! Acceptance tests for the comment-preserving editor, run against a copy of
//! the real `agentbox.toml` (never the file itself).

use agentbox_setup::{apply_edits, atomic_write, parse_to_json, validate, Edit, Seg};
use serde_json::json;
use std::{fs, path::PathBuf, process::Command};

const LIVE: &str = include_str!("../../../agentbox.toml");

fn scratch(name: &str) -> PathBuf {
    let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn edit(path: &[&str], value: serde_json::Value) -> Edit {
    Edit {
        path: path
            .iter()
            .map(|s| s.parse::<usize>().map(Seg::Idx).unwrap_or_else(|_| Seg::Key((*s).into())))
            .collect(),
        value,
    }
}

/// Line-level diff: (old, new) pairs of changed lines; panics if line counts differ.
fn changed_lines<'a>(a: &'a str, b: &'a str) -> Vec<(&'a str, &'a str)> {
    let (la, lb): (Vec<_>, Vec<_>) = (a.lines().collect(), b.lines().collect());
    assert_eq!(la.len(), lb.len(), "line count changed");
    la.into_iter().zip(lb).filter(|(x, y)| x != y).collect()
}

#[test]
fn a_zero_edits_is_byte_identical() {
    assert_eq!(apply_edits(LIVE, &[]).unwrap(), LIVE);
}

#[test]
fn a_noop_edit_of_current_values_is_byte_identical() {
    let cur = parse_to_json(LIVE).unwrap();
    let edits = vec![
        edit(&["core", "orchestration"], cur["core"]["orchestration"].clone()),
        edit(&["plugins", "packages", "3", "enabled"], cur["plugins"]["packages"][3]["enabled"].clone()),
    ];
    assert_eq!(apply_edits(LIVE, &edits).unwrap(), LIVE);
}

#[test]
fn a_zero_edit_save_via_atomic_write_round_trips() {
    let dir = scratch("roundtrip");
    let f = dir.join("agentbox.toml");
    fs::write(&f, LIVE).unwrap();
    atomic_write(&f, &apply_edits(&fs::read_to_string(&f).unwrap(), &[]).unwrap()).unwrap();
    assert_eq!(fs::read(&f).unwrap(), LIVE.as_bytes());
}

fn py_reference() -> Option<serde_json::Value> {
    let out = Command::new("python3")
        .args(["-I", "-c", "import sys,json,tomllib;print(json.dumps(tomllib.loads(sys.stdin.read())))"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .ok()
        .and_then(|mut c| {
            use std::io::Write;
            c.stdin.take()?.write_all(LIVE.as_bytes()).ok()?;
            c.wait_with_output().ok()
        })?;
    out.status.success().then(|| serde_json::from_slice(&out.stdout).unwrap())
}

#[test]
fn b_server_parse_equals_python_tomllib() {
    let Some(reference) = py_reference() else {
        eprintln!("python3 unavailable; skipping cross-check");
        return;
    };
    let ours = parse_to_json(LIVE).unwrap();
    assert_eq!(ours, reference, "server parse differs from python tomllib");
    // The defects the old JS parser had: inline comments must not leak into values.
    assert!(!ours.to_string().contains("true # "));
    assert!(ours["plugins"]["packages"].as_array().unwrap().len() > 3);
}

#[test]
fn c_inline_comment_survives_a_value_edit() {
    let target = LIVE
        .lines()
        .find(|l| l.starts_with("agentic_qe = false") && l.contains('#'))
        .expect("fixture line with inline comment");
    let out = apply_edits(LIVE, &[edit(&["toolchains", "agentic_qe"], json!(true))]).unwrap();
    let diff = changed_lines(LIVE, &out);
    assert_eq!(diff.len(), 1);
    assert_eq!(diff[0].0, target);
    assert_eq!(diff[0].1, target.replacen("= false", "= true", 1));
}

#[test]
fn c_string_and_number_edits_keep_trailing_comments() {
    let src = "[a]\nname = \"x\"   # keep me\nport = 80 # and me\nratio = 1.5 # float\n";
    let out = apply_edits(
        src,
        &[
            edit(&["a", "name"], json!("y")),
            edit(&["a", "port"], json!(8080)),
            edit(&["a", "ratio"], json!(2)),
        ],
    )
    .unwrap();
    assert_eq!(out, "[a]\nname = \"y\"   # keep me\nport = 8080 # and me\nratio = 2.0 # float\n");
}

#[test]
fn d_array_of_tables_survives_and_indexes_independently() {
    let before = parse_to_json(LIVE).unwrap();
    let n = before["plugins"]["packages"].as_array().unwrap().len();
    // An edit elsewhere leaves every entry untouched.
    let out = apply_edits(LIVE, &[edit(&["observability", "metrics_port"], json!(9999))]).unwrap();
    assert_eq!(parse_to_json(&out).unwrap()["plugins"]["packages"], before["plugins"]["packages"]);
    assert_eq!(changed_lines(LIVE, &out).len(), 1);

    // Editing entry 3 changes only entry 3.
    let flip = !before["plugins"]["packages"][3]["enabled"].as_bool().unwrap();
    let out = apply_edits(LIVE, &[edit(&["plugins", "packages", "3", "enabled"], json!(flip))]).unwrap();
    let after = parse_to_json(&out).unwrap();
    assert_eq!(after["plugins"]["packages"].as_array().unwrap().len(), n);
    for i in 0..n {
        if i == 3 {
            assert_eq!(after["plugins"]["packages"][i]["enabled"], json!(flip));
        } else {
            assert_eq!(after["plugins"]["packages"][i], before["plugins"]["packages"][i], "entry {i}");
        }
    }
    assert_eq!(changed_lines(LIVE, &out).len(), 1);
}

#[test]
fn edits_to_missing_keys_create_them_and_bad_edits_fail() {
    let out = apply_edits("[a]\nx = 1\n", &[edit(&["b", "c", "d"], json!("v"))]).unwrap();
    assert_eq!(parse_to_json(&out).unwrap()["b"]["c"]["d"], json!("v"));
    assert!(apply_edits("[a]\nx = 1\n", &[edit(&["a", "x"], json!("str"))]).is_err(), "type mismatch");
    assert!(apply_edits("[a]\nx = 1\n", &[edit(&["a", "x"], json!(null))]).is_err(), "null");
    assert!(apply_edits(LIVE, &[edit(&["plugins", "packages", "9999", "enabled"], json!(true))]).is_err());
    assert!(apply_edits("not = [valid", &[]).is_err());
}

#[test]
fn f_invalid_toml_is_rejected_and_write_is_atomic() {
    assert!(validate("a = [1, 2").is_err());
    assert!(validate("a = 1\na = 2").is_err(), "duplicate key");
    assert!(validate(LIVE).is_ok());

    let dir = scratch("atomic");
    let f = dir.join("agentbox.toml");
    fs::write(&f, "old = 1\n").unwrap();
    atomic_write(&f, "new = 2\n").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "new = 2\n");
    // No temp litter after success.
    let names: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 1, "{names:?}");

    // A failing write (target is a directory) leaves no temp file and no change.
    let d2 = dir.join("is-a-dir");
    fs::create_dir(&d2).unwrap();
    assert!(atomic_write(&d2, "x = 1\n").is_err());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);

    // Symlinks are followed: the link survives and the real file changes.
    #[cfg(unix)]
    {
        let real = dir.join("real.toml");
        let link = dir.join("link.toml");
        fs::write(&real, "v = 1\n").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        atomic_write(&link, "v = 2\n").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "v = 2\n");
    }
}

#[test]
fn seed_default_is_valid_and_parses() {
    let seed = include_str!("../../agentbox.default.toml");
    validate(seed).unwrap();
    parse_to_json(seed).unwrap();
}

#[test]
fn e_edited_output_passes_the_manifest_validator() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let edited = apply_edits(
        LIVE,
        &[
            edit(&["toolchains", "agentic_qe"], json!(true)),
            edit(&["observability", "metrics_port"], json!(9191)),
            edit(&["plugins", "packages", "3", "enabled"], json!(false)),
        ],
    )
    .unwrap();
    let dir = scratch("validator");
    let f = dir.join("agentbox.toml");
    fs::write(&f, edited).unwrap();
    let out = Command::new("node")
        .arg(root.join("scripts/agentbox-config-validate.js"))
        .arg(&f)
        .output();
    match out {
        Ok(o) if o.status.code() == Some(2) => eprintln!("npm deps missing; skipping validator run"),
        Ok(o) => assert!(o.status.success(), "{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)),
        Err(_) => eprintln!("node unavailable; skipping validator run"),
    }
}
