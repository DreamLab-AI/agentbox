//! `nostr-pod-bridge` — agentbox's first-party Nostr relay, identity bootstrap,
//! and Solid-pod bridge.
//!
//! One binary owns the whole sovereign-identity path: it mints and provisions
//! the agent identity at boot, serves the embedded relay for the lifetime of the
//! container, and publishes the curated digests that mirror to the operator's
//! phone. It replaced the third-party `nostr-rs-relay` process, the hand-rolled
//! JS crypto in `mcp/nostr-bridge/relay-consumer.js`, and — as of the identity
//! port — `scripts/sovereign-bootstrap.py` and
//! `config/hooks/nostr-session-summary.py`.
//!
//! ## Subcommands
//!
//! | argv              | Role                                                   |
//! |-------------------|--------------------------------------------------------|
//! | *(none)*          | Daemon: bind the relay, serve WS, run the pod consumer. |
//! | `bootstrap`       | Boot phase `[2/8]`, as root: resolve or mint the agent  |
//! |                   | identity, provision the pod, write `identity.env`.      |
//! | `session-summary` | SessionEnd hook: distil the transcript via Z.AI and     |
//! |                   | publish the kind-30840. Always exits 0.                 |
//! | `summarise`       | One-shot egress for an externally curated digest        |
//! |                   | ([`SessionSummary`] JSON on stdin) → kind-30840.        |
//! | `track`           | One-shot egress for a project digest                    |
//! |                   | ([`ProjectTrackingDigest`] JSON on stdin) → kind-30841. |
//!
//! Only the subcommands that actually publish need the bridge secrets, so
//! `bootstrap` — which *creates* those secrets — resolves its own configuration
//! and never touches [`BridgeConfig`].
//!
//! Configuration is environment-driven so the agentbox launcher (which owns the
//! encrypted `nostr.key.enc`) can decrypt the agent key and hand it over without
//! this process ever touching the key-at-rest format. See
//! [`BridgeConfig::from_env`] for the variables the publishing paths read, and
//! [`bootstrap::Roots`] for the filesystem roots `bootstrap` resolves.

use std::sync::Arc;

use anyhow::{anyhow, Context};
use solid_pod_rs_nostr::Relay;
use tracing::info;
use tracing_subscriber::EnvFilter;

use nostr_pod_bridge::envmap::EnvMap;
use nostr_pod_bridge::{
    bootstrap, publish_project_tracking, publish_session_summary, serve, session_summary,
    spawn_consumer, BridgeConfig, ProjectTrackingDigest, SessionSummary,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let env = EnvMap::from_process();

    match std::env::args().nth(1).as_deref() {
        // Runs before any bridge secret exists — it is what writes them.
        Some("bootstrap") => bootstrap::run(&env),
        Some("session-summary") => run_session_summary(&env).await,
        Some("summarise") => run_summarise(&BridgeConfig::from_env(&env)?).await,
        Some("track") => run_track(&BridgeConfig::from_env(&env)?).await,
        Some(other) => Err(anyhow!(
            "unknown subcommand '{other}'; expected 'bootstrap', 'session-summary', \
             'summarise', 'track', or no argument (daemon mode)"
        )),
        None => run_daemon(BridgeConfig::from_env(&env)?).await,
    }
}

/// Read the whole of stdin, naming the subcommand in any error.
fn read_stdin(what: &str) -> anyhow::Result<String> {
    std::io::read_to_string(std::io::stdin()).with_context(|| format!("reading {what} from stdin"))
}

/// SessionEnd hook: distil the transcript and publish the digest.
///
/// Best-effort by contract — [`session_summary::run`] logs and swallows every
/// failure so a missing key or unreachable endpoint never blocks session
/// teardown, which is why this always resolves to `Ok`.
async fn run_session_summary(env: &EnvMap) -> anyhow::Result<()> {
    // A SessionEnd hook with no payload on stdin has nothing to mirror; an
    // unreadable stdin is treated the same way rather than failing the hook.
    let payload = read_stdin("the SessionEnd hook payload").unwrap_or_default();
    session_summary::run(env, &payload).await
}

/// One-shot egress: read an externally curated digest from stdin and publish the
/// kind-30840.
async fn run_summarise(cfg: &BridgeConfig) -> anyhow::Result<()> {
    let raw = read_stdin("session-summary JSON")?;
    let summary: SessionSummary =
        serde_json::from_str(&raw).context("parsing SessionSummary JSON from stdin")?;
    publish_session_summary(cfg, &summary).await
}

/// One-shot egress: read a curated project digest from stdin and publish the
/// kind-30841 (PRD-017 / ADR-035 §D3). Invoked by `project-tracking-publish.cjs`.
async fn run_track(cfg: &BridgeConfig) -> anyhow::Result<()> {
    let raw = read_stdin("project-tracking JSON")?;
    let digest: ProjectTrackingDigest =
        serde_json::from_str(&raw).context("parsing ProjectTrackingDigest JSON from stdin")?;
    publish_project_tracking(cfg, &digest).await
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
