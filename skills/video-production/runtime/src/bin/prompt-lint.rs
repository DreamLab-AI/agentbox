//! Lint film and performance plans before any GPU spend.
//!
//! Exit status: 0 when there is no error-severity finding (a warning-only run
//! passes; an uncalibrated threshold set marks the pass `provisional`), 1 when
//! any rule of error severity fires, 2 for usage or input problems.
use serde_json::{Value, json};
use std::{ffi::OsString, fs, io::Write, path::Path, process::ExitCode};
use video_production_runtime::{
    comfy::sha256_hex,
    paths::{Root, take_root_option},
    prompt_lint::{Annotations, Config, Finding, lint_film, lint_performance, receipt},
};

type Result<T> = std::result::Result<T, String>;

const HELP: &str =
    "Usage: prompt-lint [--root DIR] [--film PLAN] [--performance PLAN [--scene SCENE_PLAN]]
                   [--config CONFIG] [--annotations FILE] [--out NEW_RECEIPT]

Static checks over film-bake/2 and performance-plan/2 inputs before GPU spend.
At least one of --film / --performance is required. Paths are relative to the
production root. The receipt (JSON) goes to --out (must not exist) or stdout.
Exit: 0 no errors, 1 error findings, 2 bad usage/input.

  --config        prompt-lint-config/1: thresholds, provenance, calibrated, rule severities
  --annotations   prompt-lint-annotations/1: cast look cards, emotion observations,
                  scene/location of segments (enables the look/emotion/continuity rules)
";

fn read_json(path: &str) -> Result<(Value, String)> {
    let bytes = fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let value = serde_json::from_slice(&bytes).map_err(|e| format!("{path}: {e}"))?;
    Ok((value, sha256_hex(&bytes)))
}

fn run() -> Result<ExitCode> {
    let mut raw: Vec<OsString> = std::env::args_os().skip(1).collect();
    if raw.iter().any(|a| a == "--help" || a == "-h") {
        print!("{HELP}");
        return Ok(ExitCode::SUCCESS);
    }
    let root = Root::new(&take_root_option(&mut raw).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut opts = std::collections::BTreeMap::new();
    let mut it = raw.into_iter();
    while let Some(flag) = it.next() {
        let flag = flag.into_string().map_err(|_| "Arguments must be UTF-8")?;
        if ![
            "--film",
            "--performance",
            "--scene",
            "--config",
            "--annotations",
            "--out",
        ]
        .contains(&flag.as_str())
        {
            return Err(format!("Unknown argument {flag}\n\n{HELP}"));
        }
        let value = it
            .next()
            .ok_or_else(|| format!("{flag} needs a value"))?
            .into_string()
            .map_err(|_| "Arguments must be UTF-8")?;
        if opts.insert(flag.clone(), value).is_some() {
            return Err(format!("{flag} given twice"));
        }
    }
    if !opts.contains_key("--film") && !opts.contains_key("--performance") {
        return Err(format!("Nothing to lint\n\n{HELP}"));
    }
    if opts.contains_key("--scene") && !opts.contains_key("--performance") {
        return Err("--scene only applies with --performance".into());
    }
    // Every remaining path is relative to the production root.
    std::env::set_current_dir(root.dir()).map_err(|e| e.to_string())?;
    let rel = |p: &str| root.rel(Path::new(p)).map_err(|e| e.to_string());

    let mut inputs = json!({});
    let mut note = |role: &str, path: &str, sha: &str| -> Result<()> {
        inputs[role] = json!({"path": rel(path)?, "sha256": sha});
        Ok(())
    };
    let config = match opts.get("--config") {
        Some(p) => {
            let (v, sha) = read_json(p)?;
            note("config", p, &sha)?;
            let c: Config = serde_json::from_value(v).map_err(|e| format!("{p}: {e}"))?;
            c.validate()?;
            c
        }
        None => Config::default(),
    };
    let annotations = match opts.get("--annotations") {
        Some(p) => {
            let (v, sha) = read_json(p)?;
            note("annotations", p, &sha)?;
            let a: Annotations = serde_json::from_value(v).map_err(|e| format!("{p}: {e}"))?;
            if a.schema != "prompt-lint-annotations/1" {
                return Err(format!("{p}: schema must be prompt-lint-annotations/1"));
            }
            Some(a)
        }
        None => None,
    };

    let mut findings: Vec<Finding> = Vec::new();
    let mut skipped = Vec::new();
    if let Some(p) = opts.get("--film") {
        let (v, sha) = read_json(p)?;
        note("film", p, &sha)?;
        let (f, s) = lint_film(&v, &root, annotations.as_ref(), &config)?;
        findings.extend(f);
        skipped.extend(s);
    }
    if let Some(p) = opts.get("--performance") {
        let (v, sha) = read_json(p)?;
        note("performance", p, &sha)?;
        let scene = match opts.get("--scene") {
            Some(s) => {
                let (sv, ssha) = read_json(s)?;
                note("scene", s, &ssha)?;
                Some(sv)
            }
            None => None,
        };
        let (f, s) = lint_performance(&v, scene.as_ref(), &root, &config)?;
        findings.extend(f);
        skipped.extend(s);
    }

    let out = receipt(&config, inputs, &findings, &skipped);
    let text = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())? + "\n";
    match opts.get("--out") {
        Some(p) => {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(p)
                .map_err(|e| format!("{p}: {e}"))?;
            file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        }
        None => print!("{text}"),
    }
    Ok(if out["errors"].as_u64() == Some(0) {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn main() -> ExitCode {
    run().unwrap_or_else(|error| {
        eprintln!("{error}");
        ExitCode::from(2)
    })
}
