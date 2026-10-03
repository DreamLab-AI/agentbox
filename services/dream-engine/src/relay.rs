//! Minimal Nostr relay session for the engine's forum I/O (governance panel,
//! nightly digest).
//!
//! One WebSocket, NIP-42 authenticated as the publishing key, with two
//! operations: [`RelaySession::publish`] (EVENT → OK) and
//! [`RelaySession::query`] (REQ → EVENT* → EOSE/CLOSED). Every wait is bounded;
//! callers treat any error as "the forum is unreachable tonight" and carry on
//! (fail-open — forum I/O never taints a night).
//!
//! Event types, ids, BIP-340 signing and verification are `nostr-bbs-core`'s
//! (the forum's own crate, k256 Schnorr underneath). Linking it is why this
//! crate is AGPL-3.0-only (operator decision 2026-09-25, ADR-2030/ADR-2115).
//! Nothing here touches key material beyond handing the [`SigningKey`] to
//! `sign_event`; the secret is never printed or logged.

use std::path::Path;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
pub use nostr_bbs_core::{NostrEvent, UnsignedEvent};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::{debug, warn};

/// secp256k1 Schnorr signing key, as `nostr_bbs_core::sign_event` takes it.
pub type SigningKey = k256::schnorr::SigningKey;

/// The live forum relay (DreamLab Cloudflare worker).
pub const DEFAULT_RELAY: &str = "wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev";

/// The relay the engine talks to: `DREAM_RELAY`, else the legacy
/// `DREAM_DIGEST_RELAY`, else [`DEFAULT_RELAY`].
pub fn relay_url() -> String {
    std::env::var("DREAM_RELAY")
        .or_else(|_| std::env::var("DREAM_DIGEST_RELAY"))
        .unwrap_or_else(|_| DEFAULT_RELAY.to_string())
}

