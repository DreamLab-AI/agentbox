//! `explainer-loom-draft` — draft explainer sections on the LAN model through
//! the Ontology Loom façade.
//!
//! Long-running, sequential and resumable, meant to run in the background
//! (nohup / tmux) so the expensive session model only orients, checks and
//! decides. A batch skips packets that already have output, so an interrupted
//! run continues where it stopped.
//!
//!   explainer-loom-draft --packet p.json [--out p.out.json]
//!   explainer-loom-draft --batch packets/ --out-dir drafts/
//!
//! The façade is the estate's stable model door. The scaffold is declined per
//! request (`loom_options.scaffold = false`, ADR-139) because a codebase is not
//! in the ontology; `loom-client` fails the call if the façade grounds it
//! anyway, rather than returning an answer about the wrong subject.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use clap::Parser;
use explainer_tools::draft::{fill_template, output_path, parse_draft, resolve_base_url};
use loom_client::{ChatRequest, LoomClient, LoomOptions, Message};
use serde_json::{json, Value};

#[derive(Parser, Debug)]
#[command(
    name = "explainer-loom-draft",
    about = "Draft explainer sections on the LAN model through the Ontology Loom façade"
)]
struct Args {
    /// A single evidence packet to draft.
    #[arg(long, conflicts_with = "batch")]
    packet: Option<PathBuf>,

    /// A directory of `*.json` packets; each is drafted in turn.
    #[arg(long)]
    batch: Option<PathBuf>,

    /// Output path for `--packet` (default: the packet with `.out.json`).
    #[arg(long)]
    out: Option<PathBuf>,

    /// Output directory for `--batch` (default: `<batch>/drafts`).
    #[arg(long)]
    out_dir: Option<PathBuf>,

    /// Façade base URL. Falls back to `EXPLAINER_MODEL_BASE`, then `LOOM_BASE_URL`.
    #[arg(long)]
    base: Option<String>,

    /// Model id, or `auto` to take whatever the façade advertises first.
    #[arg(long, default_value = "auto")]
    model: String,

    /// Starting token budget. Truncation doubles it and retries.
    #[arg(long, default_value_t = 1400)]
    max_tokens: u64,

    /// System prompt file.
    #[arg(long)]
    system: PathBuf,

    /// User prompt template file.
    #[arg(long)]
    template: PathBuf,

    /// Review an existing draft instead of writing a new one.
    #[arg(long)]
    review: Option<PathBuf>,

    /// Per-request timeout in seconds.
    #[arg(long, default_value_t = 900)]
    timeout: u64,
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let args = Args::parse();
    match run(args).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("explainer-loom-draft: {e}");
            std::process::ExitCode::from(2)
        }
    }
}

async fn run(args: Args) -> Result<std::process::ExitCode, String> {
    let base = resolve_base_url(args.base.as_deref());
    let client = LoomClient::builder(&base)
        .timeout(Duration::from_secs(args.timeout))
        .build();

    let model = if args.model == "auto" {
        client
            .first_model_id()
            .await
            .map_err(|e| format!("could not ask {base} which model it serves: {e}"))?
    } else {
        args.model.clone()
    };

    let session = Session {
        client,
        base: base.clone(),
        model: model.clone(),
        system: read(&args.system)?,
        template: read(&args.template)?,
        prior: match &args.review {
            Some(p) => Some(read_json(p)?),
            None => None,
        },
        max_tokens: args.max_tokens,
    };

    match (&args.packet, &args.batch) {
        (Some(packet), _) => {
            let out = args.out.clone().unwrap_or_else(|| output_path(packet));
            draft_one(&session, packet, &out)
                .await
                .map_err(|e| format!("{}: {e}", name(packet)))?;
            Ok(std::process::ExitCode::SUCCESS)
        }
        (None, Some(dir)) => {
            let out_dir = args.out_dir.clone().unwrap_or_else(|| dir.join("drafts"));
            std::fs::create_dir_all(&out_dir)
                .map_err(|e| format!("cannot create {}: {e}", out_dir.display()))?;

            let mut packets: Vec<PathBuf> = std::fs::read_dir(dir)
                .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "json"))
                .collect();
            packets.sort();

            let (mut done, mut failed) = (0_u32, 0_u32);
            for packet in &packets {
                let out = out_dir.join(
                    output_path(packet)
                        .file_name()
                        .unwrap_or_default(),
                );
                if out.exists() {
                    println!("{}: exists, skipped", name(packet));
                    continue;
                }
                match draft_one(&session, packet, &out).await {
                    Ok(()) => done += 1,
                    Err(e) => {
                        failed += 1;
                        eprintln!("{}: FAILED {e}", name(packet));
                    }
                }
            }
            println!("batch complete: {done} drafted, {failed} failed, model {model}");
            Ok(if failed > 0 {
                std::process::ExitCode::FAILURE
            } else {
                std::process::ExitCode::SUCCESS
            })
        }
        (None, None) => Err("usage: --packet p.json | --batch dir".to_owned()),
    }
}

