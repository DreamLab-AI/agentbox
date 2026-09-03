//! Shared `reqwest` client construction. `rustls-tls` only — no openssl
//! dependency, per the porting brief.

use std::sync::OnceLock;

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// A process-wide `reqwest::Client`. Each call site sets its own per-request
/// timeout (the Python originals used per-call timeouts, not a client-wide
/// one), so this client itself carries no default timeout.
pub fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("failed to build reqwest client")
    })
}
