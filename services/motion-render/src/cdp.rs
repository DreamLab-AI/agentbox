//! A small synchronous Chrome DevTools Protocol client.
//!
//! One WebSocket to the browser endpoint, flat sessions for pages. Replies are matched by id;
//! everything else is an event and is queued for the caller. The socket has a short read
//! timeout so that waiting for a reply and waiting for events share one loop, and a timed-out
//! read is never an error by itself: the command deadline decides that.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};

/// How long one command may go unanswered.
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(50);

/// The sidecar's CDP endpoint, resolved.
#[derive(Debug, Clone)]
pub struct Endpoint {
    /// Address dialled. Chrome refuses a `Host` header that is a name, so this is the IP.
    pub addr: SocketAddr,
    /// Path of the browser-level WebSocket.
    pub ws_path: String,
    /// This container's address on the network it shares with the sidecar.
    pub local_ip: IpAddr,
}

/// Resolve `host`, ask `/json/version` for the browser WebSocket, and note which local
/// address reached it.
pub fn discover(host: &str, port: u16) -> Result<Endpoint> {
    let addr = (host, port)
        .to_socket_addrs()
        .with_context(|| format!("cannot resolve the browser sidecar \"{host}\""))?
        .find(SocketAddr::is_ipv4)
        .ok_or_else(|| anyhow!("the browser sidecar \"{host}\" has no IPv4 address"))?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(8))
        .with_context(|| format!("no CDP answer from {host}:{port}"))?;
    let local_ip = s.local_addr()?.ip();
    s.set_read_timeout(Some(Duration::from_secs(8)))?;
    write!(s, "GET /json/version HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n")?;
    // Read by Content-Length: the sidecar's proxy keeps the connection open after the reply,
    // so reading to end-of-stream would wait out the timeout and then fail.
    let raw = read_http_reply(&mut s).with_context(|| format!("no CDP answer from {host}:{port}"))?;
    let text = String::from_utf8_lossy(&raw);
    let body = text.split_once("\r\n\r\n").map(|x| x.1).unwrap_or("");
    let start = body.find('{').ok_or_else(|| anyhow!("{host}:{port} did not answer /json/version with JSON"))?;
    let end = body.rfind('}').ok_or_else(|| anyhow!("{host}:{port} sent truncated JSON"))?;
    let v: Value = serde_json::from_str(&body[start..=end]).context("unreadable /json/version")?;
    let url = v["webSocketDebuggerUrl"].as_str().ok_or_else(|| anyhow!("/json/version has no webSocketDebuggerUrl"))?;
    let ws_path = url.splitn(4, '/').nth(3).map(|p| format!("/{p}")).ok_or_else(|| anyhow!("unexpected webSocketDebuggerUrl {url}"))?;
    Ok(Endpoint { addr, ws_path, local_ip })
}

/// Read one HTTP reply: the headers, then `Content-Length` bytes of body when the header is
/// present, otherwise whatever arrives before the peer closes.
fn read_http_reply(s: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut raw = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        if let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&raw[..end]).to_ascii_lowercase();
            let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok());
            if let Some(len) = len {
                if raw.len() >= end + 4 + len {
                    return Ok(raw);
                }
            }
        }
        if raw.len() > (1 << 20) {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "reply too large"));
        }
        match s.read(&mut buf)? {
            0 => return Ok(raw),
            n => raw.extend_from_slice(&buf[..n]),
        }
    }
}

/// An event from the browser: `method`, `params` and the session it came from.
#[derive(Debug, Clone)]
pub struct Event {
    /// Protocol method, for example `Page.loadEventFired`.
    pub method: String,
    /// The event's parameters.
    pub params: Value,
    /// Flat session id of the page that raised it, if any.
    pub session: Option<String>,
}

/// The connection.
pub struct Client {
    ws: WebSocket<TcpStream>,
    next_id: u64,
    events: VecDeque<Event>,
}

fn is_timeout(e: &tungstenite::Error) -> bool {
    matches!(e, tungstenite::Error::Io(io) if matches!(io.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut))
}

impl Client {
    /// Open the browser-level WebSocket.
    pub fn connect(ep: &Endpoint) -> Result<Client> {
        let stream = TcpStream::connect_timeout(&ep.addr, Duration::from_secs(8)).context("CDP websocket refused")?;
        stream.set_nodelay(true).ok();
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        // A screenshot arrives as ONE frame of base64 PNG. tungstenite's defaults (16 MiB a
        // frame, 64 MiB a message) are below a supersampled or 4K capture.
        let config = WebSocketConfig::default().max_frame_size(None).max_message_size(Some(512 << 20));
        let url = format!("ws://{}{}", ep.addr, ep.ws_path);
        let (ws, _) = tungstenite::client::client_with_config(url.as_str(), stream, Some(config))
            .map_err(|e| anyhow!("CDP websocket handshake failed: {e}"))?;
        ws.get_ref().set_read_timeout(Some(POLL))?;
        Ok(Client { ws, next_id: 1, events: VecDeque::new() })
    }