#[derive(Debug, Error)]
pub enum RelayError {
    #[error("websocket: {0}")]
    Ws(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("timed out waiting for {0}")]
    Timeout(&'static str),
    #[error("relay closed the connection")]
    Closed,
    #[error("signing: {0}")]
    Sign(String),
    #[error("key: {0}")]
    Key(String),
}

/// The environment variable the entrypoint exports from
/// `[security].role_isolation` (custody X-1 step 1, W2).
pub const ROLE_ISOLATION_VAR: &str = "AGENTBOX_ROLE_ISOLATION";

/// Upper bound on a key file; a 64-hex key is 64 bytes.
const MAX_KEY_FILE_BYTES: u64 = 4096;

/// Load the publishing key named by `var` (for example
/// `JUNKIEJARVIS_PRIVKEY_HEX`).
///
/// Custody W2 (bypass 3): this is dream-engine's one ROLE-secret reader and
/// keeps the contract of `nostr-pod-bridge`'s `role_secret` module and
/// `management-api/lib/role-secret.js`:
///
/// 1. `<var>_FILE`, when set and non-empty, wins; an unreadable file is an
///    error naming the path, never a fallback.
/// 2. With `[security].role_isolation` off: `<var>` from the environment, then
///    the `<var>=` line of `env_file` (the pre-W2 behaviour, unchanged).
/// 3. With it on: neither. A `<var>` present in the environment is reported as
///    `ROLE-ISOLATION-LEAK <var>` and ignored, and the repo `.env` is not read.
pub fn load_signing_key(var: &str, env_file: &Path) -> Result<SigningKey, RelayError> {
    load_signing_key_from(var, env_file, &|k| std::env::var(k).ok())
}

/// [`load_signing_key`] over an explicit environment lookup (tests pass a map;
/// the process environment is shared by every test thread).
pub fn load_signing_key_from(
    var: &str,
    env_file: &Path,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<SigningKey, RelayError> {
    let isolated = lookup(ROLE_ISOLATION_VAR).as_deref() == Some("1");
    let file_var = format!("{var}_FILE");
    if isolated && lookup(var).is_some() {
        eprintln!(
            "[role-secret] ROLE-ISOLATION-LEAK {var} is set in the environment under role \
             isolation; ignored (deliver it as {file_var})"
        );
    }
    let hex_value = match lookup(&file_var).filter(|p| !p.trim().is_empty()) {
        Some(path) => read_key_file(Path::new(path.trim()))?,
        None if isolated => {
            return Err(RelayError::Key(format!(
                "{var} unavailable: role isolation requires {file_var}"
            )))
        }
        None => match lookup(var) {
            Some(v) if !v.trim().is_empty() => v.trim().to_string(),
            _ => {
                let text = std::fs::read_to_string(env_file).map_err(|e| {
                    RelayError::Key(format!(
                        "{var} not set and {} unreadable: {e}",
                        env_file.display()
                    ))
                })?;
                text.lines()
                    .find_map(|l| {
                        l.strip_prefix(&format!("{var}="))
                            .map(|v| v.trim().trim_matches(['"', '\'']).to_string())
                    })
                    .ok_or_else(|| {
                        RelayError::Key(format!("{var} not found in {}", env_file.display()))
                    })?
            }
        },
    };
    let bytes: [u8; 32] = hex::decode(&hex_value)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| RelayError::Key(format!("{var} is not 64 hex characters")))?;
    nostr_bbs_core::keys::signing_key_from_bytes(&bytes).map_err(|e| RelayError::Key(e.to_string()))
}

/// Read a key file: regular, bounded, UTF-8, trimmed. Errors name the path only.
fn read_key_file(path: &Path) -> Result<String, RelayError> {
    use std::io::Read;
    let err = |what: &str| RelayError::Key(format!("key file {}: {what}", path.display()));
    let file = std::fs::File::open(path).map_err(|e| err(&e.kind().to_string()))?;
    let meta = file.metadata().map_err(|e| err(&e.kind().to_string()))?;
    if !meta.is_file() || meta.len() > MAX_KEY_FILE_BYTES {
        return Err(err("not a regular file of at most 4096 bytes"));
    }
    let mut buf = String::new();
    file.take(MAX_KEY_FILE_BYTES)
        .read_to_string(&mut buf)
        .map_err(|e| err(&e.kind().to_string()))?;
    Ok(buf.trim().to_string())
}

/// Lower-case hex x-only public key of `key`.
pub fn pubkey_hex(key: &SigningKey) -> String {
    hex::encode(key.verifying_key().to_bytes())
}

/// Sign `unsigned` with `key`. The event's `pubkey` must be the key's
/// (core refuses a mismatch rather than produce a self-invalid event).
pub fn sign(unsigned: UnsignedEvent, key: &SigningKey) -> Result<NostrEvent, RelayError> {
    nostr_bbs_core::sign_event(unsigned, key).map_err(|e| RelayError::Sign(e.to_string()))
}

/// Whether `event`'s id and BIP-340 signature are valid (strict: the id must
/// be the canonical NIP-01 hash of the content).
pub fn verify(event: &NostrEvent) -> bool {
    nostr_bbs_core::verify_event_strict(event).is_ok()
}

/// Current unix time in seconds.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Outcome of one EVENT publish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishResult {
    pub event_id: String,
    pub accepted: bool,
    pub message: String,
}

/// An authenticated relay session.
pub struct RelaySession {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    url: String,
    sub_seq: u32,
}

const AUTH_WAIT: Duration = Duration::from_secs(4);
const OK_WAIT: Duration = Duration::from_secs(15);

impl RelaySession {
    /// Connect to `url` and answer the relay's NIP-42 challenge with `key`.
    /// A relay that sends no challenge within a few seconds is used as-is.
    pub async fn connect(url: &str, key: &SigningKey) -> Result<Self, RelayError> {
        let (ws, _) = tokio::time::timeout(
            Duration::from_secs(15),
            tokio_tungstenite::connect_async(url),
        )
        .await
        .map_err(|_| RelayError::Timeout("connect"))??;
        let mut session = Self {
            ws,
            url: url.to_string(),
            sub_seq: 0,
        };
        let challenge = session.wait_for_challenge().await?;
        if let Some(challenge) = challenge {
            let auth = sign(
                UnsignedEvent {
                    pubkey: pubkey_hex(key),
                    created_at: now_secs(),
                    kind: 22242,
                    tags: vec![
                        vec!["relay".into(), session.url.clone()],
                        vec!["challenge".into(), challenge],
                    ],
                    content: String::new(),
                },
                key,
            )?;
            session.send(json!(["AUTH", auth])).await?;
            let res = session.wait_ok(&auth.id).await?;
            if !res.accepted {
                warn!(message = %res.message, "relay refused NIP-42 AUTH — continuing unauthenticated");
            }
        }
        Ok(session)
    }

    async fn send(&mut self, v: Value) -> Result<(), RelayError> {
        self.ws.send(Message::Text(v.to_string().into())).await?;
        Ok(())
    }

