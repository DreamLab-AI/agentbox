//! The public tier's real backend: a websocket to the sovereign Nostr relay.
//!
//! NIP-01 over `ws://`, with events signed by the container's own key through
//! `nostr_bbs_core::event::sign_event`, crossing the one seam in [`crate::compat`].
//! No crypto is implemented here — the
//! Schnorr signing, the event-id hashing and the key handling all come from the
//! estate's audited crate, and this file is transport plus the filter mapping.
//!
//! # One connection per operation
//!
//! Deliberate. The relay is on loopback, a connection costs microseconds, and a
//! long-lived socket would need reconnection, backpressure and subscription
//! bookkeeping to be correct under a relay restart. A store is not a live feed:
//! it asks a question, reads the answer, and stops. The forum client, which
//! *does* want a live feed, keeps its own persistent subscription and does not
//! use this path.

use std::time::Duration;

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use k256::schnorr::SigningKey;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

use colloquy_store::relay::{Filter, RelayBackend};
use colloquy_nostr::event::{NostrEvent, UnsignedEvent};
use nostr_bbs_core::event::sign_event;

use crate::compat::{from_bbs_event, to_bbs_event, to_bbs_unsigned};

/// Why a relay operation failed.
#[derive(Debug, thiserror::Error)]
pub enum RelayWsError {
    /// The socket could not be opened or broke mid-operation.
    #[error("relay transport: {0}")]
    Transport(String),
    /// The key material was unusable.
    #[error("signing key: {0}")]
    Key(String),
    /// The event could not be signed.
    #[error("signing: {0}")]
    Signing(String),
    /// The relay refused the event.
    #[error("relay rejected event {id}: {reason}")]
    Rejected {
        /// Event id.
        id: String,
        /// The relay's `OK` message.
        reason: String,
    },
    /// The relay did not answer in time.
    #[error("relay timed out after {0:?}")]
    Timeout(Duration),
}

/// How long to wait for an `OK` or an `EOSE`.
const DEADLINE: Duration = Duration::from_secs(10);

/// The sovereign relay, over a websocket.
pub struct WsRelayBackend {
    url: String,
    signing_key: SigningKey,
    pubkey: String,
    deadline: Duration,
}

impl std::fmt::Debug for WsRelayBackend {
    /// Never renders the key — a `Debug` that leaks secret material is one
    /// stray log line away from being the incident.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsRelayBackend")
            .field("url", &self.url)
            .field("pubkey", &self.pubkey)
            .field("deadline", &self.deadline)
            .finish_non_exhaustive()
    }
}

impl WsRelayBackend {
    /// Bind to a relay with a 32-byte secret key.
    ///
    /// The x-only public key is derived, never supplied: an identity file that
    /// disagrees with its own secret is a configuration error that should fail
    /// here rather than produce events nobody can verify.
    pub fn new(url: impl Into<String>, secret_key: &[u8; 32]) -> Result<Self, RelayWsError> {
        let signing_key =
            SigningKey::from_bytes(secret_key).map_err(|e| RelayWsError::Key(e.to_string()))?;
        let pubkey = hex::encode(signing_key.verifying_key().to_bytes());
        Ok(Self {
            url: url.into(),
            signing_key,
            pubkey,
            deadline: DEADLINE,
        })
    }

    /// Bind using a hex-encoded secret key, as `identity.env` records it.
    pub fn from_hex(url: impl Into<String>, secret_hex: &str) -> Result<Self, RelayWsError> {
        let raw = hex::decode(secret_hex.trim())
            .map_err(|e| RelayWsError::Key(format!("secret key is not hex: {e}")))?;
        let bytes: [u8; 32] = raw
            .try_into()
            .map_err(|_| RelayWsError::Key("secret key is not 32 bytes".into()))?;
        Self::new(url, &bytes)
    }

    /// Override the per-operation deadline.
    pub fn with_deadline(mut self, d: Duration) -> Self {
        self.deadline = d;
        self
    }

    /// The relay URL.
    pub fn url(&self) -> &str {
        &self.url
    }

