//! `report-preflight` — Report Builder prerequisite check.
//!
//! Replaces `skills/report-builder/scripts/preflight.py`. Same sections, same
//! scoring, same exit codes (0 when at least half the checks pass, else 1).
//!
//! The Python-package checks shell out to `python3 -c "import <pkg>"`: the
//! thing being probed *is* a Python environment, so that subprocess is the
//! check, not an artefact of the port.

use clap::Parser;
use serde_json::Value;
use std::process::{Command, Stdio};
use std::time::Duration;

const RESET: &str = "\x1b[0m";
const GREEN: &str = "\x1b[32m";
const RED: &str = "\x1b[31m";
const YELLOW: &str = "\x1b[33m";
const BLUE: &str = "\x1b[34m";
const BOLD: &str = "\x1b[1m";

#[derive(Parser)]
#[command(
    name = "report-preflight",
    about = "Validate Report Builder prerequisites"
)]
struct Args {}

struct Scorecard {
    score: u32,
    total: u32,
}

impl Scorecard {
    fn new() -> Self {
        Self { score: 0, total: 0 }
    }

    fn budget(&mut self, n: u32) {
        self.total += n;
    }

    fn check(&mut self, label: &str, ok: bool, fix: &str) {
        let status = if ok {
            format!("{GREEN}OK{RESET}")
        } else {
            format!("{RED}MISSING{RESET}")
        };
        let boxed = format!("[{status}]");
        // Python pads the bracketed status to width 16 including ANSI codes.
        let mut line = format!("  {boxed:>16}  {label}");
        if !ok && !fix.is_empty() {
            line.push_str(&format!("  {YELLOW}→ {fix}{RESET}"));
        }
        println!("{line}");
        if ok {
            self.score += 1;
        }
    }
}

fn cmd_exists(cmd: &str) -> bool {
    which(cmd).is_some()
}

fn which(cmd: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(cmd);
        candidate.is_file().then_some(candidate)
    })
}

