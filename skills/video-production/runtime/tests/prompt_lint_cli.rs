//! Exit-status and receipt contract of the `prompt-lint` binary.
use std::{fs, path::Path, process::Command};

fn lint(root: &Path, args: &[&str]) -> (i32, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_prompt-lint"))
        .arg("--root")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    (
        out.status.code().unwrap(),
        String::from_utf8(out.stdout).unwrap(),
    )
}

fn scratch(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("pl-cli-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn film(take_frames: u64) -> String {
    format!(
        r#"{{"clock":{{"rate":25}},"assets":{{}},"segments":[{{"id":"s","frames":[0,{take_frames}],
        "transition":"start","video_prompt":"x","anchor_prompt":{{}}}}]}}"#
    )
}

#[test]
fn exit_status_follows_error_findings_and_receipt_is_json() {
    let dir = scratch("exit");
    fs::write(dir.join("ok.json"), film(100)).unwrap();
    fs::write(dir.join("long.json"), film(900)).unwrap();
    let (code, out) = lint(&dir, &["--film", "ok.json"]);
    assert_eq!(code, 0);
    let r: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(r["verdict"], "PASS");
    assert_eq!(r["provisional"], true);
    assert_eq!(r["inputs"]["film"]["path"], "ok.json");
    let (code, out) = lint(&dir, &["--film", "long.json", "--out", "receipt.json"]);
    assert_eq!(code, 1, "{out}");
    let r: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("receipt.json")).unwrap()).unwrap();
    assert_eq!(r["findings"][0]["rule"], "take-over-cap");
    // The receipt is create-new: a second run refuses to overwrite it.
    assert_eq!(
        lint(&dir, &["--film", "long.json", "--out", "receipt.json"]).0,
        2
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn help_and_usage_errors() {
    let dir = scratch("help");
    let (code, out) = lint(&dir, &["--help"]);
    assert_eq!(code, 0);
    assert!(out.contains("Usage: prompt-lint"));
    assert_eq!(lint(&dir, &[]).0, 2);
    assert_eq!(lint(&dir, &["--bogus", "x"]).0, 2);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn calibration_claims_are_refused_and_the_receipt_is_editorial() {
    let dir = scratch("bare");
    fs::write(dir.join("ok.json"), film(100)).unwrap();
    fs::write(dir.join("bare.json"), r#"{"calibrated":true}"#).unwrap();
    let (code, _) = lint(&dir, &["--film", "ok.json", "--config", "bare.json"]);
    assert_eq!(code, 2, "a config without schema must be refused");
    let cfg = |extra: serde_json::Value| {
        let mut c = serde_json::json!({"schema":"prompt-lint-config/1","provenance":"estate"});
        c.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        c.to_string()
    };
    fs::write(
        dir.join("true.json"),
        cfg(serde_json::json!({"calibrated":true})),
    )
    .unwrap();
    let (code, _) = lint(&dir, &["--film", "ok.json", "--config", "true.json"]);
    assert_eq!(code, 2, "calibrated: true must be refused");
    fs::write(
        dir.join("field.json"),
        cfg(serde_json::json!({"calibration":{"path":"c.json","sha256":"ab"}})),
    )
    .unwrap();
    let (code, _) = lint(&dir, &["--film", "ok.json", "--config", "field.json"]);
    assert_eq!(code, 2, "a calibration field must be refused");
    fs::write(dir.join("good.json"), cfg(serde_json::json!({}))).unwrap();
    let (code, out) = lint(&dir, &["--film", "ok.json", "--config", "good.json"]);
    assert_eq!(code, 0, "{out}");
    let r: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(r["provisional"], true, "{r:#}");
    assert_eq!(r["acceptance_backing"], false);
    assert_eq!(r["acceptance"], "editorial");
    fs::remove_dir_all(dir).unwrap();
}
