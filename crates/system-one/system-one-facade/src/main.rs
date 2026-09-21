//! The `system-one-facade` binary.
//!
//! Reads its configuration from the environment, refuses to start if either
//! outbound URL points off the LAN, and serves the three routes until SIGTERM.
//! Logs are structured JSON on stdout so the supervisor's log pipeline can read
//! them without a parser of its own; `SSO_LOG` (or `RUST_LOG`) sets the filter.

use std::sync::Arc;

use system_one_facade::config::Config;
use system_one_facade::server::router;
use system_one_facade::service::Facade;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let filter = EnvFilter::try_from_env("SSO_LOG")
        .or_else(|_| EnvFilter::try_from_default_env())
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .with_span_list(false)
        .init();

    let cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(e) => {
            // A misconfigured façade must not start: a running façade is a
            // promise that nothing leaves the LAN.
            tracing::error!(error = %e, "refusing to start");
            return std::process::ExitCode::from(2);
        }
    };

    let bind = cfg.bind.clone();
    tracing::info!(
        bind = %bind,
        engine = %cfg.engine_url,
        embeddings = %cfg.embeddings_url,
        model = %cfg.model,
        shortlist_k = cfg.shortlist_k,
        window_k = cfg.window_k,
        auth = cfg.api_key.is_some(),
        cache = ?cfg.cache_path,
        "sovereign system one facade starting"
    );

    let facade = Arc::new(Facade::new(cfg));
    tracing::info!(
        embeddings = facade.embedder().cache().len(),
        compressed_rubrics = facade.embedder().cache().text_len(),
        "embedding cache loaded"
    );

    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, bind = %bind, "cannot bind");
            return std::process::ExitCode::from(1);
        }
    };

    let served = axum::serve(listener, router(facade)).with_graceful_shutdown(shutdown());
    if let Err(e) = served.await {
        tracing::error!(error = %e, "server stopped");
        return std::process::ExitCode::from(1);
    }
    tracing::info!("shut down cleanly");
    std::process::ExitCode::SUCCESS
}

/// Resolve on SIGTERM or Ctrl-C, so supervisord's stop is not a kill.
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(e) => tracing::warn!(error = %e, "cannot listen for SIGTERM"),
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("interrupt received"),
        _ = term => tracing::info!("SIGTERM received"),
    }
}
