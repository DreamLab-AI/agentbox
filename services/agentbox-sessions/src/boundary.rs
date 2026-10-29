//! Session-boundary events (ADR-043, ADR-2153 §8).
//!
//! The daemon tells management-api when a session is created, takes a turn, or
//! closes, and management-api does the identity, URN, beads and namespace
//! binding (minted in `uris.js`, never here). The payload is the one the Agent
//! of Empires status hook sent, so the receiving side is unchanged.
//!
//! Fail-open: a missing key, an unreachable API or a non-2xx answer is returned
//! to the caller to log and is never allowed to block a session.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Create,
    Turn,
    Close,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Create => "create",
            Phase::Turn => "turn",
            Phase::Close => "close",
        }
    }
}

/// Who the event is about.
pub struct Who<'a> {
    pub session_id: &'a str,
    pub slug: &'a str,
    pub tool: &'a str,
    pub project_path: &'a str,
    pub eager_mandate: bool,
}

#[derive(Debug, Clone)]
pub struct Boundary {
    base: String,
    key: String,
}

impl Boundary {
    /// `None` without `MANAGEMENT_API_KEY`, which turns binding off.
    pub fn from_env() -> Option<Self> {
        let key = std::env::var("MANAGEMENT_API_KEY").ok().filter(|k| !k.is_empty())?;
        let base = std::env::var("MANAGEMENT_API_URL").unwrap_or_else(|_| "http://127.0.0.1:9090".into());
        Some(Self { base, key })
    }

    pub fn new(base: &str, key: &str) -> Self {
        Self { base: base.into(), key: key.into() }
    }

    pub fn body(phase: Phase, who: &Who<'_>) -> Value {
        let mut b = json!({
            "phase": phase.as_str(),
            "session_id": who.session_id,
            "slug": who.slug,
            "tool": who.tool,
            "project_path": who.project_path,
        });
        let o = b.as_object_mut().unwrap();
        if who.eager_mandate {
            o.insert("eager_mandate".into(), json!(true));
        }
        match phase {
            Phase::Turn => {
                o.insert("turn_title".into(), json!(format!("turn:{}", who.slug)));
            }
            Phase::Close => {
                o.insert("outcome".into(), json!("stopped"));
            }
            Phase::Create => {}
        }
        b
    }

    pub fn emit(&self, phase: Phase, who: &Who<'_>) -> Result<()> {
        post_json(&self.base, "/v1/sessions/boundary", &self.key, &Self::body(phase, who))
    }
}

/// A minimal HTTP/1.1 POST over plain TCP. The management API is loopback-only,
/// so there is no TLS to speak of and no reason to carry an HTTP client.
fn post_json(base: &str, path: &str, bearer: &str, body: &Value) -> Result<()> {
    let hostport = base.strip_prefix("http://").ok_or_else(|| anyhow!("only http:// management URLs are supported, got {base}"))?.trim_end_matches('/');
    let addr = hostport.to_socket_addrs().with_context(|| format!("resolve {hostport}"))?.next().ok_or_else(|| anyhow!("no address for {hostport}"))?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).with_context(|| format!("connect {hostport}"))?;
    s.set_read_timeout(Some(Duration::from_secs(5)))?;
    s.set_write_timeout(Some(Duration::from_secs(5)))?;
    let payload = serde_json::to_string(body)?;
    // One buffer, one write: the headers and body must not leave as separate segments.
    let request = format!("POST {path} HTTP/1.1\r\nHost: {hostport}\r\nAuthorization: Bearer {bearer}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len());
    s.write_all(request.as_bytes())?;
    let mut resp = String::new();
    s.read_to_string(&mut resp).context("read response")?;
    let status = resp.lines().next().unwrap_or("");
    match status.split_whitespace().nth(1) {
        Some(code) if code.starts_with('2') => Ok(()),
        _ => bail!("management-api answered {status:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn who() -> Who<'static> {
        Who { session_id: "abs_codex-1", slug: "codex", tool: "codex", project_path: "/p", eager_mandate: false }
    }

    #[test]
    fn payloads_match_what_the_status_hook_sent() {
        let c = Boundary::body(Phase::Create, &who());
        assert_eq!(c["phase"], "create");
        assert_eq!(c["session_id"], "abs_codex-1");
        assert!(c.get("eager_mandate").is_none() && c.get("outcome").is_none());
        assert_eq!(Boundary::body(Phase::Turn, &who())["turn_title"], "turn:codex");
        assert_eq!(Boundary::body(Phase::Close, &who())["outcome"], "stopped");
        let mut w = who();
        w.eager_mandate = true;
        assert_eq!(Boundary::body(Phase::Create, &w)["eager_mandate"], true);
    }

    #[test]
    fn posts_with_the_bearer_and_json_body() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            // Read the whole request (the JSON body ends the stream of bytes we care about)
            // before answering, as a real server does.
            let mut got = Vec::new();
            let mut buf = [0u8; 4096];
            while !got.ends_with(b"}") {
                let n = s.read(&mut buf).unwrap();
                assert!(n > 0, "client closed before sending the body");
                got.extend_from_slice(&buf[..n]);
            }
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").unwrap();
            String::from_utf8_lossy(&got).into_owned()
        });
        Boundary::new(&format!("http://127.0.0.1:{port}"), "sekret").emit(Phase::Create, &who()).unwrap();
        let req = h.join().unwrap();
        assert!(req.starts_with("POST /v1/sessions/boundary HTTP/1.1"));
        assert!(req.contains("Authorization: Bearer sekret"));
        assert!(req.contains(r#""phase":"create""#));
    }

    #[test]
    fn a_non_2xx_and_an_unreachable_api_are_errors_for_the_caller_to_log() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut b = [0u8; 1024];
            let _ = s.read(&mut b);
            let _ = s.write_all(b"HTTP/1.1 503 Service Unavailable\r\n\r\n");
        });
        assert!(Boundary::new(&format!("http://127.0.0.1:{port}"), "k").emit(Phase::Turn, &who()).is_err());
        assert!(Boundary::new("http://127.0.0.1:1", "k").emit(Phase::Turn, &who()).is_err());
    }
}
