//! agentbox-mcp — a single Rust binary for agentbox's MCP surfaces.
//!
//! Three `rmcp` stdio servers replace the thin Python FastMCP servers
//! (imagemagick, web-summary, gemini-url-context); each subcommand serves
//! exactly the tools of the server it replaces, so the MCP server *names*
//! registered in `skills/mcp.json` and `mcp/mcp.json` are unchanged.
//!
//! `hub` is different: it is the shared streamable-HTTP front for stateless
//! stdio MCP servers (ADR-2034), so forty Claude Code sessions share one
//! process per server instead of spawning forty.

mod common;
mod gemini_url_context;
mod hub;
mod imagemagick;
mod web_summary;

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use rmcp::ServiceExt;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "agentbox-mcp",
    version,
    about = "Unified agentbox MCP server (imagemagick, web-summary, gemini-url-context, hub)"
)]
struct Cli {
    #[command(subcommand)]
    server: ServerCommand,
}

#[derive(Subcommand, Debug)]
enum ServerCommand {
    /// Image processing with format conversion, resizing, cropping, batch operations.
    Imagemagick,
    /// URL summarization with YouTube transcripts and topic generation.
    #[command(name = "web-summary")]
    WebSummary,
    /// URL expansion and analysis using Gemini's URL Context API.
    #[command(name = "gemini-url-context")]
    GeminiUrlContext,
    /// Shared streamable-HTTP hub for stateless stdio MCP servers (loopback only).
    Hub {
        /// Hub config written at boot by `agentbox-manifest mcp-hub-project`.
        #[arg(long, default_value = "/run/agentbox/mcp-hub.json")]
        config: PathBuf,
        /// Override the config's bind address (must be loopback).
        #[arg(long)]
        bind: Option<String>,
        /// How long to wait for the config file before giving up. The
        /// entrypoint writes it late in boot, after this program has started.
        #[arg(long, default_value_t = 600)]
        wait_config_secs: u64,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Logging MUST go to stderr: stdout is the JSON-RPC stdio transport
    // channel and any stray byte on it corrupts the protocol stream.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    match cli.server {
        ServerCommand::Imagemagick => {
            let service = imagemagick::ImageMagickServer::new()
                .serve(rmcp::transport::stdio())
                .await?;
            service.waiting().await?;
        }
        ServerCommand::WebSummary => {
            let service = web_summary::WebSummaryServer::new()
                .serve(rmcp::transport::stdio())
                .await?;
            service.waiting().await?;
        }
        ServerCommand::GeminiUrlContext => {
            let service = gemini_url_context::GeminiUrlContextServer::new()
                .serve(rmcp::transport::stdio())
                .await?;
            service.waiting().await?;
        }
        ServerCommand::Hub {
            config,
            bind,
            wait_config_secs,
        } => {
            hub::serve(
                &config,
                bind,
                std::time::Duration::from_secs(wait_config_secs),
            )
            .await?;
        }
    }

    Ok(())
}
