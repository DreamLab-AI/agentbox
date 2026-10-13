//! `target-gc` must stay read-only unless `--delete` is passed.
//!
//! The binary is pointed at a temporary root holding one idle Cargo target
//! directory. A run without `--delete` must report it and leave it in place; a run
//! with `--delete` must remove it. The threshold is zero days so age cannot hide
//! a regression, and the manifest is an empty file so no host policy leaks in.

use std::fs;
use std::process::Command;

fn run(root: &std::path::Path, manifest: &std::path::Path, extra: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_target-gc"))
        .arg("--manifest")
        .arg(manifest)
        .arg("--root")
        .arg(root)
        .args(["--max-age-days", "0", "--json"])
        .args(extra)
        .output()
        .expect("target-gc must run")
}

#[test]
fn nothing_is_removed_without_the_delete_flag() {
    let tmp = tempfile::tempdir().expect("temp root");
    let target = tmp.path().join("proj/target");
    fs::create_dir_all(target.join("debug/.fingerprint")).unwrap();
    fs::write(
        target.join("CACHEDIR.TAG"),
        "Signature: 8a477f597d28d172789f06886806bc55\n",
    )
    .unwrap();
    let manifest = tmp.path().join("agentbox.toml");
    fs::write(&manifest, "").unwrap();

    let report = run(tmp.path(), &manifest, &[]);
    assert!(report.status.success(), "{}", String::from_utf8_lossy(&report.stderr));
    assert!(target.exists(), "a default run must not delete");
    let parsed: serde_json::Value = serde_json::from_slice(&report.stdout).expect("--json emits JSON");
    assert_eq!(parsed["entries"][0]["verdict"], "delete");
    assert_eq!(parsed["entries"][0]["removed"], false);
    assert_eq!(parsed["reclaimed_bytes"], 0);

    let done = run(tmp.path(), &manifest, &["--delete"]);
    assert!(done.status.success(), "{}", String::from_utf8_lossy(&done.stderr));
    assert!(!target.exists(), "--delete removes an idle target");
    assert!(tmp.path().join("proj").exists(), "only the target is removed");
}
