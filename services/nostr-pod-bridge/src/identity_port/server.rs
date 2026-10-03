//! The unix-socket listener: bind with the right modes, read one line per
//! connection, authorise by `SO_PEERCRED`, answer one line.

use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use super::port::{Peer, Port, Refused, MAX_REQUEST_BYTES};

/// Mode of the socket file. Authorisation is the peer uid, never this mode;
/// the mode only keeps accounts outside the socket's group from connecting.
pub const SOCKET_MODE: u32 = 0o660;
/// How long a peer has to send its request line.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Where and how to bind.
#[derive(Debug, Clone)]
pub struct Bind {
    /// Socket path.
    pub path: PathBuf,
    /// Group the socket is chowned to (the authorised callers' group).
    pub gid: Option<u32>,
}

/// Bind the socket.
///
/// Refuses when the parent directory is writable by others without the sticky
/// bit (anyone could swap the socket), or is owned by neither root nor this
/// process. A stale socket left by a previous run is replaced; any other file
/// at the path is an error.
pub fn bind(b: &Bind) -> Result<UnixListener> {
    let parent = b
        .path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let pm = std::fs::metadata(parent)
        .with_context(|| format!("socket directory {}", parent.display()))?;
    let mode = pm.mode();
    if mode & 0o002 != 0 && mode & 0o1000 == 0 {
        bail!(
            "socket directory {} is world-writable without the sticky bit",
            parent.display()
        );
    }
    match std::fs::symlink_metadata(&b.path) {
        Ok(m) if m.file_type().is_socket() => std::fs::remove_file(&b.path)
            .with_context(|| format!("removing stale socket {}", b.path.display()))?,
        Ok(_) => bail!("{} exists and is not a socket", b.path.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e).with_context(|| format!("stat {}", b.path.display())),
    }
    let listener =
        UnixListener::bind(&b.path).with_context(|| format!("binding {}", b.path.display()))?;
    let sm = std::fs::metadata(&b.path)?;
    if pm.uid() != 0 && pm.uid() != sm.uid() {
        let _ = std::fs::remove_file(&b.path);
        bail!(
            "socket directory {} is owned by uid {}, neither root nor this process",
            parent.display(),
            pm.uid()
        );
    }
    if let Some(gid) = b.gid {
        std::os::unix::fs::chown(&b.path, None, Some(gid))
            .with_context(|| format!("chgrp {} {}", gid, b.path.display()))?;
    }
    std::fs::set_permissions(&b.path, std::fs::Permissions::from_mode(SOCKET_MODE))
        .with_context(|| format!("chmod {:o} {}", SOCKET_MODE, b.path.display()))?;
    Ok(listener)
}

/// Accept connections until `shutdown` resolves.
pub async fn serve(
    port: Arc<Port>,
    listener: UnixListener,
    shutdown: impl std::future::Future<Output = ()>,
) -> Result<()> {
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = match accepted {
                    Ok(s) => s,
                    Err(e) => { tracing::warn!(error = %e, "accept failed"); continue; }
                };
                let port = port.clone();
                tokio::spawn(async move {
                    if let Err(e) = connection(&port, stream).await {
                        tracing::debug!(error = %e, "identity-port connection ended with an error");
                    }
                });
            }
            _ = &mut shutdown => return Ok(()),
        }
    }
}

async fn connection(port: &Port, mut stream: UnixStream) -> Result<()> {
    // No credentials, no answer beyond a refusal: authorisation has no input.
    let peer = match stream.peer_cred() {
        Ok(c) => Peer {
            uid: c.uid(),
            gid: c.gid(),
            pid: c.pid(),
        },
        Err(e) => {
            let r = Refused {
                op: "?".into(),
                reason: "peer credentials unavailable".into(),
            };
            stream
                .write_all(format!("{}\n", r.to_json()).as_bytes())
                .await?;
            return Err(e.into());
        }
    };
    let (rd, mut wr) = stream.split();
    let mut reader = BufReader::new(rd.take(MAX_REQUEST_BYTES as u64 + 1));
    let mut buf = Vec::new();
    let read = tokio::time::timeout(READ_TIMEOUT, reader.read_until(b'\n', &mut buf)).await;
    let line = match read {
        Ok(Ok(_)) => String::from_utf8(buf).unwrap_or_default(),
        Ok(Err(e)) => return Err(e.into()),
        Err(_) => String::new(),
    };
    let line = if line.len() > MAX_REQUEST_BYTES {
        "x".repeat(MAX_REQUEST_BYTES + 1)
    } else {
        line
    };
    let response = port.handle(peer, &line);
    let mut out = serde_json::to_vec(&response)?;
    out.push(b'\n');
    wr.write_all(&out).await?;
    wr.shutdown().await?;
    Ok(())
}
