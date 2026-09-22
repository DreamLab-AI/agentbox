//! Probes written by the GPT-6 Astra evidence auditor, 2026-09-22
//! (docs/proposals/sovereign-settlement-research/AUDIT-sidestr-round-0.1-gpt6-astra.md),
//! kept as regressions for the `cosign` node and the relay client. Two
//! passed at 0.1.0-pre by asserting the defect and are inverted here:
//!
//! - C6, `audit_http_unindexed_block`: `/blocks.dat` (and a `Range` into
//!   it) serves only the bytes the accepted index covers; a range beyond
//!   them is 416 while `/tip` stays at the accepted height. `POST /tx`
//!   answers 413 above [`sidestr_round::node::MAX_TX_BODY`] bytes instead
//!   of truncating.
//! - C3, `audit_wss_support`: `wss://` is served by rustls (feature
//!   `relay`); the test completes a TLS websocket handshake and one
//!   REQ/EVENT/EOSE exchange against an in-process TLS relay under a
//!   self-signed certificate generated here, with no network, and checks
//!   the default root store refuses that certificate.
//!
//! `audit_wss_public_relay_read_only_smoke` is `#[ignore]` and runs only
//! with `SIDESTR_RELAY_SMOKE` set: REQ, EOSE, CLOSE against one default
//! relay; it publishes nothing.
#![cfg(feature = "bin")]
mod support;

use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use sidestr_nostr::event::SecretKeySigner;
use sidestr_nostr::relay::{ClientMessage, Filter, PublishOutcome, RelayMessage};
use sidestr_round::node::MAX_TX_BODY;
use sidestr_round::relay::{
    default_connector, follow_with, publish_one, publish_one_with, unix_now, Connector,
    RelayStandIn,
};
use support::*;
use tokio_tungstenite::tungstenite::Message;

/// One HTTP/1.1 request on a fresh connection: the status code and the body.
fn http(port: u16, method: &str, path: &str, headers: &str, body: &[u8]) -> (u16, Vec<u8>) {
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    write!(
        s,
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}\r\n"
    )
    .unwrap();
    s.write_all(body).unwrap();
    let mut bytes = vec![];
    let _ = s.read_to_end(&mut bytes);
    let split = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    let head = String::from_utf8_lossy(&bytes[..split]).to_string();
    let code: u16 = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap();
    (code, bytes[split..].to_vec())
}
fn get(port: u16, path: &str, headers: &str) -> (u16, Vec<u8>) {
    http(port, "GET", path, headers, &[])
}