/// Everything a draft needs that does not change between packets.
struct Session {
    client: LoomClient,
    base: String,
    model: String,
    system: String,
    template: String,
    prior: Option<Value>,
    max_tokens: u64,
}

async fn draft_one(s: &Session, packet_path: &Path, out_path: &Path) -> Result<(), String> {
    let (client, base, model) = (&s.client, s.base.as_str(), s.model.as_str());
    let (system, template, prior) = (s.system.as_str(), s.template.as_str(), s.prior.as_ref());
    let packet = read_json(packet_path)?;
    let user = fill_template(template, &packet, prior)
        .map_err(|leftover| format!("unresolved template field {leftover}"))?;

    let started = Instant::now();
    let answer = client
        .chat(
            ChatRequest::new(
                model,
                vec![Message::system(system), Message::user(user)],
            )
            .temperature(0.0)
            .max_tokens(s.max_tokens)
            // The subject is a codebase, which the ontology does not cover:
            // the façade must be a plain proxy for this request (ADR-139).
            .options(LoomOptions::passthrough())
            .extra("chat_template_kwargs", json!({ "enable_thinking": false })),
        )
        .await
        .map_err(|e| e.to_string())?;
    let ms = started.elapsed().as_millis();

    let result = parse_draft(&answer.content).map_err(|e| {
        // Keep the raw body: a prompt that produced unparsable output is fixed
        // by reading what it actually said, not by guessing.
        let raw = out_path.with_extension("raw.json");
        let _ = std::fs::write(
            &raw,
            serde_json::to_string_pretty(&answer.raw).unwrap_or_default(),
        );
        format!("{e}; raw response saved to {}", raw.display())
    })?;

    let receipt = json!({
        "packet": name(packet_path),
        "model": answer.model.clone().unwrap_or_else(|| model.to_owned()),
        "base": base,
        "attempt": answer.attempts,
        "max_tokens": answer.max_tokens,
        "finish_reason": answer.finish_reason,
        "prompt_tokens": answer.usage.prompt_tokens,
        "completion_tokens": answer.usage.completion_tokens,
        "ms": ms,
        "served_mode": answer.served_mode.as_str(),
        "grounding_status": answer.grounding_status,
    });

    let body = json!({ "result": result, "receipt": receipt });
    std::fs::write(
        out_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?
        ),
    )
    .map_err(|e| format!("cannot write {}: {e}", out_path.display()))?;

    println!(
        "{}: {:?}, {} claims, {} tokens, {:.1} s → {}",
        name(packet_path),
        result.status,
        result.claims.len(),
        answer
            .usage
            .completion_tokens
            .map_or_else(|| "?".to_owned(), |t| t.to_string()),
        seconds(ms),
        out_path.display()
    );
    Ok(())
}

/// Milliseconds as seconds, for the progress line. `u128` has more range than
/// `f64` has mantissa, so narrow through `u64` first — a draft taking longer
/// than 500 million years is not the precision problem here.
#[allow(clippy::cast_precision_loss)]
fn seconds(ms: u128) -> f64 {
    u64::try_from(ms).unwrap_or(u64::MAX) as f64 / 1000.0
}

fn name(p: &Path) -> String {
    p.file_name().unwrap_or_default().to_string_lossy().into_owned()
}

fn read(p: &Path) -> Result<String, String> {
    std::fs::read_to_string(p).map_err(|e| format!("cannot read {}: {e}", p.display()))
}

fn read_json(p: &Path) -> Result<Value, String> {
    serde_json::from_str(&read(p)?).map_err(|e| format!("{} is not valid JSON: {e}", p.display()))
}
