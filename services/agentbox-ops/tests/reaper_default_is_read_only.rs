//! ADR-2032 regression guard: `ruflo-daemon-gc` must stay read-only by default.
//!
//! The Hermes stop path now shares the reaper's argv allowlist through
//! `process_identity`. Sharing code must not change what the reaper *does*:
//! without `--kill` it discovers and reports, and signals nothing.
//!
//! The binary is run with `HOME` pointed at an empty temporary directory, so
//! registry discovery finds nothing and only the read-only process sweep runs.
//! No `--kill` flag is passed anywhere in this file.

use std::process::Command;

#[test]
fn the_reaper_signals_nothing_without_an_explicit_kill_flag() {
    let home = tempfile::tempdir().expect("temp HOME");

    let out = Command::new(env!("CARGO_BIN_EXE_ruflo-daemon-gc"))
        .arg("--json")
        .env("HOME", home.path())
        .output()
        .expect("the reaper binary must run");

    assert!(
        out.status.success(),
        "default invocation must succeed: {:?}\nstderr: {}",
        out.status,
        String::from_utf8_lossy(&out.stderr)
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("--json must emit JSON: {e}\n{stdout}"));

    let killed = parsed
        .get("killed")
        .and_then(|k| k.as_array())
        .unwrap_or_else(|| panic!("the report must carry a `killed` list:\n{stdout}"));
    assert!(
        killed.is_empty(),
        "the default run must signal nothing, got {killed:?}"
    );

    // Discovery itself is unchanged: every row still reports the fields the
    // reaper's contract publishes, so a shared matcher has not altered output.
    if let Some(rows) = parsed.get("daemons").and_then(|d| d.as_array()) {
        for row in rows {
            for field in ["pid", "workspace", "source", "confirmed", "stale"] {
                assert!(
                    row.get(field).is_some(),
                    "row is missing `{field}`:\n{row}"
                );
            }
        }
    }
}
