//! The decision: one request line from one peer in, one response out.
//!
//! [`Port::handle`] is the whole policy. The socket layer only supplies the
//! peer's credentials (from `SO_PEERCRED`) and the raw line, so every refusal
//! path is testable without a second uid. The order of checks is fixed:
//!
//! 1. the line is a JSON object `{"op": <string>, "params": <object>}`;
//! 2. the peer uid is in the ACL;
//! 3. the op is in the closed list and granted to that uid;
//! 4. the params parse strictly for that op (unknown fields refused);
//! 5. the named key is granted to that uid for that op, and held;
//! 6. the op's own check (kind allowlist, URL prefix, relay list);
//! 7. sign through `nostr-bbs-core`, write the receipt, answer.
//!
//! A receipt line is written for every decision. If the receipt for an
//! admission cannot be written, the signature is discarded and the request is
//! refused: nothing is signed off the record.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine as _;
use nostr_bbs_core::keys::signing_key_from_bytes;
use nostr_bbs_core::nip19::encode_npub;
use nostr_bbs_core::{sign_event, NostrEvent, UnsignedEvent};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;
use zeroize::Zeroizing;

use super::acl::{self, Acl, OpGrant};
use super::receipts::{Receipt, Receipts};

/// Longest accepted request line, in bytes.
pub const MAX_REQUEST_BYTES: usize = 64 * 1024;
/// Longest accepted NIP-42 challenge.
const MAX_CHALLENGE: usize = 512;
/// HTTP methods a NIP-98 header may name.
const METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
/// NIP-98 HTTP Auth kind.
const KIND_HTTP_AUTH: u64 = 27_235;
/// NIP-42 client AUTH kind.
const KIND_CLIENT_AUTH: u64 = 22_242;
/// The key a request means when it names none.
const DEFAULT_KEY: &str = "core";
/// The key `forum_event` means when it names none.
const DEFAULT_FORUM_KEY: &str = "junkiejarvis";

/// Credentials of the connected peer, as `SO_PEERCRED` reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Peer {
    /// Effective uid. The only input to authorisation.
    pub uid: u32,
    /// Effective gid. Audit only.
    pub gid: u32,
    /// Process id. Audit only: pids are reused.
    pub pid: Option<i32>,
}

/// A secret key the port holds. Never `Debug`, never serialised.
struct HeldKey {
    sk: Zeroizing<[u8; 32]>,
    xonly: String,
    npub: String,
}

/// The live-mirror child, derived once at start.
struct MirrorChild {
    secret: Zeroizing<[u8; 32]>,
    xonly: String,
    npub: String,
}

/// The keys the port holds, by ACL key name.
pub struct KeyRing {
    keys: BTreeMap<String, HeldKey>,
    mirror: Option<MirrorChild>,
}

impl std::fmt::Debug for KeyRing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyRing")
            .field("keys", &self.keys.keys().collect::<Vec<_>>())
            .field("mirror", &self.mirror.is_some())
            .finish()
    }
}

impl KeyRing {
    /// Load every key the ACL declares from `dir`. A `required` key that is
    /// absent is an error; an optional one is simply not held, and requests on
    /// it are refused. Error messages name files, never contents.
    ///
    /// The mirror child is derived from the `mirror_root` key's file *as
    /// written*: that file must hold the operator hex exactly as
    /// `AGENTBOX_PRIVKEY_HEX` supplies it (see [`crate::mirror_key`]).
    pub fn load(acl: &Acl, dir: &Path, mirror_tag: Option<&str>) -> Result<Self> {
        let mut keys = BTreeMap::new();
        let mut mirror = None;
        for (name, policy) in &acl.keys {
            let path = dir.join(&policy.spec.file);
            let hex_sk = match std::fs::read_to_string(&path) {
                Ok(s) => Zeroizing::new(s),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound && !policy.spec.required => {
                    continue
                }
                Err(e) => {
                    return Err(anyhow!(
                        "key {name}: cannot read {}: {}",
                        path.display(),
                        e.kind()
                    ))
                }
            };
            let held = held_key(hex_sk.trim()).with_context(|| {
                format!(
                    "key {name}: {} does not hold a usable secret key",
                    path.display()
                )
            })?;
            if policy.spec.mirror_root {
                let secret = Zeroizing::new(
                    crate::mirror_key::child_secret(hex_sk.trim(), mirror_tag)
                        .map_err(|_| anyhow!("key {name}: mirror child derivation failed"))?,
                );
                let child = held_key(&Zeroizing::new(hex::encode(*secret))).map_err(|_| {
                    anyhow!("key {name}: mirror child is not a valid secp256k1 scalar")
                })?;
                mirror = Some(MirrorChild {
                    secret,
                    xonly: child.xonly,
                    npub: child.npub,
                });
            }
            keys.insert(name.clone(), held);
        }
        Ok(Self { keys, mirror })
    }