    async fn connect(
        &self,
    ) -> Result<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, RelayWsError>
    {
        let (ws, _) = tokio::time::timeout(self.deadline, tokio_tungstenite::connect_async(&self.url))
            .await
            .map_err(|_| RelayWsError::Timeout(self.deadline))?
            .map_err(|e| RelayWsError::Transport(e.to_string()))?;
        Ok(ws)
    }
}

/// Translate a [`Filter`] into the NIP-01 JSON a relay expects.
///
/// Empty vectors are omitted rather than sent as `[]`: an empty tag filter means
/// "no constraint" to this type and "match nothing" to a relay, and conflating
/// the two returns an empty board with no error.
pub fn filter_to_json(f: &Filter) -> Value {
    let mut o = serde_json::Map::new();
    if !f.kinds.is_empty() {
        o.insert("kinds".into(), json!(f.kinds));
    }
    if !f.d.is_empty() {
        o.insert("#d".into(), json!(f.d));
    }
    if !f.t.is_empty() {
        o.insert("#t".into(), json!(f.t));
    }
    if !f.e.is_empty() {
        o.insert("#e".into(), json!(f.e));
    }
    if f.limit > 0 {
        o.insert("limit".into(), json!(f.limit));
    }
    Value::Object(o)
}

#[async_trait]
impl RelayBackend for WsRelayBackend {
    async fn publish(&self, event: UnsignedEvent) -> Result<String, String> {
        let mut event = event;
        // The caller builds events for whoever the store acts as; the signature
        // has to match this backend's key, so the pubkey is overwritten rather
        // than validated — otherwise every caller has to know our key.
        event.pubkey.clone_from(&self.pubkey);

        let signed = from_bbs_event(
            sign_event(to_bbs_unsigned(event), &self.signing_key)
                .map_err(|e| RelayWsError::Signing(e.to_string()).to_string())?,
        );
        let id = signed.id.clone();

        let mut ws = self.connect().await.map_err(|e| e.to_string())?;
        let msg = serde_json::to_string(&json!(["EVENT", signed])).map_err(|e| e.to_string())?;
        ws.send(Message::Text(msg))
            .await
            .map_err(|e| RelayWsError::Transport(e.to_string()).to_string())?;

        let deadline = self.deadline;
        let wait = async {
            while let Some(frame) = ws.next().await {
                let Ok(Message::Text(text)) = frame else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                if v.get(0).and_then(Value::as_str) != Some("OK") {
                    continue;
                }
                if v.get(1).and_then(Value::as_str) != Some(id.as_str()) {
                    continue;
                }
                return if v.get(2).and_then(Value::as_bool).unwrap_or(false) {
                    Ok(id.clone())
                } else {
                    Err(RelayWsError::Rejected {
                        id: id.clone(),
                        reason: v.get(3).and_then(Value::as_str).unwrap_or("no reason").to_string(),
                    })
                };
            }
            Err(RelayWsError::Transport("closed before OK".into()))
        };

        tokio::time::timeout(deadline, wait)
            .await
            .map_err(|_| RelayWsError::Timeout(deadline).to_string())?
            .map_err(|e| e.to_string())
    }

