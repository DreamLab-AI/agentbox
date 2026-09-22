//! The relay I/O (feature `relay`): a tokio + tokio-tungstenite client
//! that follows relays with reconnection and publishes to them, and an
//! in-process NIP-01 relay stand-in for tests and one-box runs. The rules
//! — filters, the on-receipt checks, what a publish outcome means — are
//! `sidestr-nostr`'s ([`sidestr_nostr::relay`]); this module is only the
//! sockets, so the state machines stay free of them.
//!
//! # TLS
//!
//! `wss://` is served by rustls with the `ring` provider and the Mozilla
//! root store (`webpki-roots`), built once by [`default_connector`] — the
//! provider is named explicitly, so a downstream crate that also enables
//! `aws-lc-rs` cannot make the follower panic on an ambiguous default.
//! [`follow_with`] and [`publish_one_with`] take another
//! [`Connector`] (a private root, a test certificate); [`follow`] and
//! [`publish_one`] use the default. No `native-tls`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use sidestr_nostr::event::Event;
use sidestr_nostr::relay::{ClientMessage, Filter, PublishOutcome, RelayMessage};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message;
pub use tokio_tungstenite::Connector;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

/// Seconds since the epoch.
pub fn unix_now() -> u64 {
    unix_now_ms() / 1000
}

/// Milliseconds since the epoch: the rounds' clock.
pub fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// The TLS client configuration `wss://` uses: rustls, the `ring`
/// provider, TLS 1.2 and 1.3, the Mozilla root store, no client
/// certificate. Built once per process: the root store is some hundred
/// certificates, and a signer publishes on a fresh connection every time.
pub fn default_tls_config() -> Arc<rustls::ClientConfig> {
    static CONFIG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let mut roots = rustls::RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            Arc::new(
                rustls::ClientConfig::builder_with_provider(Arc::new(
                    rustls::crypto::ring::default_provider(),
                ))
                .with_safe_default_protocol_versions()
                .expect("ring supports TLS 1.2 and 1.3")
                .with_root_certificates(roots)
                .with_no_client_auth(),
            )
        })
        .clone()
}

/// [`Connector::Rustls`] over [`default_tls_config`]: what `ws://` and
/// `wss://` URLs are opened with unless a caller says otherwise.
pub fn default_connector() -> Connector {
    Connector::Rustls(default_tls_config())
}