    /// The x-only public key of a held key.
    pub fn pubkey(&self, name: &str) -> Option<&str> {
        self.keys.get(name).map(|k| k.xonly.as_str())
    }
}

fn held_key(hex_sk: &str) -> Result<HeldKey> {
    if hex_sk.len() != 64 || !hex_sk.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("not 64 hex characters");
    }
    let mut sk = Zeroizing::new([0u8; 32]);
    hex::decode_to_slice(hex_sk, &mut sk[..]).map_err(|_| anyhow!("not hex"))?;
    let signing =
        signing_key_from_bytes(&sk).map_err(|_| anyhow!("not a valid secp256k1 scalar"))?;
    let xonly = hex::encode(signing.verifying_key().to_bytes());
    let npub = encode_npub(&xonly).map_err(|e| anyhow!("npub encoding: {e}"))?;
    Ok(HeldKey { sk, xonly, npub })
}

/// Why a request was refused. The text goes back to the caller and into the
/// receipt; it never carries key material or request content.
#[derive(Debug, Clone)]
pub struct Refused {
    /// The operation as the caller named it (or `"?"`).
    pub op: String,
    /// Human-readable reason.
    pub reason: String,
}

impl Refused {
    fn new(op: &str, reason: impl Into<String>) -> Self {
        Self {
            op: op.to_string(),
            reason: reason.into(),
        }
    }

