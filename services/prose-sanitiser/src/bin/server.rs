//! HTTP service exposing the prose-sanitiser cleaning pipeline.

use clap::Parser;
use prose_sanitiser::common::{env_nonempty, eprint_line, run_cli, CliError};
use prose_sanitiser::server::{app, version, ServerState};

#[derive(Parser)]
#[command(about = "HTTP service exposing the prose-sanitiser cleaning pipeline.")]
struct Args {
    #[arg(long)]
    host: Option<String>,
    #[arg(long)]
    port: Option<u16>,
    /// Require this bearer token (default: none)
    #[arg(long = "api-key")]
    api_key: Option<String>,
    /// Print the version and exit
    #[arg(short = 'V', long)]
    version: bool,
}

fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(run_cli(body) as u8)
}

fn body() -> Result<i32, CliError> {
    let args = Args::parse();
    if args.version {
        println!("{}", version());
        return Ok(0);
    }

    let host = args
        .host
        .clone()
        .or_else(|| env_nonempty("WATERMARKS_SERVER_HOST"))
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let port = args.port.unwrap_or_else(|| {
        env_nonempty("WATERMARKS_SERVER_PORT")
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(8765)
    });
    let api_key = args
        .api_key
        .clone()
        .or_else(|| env_nonempty("WATERMARKS_SERVER_API_KEY"))
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());

    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        eprint_line(&format!(
            "warning: binding {host} — intended for a trusted network only"
        ));
    }
    if api_key.is_some() {
        eprint_line("API key required for requests");
    } else {
        eprint_line("warning: no API key set — only bind to loopback or a trusted network");
    }

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| CliError::new(1, format!("cannot start runtime: {error}")))?;

    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind((host.as_str(), port))
            .await
            .map_err(|error| CliError::new(1, format!("cannot bind {host}:{port}: {error}")))?;
        eprint_line(&format!(
            "prose-sanitiser service {} on http://{host}:{port}",
            version()
        ));
        let shutdown = async {
            let _ = tokio::signal::ctrl_c().await;
            eprint_line("shutting down");
        };
        axum::serve(listener, app(ServerState { api_key }))
            .with_graceful_shutdown(shutdown)
            .await
            .map_err(|error| CliError::new(1, format!("server error: {error}")))?;
        Ok(0)
    })
}
