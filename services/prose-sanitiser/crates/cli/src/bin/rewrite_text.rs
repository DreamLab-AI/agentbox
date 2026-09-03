//! Layer B optional rewrite hook for statistical (token-sampling) watermarks.
//!
//! Backends: print-prompt (default; CI-safe, no model), ollama, openai-compatible.
//!
//! Env (optional): WATERMARKS_REWRITE_BACKEND, WATERMARKS_REWRITE_BASE_URL,
//! WATERMARKS_REWRITE_MODEL, WATERMARKS_REWRITE_API_KEY (env-only; never on
//! argv), WATERMARKS_REWRITE_ALLOW_REMOTE.

use std::path::Path;

use clap::Parser;
use prose_sanitiser::common::surrogate;
use prose_sanitiser::common::{
    cleaned_path, env_flag, env_nonempty, eprint_line, read_text_input, run_cli, to_pretty_json,
    write_text_output, CliError,
};
use prose_sanitiser::rewrite::{
    rewrite, Backend, MarkllmOptions, RewriteOptions, DEFAULT_MARKLLM_MODEL,
};

#[derive(Parser)]
#[command(about = "Layer B optional rewrite hook for statistical watermarks.")]
struct Args {
    /// Input text file, or - for stdin
    #[arg(default_value = "-")]
    path: String,
    /// Output path (default: stdout or *.rewritten.*)
    #[arg(short, long)]
    output: Option<String>,
    #[arg(long, value_parser = ["print-prompt", "ollama", "openai-compatible"])]
    backend: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long = "base-url")]
    base_url: Option<String>,
    /// Allow non-loopback rewrite endpoints (default: deny)
    #[arg(long = "allow-remote")]
    allow_remote: bool,
    /// OpenAI-compatible reasoning_effort; 'none' skips chain-of-thought,
    /// 'off' omits the parameter entirely
    #[arg(long = "reasoning-effort", value_parser = ["none", "low", "medium", "high", "off"])]
    reasoning_effort: Option<String>,
    // NOTE: no --api-key flag on purpose — keys on argv are visible in `ps`
    // and shell history. Set WATERMARKS_REWRITE_API_KEY instead.
    #[arg(long, value_parser = ["paraphrase", "backtranslate", "structural", "humanize", "code", "simplify", "declaudish"], default_value = "paraphrase")]
    strength: String,
    /// Pivot language for backtranslate
    #[arg(long, default_value = "French")]
    lang: String,
    #[arg(long = "original-lang", default_value = "English")]
    original_lang: String,
    #[arg(long, default_value_t = 120.0)]
    timeout: f64,
    /// Sampling temperature for the rewrite backend
    #[arg(long, default_value_t = 0.9)]
    temperature: f64,
    /// Number of rewrite candidates to generate and score
    #[arg(long, default_value_t = 1)]
    candidates: u32,
    /// Skip the Layer A scrub on model output
    #[arg(long = "no-layer-a-after")]
    no_layer_a_after: bool,
    /// Stats JSON on stderr
    #[arg(long = "json-stats")]
    json_stats: bool,
    /// Optional: run MarkLLM before/after detection around the rewrite
    #[arg(long = "markllm-scheme", value_parser = ["kgw", "synthid", "synthid-text"])]
    markllm_scheme: Option<String>,
    #[arg(long = "markllm-dir")]
    markllm_dir: Option<String>,
    #[arg(long = "markllm-model")]
    markllm_model: Option<String>,
    #[arg(long = "markllm-timeout")]
    markllm_timeout: Option<f64>,
    /// Original question the text answers (truncated to 800 chars)
    #[arg(long)]
    context: Option<String>,
    /// Skip the rewrite if prose (minus code blocks) is shorter than this
    #[arg(long = "min-chars")]
    min_chars: Option<usize>,
    /// Rewrite even when the input looks like a binary container
    #[arg(long = "force-text")]
    force_text: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();

    // Every flag falls back to its environment variable, then its default.
    let backend_name = args
        .backend
        .clone()
        .or_else(|| env_nonempty("WATERMARKS_REWRITE_BACKEND"))
        .unwrap_or_else(|| "print-prompt".to_string());
    let backend = Backend::parse(&backend_name)
        .ok_or_else(|| CliError::new(1, format!("unknown backend: {backend_name}")))?;
    let reasoning = args
        .reasoning_effort
        .clone()
        .or_else(|| env_nonempty("WATERMARKS_REWRITE_REASONING_EFFORT"))
        .unwrap_or_else(|| "none".to_string());

    let units = read_text_input(Some(&args.path), args.force_text, None)?;
    let text = String::from_utf8_lossy(&surrogate::encode(&units)).into_owned();

    let options = RewriteOptions {
        backend,
        model: args
            .model
            .clone()
            .or_else(|| env_nonempty("WATERMARKS_REWRITE_MODEL")),
        base_url: args
            .base_url
            .clone()
            .or_else(|| env_nonempty("WATERMARKS_REWRITE_BASE_URL"))
            .or_else(|| Some("http://127.0.0.1:11434".to_string())),
        api_key: env_nonempty("WATERMARKS_REWRITE_API_KEY"),
        strength: args.strength.clone(),
        lang: args.lang.clone(),
        original_lang: args.original_lang.clone(),
        timeout: args.timeout,
        layer_a_after: !args.no_layer_a_after,
        temperature: args.temperature,
        candidates: args.candidates,
        allow_remote: args.allow_remote || env_flag("WATERMARKS_REWRITE_ALLOW_REMOTE"),
        reasoning_effort: (reasoning != "off").then_some(reasoning),
        markllm: args.markllm_scheme.clone().map(|scheme| MarkllmOptions {
            scheme,
            upstream_dir: args
                .markllm_dir
                .clone()
                .or_else(|| env_nonempty("MARKLLM_DIR")),
            model: args
                .markllm_model
                .clone()
                .or_else(|| env_nonempty("MARKLLM_MODEL"))
                .unwrap_or_else(|| DEFAULT_MARKLLM_MODEL.to_string()),
            timeout: args.markllm_timeout.unwrap_or_else(|| {
                env_nonempty("WATERMARKS_MARKLLM_TIMEOUT")
                    .and_then(|raw| raw.parse().ok())
                    .unwrap_or(180.0)
            }),
        }),
        context: args.context.clone(),
        min_chars: args.min_chars.unwrap_or_else(|| {
            env_nonempty("WATERMARKS_REWRITE_MIN_CHARS")
                .and_then(|raw| raw.parse().ok())
                .unwrap_or(0)
        }),
    };

    let mut warn = |message: &str| eprint_line(message);
    let (result, info) = rewrite(&text, &options, &mut warn)?;

    let mut out = args.output.clone();
    if out.is_none() && args.path != "-" && backend != Backend::PrintPrompt {
        out = Some(
            cleaned_path(Path::new(&args.path), ".rewritten")
                .display()
                .to_string(),
        );
    } else if out.is_none() && backend == Backend::PrintPrompt {
        out = Some("-".to_string());
    }

    write_text_output(&surrogate::decode(result.as_bytes()), out.as_deref())?;

    if args.json_stats {
        eprint_line(&to_pretty_json(&info));
    } else {
        let output_chars = info
            .get("output_chars")
            .and_then(|value| value.as_u64())
            .unwrap_or(result.chars().count() as u64);
        eprint_line(&format!(
            "backend={} strength={} mode={} chars {}->{}",
            info["backend"].as_str().unwrap_or_default(),
            info["strength"].as_str().unwrap_or_default(),
            info.get("mode").and_then(|v| v.as_str()).unwrap_or("None"),
            info["input_chars"],
            output_chars
        ));
    }
    Ok(0)
}
