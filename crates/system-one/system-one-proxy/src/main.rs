//! The `system-one-proxy` binary.
//!
//! Reads `SYSTEM_ONE_PROJECTION` (default `/run/agentbox/system-one.json`),
//! refuses to start (exit 2) without a valid, loopback-bound projection, and
//! serves until SIGTERM. Logs are JSON on stdout; `SOP_LOG` or `RUST_LOG`
//! sets the filter.

use std::sync::Arc;

use system_one_proxy::config::Watched;
use system_one_proxy::server::{router, Proxy};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let filter = EnvFilter::try_from_env("SOP_LOG")
        .or_else(|_| EnvFilter::try_from_default_env())
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .with_span_list(false)
        .init();

    let path = std::env::var("SYSTEM_ONE_PROJECTION")
        .unwrap_or_else(|_| "/run/agentbox/system-one.json".into());
    // A stub `{"enabled":false,"reason":…}` is what boot writes when the slot
    // is on but unusable (ADR-2139): exit 0 with one line, the same contract as
    // serve-identity, so supervisord shows EXITED rather than a restart loop.
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if v.get("enabled").and_then(|e| e.as_bool()) == Some(false) {
                println!(
                    "system-one-proxy: projection says enabled=false ({}); nothing to serve",
                    v.get("reason")
                        .and_then(|r| r.as_str())
                        .unwrap_or("no reason recorded")
                );
                return std::process::ExitCode::SUCCESS;
            }
        }
    }
    let watched = match Watched::load(std::path::Path::new(&path)) {
        Ok(w) => w,
        Err(e) => {
            tracing::error!(error = %e, path, "refusing to start");
            return std::process::ExitCode::from(2);
        }
    };
    let proxy = match Proxy::new(watched) {
        Ok(p) => Arc::new(p),
        Err(e) => {
            tracing::error!(error = %e, "refusing to start");
            return std::process::ExitCode::from(2);
        }
    };
    let p = proxy.projection();
    tracing::info!(bind = %p.bind, active = %p.active, model = %p.selected().model, local = p.selected().local, projected_local = ?p.projected_local, path, "system one proxy starting");

    let listener = match tokio::net::TcpListener::bind(&p.bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, bind = %p.bind, "cannot bind");
            return std::process::ExitCode::from(1);
        }
    };
    if let Err(e) = axum::serve(listener, router(proxy))
        .with_graceful_shutdown(shutdown())
        .await
    {
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
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
}
