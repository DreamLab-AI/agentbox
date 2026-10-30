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
fn a_bare_calibrated_claim_config_is_refused_and_skipped_rules_stay_provisional() {
    let dir = scratch("bare");
    fs::write(dir.join("ok.json"), film(100)).unwrap();
    fs::write(dir.join("bare.json"), r#"{"calibrated":true}"#).unwrap();
    let (code, _) = lint(&dir, &["--film", "ok.json", "--config", "bare.json"]);
    assert_eq!(code, 2, "a config without schema must be refused");
    // A calibrated set whose run skipped rules (no annotations) still cannot back acceptance.
    fs::write(dir.join("data.csv"), b"clips\n").unwrap();
    let sha = |name: &str| {
        let out = Command::new("sha256sum")
            .arg(dir.join(name))
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap()[..64].to_owned()
    };
    let config_for = |extra: serde_json::Value| {
        let mut c = serde_json::json!({"schema":"prompt-lint-config/1","provenance":"estate"});
        c.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        c
    };
    // The record binds the effective config (defaults applied) it was made for.
    let honest = config_for(serde_json::json!({}));
    let bound = video_production_runtime::calibration::thresholds_digest(
        &video_production_runtime::prompt_lint::Config::from_value(honest).unwrap(),
    )
    .unwrap();
    let cal = serde_json::json!({"schema":"threshold-calibration/2","tool":"prompt-lint",
        "provenance":"estate","thresholds_sha256":bound,
        "evidence":[{"path":"data.csv","sha256":sha("data.csv")}]});
    fs::write(dir.join("cal.json"), serde_json::to_vec(&cal).unwrap()).unwrap();
    let digest = sha("cal.json");
    let claim =
        serde_json::json!({"calibrated":true,"calibration":{"path":"cal.json","sha256":digest}});
    fs::write(dir.join("good.json"), config_for(claim.clone()).to_string()).unwrap();
    // The same record cannot back loosened thresholds.
    let mut forged = config_for(claim);
    forged["thresholds"] = serde_json::json!({"max_references":99});
    fs::write(dir.join("forged.json"), forged.to_string()).unwrap();
    let (code, out) = lint(&dir, &["--film", "ok.json", "--config", "forged.json"]);
    assert_eq!(
        code, 2,
        "a record for another threshold set must be refused: {out}"
    );
    let (code, out) = lint(&dir, &["--film", "ok.json", "--config", "good.json"]);
    assert_eq!(code, 0, "{out}");
    let r: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert!(!r["skipped_rules"].as_array().unwrap().is_empty());
    assert_eq!(r["provisional"], true, "{r:#}");
    assert_eq!(r["acceptance_backing"], false);
    fs::remove_dir_all(dir).unwrap();
}
