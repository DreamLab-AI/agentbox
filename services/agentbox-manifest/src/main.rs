//! `agentbox-manifest` — the boot-time TOML/JSON projector.
//!
//! Before this crate, `python3` was a *boot* dependency of agentbox purely
//! because `config/entrypoint-unified.sh` reached for `tomllib` and `json`
//! seventeen times, and four more scripts did the same work at greater length.
//! Every one of those sites is a subcommand here, with identical inputs,
//! outputs, exit codes, and stdout lines — the entrypoint greps some of them.
//!
//! Python remains in the image and is unaffected: `opf-router` and the
//! code-interpreter MCP server are genuinely Python-hosted (torch, Jupyter
//! kernels) and stay supervised as they are. What changes is that boot no
//! longer *needs* an interpreter to read its own configuration.
//!
//! Conventions worth knowing before editing a subcommand:
//!
//! * Sites the shell wraps as `... && echo "  [mcp] Added x" || true` must stay
//!   silent and signal through the exit status; sites that printed from inside
//!   Python keep their `println!`.
//! * Fail-open sites (`model-routing-project`, `toml-bool`) always exit 0.
//! * Secrets travel on stdin, never argv, so they stay off the process list.

mod jsonio;
mod mcp;
mod plugins;
mod proxy;
mod routing;
mod stacks;
mod stacks_env;
mod tomlval;
mod tui_fields;
mod tui_read;
mod tui_sections;
mod tui_write;

use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use serde_json::Value;

#[derive(Parser)]
#[command(
    name = "agentbox-manifest",
    about = "Boot-time TOML/JSON projection for agentbox",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Upsert one server into `.mcp.json`. The spec JSON is read from stdin so
    /// bearer tokens and passwords never appear in the process list.
    McpSetServer {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        name: String,
    },
    /// Reconcile the `agentic-qe` entry and its env block (ADR-041 routing).
    McpReconcileAqe {
        #[arg(long)]
        file: PathBuf,
        /// Empty or omitted removes `AQE_LLM_PROVIDER` rather than blanking it.
        #[arg(long, default_value = "")]
        provider: String,
    },
    /// Append a namespace to the governed server's protected list (append-only).
    McpProtectNamespace {
        #[arg(long)]
        file: PathBuf,
        #[arg(long, default_value = "claude-flow")]
        server: String,
        #[arg(long)]
        namespace: String,
    },
    /// ADR-036 D2: de-register any ruvector-mcp outside /opt/agentbox.
    McpDeregisterFork {
        #[arg(long)]
        file: PathBuf,
    },
    /// Register a marketplace plugin in `installed_plugins.json`.
    PluginRegister {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        key: String,
        #[arg(long)]
        install_path: String,
        /// Printed only when the plugin was actually added.
        #[arg(long)]
        message: String,
        /// Freeze the `installedAt`/`lastUpdated` stamp. Test-only: without it
        /// the value is the wall clock, which no golden could pin.
        #[arg(long, hide = true)]
        now: Option<String>,
    },
    /// Emit `name<TAB>source` for enabled, validated `[[plugins.packages]]`.
    PluginList {
        #[arg(long)]
        manifest: PathBuf,
    },
    /// ADR-069: project `[interaction_plane.proxy]` into the proxy config file.
    Nip98Config {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// ADR-041: project `[model_routing]` into every `.agentic-qe/llm-config.json`.
    ModelRoutingProject {
        #[arg(long, default_value = "/etc/agentbox.toml")]
        manifest: PathBuf,
        #[arg(long)]
        workspace: Option<PathBuf>,
        #[arg(long)]
        dry_run: bool,
    },
    /// Provision the per-stack profile tree under `$WORKSPACE/profiles`.
    ProvisionStacks,
    /// `agentbox.toml` → flat TUI state JSON.
    TuiRead { config: PathBuf, state: PathBuf },
    /// Flat TUI state JSON → canonical `agentbox.toml`.
    TuiWrite {
        state: PathBuf,
        output: PathBuf,
        existing: Option<PathBuf>,
    },
    /// Print `1` or `0` for a dotted manifest path. Always exits 0.
    TomlBool {
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long)]
        path: String,
    },
    /// Print the embedding dimension of an OpenAI-shaped response on stdin.
    EmbeddingDim,
    /// Print one key from a flat TUI state document.
    StateGet { file: PathBuf, key: String },
    /// Set one key in a flat TUI state document to a string.
    StateSet {
        file: PathBuf,
        key: String,
        value: String,
    },
    /// Set one key in a flat TUI state document to a boolean.
    StateSetBool {
        file: PathBuf,
        key: String,
        value: String,
    },
}

