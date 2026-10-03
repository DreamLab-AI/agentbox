//! The identity port (custody X-1 step 1, design §2.5; ADR-2122).
//!
//! Under `[security].role_isolation` the sovereign key is held by one process,
//! `nostr-pod-bridge serve-identity`, running as the identity role account.
//! Every other process asks it to sign through a unix socket and gets back a
//! signature, a header or a public key: **the sovereign secret never crosses
//! the socket.**
//!
//! - **Authorisation** is the peer uid from `SO_PEERCRED`, checked against a
//!   checked-in ACL ([`acl`]) that maps uid → named operations → keys → kinds.
//!   The socket's file mode (0660, group = the callers' group) only narrows who
//!   can connect; it is never the authorisation.
//! - **Operations** are a closed list ([`acl::OPERATIONS`]): `pubkey`, `nip98`,
//!   `sign_event`, `forum_event`, `nip42_auth`, `mirror_key`. Anything else is
//!   refused with `{"refused": {"op", "reason"}}`.
//! - **Receipts**: one JSONL line per decision ([`receipts`]).
//! - **Crypto**: signing is `nostr-bbs-core`'s `sign_event`; the mirror child is
//!   [`crate::mirror_key`]. This module adds no primitive.
//!
//! Wire: one JSON line `{"op": "<op>", "params": {...}}` in, one JSON line out,
//! then the connection closes. [`client`] is the shell-facing end.
//!
//! ## Configuration (environment only; nothing secret on argv)
//!
//! | Variable | Default |
//! |---|---|
//! | `AGENTBOX_ROLE_ISOLATION` | must be `1`, otherwise `serve-identity` exits 0 at once |
//! | `AGENTBOX_IDENTITY_ACL` | `/opt/agentbox/config/custody/identity-port-acl.json` |
//! | `AGENTBOX_IDENTITY_KEY_DIR` | `/run/secrets/ab-identity` (W1's delivery dir for the role) |
//! | `AGENTBOX_IDENTITY_SOCK` | `/run/secrets/ab-identity-port/identity.sock` (also read by the client) |
//! | `AGENTBOX_IDENTITY_SOCK_GID` | unset: the process's own gid |
//! | `AGENTBOX_IDENTITY_RECEIPT_DIR` | `/var/lib/agentbox/events/sign` |
//! | `AGENTBOX_CONFIG` | `/etc/agentbox.toml` (resolves `manifest:` ACL references) |
//! | `AGENTBOX_MIRROR_KEY_TAG` | `agentbox-mirror-v1` (server side only; a caller cannot choose it) |

pub mod acl;
pub mod client;
pub mod port;
pub mod receipts;
pub mod server;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};

use crate::envmap::EnvMap;

/// Default socket path.
/// Inside the root-owned `/run/secrets` mount: devuser owns the rest of `/run`
/// and could rename any other directory out from under the socket.
pub const DEFAULT_SOCK: &str = "/run/secrets/ab-identity-port/identity.sock";
/// Default ACL path (the checked-in file as installed in the image).
pub const DEFAULT_ACL: &str = "/opt/agentbox/config/custody/identity-port-acl.json";
/// Default key directory (the identity role's tmpfs secrets).
pub const DEFAULT_KEY_DIR: &str = "/run/secrets/ab-identity";
/// Default receipt directory.
pub const DEFAULT_RECEIPT_DIR: &str = "/var/lib/agentbox/events/sign";

/// The socket path a client should use.
pub fn socket_path(env: &EnvMap) -> PathBuf {
    PathBuf::from(env.or("AGENTBOX_IDENTITY_SOCK", DEFAULT_SOCK))
}

/// Whether `[security].role_isolation` is on, as the entrypoint exports it.
pub fn role_isolation_on(env: &EnvMap) -> bool {
    env.get("AGENTBOX_ROLE_ISOLATION").map(str::trim) == Some("1")
}

/// Build the port from the environment: ACL, keys, receipts.
pub fn port_from_env(env: &EnvMap) -> Result<port::Port> {
    let manifest_path = env.or("AGENTBOX_CONFIG", "/etc/agentbox.toml");
    let manifest = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| toml::from_str::<toml::Value>(&s).ok());
    let acl_path = PathBuf::from(env.or("AGENTBOX_IDENTITY_ACL", DEFAULT_ACL));
    let acl = acl::Acl::load(&acl_path, manifest.as_ref())?;
    for r in &acl.unresolved {
        tracing::warn!(reference = %r, "ACL manifest reference unresolved; it grants nothing");
    }
    let key_dir = PathBuf::from(env.or("AGENTBOX_IDENTITY_KEY_DIR", DEFAULT_KEY_DIR));
    let tag = env.get("AGENTBOX_MIRROR_KEY_TAG");
    let keys = port::KeyRing::load(&acl, &key_dir, tag)?;
    let receipts =
        receipts::Receipts::new(env.or("AGENTBOX_IDENTITY_RECEIPT_DIR", DEFAULT_RECEIPT_DIR))?;
    Ok(port::Port::new(acl, keys, receipts))
}

/// `serve-identity`: hold the keys and answer on the socket until SIGINT or
/// SIGTERM. With the flag off it logs one line and returns `Ok` without
/// reading any key.
pub async fn run_serve_identity(env: &EnvMap) -> Result<()> {
    if !role_isolation_on(env) {
        println!("[identity-port] role_isolation is off; serve-identity does not run. Exiting.");
        return Ok(());
    }
    let port = Arc::new(port_from_env(env)?);
    let gid = match env.non_empty("AGENTBOX_IDENTITY_SOCK_GID") {
        None => None,
        Some(g) => Some(
            g.trim()
                .parse::<u32>()
                .map_err(|_| anyhow!("AGENTBOX_IDENTITY_SOCK_GID must be a numeric gid"))?,
        ),
    };
    let bind = server::Bind {
        path: socket_path(env),
        gid,
    };
    let listener = server::bind(&bind)?;
    tracing::info!(
        socket = %bind.path.display(),
        callers = port.acl().callers.len(),
        keys = ?port.acl().keys.keys().collect::<Vec<_>>(),
        "identity port listening"
    );
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .context("installing the SIGTERM handler")?;
    let shutdown = async move {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    };
    server::serve(port, listener, shutdown).await?;
    let _ = std::fs::remove_file(&bind.path);
    Ok(())
}