    /// The wire form: `{"refused": {"op", "reason"}}`.
    pub fn to_json(&self) -> Value {
        json!({ "refused": { "op": self.op, "reason": self.reason } })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    op: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PubkeyReq {
    #[serde(default)]
    key: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nip98Req {
    #[serde(default)]
    key: Option<String>,
    method: String,
    url: String,
    #[serde(default, alias = "body_sha256")]
    payload_sha256: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignEventReq {
    #[serde(default)]
    key: Option<String>,
    kind: u64,
    #[serde(default)]
    tags: Vec<Vec<String>>,
    #[serde(default)]
    content: String,
    #[serde(default)]
    created_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForumEventReq {
    #[serde(default)]
    key: Option<String>,
    kind: u64,
    #[serde(default)]
    tags: Vec<Vec<String>>,
    #[serde(default)]
    content: String,
    /// Accepted for the rehearsal's contract. The port never publishes, so
    /// every forum event it returns is a dry run as far as the port goes.
    #[serde(default)]
    #[allow(dead_code)]
    dry_run: Option<bool>,
    /// Zone sealing is not an identity-port operation; a request naming a zone
    /// is refused rather than signed in the clear.
    #[serde(default)]
    zone: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nip42Req {
    #[serde(default)]
    key: Option<String>,
    relay: String,
    challenge: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MirrorKeyReq {}

/// An event before signing; the author is always the held key.
struct Draft {
    kind: u64,
    tags: Vec<Vec<String>>,
    content: String,
    created_at: u64,
}

/// What an admitted request produced, for the response and the receipt.
struct Admitted {
    response: Value,
    key: Option<String>,
    kind: Option<u64>,
    event_id: Option<String>,
    url_host: Option<String>,
}

/// The identity port: ACL, held keys, receipt sink and clock.
pub struct Port {
    acl: Acl,
    keys: KeyRing,
    receipts: Receipts,
    now: fn() -> u64,
}

impl std::fmt::Debug for Port {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Port")
            .field("keys", &self.keys)
            .finish_non_exhaustive()
    }
}

impl Port {
    /// Assemble a port.
    pub fn new(acl: Acl, keys: KeyRing, receipts: Receipts) -> Self {
        Self {
            acl,
            keys,
            receipts,
            now: now_unix,
        }
    }

    /// The ACL in force.
    pub fn acl(&self) -> &Acl {
        &self.acl
    }

    /// Decide one request. Always returns exactly one JSON response; a refusal
    /// is `{"refused": {...}}`.
    pub fn handle(&self, peer: Peer, line: &str) -> Value {
        let (op, outcome) = self.decide(peer, line);
        let mut receipt = Receipt::new((self.now)(), &op, peer);
        match outcome {
            Ok(a) => {
                receipt.admit(
                    a.key.clone(),
                    a.kind,
                    a.event_id.clone(),
                    a.url_host.clone(),
                );
                if let Err(e) = self.receipts.write(&receipt) {
                    tracing::error!(error = %e, op = %op, "receipt unwritable; refusing an admitted request");
                    let r = Refused::new(
                        &op,
                        "the sign receipt could not be written; nothing was signed off the record",
                    );
                    return r.to_json();
                }
                a.response
            }
            Err(r) => {
                receipt.refuse(&r.reason);
                if let Err(e) = self.receipts.write(&receipt) {
                    tracing::error!(error = %e, op = %op, "receipt unwritable for a refusal");
                }
                r.to_json()
            }
        }
    }

    fn decide(&self, peer: Peer, line: &str) -> (String, Result<Admitted, Refused>) {
        if line.len() > MAX_REQUEST_BYTES {
            return ("?".into(), Err(Refused::new("?", "request too large")));
        }
        let env: Envelope = match serde_json::from_str(line.trim()) {
            Ok(e) => e,
            Err(_) => {
                return (
                    "?".into(),
                    Err(Refused::new(
                        "?",
                        "malformed request: expected {\"op\": string, \"params\": object}",
                    )),
                )
            }
        };
        let op = sanitise_op(&env.op);
        let r = self.decide_op(peer, &op, env.params);
        (op, r)
    }

    fn decide_op(&self, peer: Peer, op: &str, params: Option<Value>) -> Result<Admitted, Refused> {
        if !self.acl.callers.contains_key(&peer.uid) {
            return Err(Refused::new(
                op,
                format!("uid {} is not in the identity-port ACL", peer.uid),
            ));
        }
        if !acl::OPERATIONS.contains(&op) {
            return Err(Refused::new(
                op,
                format!(
                    "unknown operation; the closed list is {:?}",
                    acl::OPERATIONS
                ),
            ));
        }
        let grant = self.acl.grant(peer.uid, op).ok_or_else(|| {
            Refused::new(op, format!("operation not granted to uid {}", peer.uid))
        })?;
        let params = match params {
            None => Value::Object(Default::default()),
            Some(v @ Value::Object(_)) => v,
            Some(_) => {
                return Err(Refused::new(
                    op,
                    "malformed request: params must be a JSON object",
                ))
            }
        };
        let bad = |e: serde_json::Error| {
            Refused::new(op, format!("malformed {op} request: {}", strip_serde(&e)))
        };
        match op {
            acl::OP_PUBKEY => self.op_pubkey(grant, serde_json::from_value(params).map_err(bad)?),
            acl::OP_NIP98 => self.op_nip98(grant, serde_json::from_value(params).map_err(bad)?),
            acl::OP_SIGN_EVENT => {
                self.op_sign_event(grant, serde_json::from_value(params).map_err(bad)?)
            }
            acl::OP_FORUM_EVENT => {
                self.op_forum_event(grant, serde_json::from_value(params).map_err(bad)?)
            }
            acl::OP_NIP42_AUTH => {
                self.op_nip42(grant, serde_json::from_value(params).map_err(bad)?)
            }
            acl::OP_MIRROR_KEY => {
                let _: MirrorKeyReq = serde_json::from_value(params).map_err(bad)?;
                self.op_mirror_key(grant)
            }
            _ => unreachable!("op checked against the closed list above"),
        }
    }

    /// Resolve the key a request names against the caller's grant.
    fn key<'a>(
        &'a self,
        op: &str,
        grant: &OpGrant,
        named: Option<String>,
        default: &str,
    ) -> Result<(String, &'a HeldKey), Refused> {
        let name = named.unwrap_or_else(|| default.to_string());
        if !grant.keys.iter().any(|k| k == &name) {
            return Err(Refused::new(
                op,
                format!("key {name:?} is not granted for {op}"),
            ));
        }
        let held =
            self.keys.keys.get(&name).ok_or_else(|| {
                Refused::new(op, format!("key {name:?} is not held by this port"))
            })?;
        Ok((name, held))
    }

    fn sign(&self, op: &str, held: &HeldKey, d: Draft) -> Result<NostrEvent, Refused> {
        let sk =
            signing_key_from_bytes(&held.sk).map_err(|_| Refused::new(op, "held key unusable"))?;
        let unsigned = UnsignedEvent {
            pubkey: held.xonly.clone(),
            created_at: d.created_at,
            kind: d.kind,
            tags: d.tags,
            content: d.content,
        };
        sign_event(unsigned, &sk).map_err(|_| Refused::new(op, "signing failed"))
    }

    fn op_pubkey(&self, grant: &OpGrant, req: PubkeyReq) -> Result<Admitted, Refused> {
        let (name, held) = self.key(acl::OP_PUBKEY, grant, req.key, DEFAULT_KEY)?;
        Ok(Admitted {
            response: json!({
                "key": name,
                "pubkey": held.xonly,
                "npub": held.npub,
                "did": format!("did:nostr:{}", held.xonly),
            }),
            key: Some(name),
            kind: None,
            event_id: None,
            url_host: None,
        })
    }

    fn op_nip98(&self, grant: &OpGrant, req: Nip98Req) -> Result<Admitted, Refused> {
        let op = acl::OP_NIP98;
        let (name, held) = self.key(op, grant, req.key, DEFAULT_KEY)?;
        let method = req.method.trim().to_ascii_uppercase();
        if !METHODS.contains(&method.as_str()) {
            return Err(Refused::new(
                op,
                format!("method must be one of {METHODS:?}"),
            ));
        }
        let url = Url::parse(req.url.trim())
            .map_err(|_| Refused::new(op, "url is not an absolute URL"))?;
        if !url.username().is_empty() || url.password().is_some() {
            return Err(Refused::new(op, "url must not carry userinfo"));
        }
        let policy = &self.acl.keys[&name];
        if !acl::url_allowed(&url, &policy.url_prefixes) {
            return Err(Refused::new(
                op,
                format!(
                    "url host {:?} is outside key {name:?}'s NIP-98 allowlist",
                    url.host_str().unwrap_or("")
                ),
            ));
        }
        // The `u` tag is signed without query or fragment, exactly as
        // NostrBridge.buildNip98Header does: solid-pod-rs rebuilds the expected
        // URL from the path alone.
        // String-level cut (not the parsed form), so the tag is byte-identical
        // to what the caller passes the verifier.
        let raw = req.url.trim();
        let u = raw[..raw.find(['?', '#']).unwrap_or(raw.len())].to_string();
        let mut tags = vec![vec!["u".to_string(), u], vec!["method".to_string(), method]];
        if let Some(p) = req.payload_sha256 {
            let p = p.trim().to_ascii_lowercase();
            if p.len() != 64 || !p.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(Refused::new(op, "payload_sha256 must be 64 hex characters"));
            }
            tags.push(vec!["payload".to_string(), p]);
        }
        let d = Draft {
            kind: KIND_HTTP_AUTH,
            tags,
            content: String::new(),
            created_at: (self.now)(),
        };
        let ev = self.sign(op, held, d)?;
        let json =
            serde_json::to_string(&ev).map_err(|_| Refused::new(op, "serialisation failed"))?;
        let header = format!(
            "Nostr {}",
            base64::engine::general_purpose::STANDARD.encode(json)
        );
        Ok(Admitted {
            response: json!({ "header": header, "event_id": ev.id, "pubkey": ev.pubkey }),
            key: Some(name),
            kind: Some(KIND_HTTP_AUTH),
            event_id: Some(ev.id),
            url_host: url.host_str().map(str::to_string),
        })
    }

    fn signed_event(
        &self,
        op: &str,
        grant: &OpGrant,
        name: String,
        held: &HeldKey,
        d: Draft,
    ) -> Result<Admitted, Refused> {
        let kind = d.kind;
        if !grant.kinds.contains(&kind) {
            return Err(Refused::new(
                op,
                format!(
                    "kind {kind} is not in this caller's {op} allowlist {:?}",
                    grant.kinds
                ),
            ));
        }
        let ev = self.sign(op, held, d)?;
        let id = ev.id.clone();
        let response = json!({ "event": serde_json::to_value(&ev).map_err(|_| Refused::new(op, "serialisation failed"))? });
        Ok(Admitted {
            response,
            key: Some(name),
            kind: Some(kind),
            event_id: Some(id),
            url_host: None,
        })
    }

    fn op_sign_event(&self, grant: &OpGrant, req: SignEventReq) -> Result<Admitted, Refused> {
        let op = acl::OP_SIGN_EVENT;
        let (name, held) = self.key(op, grant, req.key, DEFAULT_KEY)?;
        let created_at = req.created_at.unwrap_or_else(self.now);
        let d = Draft {
            kind: req.kind,
            tags: req.tags,
            content: req.content,
            created_at,
        };
        self.signed_event(op, grant, name, held, d)
    }

    fn op_forum_event(&self, grant: &OpGrant, req: ForumEventReq) -> Result<Admitted, Refused> {
        let op = acl::OP_FORUM_EVENT;
        if req.zone.is_some() {
            return Err(Refused::new(
                op,
                "zone sealing is not an identity-port operation; nothing was signed",
            ));
        }
        let (name, held) = self.key(op, grant, req.key, DEFAULT_FORUM_KEY)?;
        let d = Draft {
            kind: req.kind,
            tags: req.tags,
            content: req.content,
            created_at: (self.now)(),
        };
        self.signed_event(op, grant, name, held, d)
    }

    fn op_nip42(&self, grant: &OpGrant, req: Nip42Req) -> Result<Admitted, Refused> {
        let op = acl::OP_NIP42_AUTH;
        let (name, held) = self.key(op, grant, req.key, DEFAULT_KEY)?;
        let relay = acl::normalise_relay(&req.relay);
        if !self.acl.keys[&name].relays.contains(&relay) {
            return Err(Refused::new(
                op,
                format!("relay is not in key {name:?}'s relay list"),
            ));
        }
        if req.challenge.is_empty() || req.challenge.len() > MAX_CHALLENGE {
            return Err(Refused::new(
                op,
                format!("challenge must be 1..={MAX_CHALLENGE} bytes"),
            ));
        }
        let tags = vec![
            vec!["relay".to_string(), req.relay.trim().to_string()],
            vec!["challenge".to_string(), req.challenge],
        ];
        let d = Draft {
            kind: KIND_CLIENT_AUTH,
            tags,
            content: String::new(),
            created_at: (self.now)(),
        };
        let ev = self.sign(op, held, d)?;
        let id = ev.id.clone();
        let host = Url::parse(&relay)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string));
        Ok(Admitted {
            response: json!({ "event": serde_json::to_value(&ev).map_err(|_| Refused::new(op, "serialisation failed"))? }),
            key: Some(name),
            kind: Some(KIND_CLIENT_AUTH),
            event_id: Some(id),
            url_host: host,
        })
    }

    fn op_mirror_key(&self, grant: &OpGrant) -> Result<Admitted, Refused> {
        let op = acl::OP_MIRROR_KEY;
        let m = self
            .keys
            .mirror
            .as_ref()
            .ok_or_else(|| Refused::new(op, "the mirror root key is not held by this port"))?;
        let mut response = json!({ "pubkey": m.xonly, "npub": m.npub });
        if grant.secret {
            response["secret_hex"] = Value::String(hex::encode(*m.secret));
        }
        Ok(Admitted {
            response,
            key: Some("mirror".into()),
            kind: None,
            event_id: None,
            url_host: None,
        })
    }
}

/// Wall-clock seconds since the Unix epoch.
fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Keep an operation name printable and short before it is echoed or logged.
fn sanitise_op(op: &str) -> String {
    let s: String = op
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(48)
        .collect();
    if s.is_empty() {
        "?".into()
    } else {
        s
    }
}

/// serde's messages can quote input values; keep only the structural part.
fn strip_serde(e: &serde_json::Error) -> String {
    let msg = e.to_string();
    if msg.starts_with("unknown field") || msg.starts_with("missing field") {
        msg.split(", expected").next().unwrap_or("").to_string()
    } else {
        "a field has the wrong type".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity_port::receipts::Receipts;

    const CORE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const JJ: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const ACL: &str = r#"{"version":1,
      "keys":{
        "core":{"file":"core.key","required":true,"mirror_root":true,
                "nip98_url_prefixes":["https://pod.example/"],"relays":["ws://127.0.0.1:7777"]},
        "junkiejarvis":{"file":"jj.key"}},
      "callers":{
        "1000":{"name":"devuser","ops":{
          "pubkey":{"keys":["core","junkiejarvis"]},
          "nip98":{"keys":["core"]},
          "sign_event":{"keys":["core"],"kinds":[38410,30840]},
          "forum_event":{"keys":["junkiejarvis"],"kinds":[1,42]},
          "nip42_auth":{"keys":["core"]},
          "mirror_key":{"secret":true}}},
        "961":{"name":"ab-gateway","ops":{
          "nip42_auth":{"keys":["core"]},
          "sign_event":{"keys":["core"],"kinds":[1]},
          "mirror_key":{}}}}}"#;

    struct Fx {
        port: Port,
        dir: tempfile::TempDir,
    }

    fn fx_with(acl: &str, jj: bool) -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let keys = dir.path().join("keys");
        std::fs::create_dir(&keys).unwrap();
        std::fs::write(keys.join("core.key"), format!("{CORE}\n")).unwrap();
        if jj {
            std::fs::write(keys.join("jj.key"), JJ).unwrap();
        }
        let acl = Acl::parse(acl, None).unwrap();
        let ring = KeyRing::load(&acl, &keys, None).unwrap();
        let receipts = Receipts::new(dir.path().join("receipts")).unwrap();
        Fx {
            port: Port::new(acl, ring, receipts),
            dir,
        }
    }

    fn fx() -> Fx {
        fx_with(ACL, true)
    }

    const DEV: Peer = Peer {
        uid: 1000,
        gid: 1000,
        pid: None,
    };
    const GW: Peer = Peer {
        uid: 961,
        gid: 961,
        pid: None,
    };
    const STRANGER: Peer = Peer {
        uid: 4242,
        gid: 4242,
        pid: None,
    };

    fn req(op: &str, params: Value) -> String {
        json!({ "op": op, "params": params }).to_string()
    }

    fn receipts(f: &Fx) -> Vec<Value> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(f.dir.path().join("receipts")).unwrap() {
            for l in std::fs::read_to_string(e.unwrap().path()).unwrap().lines() {
                out.push(serde_json::from_str(l).unwrap());
            }
        }
        out
    }