/// A scratch directory of this process, never inside the repository.
fn scratch(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("sidestr-round-audit-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

struct Kill(std::process::Child);
impl Drop for Kill {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// C6 inverted. `cosign` on a chain with only its genesis; a sealed
/// height-1 block appended directly to `blocks.dat` behind its back. The
/// HTTP surface serves the committed bytes only.
#[test]
fn audit_http_unindexed_block() {
    let root = scratch("http");
    let ks = keys(3);
    let (doc, g) = federated_doc("audithttp", &ks, 2, 0);
    let dir = root.join("chain");
    let chain = sidestr_core::chain::Chain::open_sealed(doc.clone(), &dir, |_| Ok(g)).unwrap();
    let (b, _, _) = chain
        .state()
        .build_next(&sidestr_core::state::NextBlock {
            time: 1_790_000_100,
            claims: vec![],
        })
        .unwrap();
    let sealed = seal_with(chain.state().federation().unwrap(), &b, &ks, &[0, 1]);
    drop(chain);
    std::fs::write(root.join("chain.json"), doc.to_json().unwrap()).unwrap();
    std::fs::write(root.join("key"), hex::encode(ks[0].secret_bytes())).unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let log = std::fs::File::create(root.join("node.log")).unwrap();
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_cosign"))
        .arg("--chain")
        .arg(root.join("chain.json"))
        .arg("--dir")
        .arg(&dir)
        .arg("--key-file")
        .arg(root.join("key"))
        .arg("--port")
        .arg(port.to_string())
        .args(["--interval", "3600"])
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .spawn()
        .unwrap();
    let _child = Kill(child);
    for _ in 0..200 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let dat = dir.join("blocks.dat");
    let committed = std::fs::read(&dat).unwrap();
    let offset = committed.len() as u64;
    let bytes = bitcoin::consensus::serialize(&sealed);
    std::fs::OpenOptions::new()
        .append(true)
        .open(&dat)
        .unwrap()
        .write_all(&bytes)
        .unwrap();
    assert_eq!(
        std::fs::metadata(&dat).unwrap().len(),
        offset + bytes.len() as u64
    );
    // the unindexed tail, by Range: 416, nothing served
    let (code, body) = get(
        port,
        "/blocks.dat",
        &format!(
            "Range: bytes={}-{}\r\n",
            offset,
            offset + bytes.len() as u64 - 1
        ),
    );
    assert_eq!(code, 416);
    assert!(body.is_empty());
    // a range straddling the boundary: 416 too
    let (code, _) = get(
        port,
        "/blocks.dat",
        &format!("Range: bytes={}-{}\r\n", offset - 8, offset + 8),
    );
    assert_eq!(code, 416);
    // the whole file: the committed bytes exactly, nothing after the index's last entry
    let (code, body) = get(port, "/blocks.dat", "");
    assert_eq!(code, 200);
    assert_eq!(body, committed);
    // an open-ended range: ends at the committed end
    let (code, body) = get(port, "/blocks.dat", "Range: bytes=8-\r\n");
    assert_eq!(code, 206);
    assert_eq!(body, &committed[8..]);
    let (_, tip) = get(port, "/tip", "");
    let tip = String::from_utf8(tip).unwrap();
    assert!(tip.contains("\"height\":0"), "{tip}");
    println!(
        "AUDIT HTTP unindexed sealed h1 not served: range beyond index=416, /blocks.dat={} committed bytes of {} on disk; /tip height=0",
        committed.len(),
        offset + bytes.len() as u64
    );

    // POST /tx: 413 over the cap, not a truncated read
    let big = vec![b'0'; MAX_TX_BODY + 1];
    let (code, body) = http(
        port,
        "POST",
        "/tx",
        &format!("Content-Length: {}\r\n", big.len()),
        &big,
    );
    assert_eq!(code, 413, "{}", String::from_utf8_lossy(&body));
    assert!(String::from_utf8_lossy(&body).contains("262144"));
    // at the cap it is read whole and judged as a transaction (400: not one)
    let at_cap = vec![b'0'; MAX_TX_BODY];
    let (code, _) = http(
        port,
        "POST",
        "/tx",
        &format!("Content-Length: {}\r\n", at_cap.len()),
        &at_cap,
    );
    assert_eq!(code, 400);
    println!("AUDIT POST /tx over {MAX_TX_BODY} bytes=413; at the cap=400");
}

/// A self-signed certificate for `localhost`, and the server and client
/// configurations that trust only it. rustls with the `ring` provider on
/// both sides, as the crate's default connector.
fn local_tls() -> (Arc<rustls::ServerConfig>, Connector) {
    let ck = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
    let cert = ck.cert.der().clone();
    let key = rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(
        ck.key_pair.serialize_der(),
    ));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let server = rustls::ServerConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert.clone()], key)
        .unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(cert).unwrap();
    let client = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    (Arc::new(server), Connector::Rustls(Arc::new(client)))
}

/// C3 inverted (the probe observed `URL error: TLS support not compiled
/// in`). A `wss://` handshake completes against the in-process relay
/// behind TLS; REQ is answered with EOSE, a published EVENT is echoed to
/// the subscription; and the default connector — the Mozilla root store —
/// refuses the self-signed certificate rather than trusting anything.
#[tokio::test]
async fn audit_wss_support() {
    let (server, connector) = local_tls();
    let relay = RelayStandIn::start_tls("127.0.0.1:0", server)
        .await
        .unwrap();
    let url = relay.url();
    assert!(url.starts_with("wss://localhost:"), "{url}");

    // the raw exchange: handshake, REQ, EOSE
    let (mut ws, response) = tokio_tungstenite::connect_async_tls_with_config(
        &url,
        None,
        false,
        Some(connector.clone()),
    )
    .await
    .unwrap();
    assert_eq!(response.status().as_u16(), 101);
    let req = ClientMessage::Req {
        subscription_id: "audit".into(),
        filters: vec![Filter {
            kinds: vec![23510],
            ..Filter::default()
        }],
    };
    ws.send(Message::Text(req.to_json().into())).await.unwrap();
    let eose = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(
        RelayMessage::from_json(eose.to_text().unwrap()).unwrap(),
        RelayMessage::Eose(id) if id == "audit"
    ));
    // an EVENT published over TLS by the client arrives on the subscription
    let signer = SecretKeySigner::from_bytes(&[7u8; 32]).unwrap();
    let ev = sidestr_nostr::round::sign_proposal(
        &signer,
        &sidestr_nostr::round::Proposal {
            chain_id: "sidestr:tls".into(),
            height: 1,
            block_hex: "00".into(),
        },
        unix_now(),
    )
    .unwrap();
    assert_eq!(
        publish_one_with(&url, &ev, Duration::from_secs(5), &connector).await,
        PublishOutcome::Ok
    );
    let pushed = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(
        RelayMessage::from_json(pushed.to_text().unwrap()).unwrap(),
        RelayMessage::Event { event, .. } if event == ev
    ));
    ws.send(Message::Text(
        ClientMessage::Close("audit".into()).to_json().into(),
    ))
    .await
    .unwrap();
    ws.close(None).await.unwrap();
    // the follower, as cosign uses it, over TLS
    let mut rx = follow_with(vec![url.clone()], vec![23510], 600, |_| {}, connector);
    let (from, got) = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((from, got), (url.clone(), ev.clone()));
    // the default connector does not trust a certificate outside the root store
    assert_eq!(
        publish_one(&url, &ev, Duration::from_secs(5)).await,
        PublishOutcome::Closed,
        "a self-signed certificate must be refused by the Mozilla roots"
    );
    let refused = tokio_tungstenite::connect_async_tls_with_config(
        &url,
        None,
        false,
        Some(default_connector()),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(
        refused.contains("UnknownIssuer") || refused.to_lowercase().contains("certificate"),
        "{refused}"
    );
    println!(
        "AUDIT WSS local TLS handshake=101 REQ/EOSE/EVENT exchange=ok default roots refuse self-signed={refused}"
    );
}