fn env_set(key: &str) -> bool {
    std::env::var(key)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn user_exists(username: &str) -> bool {
    Command::new("id")
        .arg(username)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Probes the Python environment the report toolchain actually runs in.
fn python_pkg(pkg: &str) -> bool {
    Command::new("python3")
        .args(["-c", &format!("import {pkg}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn python_at_least_310() -> bool {
    Command::new("python3")
        .args([
            "-c",
            "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)",
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn skill_exists(name: &str) -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
    std::path::Path::new(&home)
        .join(".claude/skills")
        .join(name)
        .is_dir()
}

/// Live call against the Gemini image endpoint.
fn check_nano_banana() -> (bool, String) {
    let key = std::env::var("GOOGLE_API_KEY")
        .ok()
        .filter(|k| !k.is_empty())
        .or_else(|| std::env::var("GOOGLE_GEMINI_API_KEY").ok())
        .unwrap_or_default();
    if key.is_empty() {
        return (false, "No API key".into());
    }
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={key}"
    );
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return (false, truncate(&e.to_string(), 60)),
    };
    let body = serde_json::json!({
        "contents": [{"parts": [{"text": "test"}]}],
        "generationConfig": {"responseModalities": ["TEXT"]}
    });
    match client
        .post(url)
        .json(&body)
        .send()
        .and_then(|r| r.json::<Value>())
    {
        Ok(v) => match v.get("error") {
            Some(e) => (
                false,
                truncate(
                    e.get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown error"),
                    60,
                ),
            ),
            None => (true, "Working".into()),
        },
        Err(e) => (false, truncate(&e.to_string(), 60)),
    }
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn main() {
    Args::parse();
    let bar = "=".repeat(60);
    println!("\n{BOLD}{BLUE}{bar}{RESET}");
    println!("{BOLD}{BLUE}  Report Builder — Preflight Check{RESET}");
    println!("{BOLD}{BLUE}{bar}{RESET}\n");

    let mut s = Scorecard::new();

    println!("{BOLD}LaTeX Toolchain (REQUIRED){RESET}");
    s.budget(5);
    s.check("pdflatex", cmd_exists("pdflatex"), "Install texlive-basic");
    s.check("biber", cmd_exists("biber"), "Install texlive-bibtexextra");
    s.check(
        "makeglossaries",
        cmd_exists("makeglossaries"),
        "Install texlive-latexextra",
    );
    s.check(
        "makeindex",
        cmd_exists("makeindex"),
        "Install texlive-basic",
    );
    let pgf = Command::new("kpsewhich")
        .arg("pgfplots.sty")
        .output()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);
    s.check(
        "pgfplots/tikz/tcolorbox",
        pgf,
        "Install texlive-pictures texlive-latexextra",
    );

    println!("\n{BOLD}Python Environment (REQUIRED){RESET}");
    s.budget(5);
    s.check("Python 3.10+", python_at_least_310(), "");
    s.check(
        "matplotlib",
        python_pkg("matplotlib"),
        "pip install matplotlib",
    );
    s.check("pandas", python_pkg("pandas"), "pip install pandas");
    s.check("numpy", python_pkg("numpy"), "pip install numpy");
    s.check("PyMuPDF (fitz)", python_pkg("fitz"), "pip install pymupdf");

    println!("\n{BOLD}Diagram Tools (OPTIONAL){RESET}");
    s.budget(2);
    s.check(
        "Mermaid CLI (mmdc)",
        cmd_exists("mmdc"),
        "npm install -g @mermaid-js/mermaid-cli",
    );
    s.check("seaborn", python_pkg("seaborn"), "pip install seaborn");

    println!("\n{BOLD}API Keys (OPTIONAL — enables enhanced features){RESET}");
    s.budget(4);
    s.check(
        "GOOGLE_API_KEY",
        env_set("GOOGLE_API_KEY") || env_set("GOOGLE_GEMINI_API_KEY"),
        "Export key for Nano Banana",
    );
    s.check(
        "PERPLEXITY_API_KEY",
        env_set("PERPLEXITY_API_KEY"),
        "Export key for web research",
    );
    s.check(
        "OPENAI_API_KEY",
        env_set("OPENAI_API_KEY"),
        "Export key for cross-LLM review",
    );
    s.check(
        "DEEPSEEK_API_KEY",
        env_set("DEEPSEEK_API_KEY"),
        "Export key for reasoner review",
    );

    println!("\n{BOLD}Nano Banana Image Generation{RESET}");
    s.budget(1);
    let (nb_ok, nb_msg) = check_nano_banana();
    s.check(
        &format!("Nano Banana API ({nb_msg})"),
        nb_ok,
        "Needs billing-enabled Gemini key",
    );

    println!("\n{BOLD}Multi-User LLM Agents (OPTIONAL){RESET}");
    s.budget(3);
    for user in ["gemini-user", "openai-user", "deepseek-user"] {
        s.check(user, user_exists(user), "Container multi-user setup");
    }

    println!("\n{BOLD}Complementary Skills{RESET}");
    s.budget(5);
    for skill in [
        "latex-documents",
        "perplexity-research",
        "ui-ux-pro-max-skill",
        "build-with-quality",
        "skill-builder",
    ] {
        s.check(skill, skill_exists(skill), "");
    }

    println!("\n{BOLD}Claude Flow / MCP{RESET}");
    s.budget(2);
    s.check(
        "claude-flow CLI",
        cmd_exists("claude-flow"),
        "npx @claude-flow/cli@latest",
    );
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
    let settings = std::path::Path::new(&home).join(".claude/settings.json");
    let has_mcp = std::fs::read_to_string(settings)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|v| {
            v.get("mcpServers")
                .map(|m| m.to_string())
                .unwrap_or_default()
                .contains("claude-flow")
        })
        .unwrap_or(false);
    s.check(
        "claude-flow MCP server",
        has_mcp,
        "claude mcp add claude-flow -- npx -y @claude-flow/cli@latest",
    );

    let pct = (100 * s.score).checked_div(s.total).unwrap_or(0) as i32;
    let colour = if pct >= 80 {
        GREEN
    } else if pct >= 50 {
        YELLOW
    } else {
        RED
    };
    println!("\n{BOLD}{colour}{bar}{RESET}");
    println!(
        "{BOLD}{colour}  Score: {}/{} ({pct}%){RESET}",
        s.score, s.total
    );
    if pct >= 80 {
        println!("{BOLD}{GREEN}  Status: READY — all core requirements met{RESET}");
    } else if pct >= 50 {
        println!("{BOLD}{YELLOW}  Status: PARTIAL — core features work, some enhancements unavailable{RESET}");
    } else {
        println!("{BOLD}{RED}  Status: NOT READY — install required dependencies{RESET}");
    }
    println!("{BOLD}{colour}{bar}{RESET}\n");

    std::process::exit(if pct >= 50 { 0 } else { 1 });
}
