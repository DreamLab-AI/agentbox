//! The relay I/O (feature `relay`): a tokio + tokio-tungstenite client
//! that follows relays with reconnection and publishes to them, and an
//! in-process NIP-01 relay stand-in for tests and one-box runs. The rules
//! — filters, the on-receipt checks, what a publish outcome means — are
//! `sidestr-nostr`'s ([`sidestr_nostr::relay`]); this module is only the
//! sockets, so the state machines stay free of them.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use sidestr_nostr::event::Event;
use sidestr_nostr::relay::{ClientMessage, Filter, PublishOutcome, RelayMessage};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message;

/// Seconds since the epoch.
pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
    let (tx, rx) = mpsc::channel(1024);
    let log = Arc::new(log);
    for url in relays {
        let tx = tx.clone();
        let kinds = kinds.clone();
        let log = log.clone();
        tokio::spawn(async move {
            let mut backoff = 1u64;
            loop {
                match tokio_tungstenite::connect_async(&url).await {
                    Ok((mut ws, _)) => {
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
    let attempt = async {
        let (mut ws, _) = match tokio_tungstenite::connect_async(url).await {
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
/// arrival. Enough for three signers on one box and for the interop tests;
/// **not a relay** — no persistence, no limits, no auth, one process.
#[derive(Debug)]
pub struct RelayStandIn {
    addr: SocketAddr,
    events: Arc<Mutex<Vec<Event>>>,
    _live: broadcast::Sender<Event>,
}

impl RelayStandIn {
    /// Listen on `bind` (`127.0.0.1:0` for any free port) and serve until
    /// dropped.
    pub async fn start(bind: &str) -> std::io::Result<Self> {
        let listener = TcpListener::bind(bind).await?;
        let addr = listener.local_addr()?;
        let events: Arc<Mutex<Vec<Event>>> = Arc::new(Mutex::new(Vec::new()));
        let (live, _) = broadcast::channel::<Event>(4096);
        let store = events.clone();
        let sender = live.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(serve(stream, store.clone(), sender.clone()));
            }
        });
        Ok(Self {
            addr,
            events,
            _live: live,
        })
    }
    /// `ws://127.0.0.1:<port>`.
    pub fn url(&self) -> String {
        format!("ws://{}", self.addr)
    }
    /// Everything accepted so far, in arrival order.
    pub fn events(&self) -> Vec<Event> {
        self.events.lock().map(|e| e.clone()).unwrap_or_default()
    }
}

async fn serve(stream: TcpStream, store: Arc<Mutex<Vec<Event>>>, live: broadcast::Sender<Event>) {
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