/// The actual subscriptions the follower sends: one REQ per kind, kind and
/// `since = now − 600` only — no `#chain` — as `relay.mjs subscribe`.
#[tokio::test]
async fn audit_subscription_filter() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let before = unix_now();
    let _rx = sidestr_round::relay::follow(
        vec![format!("ws://{addr}")],
        vec![23510, 23511, 23512, 23513, 23514],
        600,
        |_| {},
    );
    let (stream, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
    for kind in [23510, 23511, 23512, 23513, 23514] {
        let msg = ws.next().await.unwrap().unwrap();
        let text = msg.to_text().unwrap();
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(v[2]["kinds"], serde_json::json!([kind]));
        assert_eq!(v[2].as_object().unwrap().len(), 2);
        let since = v[2]["since"].as_u64().unwrap();
        assert!((before - 600..=unix_now() - 600).contains(&since));
        println!("AUDIT Rust actual subscription {text}");
    }
}

/// Read-only smoke against one public relay, only when
/// `SIDESTR_RELAY_SMOKE` is set (to `1` for `wss://nos.lol`, or to a
/// `wss://` URL): REQ for one kind-23510 event, EOSE, CLOSE. Nothing is
/// published. Ignored by default; a no-op without the variable.
#[tokio::test]
#[ignore = "network: set SIDESTR_RELAY_SMOKE=1 (or a wss:// URL) to run"]
async fn audit_wss_public_relay_read_only_smoke() {
    let Ok(v) = std::env::var("SIDESTR_RELAY_SMOKE") else {
        println!("AUDIT relay smoke skipped: SIDESTR_RELAY_SMOKE not set");
        return;
    };
    let url = if v.starts_with("wss://") {
        v
    } else {
        "wss://nos.lol".to_string()
    };
    let (mut ws, response) = tokio_tungstenite::connect_async_tls_with_config(
        &url,
        None,
        false,
        Some(default_connector()),
    )
    .await
    .unwrap();
    assert_eq!(response.status().as_u16(), 101);
    let req = ClientMessage::Req {
        subscription_id: "smoke".into(),
        filters: vec![Filter {
            kinds: vec![23510],
            limit: Some(1),
            ..Filter::default()
        }],
    };
    ws.send(Message::Text(req.to_json().into())).await.unwrap();
    let mut events = 0usize;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let msg = tokio::time::timeout_at(deadline, ws.next())
            .await
            .expect("EOSE within 20 s")
            .unwrap()
            .unwrap();
        match msg {
            Message::Text(t) => match RelayMessage::from_json(&t) {
                Ok(RelayMessage::Event { .. }) => events += 1,
                Ok(RelayMessage::Eose(id)) if id == "smoke" => break,
                Ok(RelayMessage::Closed(..)) => panic!("subscription closed by {url}: {t}"),
                _ => {}
            },
            Message::Ping(p) => ws.send(Message::Pong(p)).await.unwrap(),
            Message::Close(_) => panic!("{url} closed before EOSE"),
            _ => {}
        }
    }
    ws.send(Message::Text(
        ClientMessage::Close("smoke".into()).to_json().into(),
    ))
    .await
    .unwrap();
    ws.close(None).await.unwrap();
    println!(
        "AUDIT relay smoke {url}: handshake=101 events={events} EOSE=ok CLOSE=sent published=0"
    );
}
