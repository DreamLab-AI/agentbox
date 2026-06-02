//! `nostr-pod-bridge` daemon — drop-in replacement for the third-party
//! `nostr-rs-relay` process in agentbox's relay slot.
//!
//! Configuration is environment-driven so the agentbox launcher (which owns the
//! encrypted `nostr.key.enc`) can decrypt the agent key and hand it over without
//! this process ever touching the key-at-rest format.
//!
//! | Env var                              | Meaning                                   |
//! |--------------------------------------|-------------------------------------------|
//! | `AGENTBOX_RELAY_BIND`                | bind addr (default `127.0.0.1:7777`)      |
//! | `AGENTBOX_POD_ROOT`                  | pod filesystem root (required)            |
//! | `AGENTBOX_BRIDGE_RECIPIENT_PUBKEY`   | agent x-only hex pubkey (required)        |
//! | `AGENTBOX_BRIDGE_SK`                 | agent secret key, 64-char hex (required)  |
//! | `AGENTBOX_ADMIN_PUBKEY`              | admin delegator hex pubkey (required)     |
//! | `AGENTBOX_ALLOWED_PUBKEYS`           | comma-separated hex allowlist (optional)  |
//!
//! ## Subcommands
//!
//! - (none) — run the daemon: bind the relay, serve WS, run the pod-ingress
//!   consumer.
//! - `summarise` — one-shot egress: read a curated [`SessionSummary`] as JSON on
//!   stdin, sign a kind-30840, dual-write it to the pod, and publish it to the
//!   running relay for the live phone mirror. Invoked by the SessionEnd hook
//!   after the Z.AI consultant produces the digest.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Context};
use solid_pod_rs_nostr::Relay;
use tracing::info;
use tracing_subscriber::EnvFilter;

use nostr_pod_bridge::{publish_session_summary, serve, spawn_consumer, BridgeConfig, SessionSummary};

fn env_required(key: &str) -> anyhow::Result<String> {
    std::env::var(key).with_context(|| format!("missing required env var {key}"))
}

fn parse_sk(hex_str: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = hex::decode(hex_str.trim()).context("AGENTBOX_BRIDGE_SK is not valid hex")?;
    let arr: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("AGENTBOX_BRIDGE_SK must be exactly 32 bytes (64 hex chars)"))?;
    Ok(arr)
}

fn load_config() -> anyhow::Result<BridgeConfig> {
    let allowed_pubkeys = std::env::var("AGENTBOX_ALLOWED_PUBKEYS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(BridgeConfig {
        bind_addr: std::env::var("AGENTBOX_RELAY_BIND")
            .unwrap_or_else(|_| "127.0.0.1:7777".to_string()),
        pod_root: PathBuf::from(env_required("AGENTBOX_POD_ROOT")?),
        recipient_pubkey: env_required("AGENTBOX_BRIDGE_RECIPIENT_PUBKEY")?,
        recipient_sk: parse_sk(&env_required("AGENTBOX_BRIDGE_SK")?)?,
        admin_pubkey: env_required("AGENTBOX_ADMIN_PUBKEY")?,
        allowed_pubkeys,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let cfg = load_config()?;

    match std::env::args().nth(1).as_deref() {
        Some("summarise") => run_summarise(cfg).await,
        Some(other) => Err(anyhow!(
            "unknown subcommand '{other}'; expected 'summarise' or no argument (daemon mode)"
        )),
        None => run_daemon(cfg).await,
    }
}

/// One-shot egress: read a curated digest from stdin and publish the kind-30840.
async fn run_summarise(cfg: BridgeConfig) -> anyhow::Result<()> {
    let raw = std::io::read_to_string(std::io::stdin())
        .context("reading session-summary JSON from stdin")?;
    let summary: SessionSummary =
        serde_json::from_str(&raw).context("parsing SessionSummary JSON from stdin")?;
    publish_session_summary(&cfg, &summary).await?;
    Ok(())
}

/// Long-running daemon: bind the relay, serve WS, run the pod-ingress consumer.
async fn run_daemon(cfg: BridgeConfig) -> anyhow::Result<()> {
    let bind_addr = cfg.bind_addr.clone();
    info!(
        recipient = %cfg.recipient_pubkey,
        pod_root = %cfg.pod_root.display(),
        allowlist = cfg.allowed_pubkeys.len(),
        "nostr-pod-bridge starting"
    );

    // In-memory relay store: durability lives in the pod inbox written by the
    // consumer, not in the relay's own ring buffer. The relay still serves
    // NIP-01 REQ replay for the lifetime of the process.
    let relay = Arc::new(Relay::in_memory());

    let consumer = spawn_consumer(relay.clone(), cfg);

    tokio::select! {
        r = serve(relay, &bind_addr) => r?,
        _ = tokio::signal::ctrl_c() => info!("SIGINT received; shutting down"),
    }

    consumer.abort();
    Ok(())
}
