mod common;
use common::*;
use std::process::Command;

#[test]
fn toml_string_returns_only_strings_and_fails_open() {
    let s = Scratch::new("toml-string");
    let file = s.join("manifest.toml");
    for (body, expected) in [
        (
            "[consultants.antigravity]\nmodel = 'custom-model'",
            "custom-model\n",
        ),
        ("[consultants.antigravity]\nmodel = 42", "\n"),
        ("[consultants.antigravity]\nmodel = true", "\n"),
        ("[consultants.antigravity]\nmodel = ['model']", "\n"),
        ("[other]\nmodel = 'unused'", "\n"),
        ("invalid TOML", "\n"),
    ] {
        std::fs::write(&file, body).unwrap();
        let out = run_ok(&[
            "toml-string",
            "--manifest",
            file.to_str().unwrap(),
            "--path",
            "consultants.antigravity.model",
        ]);
        assert_eq!(String::from_utf8(out.stdout).unwrap(), expected);
    }
    std::fs::remove_file(&file).unwrap();
    let out = run_ok(&[
        "toml-string",
        "--manifest",
        file.to_str().unwrap(),
        "--path",
        "consultants.antigravity.model",
    ]);
    assert_eq!(out.stdout, b"\n");
}

#[test]
fn tui_model_precedence_is_state_then_existing_then_default() {
    let s = Scratch::new("model-precedence");
    let state = s.join("state.json");
    let existing = s.join("existing.toml");
    let out = s.join("out.toml");
    for (state_text, existing_text, expected) in [
        ("{}", "[core]\nx = 1", "gemini-3.8-flash"),
        (
            "{}",
            "[consultants.antigravity]\nmodel = 'operator-model'",
            "operator-model",
        ),
        (
            r#"{"consultants.antigravity.model":"explicit-model"}"#,
            "[consultants.antigravity]\nmodel = 'operator-model'",
            "explicit-model",
        ),
    ] {
        std::fs::write(&state, state_text).unwrap();
        std::fs::write(&existing, existing_text).unwrap();
        run_ok(&[
            "tui-write",
            state.to_str().unwrap(),
            out.to_str().unwrap(),
            existing.to_str().unwrap(),
        ]);
        let result: toml::Value = std::fs::read_to_string(&out).unwrap().parse().unwrap();
        assert_eq!(
            result["consultants"]["antigravity"]["model"].as_str(),
            Some(expected)
        );
    }
}

#[test]
fn boot_model_projection_respects_environment_and_handles_missing_config() {
    let s = Scratch::new("boot-model");
    let manifest = s.join("manifest.toml");
    std::fs::write(
        &manifest,
        "[consultants.antigravity]\nmodel = 'manifest-model'\n",
    )
    .unwrap();
    // Execute only the actual projection block, never the live entrypoint.
    let source = include_str!("../../../config/entrypoint-unified.sh");
    let block = source
        .split("# Explicit environment selection wins;")
        .nth(1)
        .unwrap();
    let block = block.split("\nif [ -f \"$_MCP_PROJECTOR\"").next().unwrap();
    let script = format!("# Explicit environment selection wins;{block}\nprintf '%s' \"$AGENTBOX_ANTIGRAVITY_MODEL\"");
    for (env_value, config_exists, expected) in [
        (None, true, "manifest-model"),
        (Some(""), true, "manifest-model"),
        (Some("environment-model"), true, "environment-model"),
        (None, false, ""),
    ] {
        if !config_exists {
            std::fs::remove_file(&manifest).unwrap();
        }
        let mut cmd = Command::new("bash");
        cmd.args(["-eu", "-c", &script])
            .env("AGENTBOX_CONFIG", &manifest)
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    std::path::Path::new(BIN).parent().unwrap().display(),
                    std::env::var("PATH").unwrap()
                ),
            )
            .env_remove("AGENTBOX_ANTIGRAVITY_MODEL");
        if let Some(value) = env_value {
            cmd.env("AGENTBOX_ANTIGRAVITY_MODEL", value);
        }
        let out = cmd.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(String::from_utf8(out.stdout).unwrap(), expected);
    }
}