    fn refused(v: &Value) -> bool {
        v.get("refused").is_some()
    }

    #[test]
    fn a_uid_outside_the_acl_is_refused_for_every_op_and_nothing_is_signed() {
        let f = fx();
        let calls = [
            req("pubkey", json!({})),
            req(
                "nip98",
                json!({"method":"GET","url":"https://pod.example/x"}),
            ),
            req("sign_event", json!({"kind":38410})),
            req("forum_event", json!({"kind":1})),
            req(
                "nip42_auth",
                json!({"relay":"ws://127.0.0.1:7777","challenge":"c"}),
            ),
            req("mirror_key", json!({})),
        ];
        for c in &calls {
            let v = f.port.handle(STRANGER, c);
            assert!(refused(&v), "{c} admitted for a stranger: {v}");
            assert!(v["refused"]["reason"]
                .as_str()
                .unwrap()
                .contains("not in the identity-port ACL"));
        }
        let r = receipts(&f);
        assert_eq!(r.len(), calls.len());
        for line in r {
            assert_eq!(line["decision"], "refuse");
            assert_eq!(line["uid"], 4242);
            assert!(line.get("event_id").is_none());
        }
    }

    #[test]
    fn the_kind_allowlist_is_per_caller() {
        let f = fx();
        assert!(!refused(
            &f.port
                .handle(DEV, &req("sign_event", json!({"kind":38410})))
        ));
        assert!(refused(
            &f.port.handle(DEV, &req("sign_event", json!({"kind":1})))
        ));
        assert!(!refused(
            &f.port.handle(GW, &req("sign_event", json!({"kind":1})))
        ));
        assert!(refused(
            &f.port.handle(GW, &req("sign_event", json!({"kind":38410})))
        ));
        // An op granted to one caller is not granted to another.
        let v = f.port.handle(
            GW,
            &req(
                "nip98",
                json!({"method":"GET","url":"https://pod.example/x"}),
            ),
        );
        assert!(
            v["refused"]["reason"]
                .as_str()
                .unwrap()
                .contains("not granted"),
            "{v}"
        );
    }