/// One websocket connection to `url`, plain or TLS by its scheme. The
/// error is boxed: tungstenite's is large and this is the cold path.
async fn connect(
    url: &str,
    connector: &Connector,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, Box<tokio_tungstenite::tungstenite::Error>>
{
    tokio_tungstenite::connect_async_tls_with_config(url, None, false, Some(connector.clone()))
        .await
        .map(|(ws, _)| ws)
        .map_err(Box::new)
}

/// Follow `relays` for these kinds since `since_secs` ago (`relay.mjs
/// subscribe`): one `REQ` per kind, by kind only (relays refuse `#chain`),
/// reconnecting with backoff from 1 s to 60 s. Every `EVENT` a relay sends
/// arrives on the channel unverified, tagged with the relay's URL; the
/// chain tag, the signature and duplicates are the consumer's business
/// ([`sidestr_nostr::relay::Follower`], which the rounds apply).
pub fn follow(
    relays: Vec<String>,
    kinds: Vec<u32>,
    since_secs: u64,
    log: impl Fn(String) + Send + Sync + 'static,
) -> mpsc::Receiver<(String, Event)> {
    follow_with(relays, kinds, since_secs, log, default_connector())
}

/// [`follow`] with the TLS connector given.
pub fn follow_with(
    relays: Vec<String>,
    kinds: Vec<u32>,
    since_secs: u64,
    log: impl Fn(String) + Send + Sync + 'static,
    connector: Connector,
) -> mpsc::Receiver<(String, Event)> {
    let (tx, rx) = mpsc::channel(1024);
    let log = Arc::new(log);
    for url in relays {
        let tx = tx.clone();
        let kinds = kinds.clone();
        let log = log.clone();
        let connector = connector.clone();
        tokio::spawn(async move {
            let mut backoff = 1u64;
            loop {
                match connect(&url, &connector).await {
                    Ok(mut ws) => {
                        backoff = 1;
                        let now = unix_now();
                        for k in &kinds {
                            let req = ClientMessage::Req {
                                subscription_id: format!("k{k}"),
                                filters: vec![sidestr_nostr::relay::follow_filter(
                                    *k, since_secs, now,
                                )],
                            };
                            if ws.send(Message::Text(req.to_json().into())).await.is_err() {
                                break;
                            }
                        }
                        log(format!("relay {url}: following kinds {kinds:?}"));
                        while let Some(msg) = ws.next().await {
                            let text = match msg {
                                Ok(Message::Text(t)) => t.to_string(),
                                Ok(Message::Ping(p)) => {
                                    let _ = ws.send(Message::Pong(p)).await;
                                    continue;
                                }
                                Ok(Message::Close(_)) | Err(_) => break,
                                _ => continue,
                            };
                            if let Ok(RelayMessage::Event { event, .. }) =
                                RelayMessage::from_json(&text)
                            {
                                if tx.send((url.clone(), event)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        log(format!("relay {url}: closed, reconnecting"));
                    }
                    Err(e) => log(format!("relay {url}: {e}")),
                }
                tokio::time::sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(60);
            }
        });
    }
    rx
}

/// Publish one event to one relay and report what it said (`relay.mjs
/// publish`): a fresh connection, `["EVENT", …]`, the `OK` for this id
/// within `timeout`.
pub async fn publish_one(url: &str, event: &Event, timeout: Duration) -> PublishOutcome {
    publish_one_with(url, event, timeout, &default_connector()).await
}

/// [`publish_one`] with the TLS connector given.
pub async fn publish_one_with(
    url: &str,
    event: &Event,
    timeout: Duration,
    connector: &Connector,
) -> PublishOutcome {
    let attempt = async {
        let mut ws = match connect(url, connector).await {
            Ok(x) => x,
            Err(_) => return PublishOutcome::Closed,
        };
        if ws
            .send(Message::Text(
                ClientMessage::Event(event.clone()).to_json().into(),
            ))
            .await
            .is_err()
        {
            return PublishOutcome::Closed;
        }
        while let Some(msg) = ws.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    if let Ok(RelayMessage::Ok {
                        event_id,
                        accepted,
                        message,
                    }) = RelayMessage::from_json(&t)
                    {
                        if event_id == event.id {
                            let _ = ws.close(None).await;
                            return PublishOutcome::from_ok(accepted, &message);
                        }
                    }
                }
                Ok(Message::Ping(p)) => {
                    let _ = ws.send(Message::Pong(p)).await;
                }
                Ok(Message::Close(_)) | Err(_) => return PublishOutcome::Closed,
                _ => {}
            }
        }
        PublishOutcome::Closed
    };
    match tokio::time::timeout(timeout, attempt).await {
        Ok(o) => o,
        Err(_) => PublishOutcome::Timeout,
    }
}

/// Publish to every relay at once; each one's verdict, in order. Upstream's
/// timeout is 8 s.
pub async fn publish_all(
    relays: &[String],
    event: &Event,
    timeout: Duration,
) -> Vec<(String, PublishOutcome)> {
    let mut out = Vec::with_capacity(relays.len());
    let results =
        futures_util::future::join_all(relays.iter().map(|r| publish_one(r, event, timeout))).await;
    for (r, o) in relays.iter().zip(results) {
        out.push((r.clone(), o));
    }
    out
}

/// How many said `ok`.
pub fn ok_count(results: &[(String, PublishOutcome)]) -> usize {
    results
        .iter()
        .filter(|(_, o)| *o == PublishOutcome::Ok)
        .count()
}

// --- the stand-in ------------------------------------------------------------------

fn matches(f: &Filter, ev: &Event) -> bool {
    (f.kinds.is_empty() || f.kinds.contains(&ev.kind))
        && (f.authors.is_empty() || f.authors.iter().any(|a| ev.pubkey.eq_ignore_ascii_case(a)))
        && (f.d.is_empty()
            || ev
                .tags
                .iter()
                .any(|t| t.len() > 1 && t[0] == "d" && f.d.contains(&t[1])))
        && (f.t.is_empty()
            || ev
                .tags
                .iter()
                .any(|t| t.len() > 1 && t[0] == "t" && f.t.contains(&t[1])))
        && f.since.is_none_or(|s| ev.created_at >= s)
}

/// A NIP-01 relay in a process: `REQ` / `EVENT` / `CLOSE` in, `EVENT` /
/// `EOSE` / `OK` / `CLOSED` out, events kept in memory and verified on
/// arrival, plain or behind TLS ([`RelayStandIn::start_tls`]). Enough for
/// three signers on one box and for the interop tests; **not a relay** —
/// no persistence, no limits, no auth, one process.
#[derive(Debug)]
pub struct RelayStandIn {
    addr: SocketAddr,
    tls: bool,
    events: Arc<Mutex<Vec<Event>>>,
    _live: broadcast::Sender<Event>,
}

impl RelayStandIn {
    /// Listen on `bind` (`127.0.0.1:0` for any free port) and serve until
    /// dropped.
    pub async fn start(bind: &str) -> std::io::Result<Self> {
        Self::start_with(bind, None).await
    }

    /// [`RelayStandIn::start`] behind TLS with this server configuration
    /// (a certificate for the name the client will dial), so a `wss://`
    /// client can be tested without a network.
    pub async fn start_tls(bind: &str, tls: Arc<rustls::ServerConfig>) -> std::io::Result<Self> {
        Self::start_with(bind, Some(tls)).await
    }

    async fn start_with(
        bind: &str,
        tls: Option<Arc<rustls::ServerConfig>>,
    ) -> std::io::Result<Self> {
        let listener = TcpListener::bind(bind).await?;
        let addr = listener.local_addr()?;
        let events: Arc<Mutex<Vec<Event>>> = Arc::new(Mutex::new(Vec::new()));
        let (live, _) = broadcast::channel::<Event>(4096);
        let store = events.clone();
        let sender = live.clone();
        let acceptor = tls.clone().map(tokio_rustls::TlsAcceptor::from);
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let (store, sender) = (store.clone(), sender.clone());
                match acceptor.clone() {
                    None => {
                        tokio::spawn(serve(stream, store, sender));
                    }
                    Some(acceptor) => {
                        tokio::spawn(async move {
                            if let Ok(tls) = acceptor.accept(stream).await {
                                serve(tls, store, sender).await;
                            }
                        });
                    }
                }
            }
        });
        Ok(Self {
            addr,
            tls: tls.is_some(),
            events,
            _live: live,
        })
    }
    /// `ws://127.0.0.1:<port>`, or `wss://localhost:<port>` behind TLS
    /// (the certificate is expected to name `localhost`).
    pub fn url(&self) -> String {
        if self.tls {
            format!("wss://localhost:{}", self.addr.port())
        } else {
            format!("ws://{}", self.addr)
        }
    }
    /// Everything accepted so far, in arrival order.
    pub fn events(&self) -> Vec<Event> {
        self.events.lock().map(|e| e.clone()).unwrap_or_default()
    }
}