    /// Read one message if one arrives within the poll interval. Replies are returned,
    /// events are queued.
    fn read_one(&mut self) -> Result<Option<Value>> {
        let msg = match self.ws.read() {
            Ok(m) => m,
            Err(e) if is_timeout(&e) => return Ok(None),
            Err(e) => bail!("CDP connection closed: {e}"),
        };
        let text = match msg {
            Message::Text(t) => t.as_str().to_owned(),
            Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
            Message::Close(_) => bail!("CDP connection closed by the browser"),
            _ => return Ok(None),
        };
        let v: Value = serde_json::from_str(&text).context("unreadable CDP message")?;
        if v.get("id").is_some() {
            return Ok(Some(v));
        }
        if let Some(method) = v["method"].as_str() {
            self.events.push_back(Event {
                method: method.to_owned(),
                params: v["params"].clone(),
                session: v["sessionId"].as_str().map(str::to_owned),
            });
        }
        Ok(None)
    }

    /// Send a command and wait for its result.
    pub fn send(&mut self, method: &str, params: Value, session: Option<&str>) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }
        self.ws.send(Message::text(msg.to_string())).map_err(|e| anyhow!("{method}: cannot send: {e}"))?;
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        loop {
            if let Some(v) = self.read_one()? {
                if v["id"].as_u64() != Some(id) {
                    continue;
                }
                if let Some(err) = v.get("error") {
                    bail!("{method}: {}", err["message"].as_str().unwrap_or("error"));
                }
                return Ok(v["result"].clone());
            }
            if Instant::now() > deadline {
                bail!("{method}: no answer in {} s", COMMAND_TIMEOUT.as_secs());
            }
        }
    }

    /// Read for up to `wait`, queueing whatever events arrive.
    pub fn pump(&mut self, wait: Duration) -> Result<()> {
        let until = Instant::now() + wait;
        loop {
            self.read_one()?;
            if Instant::now() >= until {
                return Ok(());
            }
        }
    }

    /// Take the queued events.
    pub fn drain(&mut self) -> Vec<Event> {
        self.events.drain(..).collect()
    }

    /// Evaluate `(function)(argument)` in a page and return its value, awaiting a promise.
    pub fn evaluate(&mut self, session: &str, function: &str, arg: &Value) -> Result<Value> {
        let r = self.send(
            "Runtime.evaluate",
            json!({ "expression": format!("({function})({arg})"), "awaitPromise": true, "returnByValue": true }),
            Some(session),
        )?;
        if let Some(ex) = r.get("exceptionDetails") {
            let d = ex["exception"]["description"].as_str().or_else(|| ex["text"].as_str()).unwrap_or("exception");
            bail!("page threw: {d}");
        }
        Ok(r["result"]["value"].clone())
    }

    /// Close the socket. The browser disposes a context created with `disposeOnDetach`.
    pub fn close(&mut self) {
        let _ = self.ws.close(None);
        let _ = self.ws.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// A stand-in for Chrome's HTTP endpoint on loopback.
    fn fake_version(body: &'static str) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = l.accept() {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
            }
        });
        port
    }

    #[test]
    fn discovers_the_browser_socket_path_and_local_address() {
        let port = fake_version(r#"{"Browser":"Chrome/1","webSocketDebuggerUrl":"ws://localhost:9222/devtools/browser/abc-123"}"#);
        let ep = discover("127.0.0.1", port).unwrap();
        assert_eq!(ep.ws_path, "/devtools/browser/abc-123");
        assert_eq!(ep.addr.port(), port);
        assert!(ep.local_ip.is_loopback());
    }

    #[test]
    fn a_peer_that_keeps_the_connection_open_is_still_read() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = l.accept() {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let body = r#"{"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/keep"}"#;
                let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length:{}\r\n\r\n{}", body.len(), body);
                std::thread::sleep(Duration::from_secs(20)); // never closes within the read timeout
            }
        });
        let t0 = Instant::now();
        assert_eq!(discover("127.0.0.1", port).unwrap().ws_path, "/devtools/browser/keep");
        assert!(t0.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn a_reply_that_is_not_json_is_an_error() {
        let port = fake_version("Host header is specified and is not an IP address or localhost.");
        assert!(discover("127.0.0.1", port).is_err());
    }

    #[test]
    fn a_closed_port_is_an_error() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(discover("127.0.0.1", port).is_err());
    }
}