    /// Next JSON array frame, or `None` on timeout.
    async fn next_frame(&mut self, wait: Duration) -> Result<Option<Vec<Value>>, RelayError> {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                return Ok(None);
            }
            match tokio::time::timeout(left, self.ws.next()).await {
                Err(_) => return Ok(None),
                Ok(None) => return Err(RelayError::Closed),
                Ok(Some(Err(e))) => return Err(e.into()),
                Ok(Some(Ok(Message::Text(t)))) => {
                    if let Ok(Value::Array(frame)) = serde_json::from_str::<Value>(&t) {
                        return Ok(Some(frame));
                    }
                }
                Ok(Some(Ok(Message::Ping(p)))) => {
                    let _ = self.ws.send(Message::Pong(p)).await;
                }
                Ok(Some(Ok(Message::Close(_)))) => return Err(RelayError::Closed),
                Ok(Some(Ok(_))) => {}
            }
        }
    }

    async fn wait_for_challenge(&mut self) -> Result<Option<String>, RelayError> {
        let deadline = tokio::time::Instant::now() + AUTH_WAIT;
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            match self.next_frame(left).await? {
                None => return Ok(None),
                Some(f) if f.first().and_then(Value::as_str) == Some("AUTH") => {
                    return Ok(f.get(1).and_then(Value::as_str).map(str::to_string));
                }
                Some(f) => debug!(frame = ?f.first(), "pre-auth frame ignored"),
            }
        }
    }

    async fn wait_ok(&mut self, event_id: &str) -> Result<PublishResult, RelayError> {
        let deadline = tokio::time::Instant::now() + OK_WAIT;
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            let Some(f) = self.next_frame(left).await? else {
                return Err(RelayError::Timeout("OK"));
            };
            match f.first().and_then(Value::as_str) {
                Some("OK") if f.get(1).and_then(Value::as_str) == Some(event_id) => {
                    return Ok(PublishResult {
                        event_id: event_id.to_string(),
                        accepted: f.get(2).and_then(Value::as_bool).unwrap_or(false),
                        message: f.get(3).and_then(Value::as_str).unwrap_or("").to_string(),
                    });
                }
                Some("NOTICE") => warn!(notice = ?f.get(1), "relay notice"),
                _ => {}
            }
        }
    }

    /// Publish one signed event and wait for the relay's OK.
    pub async fn publish(&mut self, event: &NostrEvent) -> Result<PublishResult, RelayError> {
        self.send(json!(["EVENT", event])).await?;
        self.wait_ok(&event.id).await
    }

    /// Run one REQ with `filter`, collecting events until EOSE/CLOSED or `wait`.
    pub async fn query(
        &mut self,
        filter: Value,
        wait: Duration,
    ) -> Result<Vec<NostrEvent>, RelayError> {
        self.sub_seq += 1;
        let sid = format!("dream{}", self.sub_seq);
        self.send(json!(["REQ", sid, filter])).await?;
        let deadline = tokio::time::Instant::now() + wait;
        let mut out = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            let Some(f) = self.next_frame(left).await? else {
                break;
            };
            let tag = f.first().and_then(Value::as_str);
            let same_sub = f.get(1).and_then(Value::as_str) == Some(sid.as_str());
            match tag {
                Some("EVENT") if same_sub => {
                    if let Some(ev) = f
                        .get(2)
                        .and_then(|v| serde_json::from_value::<NostrEvent>(v.clone()).ok())
                    {
                        out.push(ev);
                    }
                }
                Some("EOSE") | Some("CLOSED") if same_sub => break,
                _ => {}
            }
        }
        let _ = self.send(json!(["CLOSE", sid])).await;
        Ok(out)
    }

    /// Close the socket (best effort).
    pub async fn close(mut self) {
        let _ = self.ws.close(None).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_loads_from_env_file_and_signs_verifiably() {
        let dir = tempfile::tempdir().unwrap();
        let env = dir.path().join(".env");
        // BIP-340 test vector 1 secret key.
        let sk_hex = "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
        std::fs::write(&env, format!("OTHER=1\nDREAM_TEST_KEY_X=\"{sk_hex}\"\n")).unwrap();
        let key = load_signing_key("DREAM_TEST_KEY_X", &env).unwrap();
        assert_eq!(
            pubkey_hex(&key),
            "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659"
        );
        let ev = sign(
            UnsignedEvent {
                pubkey: pubkey_hex(&key),
                created_at: 1,
                kind: 1,
                tags: vec![],
                content: "x".into(),
            },
            &key,
        )
        .unwrap();
        assert!(verify(&ev));
        // Wire round-trip: the JSON the relay receives verifies after parsing.
        let wire: NostrEvent = serde_json::from_str(&serde_json::to_string(&ev).unwrap()).unwrap();
        assert!(verify(&wire));
        let mut tampered = ev.clone();
        tampered.content = "y".into();
        assert!(!verify(&tampered));
    }

    #[test]
    fn signing_refuses_a_mismatched_pubkey() {
        let key = nostr_bbs_core::keys::signing_key_from_bytes(&[7u8; 32]).unwrap();
        let res = sign(
            UnsignedEvent {
                pubkey: "00".repeat(32),
                created_at: 1,
                kind: 1,
                tags: vec![],
                content: String::new(),
            },
            &key,
        );
        assert!(res.is_err());
    }

    fn lookup_of(pairs: &[(&str, String)]) -> impl Fn(&str) -> Option<String> {
        let m: std::collections::HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect();
        move |k: &str| m.get(k).cloned()
    }

    const SK1: &str = "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
    const PK1: &str = "dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659";

    #[test]
    fn role_key_file_wins_over_env_and_env_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("k");
        std::fs::write(&f, format!("{SK1}\n")).unwrap();
        let env = dir.path().join(".env");
        std::fs::write(&env, format!("JJ={}\n", "11".repeat(32))).unwrap();
        let l = lookup_of(&[
            ("JJ", "22".repeat(32)),
            ("JJ_FILE", f.display().to_string()),
        ]);
        assert_eq!(
            pubkey_hex(&load_signing_key_from("JJ", &env, &l).unwrap()),
            PK1
        );
    }

    #[test]
    fn role_isolation_refuses_the_env_var_and_the_env_file() {
        let dir = tempfile::tempdir().unwrap();
        let env = dir.path().join(".env");
        std::fs::write(&env, format!("JJ={SK1}\n")).unwrap();
        let l = lookup_of(&[(ROLE_ISOLATION_VAR, "1".into()), ("JJ", SK1.into())]);
        let err = match load_signing_key_from("JJ", &env, &l) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("role isolation must refuse the env var and the .env file"),
        };
        assert!(err.contains("JJ_FILE"), "{err}");
        assert!(!err.contains(SK1), "{err}");
    }

    #[test]
    fn role_isolation_reads_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("k");
        std::fs::write(&f, SK1).unwrap();
        let l = lookup_of(&[
            (ROLE_ISOLATION_VAR, "1".into()),
            ("JJ_FILE", f.display().to_string()),
        ]);
        let key = load_signing_key_from("JJ", &dir.path().join("none"), &l).unwrap();
        assert_eq!(pubkey_hex(&key), PK1);
    }

    #[test]
    fn flag_off_keeps_env_then_env_file() {
        let dir = tempfile::tempdir().unwrap();
        let env = dir.path().join(".env");
        std::fs::write(&env, format!("JJ=\"{SK1}\"\n")).unwrap();
        let from_file = load_signing_key_from("JJ", &env, &lookup_of(&[])).unwrap();
        assert_eq!(pubkey_hex(&from_file), PK1);
        let l = lookup_of(&[("JJ", SK1.into())]);
        let from_env = load_signing_key_from("JJ", &dir.path().join("none"), &l).unwrap();
        assert_eq!(pubkey_hex(&from_env), PK1);
    }

    #[test]
    fn unreadable_key_file_names_the_path_and_does_not_fall_back() {
        let dir = tempfile::tempdir().unwrap();
        let l = lookup_of(&[
            ("JJ", SK1.into()),
            ("JJ_FILE", "/nonexistent/jj.key".into()),
        ]);
        let err = match load_signing_key_from("JJ", &dir.path().join("none"), &l) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("an unreadable JJ_FILE must not fall back to JJ"),
        };
        assert!(err.contains("/nonexistent/jj.key"), "{err}");
    }

    #[test]
    fn missing_or_malformed_key_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let env = dir.path().join(".env");
        std::fs::write(&env, "DREAM_TEST_KEY_Y=nothex\n").unwrap();
        assert!(load_signing_key("DREAM_TEST_KEY_Y", &env).is_err());
        assert!(load_signing_key("DREAM_TEST_KEY_ABSENT", &env).is_err());
        assert!(load_signing_key("DREAM_TEST_KEY_Z", &dir.path().join("none")).is_err());
    }
}