/// Rust installs `SIG_IGN` for `SIGPIPE` at startup, which turns a closed
/// downstream pipe into a panic-with-backtrace on the next `println!` instead
/// of a quiet death. The entrypoint pipes this binary into `sed` and consumes
/// `plugin-list` through command substitution, and a backtrace in the boot log
/// would be both alarming and useless. Restoring the default makes it behave
/// like every other tool in the pipeline — the same thing CPython does by
/// raising BrokenPipeError and exiting.
fn restore_default_sigpipe() {
    const SIGPIPE: i32 = 13;
    const SIG_DFL: usize = 0;
    extern "C" {
        fn signal(signum: i32, handler: usize) -> usize;
    }
    // Safety: setting a signal disposition to the default is always valid, and
    // this runs before any thread is spawned.
    unsafe {
        signal(SIGPIPE, SIG_DFL);
    }
}

fn main() -> ExitCode {
    restore_default_sigpipe();
    match run(Cli::parse().command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cmd: Command) -> Result<(), String> {
    match cmd {
        Command::McpSetServer { file, name } => mcp::set_server(&file, &name),
        Command::McpReconcileAqe { file, provider } => {
            mcp::reconcile_aqe(&file, Some(provider.as_str()))
        }
        Command::McpProtectNamespace {
            file,
            server,
            namespace,
        } => mcp::protect_namespace(&file, &server, &namespace),
        Command::McpDeregisterFork { file } => mcp::deregister_ruvector_fork(&file),

        Command::PluginRegister {
            file,
            key,
            install_path,
            message,
            now,
        } => plugins::register(
            &file,
            &key,
            &install_path,
            &message,
            &now.unwrap_or_else(plugins::utc_now_isoformat_z),
        ),
        Command::PluginList { manifest } => {
            let cfg = tomlval::parse_file_lenient(&manifest);
            let (rows, warnings) = plugins::read_packages(&cfg);
            for w in warnings {
                eprintln!("{w}");
            }
            for r in rows {
                println!("{}\t{}", r.name, r.source);
            }
            Ok(())
        }

        Command::Nip98Config { manifest, out } => proxy::project(&manifest, &out),

        Command::ModelRoutingProject {
            manifest,
            workspace,
            dry_run,
        } => {
            let ws = workspace.unwrap_or_else(|| {
                std::env::var("WORKSPACE")
                    .unwrap_or_else(|_| "/home/devuser/workspace".into())
                    .into()
            });
            // Fail-open: a routing-projection failure must never block boot.
            routing::project(&manifest, &ws, dry_run);
            Ok(())
        }
        Command::ProvisionStacks => stacks::provision(),

        Command::TuiRead { config, state } => tui_read::run(&config, &state),
        Command::TuiWrite {
            state,
            output,
            existing,
        } => tui_write::run(&state, &output, existing.as_deref()),

        Command::TomlBool { manifest, path } => {
            let cfg = tomlval::parse_file_lenient(&manifest);
            println!("{}", u8::from(tomlval::get_bool(&cfg, &path, false)));
            Ok(())
        }
        Command::EmbeddingDim => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| format!("reading stdin: {e}"))?;
            let v: Value = serde_json::from_str(&buf).map_err(|e| format!("{e}"))?;
            let dim = v
                .get("data")
                .and_then(|d| d.get(0))
                .and_then(|d| d.get("embedding"))
                .and_then(Value::as_array)
                .map(|a| a.len())
                .ok_or_else(|| "response carries no data[0].embedding".to_string())?;
            println!("{dim}");
            Ok(())
        }

        Command::StateGet { file, key } => {
            let state = jsonio::read_opt(&file).ok_or_else(|| format!("{}", file.display()))?;
            println!("{}", state_get_repr(state.get(&key)));
            Ok(())
        }
        Command::StateSet { file, key, value } => state_write(&file, &key, Value::String(value)),
        Command::StateSetBool { file, key, value } => {
            state_write(&file, &key, Value::Bool(value.to_lowercase() == "true"))
        }
    }
}

/// The shell contract for `state_get`: empty for absent/null, lowercase
/// `true`/`false` for booleans, `str(v)` otherwise.
fn state_get_repr(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(true)) => "true".into(),
        Some(Value::Bool(false)) => "false".into(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn state_write(file: &std::path::Path, key: &str, value: Value) -> Result<(), String> {
    let mut state = jsonio::read_opt(file).ok_or_else(|| format!("{}", file.display()))?;
    state
        .as_object_mut()
        .ok_or_else(|| format!("{}: not a JSON object", file.display()))?
        .insert(key.to_string(), value);
    std::fs::write(file, jsonio::dumps(&state)).map_err(|e| format!("{}: {e}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn state_get_renders_the_shell_contract() {
        assert_eq!(state_get_repr(None), "");
        assert_eq!(state_get_repr(Some(&Value::Null)), "");
        assert_eq!(state_get_repr(Some(&json!(true))), "true");
        assert_eq!(state_get_repr(Some(&json!(false))), "false");
        assert_eq!(state_get_repr(Some(&json!("standalone"))), "standalone");
        assert_eq!(state_get_repr(Some(&json!(9091))), "9091");
    }

    #[test]
    fn cli_parses_every_subcommand_name() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
