//! The unix-socket API (ADR-2153 §6).
//!
//! No TCP listener. The socket is mode 0660 in a dedicated group, and every
//! connection is authorised by the peer's uid from `SO_PEERCRED` against an
//! ACL, never by the file mode: the mode only narrows who can connect. This is
//! the identity port's pattern, so nostr-gateway keeps reaching it when
//! `[security].role_isolation` splits it onto its own uid.
//!
//! The protocol is one JSON request line, one JSON response line:
//!
//! ```text
//! {"op":"list"}                                   -> {"ok":true,"sessions":[...]}
//! {"op":"send","slug":"codex","text":"hello"}     -> {"ok":true}
//! {"op":"create","slug":"scratch","tool":"codex"} -> {"ok":true}
//! {"op":"close","slug":"scratch"}                 -> {"ok":true}
//! {"op":"reconcile","dry_run":true}               -> {"ok":true,"outcomes":[...]}
//! ```

use crate::plane::{Config, CreateReq, Plane};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::Arc;
use std::time::Duration;

/// Mode of the socket file. Authorisation is the peer uid, never this mode.
const SOCKET_MODE: u32 = 0o660;
const MAX_REQUEST: u64 = 64 * 1024;

pub fn authorised(uid: u32, acl: &[u32]) -> bool {
    acl.contains(&uid)
}

/// Bind the socket, replacing a stale one left by a previous run.
pub fn bind(cfg: &Config) -> Result<UnixListener> {
    if let Some(parent) = cfg.socket_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o755));
    }
    if cfg.socket_path.exists() {
        std::fs::remove_file(&cfg.socket_path).with_context(|| format!("remove stale {}", cfg.socket_path.display()))?;
    }
    let l = UnixListener::bind(&cfg.socket_path).with_context(|| format!("bind {}", cfg.socket_path.display()))?;
    if let Some(gid) = cfg.socket_gid {
        std::os::unix::fs::chown(&cfg.socket_path, None, Some(gid)).with_context(|| format!("chgrp {gid} {}", cfg.socket_path.display()))?;
    }
    std::fs::set_permissions(&cfg.socket_path, std::fs::Permissions::from_mode(SOCKET_MODE)).context("chmod socket")?;
    Ok(l)
}

pub fn serve(plane: Arc<Plane>, listener: UnixListener) {
    for conn in listener.incoming() {
        let Ok(stream) = conn else { continue };
        let plane = Arc::clone(&plane);
        std::thread::spawn(move || {
            let _ = handle(&plane, stream);
        });
    }
}

fn reply(stream: &mut UnixStream, v: &Value) -> std::io::Result<()> {
    writeln!(stream, "{v}")
}

fn handle(plane: &Plane, mut stream: UnixStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(60)))?;
    let uid = match rustix::net::sockopt::socket_peercred(&stream) {
        Ok(c) => c.uid.as_raw(),
        Err(_) => return reply(&mut stream, &json!({"ok": false, "error": "peer credentials unavailable"})),
    };
    if !authorised(uid, &plane.cfg.acl_uids) {
        return reply(&mut stream, &json!({"ok": false, "error": format!("uid {uid} is not authorised")}));
    }
    let mut line = String::new();
    BufReader::new((&stream).take(MAX_REQUEST)).read_line(&mut line)?;
    reply(&mut stream, &dispatch(plane, line.trim()))
}

/// Answer one request line. Separate from the socket so it can be tested directly.
pub fn dispatch(plane: &Plane, line: &str) -> Value {
    let req: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return json!({"ok": false, "error": format!("bad request: {e}")}),
    };
    let s = |k: &str| req[k].as_str().unwrap_or("");
    let res: Result<Value> = (|| match s("op") {
        "list" | "status" => Ok(json!({"sessions": plane.status()?})),
        "send" => plane.send(s("slug"), s("text")).map(|_| json!({})),
        "mark" => plane.mark(s("slug"), s("state")).map(|_| json!({})),
        "create" => {
            let r: CreateReq = serde_json::from_value(req.clone())?;
            plane.create(&r).map(|_| json!({}))
        }
        "close" => plane.close(s("slug")).map(|_| json!({})),
        "reconcile" => Ok(json!({"outcomes": plane.reconcile_once(req["dry_run"].as_bool().unwrap_or(false))})),
        other => anyhow::bail!("unknown op {other:?}"),
    })();
    match res {
        Ok(mut v) => {
            v["ok"] = json!(true);
            v
        }
        Err(e) => json!({"ok": false, "error": format!("{e:#}")}),
    }
}

/// Send one request to a running daemon and return its answer.
pub fn call(socket: &std::path::Path, request: &str) -> Result<String> {
    let mut s = UnixStream::connect(socket).with_context(|| format!("connect {}", socket.display()))?;
    s.set_read_timeout(Some(Duration::from_secs(120)))?;
    writeln!(s, "{}", request.trim())?;
    let mut out = String::new();
    BufReader::new(s).read_line(&mut out)?;
    Ok(out.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_acl_decides_not_the_mode() {
        assert!(authorised(1000, &[1000, 961]));
        assert!(authorised(961, &[1000, 961]));
        assert!(!authorised(0, &[1000, 961]), "even root is refused unless listed");
        assert!(!authorised(1000, &[]));
    }
}