    async fn fetch(&self, filter: &Filter) -> Result<Vec<NostrEvent>, String> {
        let mut ws = self.connect().await.map_err(|e| e.to_string())?;
        let sub = "colloquy";
        let req = serde_json::to_string(&json!(["REQ", sub, filter_to_json(filter)]))
            .map_err(|e| e.to_string())?;
        ws.send(Message::Text(req))
            .await
            .map_err(|e| RelayWsError::Transport(e.to_string()).to_string())?;

        let deadline = self.deadline;
        let collect = async {
            let mut out = Vec::new();
            while let Some(frame) = ws.next().await {
                let Ok(Message::Text(text)) = frame else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                match v.get(0).and_then(Value::as_str) {
                    Some("EVENT") if v.get(1).and_then(Value::as_str) == Some(sub) => {
                        if let Some(ev) = v.get(2).cloned() {
                            // A malformed event is skipped, not fatal: one bad
                            // row must not cost the caller the whole page.
                            if let Ok(ev) = serde_json::from_value::<NostrEvent>(ev) {
                                // Signature verification is not optional, and it
                                // is not this crate's to reimplement.
                                // Verification is not optional and is not this
                                // crate's to reimplement — it crosses the seam
                                // to the estate's audited implementation.
                                if nostr_bbs_core::event::verify_event(&to_bbs_event(ev.clone())) {
                                    out.push(ev);
                                }
                            }
                        }
                    }
                    Some("EOSE") if v.get(1).and_then(Value::as_str) == Some(sub) => break,
                    Some("CLOSED") => break,
                    _ => {}
                }
            }
            let _ = ws.send(Message::Text(
                serde_json::to_string(&json!(["CLOSE", sub])).unwrap_or_default(),
            ))
            .await;
            out
        };

        tokio::time::timeout(deadline, collect)
            .await
            .map_err(|_| RelayWsError::Timeout(deadline).to_string())
    }

    fn pubkey(&self) -> &str {
        &self.pubkey
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_nostr::kinds::KIND_KNOWLEDGE_UNIT;

    fn key() -> [u8; 32] {
        // A fixed, non-secret test key. Valid secp256k1 scalar.
        let mut k = [0u8; 32];
        k[31] = 7;
        k
    }

    #[test]
    fn the_pubkey_is_derived_from_the_secret_not_supplied() {
        let b = WsRelayBackend::new("ws://127.0.0.1:7777", &key()).unwrap();
        assert_eq!(b.pubkey().len(), 64);
        assert!(b.pubkey().chars().all(|c| c.is_ascii_hexdigit()));
        let from_hex = WsRelayBackend::from_hex("ws://127.0.0.1:7777", &hex::encode(key())).unwrap();
        assert_eq!(b.pubkey(), from_hex.pubkey());
    }

    #[test]
    fn a_bad_key_fails_at_construction_not_at_publish_time() {
        assert!(WsRelayBackend::from_hex("ws://x", "not hex").is_err());
        assert!(WsRelayBackend::from_hex("ws://x", "aabb").is_err());
        assert!(WsRelayBackend::new("ws://x", &[0u8; 32]).is_err(), "zero is not a valid scalar");
    }

    #[test]
    fn debug_never_renders_the_key() {
        let b = WsRelayBackend::new("ws://127.0.0.1:7777", &key()).unwrap();
        let rendered = format!("{b:?}");
        assert!(!rendered.contains(&hex::encode(key())));
        assert!(rendered.contains("127.0.0.1:7777"));
    }

    #[test]
    fn empty_tag_filters_are_omitted_not_sent_as_empty_arrays() {
        // `"#t": []` means "match nothing" to a relay. Sending it for an
        // unconstrained query returns an empty board with no error.
        let f = Filter {
            kinds: vec![KIND_KNOWLEDGE_UNIT],
            limit: 100,
            ..Filter::default()
        };
        let j = filter_to_json(&f);
        assert_eq!(j["kinds"], json!([38100]));
        assert_eq!(j["limit"], json!(100));
        assert!(j.get("#t").is_none(), "{j}");
        assert!(j.get("#d").is_none());
        assert!(j.get("#e").is_none());
    }

    #[test]
    fn populated_tag_filters_use_the_nip01_spelling() {
        let f = Filter {
            kinds: vec![38101, 38102],
            d: vec!["a1b2c3".into()],
            t: vec!["http".into()],
            e: vec!["ev1".into()],
            limit: 5,
        };
        let j = filter_to_json(&f);
        assert_eq!(j["#d"], json!(["a1b2c3"]));
        assert_eq!(j["#t"], json!(["http"]));
        assert_eq!(j["#e"], json!(["ev1"]));
        assert_eq!(j["kinds"], json!([38101, 38102]));
    }

    #[test]
    fn a_zero_limit_is_omitted_so_the_relay_applies_its_own_default() {
        let j = filter_to_json(&Filter::default());
        assert!(j.get("limit").is_none());
        assert_eq!(j, json!({}));
    }
}