    #[test]
    fn governance_and_graduation_kinds_are_refused_even_when_asked_directly() {
        let f = fx();
        for k in [31_402u64, 31_403, 38_414, 27_235, 22_242, 0] {
            assert!(
                refused(&f.port.handle(DEV, &req("sign_event", json!({"kind":k})))),
                "kind {k}"
            );
        }
    }

    #[test]
    fn a_key_not_granted_or_not_held_is_refused() {
        let f = fx();
        let v = f.port.handle(
            DEV,
            &req("sign_event", json!({"key":"junkiejarvis","kind":38410})),
        );
        assert!(
            v["refused"]["reason"]
                .as_str()
                .unwrap()
                .contains("not granted"),
            "{v}"
        );
        let f = fx_with(ACL, false);
        let v = f.port.handle(DEV, &req("forum_event", json!({"kind":1})));
        assert!(
            v["refused"]["reason"]
                .as_str()
                .unwrap()
                .contains("not held"),
            "{v}"
        );
    }

    #[test]
    fn malformed_requests_are_refused_and_receipted() {
        let f = fx();
        let bad = [
            "not json",
            "[]",
            r#"{"op":"pubkey","params":[1]}"#,
            r#"{"op":"pubkey","params":"x"}"#,
            r#"{"op":"pubkey","params":{},"extra":1}"#,
            r#"{"op":"sign_event","params":{"kind":"one"}}"#,
            r#"{"op":"sign_event","params":{"kind":38410,"pubkey":"ff"}}"#,
            r#"{"op":"nip98","params":{"method":"GET"}}"#,
            r#"{"op":"mirror_key","params":{"tag":"other"}}"#,
            r#"{"op":"dm_unwrap","params":{"envelope":{}}}"#,
            r#"{"op":"sign","params":{"event":{"kind":1}}}"#,
            "",
        ];
        for b in bad {
            assert!(refused(&f.port.handle(DEV, b)), "admitted: {b}");
        }
        assert_eq!(receipts(&f).len(), bad.len());
        let huge = format!(
            r#"{{"op":"pubkey","params":{{"key":"{}"}}}}"#,
            "x".repeat(MAX_REQUEST_BYTES)
        );
        assert!(refused(&f.port.handle(DEV, &huge)));
    }

