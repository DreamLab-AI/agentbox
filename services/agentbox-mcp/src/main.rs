//! agentbox-mcp — a single Rust `rmcp` binary that replaces three thin
//! Python FastMCP servers (imagemagick, web-summary, gemini-url-context).
//! Each subcommand serves exactly the tools of the server it replaces, over
//! stdio, so the three MCP server *names* registered in `skills/mcp.json`
//! and `mcp/mcp.json` are unchanged.

mod common;
mod gemini_url_context;
mod imagemagick;
mod web_summary;

use clap::{Parser, Subcommand};
use rmcp::ServiceExt;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "agentbox-mcp",
    version,
    about = "Unified agentbox MCP server (imagemagick, web-summary, gemini-url-context)"
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
    let transport = rmcp::transport::stdio();

    match cli.server {
        ServerCommand::Imagemagick => {
            let service = imagemagick::ImageMagickServer::new()
                .serve(transport)
                .await?;
            service.waiting().await?;
        }
        ServerCommand::WebSummary => {
            let service = web_summary::WebSummaryServer::new()
                .serve(transport)
                .await?;
            service.waiting().await?;
        }
        ServerCommand::GeminiUrlContext => {
            let service = gemini_url_context::GeminiUrlContextServer::new()
                .serve(transport)
                .await?;
            service.waiting().await?;
        }
    }

    Ok(())
}
