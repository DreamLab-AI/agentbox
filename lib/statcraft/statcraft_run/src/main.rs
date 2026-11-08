//! Headless StatCraft runner for agents.
//!
//! The upstream MCP mode (`statcraft_app --mcp`) only proxies to a running desktop GUI. This
//! binary drives the same engine (`SyntaxDispatcher` over `CommandBus`) with no GUI, so an agent
//! can run SPSS-syntax statistics on a file and read exact results back as JSON.
//!
//! Usage:
//!   statcraft-run run <data.csv|.tsv|.sav|.xlsx> <script.sps | -> [--sheet NAME]
//!   statcraft-run commands      # catalogue of engine commands as JSON
//!   statcraft-run syntax-help   # SPSS syntax reference (Markdown)
//!
//! `run` prints one JSON document: `{"dataset": {...}, "results": [{"command", "line", "result"}]}`.
//! The script is `-` to read it from stdin. Exit status is non-zero on any load, parse or
//! execution error, with the error printed to stderr.

use serde_json::{json, Value};
use statcraft_core::DataSet;
use statcraft_io::{load_csv_from_path, load_excel_from_path, load_spss_from_path, CsvOptions};
use statcraft_syntax::{generate_full_syntax_reference, CommandBus, SyntaxDispatcher};
use std::io::Read;
use std::path::Path;
use std::process::ExitCode;

fn load(path: &Path, sheet: Option<&str>) -> Result<DataSet, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "sav" | "zsav" => {
            let data = load_spss_from_path(path).map_err(|e| format!("load {}: {e}", path.display()))?;
            DataSet::from_spss_data(data).map_err(|e| format!("dataset: {e}"))
        }
        "xlsx" | "xls" | "xlsm" | "ods" => {
            let table = load_excel_from_path(path, sheet).map_err(|e| format!("load {}: {e}", path.display()))?;
            DataSet::from_raw_table(table).map_err(|e| format!("dataset: {e}"))
        }
        _ => {
            let mut options = CsvOptions::default();
            if ext == "tsv" {
                options.delimiter = b'\t';
            }
            let table = load_csv_from_path(path, options).map_err(|e| format!("load {}: {e}", path.display()))?;
            DataSet::from_raw_table(table).map_err(|e| format!("dataset: {e}"))
        }
    }
}

fn run(args: &[String]) -> Result<Value, String> {
    let (data, script) = match (args.first(), args.get(1)) {
        (Some(d), Some(s)) => (d, s),
        _ => return Err("usage: statcraft-run run <data> <script.sps|-> [--sheet NAME]".into()),
    };
    let sheet = args.iter().position(|a| a == "--sheet").and_then(|i| args.get(i + 1)).map(String::as_str);
    let sps = if script == "-" {
        let mut s = String::new();
        std::io::stdin().read_to_string(&mut s).map_err(|e| format!("stdin: {e}"))?;
        s
    } else {
        std::fs::read_to_string(script).map_err(|e| format!("read {script}: {e}"))?
    };
    let mut dataset = Some(load(Path::new(data), sheet)?);
    let mut bus = CommandBus::with_defaults();
    let executed = SyntaxDispatcher::execute_batch(&sps, &mut dataset, &mut bus).map_err(|e| e.to_string())?;
    let results: Vec<Value> = executed
        .into_iter()
        .map(|(cmd, result)| json!({ "command": cmd.name, "line": cmd.line_num, "result": result }))
        .collect();
    Ok(json!({ "dataset": { "path": data }, "results": results }))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = match args.first().map(String::as_str) {
        Some("run") => run(&args[1..]).map(|v| v.to_string()),
        Some("commands") => Ok(Value::Array(CommandBus::with_defaults().list_specs()).to_string()),
        Some("syntax-help") => Ok(generate_full_syntax_reference()),
        _ => Err("usage: statcraft-run run <data> <script.sps|-> [--sheet NAME] | commands | syntax-help".into()),
    };
    match out {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("statcraft-run: {e}");
            ExitCode::FAILURE
        }
    }
}