    #[test]
    fn nip98_signs_only_allowlisted_urls_and_strips_the_query() {
        let f = fx();
        let v = f.port.handle(
            DEV,
            &req(
                "nip98",
                json!({"key":"core","method":"put","url":"https://pod.example/a/b?x=1",
            "payload_sha256":"E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"}),
            ),
        );
        let header = v["header"].as_str().expect("header");
        let raw = base64::engine::general_purpose::STANDARD
            .decode(header.strip_prefix("Nostr ").unwrap())
            .unwrap();
        let ev: NostrEvent = serde_json::from_slice(&raw).unwrap();
        assert!(nostr_bbs_core::verify_event(&ev));
        assert_eq!(ev.kind, 27_235);
        assert_eq!(ev.pubkey, f.port.keys.pubkey("core").unwrap());
        assert_eq!(ev.tags[0], vec!["u", "https://pod.example/a/b"]);
        assert_eq!(ev.tags[1], vec!["method", "PUT"]);
        assert_eq!(
            ev.tags[2][1],
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        for url in [
            "https://not-allowlisted.invalid/x",
            "http://pod.example/x",
            "https://user@pod.example/x",
            "pod.example/x",
        ] {
            let v = f
                .port
                .handle(DEV, &req("nip98", json!({"method":"GET","url":url})));
            assert!(refused(&v), "{url}");
        }
        assert!(refused(&f.port.handle(
            DEV,
            &req(
                "nip98",
                json!({"method":"TRACE","url":"https://pod.example/x"})
            )
        )));
        assert!(refused(&f.port.handle(
            DEV,
            &req(
                "nip98",
                json!({"method":"GET","url":"https://pod.example/x","body_sha256":"zz"})
            )
        )));
        let receipts = receipts(&f);
        let admit = receipts.iter().find(|r| r["decision"] == "admit").unwrap();
        assert_eq!(admit["host"], "pod.example");
        assert_eq!(admit["kind"], 27_235);
        assert!(admit.get("header").is_none());
    }

    #[test]
    fn nip42_names_only_configured_relays() {
        let f = fx();
        let v = f.port.handle(
            DEV,
            &req(
                "nip42_auth",
                json!({"key":"core","relay":"ws://127.0.0.1:7777/","challenge":"abc"}),
            ),
        );
        let ev: NostrEvent = serde_json::from_value(v["event"].clone()).unwrap();
        assert!(nostr_bbs_core::verify_event(&ev));
        assert_eq!(ev.kind, 22_242);
        assert!(ev
            .tags
            .contains(&vec!["challenge".to_string(), "abc".to_string()]));
        assert!(refused(&f.port.handle(
            DEV,
            &req(
                "nip42_auth",
                json!({"relay":"wss://elsewhere.example","challenge":"abc"})
            )
        )));
        assert!(refused(&f.port.handle(
            DEV,
            &req(
                "nip42_auth",
                json!({"relay":"ws://127.0.0.1:7777","challenge":""})
            )
        )));
    }

    #[test]
    fn forum_events_default_to_the_forum_key_and_refuse_zones() {
        let f = fx();
        let v = f.port.handle(
            DEV,
            &req(
                "forum_event",
                json!({"kind":1,"content":"hi","dry_run":true}),
            ),
        );
        let ev: NostrEvent = serde_json::from_value(v["event"].clone()).unwrap();
        assert!(nostr_bbs_core::verify_event(&ev));
        assert_eq!(ev.pubkey, f.port.keys.pubkey("junkiejarvis").unwrap());
        assert!(refused(&f.port.handle(
            DEV,
            &req("forum_event", json!({"kind":1,"zone":"zone2"}))
        )));
        assert!(refused(
            &f.port.handle(DEV, &req("forum_event", json!({"kind":40})))
        ));
    }

    #[test]
    fn mirror_key_matches_the_w8_derivation_and_the_secret_is_per_grant() {
        let f = fx();
        let v = f.port.handle(DEV, &req("mirror_key", json!({})));
        assert_eq!(
            v["pubkey"],
            crate::mirror_key::child_xonly_pubkey_hex(CORE, None).unwrap()
        );
        assert_eq!(
            v["secret_hex"], "a25935d1bb6782faa0ceaca1dce34bb23bf45a507e8e19b8973de836cbdcab72",
            "W8's synthetic vector for the aaaa key"
        );
        let v = f.port.handle(GW, &req("mirror_key", json!({})));
        assert!(v.get("pubkey").is_some());
        assert!(
            v.get("secret_hex").is_none(),
            "secret returned without the grant: {v}"
        );
    }

    #[test]
    fn the_sovereign_secret_is_in_no_response_and_no_receipt() {
        let f = fx();
        let calls = [
            req("pubkey", json!({})),
            req("pubkey", json!({"key":"junkiejarvis"})),
            req(
                "nip98",
                json!({"method":"GET","url":"https://pod.example/x"}),
            ),
            req(
                "sign_event",
                json!({"kind":38410,"content":"SENTINEL-CONTENT"}),
            ),
            req(
                "forum_event",
                json!({"kind":1,"content":"SENTINEL-CONTENT"}),
            ),
            req(
                "nip42_auth",
                json!({"relay":"ws://127.0.0.1:7777","challenge":"SENTINEL-CHALLENGE"}),
            ),
            req("mirror_key", json!({})),
            req("sign_event", json!({"kind":1,"content":"SENTINEL-CONTENT"})),
        ];
        for c in &calls {
            let s = f.port.handle(DEV, c).to_string().to_ascii_lowercase();
            assert!(
                !s.contains(CORE) && !s.contains(JJ),
                "secret in response to {c}"
            );
        }
        let all: String = receipts(&f).iter().map(Value::to_string).collect();
        for needle in [CORE, JJ, "SENTINEL-CONTENT", "SENTINEL-CHALLENGE", "Nostr "] {
            assert!(!all.contains(needle), "{needle} reached a receipt");
        }
        assert!(!format!("{:?}", f.port).contains(CORE));
    }

    #[test]
    fn an_unwritable_receipt_refuses_an_admission() {
        let f = fx();
        let rdir = f.dir.path().join("receipts");
        std::fs::remove_dir_all(&rdir).unwrap();
        std::fs::write(&rdir, "not a dir").unwrap();
        let v = f
            .port
            .handle(DEV, &req("sign_event", json!({"kind":38410})));
        assert!(
            v["refused"]["reason"].as_str().unwrap().contains("receipt"),
            "{v}"
        );
    }

    #[test]
    fn an_odd_y_supplied_key_signs_as_its_x_only_identity_and_keeps_the_phone_child() {
        // Scalar 6 has odd y (W8's hazard vector): the file holds the operator
        // hex as supplied; signing still yields the even-y x-only identity.
        let six = format!("{:0>64}", "6");
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("core.key"), &six).unwrap();
        let acl = Acl::parse(ACL, None).unwrap();
        let ring = KeyRing::load(&acl, dir.path(), None).unwrap();
        let port = Port::new(acl, ring, Receipts::new(dir.path().join("r")).unwrap());
        let v = port.handle(DEV, &req("sign_event", json!({"kind":38410})));
        let ev: NostrEvent = serde_json::from_value(v["event"].clone()).unwrap();
        assert!(nostr_bbs_core::verify_event(&ev));
        let ident = crate::identity::keypair_from_privkey_hex(&six).unwrap();
        assert_eq!(ev.pubkey, ident.x_only_pubkey_hex);
        let m = port.handle(DEV, &req("mirror_key", json!({})));
        assert_eq!(
            m["pubkey"],
            crate::mirror_key::child_xonly_pubkey_hex(&six, None).unwrap()
        );
    }

    #[test]
    fn a_missing_required_key_or_a_bad_key_file_fails_without_echoing_it() {
        let dir = tempfile::tempdir().unwrap();
        let acl = Acl::parse(ACL, None).unwrap();
        let e = KeyRing::load(&acl, dir.path(), None).unwrap_err();
        assert!(format!("{e:#}").contains("core.key"));
        std::fs::write(dir.path().join("core.key"), "zz-not-hex-SECRETISH").unwrap();
        let e = format!("{:#}", KeyRing::load(&acl, dir.path(), None).unwrap_err());
        assert!(!e.contains("SECRETISH") && !e.contains("zz"), "{e}");
    }
}