async fn serve<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S,
    store: Arc<Mutex<Vec<Event>>>,
    live: broadcast::Sender<Event>,
) {
    let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
        return;
    };
    let mut subs: HashMap<String, Vec<Filter>> = HashMap::new();
    let mut rx = live.subscribe();
    loop {
        tokio::select! {
            msg = ws.next() => {
                let text = match msg {
                    Some(Ok(Message::Text(t))) => t.to_string(),
                    Some(Ok(Message::Ping(p))) => { let _ = ws.send(Message::Pong(p)).await; continue; }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => continue,
                };
                let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else { continue };
                match v.first().and_then(|x| x.as_str()) {
                    Some("REQ") => {
                        let Some(id) = v.get(1).and_then(|x| x.as_str()) else { continue };
                        let filters: Vec<Filter> = v[2..].iter().filter_map(|f| serde_json::from_value(f.clone()).ok()).collect();
                        let mut stored: Vec<Event> = store.lock().map(|s| s.clone()).unwrap_or_default();
                        stored.sort_by_key(|a| std::cmp::Reverse(a.created_at));
                        let limit = filters.iter().filter_map(|f| f.limit).max();
                        let mut sent = 0usize;
                        for ev in stored {
                            if filters.iter().any(|f| matches(f, &ev)) {
                                if limit.is_some_and(|l| sent >= l as usize) { break; }
                                let m = serde_json::to_string(&("EVENT", id, &ev)).expect("plain fields");
                                if ws.send(Message::Text(m.into())).await.is_err() { return; }
                                sent += 1;
                            }
                        }
                        let eose = serde_json::to_string(&("EOSE", id)).expect("plain fields");
                        if ws.send(Message::Text(eose.into())).await.is_err() { return; }
                        subs.insert(id.to_string(), filters);
                    }
                    Some("EVENT") => {
                        let Some(ev) = v.get(1).and_then(|e| serde_json::from_value::<Event>(e.clone()).ok()) else { continue };
                        let (ok, why) = match ev.verify() {
                            Ok(()) => (true, ""),
                            Err(_) => (false, "invalid: bad signature"),
                        };
                        if ok {
                            let fresh = store.lock().map(|mut s| {
                                if s.iter().any(|e| e.id == ev.id) { false } else { s.push(ev.clone()); true }
                            }).unwrap_or(false);
                            if fresh { let _ = live.send(ev.clone()); }
                        }
                        let m = serde_json::to_string(&("OK", &ev.id, ok, why)).expect("plain fields");
                        if ws.send(Message::Text(m.into())).await.is_err() { return; }
                    }
                    Some("CLOSE") => {
                        if let Some(id) = v.get(1).and_then(|x| x.as_str()) { subs.remove(id); }
                    }
                    _ => {
                        let m = serde_json::to_string(&("NOTICE", "unknown verb")).expect("plain fields");
                        let _ = ws.send(Message::Text(m.into())).await;
                    }
                }
            }
            ev = rx.recv() => {
                let Ok(ev) = ev else { continue };
                for (id, filters) in &subs {
                    if filters.iter().any(|f| matches(f, &ev)) {
                        let m = serde_json::to_string(&("EVENT", id, &ev)).expect("plain fields");
                        if ws.send(Message::Text(m.into())).await.is_err() { return; }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sidestr_nostr::event::SecretKeySigner;
    use sidestr_nostr::tx::sign_transaction_event;

    #[tokio::test]
    async fn the_stand_in_stores_replays_and_pushes_and_the_client_follows_and_publishes() {
        let relay = RelayStandIn::start("127.0.0.1:0").await.unwrap();
        let url = relay.url();
        let signer = SecretKeySigner::from_bytes(&[3u8; 32]).unwrap();
        let now = unix_now();
        let old = sign_transaction_event(&signer, "sidestr:t", "0200", now - 10).unwrap();
        assert_eq!(
            publish_one(&url, &old, Duration::from_secs(5)).await,
            PublishOutcome::Ok
        );
        let mut forged = old.clone();
        forged.content = "0300".into();
        assert!(matches!(
            publish_one(&url, &forged, Duration::from_secs(5)).await,
            PublishOutcome::Rejected(_)
        ));
        let mut rx = follow(vec![url.clone()], vec![23500], 600, |_| {});
        let (_, got) = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got, old, "stored events are replayed");
        let fresh = sign_transaction_event(&signer, "sidestr:t", "0201", now).unwrap();
        let r = publish_all(
            &[url.clone(), "ws://127.0.0.1:1".into()],
            &fresh,
            Duration::from_secs(5),
        )
        .await;
        assert_eq!(ok_count(&r), 1);
        let (_, got) = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got, fresh, "live events are pushed");
        assert_eq!(relay.events().len(), 2);
        // a filter by #d and limit, as fetchLatestTip asks
        let tip = sidestr_nostr::tip::sign_tip(
            &signer,
            &sidestr_nostr::tip::TipTemplate::new("sidestr:t", 0, vec![], vec![]).unwrap(),
            now,
        )
        .unwrap();
        publish_one(&url, &tip, Duration::from_secs(5)).await;
        let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        ws.send(Message::Text(
            ClientMessage::Req {
                subscription_id: "tip".into(),
                filters: vec![sidestr_nostr::relay::tip_filter("sidestr:t")],
            }
            .to_json()
            .into(),
        ))
        .await
        .unwrap();
        let mut got = Vec::new();
        while let Some(Ok(Message::Text(t))) = ws.next().await {
            match RelayMessage::from_json(&t).unwrap() {
                RelayMessage::Event { event, .. } => got.push(event),
                RelayMessage::Eose(_) => break,
                _ => {}
            }
        }
        assert_eq!(got, vec![tip]);
    }
}
