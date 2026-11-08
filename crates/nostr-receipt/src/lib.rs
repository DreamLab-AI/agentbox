//! Signed `did:nostr` receipts for disclosures and revocations.
//!
//! A receipt is an ordinary Nostr event (NIP-01), signed with BIP-340 Schnorr through
//! [`nostr_bbs_core`]. The issuer is the event's pubkey, written as `did:nostr:<hex>`. Two kinds
//! exist:
//!
//! - **disclosure**: an answer was released from a memory under a stated mechanism. It commits to
//!   a salted hash of the question and a hash of the answer, never their text.
//! - **revocation**: a document was removed from a memory. It commits to the document's hash.
//!
//! Both carry the memory commitment and the privacy mechanism's parameters (`sigma`, clip norm,
//! `epsilon`, `delta`). What a valid signature proves is limited: the named issuer made this
//! statement and it has not been altered since. It does not prove that the mechanism was applied;
//! independent attestation of that is separate work.
//!
//! Receipts carry who asked whom only if `requester` is set. Publishing them to a public relay in
//! the clear would expose that link, so transport should use NIP-59 gift wrap.
//!
//! The kind numbers are provisional, pending a draft NIP.

use k256::schnorr::SigningKey;
use nostr_bbs_core::event::{sign_event, verify_event_strict, NostrEvent, UnsignedEvent};
use nostr_bbs_core::keys::signing_key_from_bytes;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Event kind of a disclosure receipt (provisional).
pub const KIND_DISCLOSURE: u64 = 8810;
/// Event kind of a revocation receipt (provisional).
pub const KIND_REVOCATION: u64 = 8811;
/// Receipt schema version, carried in the `v` tag.
pub const VERSION: &str = "1";

/// Errors from issuing or verifying a receipt.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("signature or event id invalid: {0}")]
    Signature(String),
    #[error("not a receipt: {0}")]
    Schema(String),
    #[error("signer failed: {0}")]
    Signer(String),
}

/// The privacy mechanism a memory was released under.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mechanism {
    /// Mechanism name, e.g. `gaussian`.
    pub name: String,
    /// Noise standard deviation per coordinate.
    pub sigma: f64,
    /// L2 clip norm applied before the noise.
    pub clip: f64,
    /// Per-document epsilon over the memory's lifetime.
    pub epsilon: f64,
    /// Per-document delta over the memory's lifetime.
    pub delta: f64,
}

/// What the receipt attests.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Body {
    /// An answer was released.
    Disclosure {
        /// `sha256(salt || question)`, hex.
        query_hash: String,
        /// `sha256(answer)`, hex.
        answer_hash: String,
        /// The asking party, if the issuer chooses to name it.
        requester: Option<String>,
    },
    /// A document was removed from the memory.
    Revocation {
        /// `sha256(document)`, hex.
        document_hash: String,
    },
}

/// A receipt's content, before signing or after verification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Receipt {
    /// Commitment to the memory version (hex).
    pub memory: String,
    /// Mechanism parameters.
    pub mechanism: Mechanism,
    /// Disclosure or revocation.
    pub body: Body,
    /// Id of the issuer's previous receipt, chaining the log.
    pub prev: Option<String>,
    /// Unix time, seconds.
    pub created_at: u64,
}

/// A verified receipt.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Verified {
    /// Event id (hex).
    pub id: String,
    /// The issuer, `did:nostr:<hex>`.
    pub issuer: String,
    /// The attested content.
    pub receipt: Receipt,
}

/// Format a BIP-340 x-only public key (64 lowercase hex characters) as a `did:nostr` identifier.
pub fn did_nostr(pubkey_hex: &str) -> String {
    format!("did:nostr:{pubkey_hex}")
}

/// Parse `did:nostr:<64 lowercase hex>` into the public key bytes.
///
/// The grammar matches agentbox's URI mint (`management-api/lib/uris.js`); the shared fixtures in
/// `fixtures/did-nostr.json` keep the two in step.
pub fn parse_did_nostr(s: &str) -> Result<[u8; 32], Error> {
    let hex_part = s.strip_prefix("did:nostr:").ok_or_else(|| Error::Schema(format!("not a did:nostr: {s:?}")))?;
    if !is_hex64(hex_part) {
        return Err(Error::Schema(format!("did:nostr needs 64 lowercase hex characters: {s:?}")));
    }
    let mut out = [0u8; 32];
    hex::decode_to_slice(hex_part, &mut out).map_err(|e| Error::Schema(e.to_string()))?;
    Ok(out)
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `sha256(bytes)` as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// `sha256(salt || text)` as lowercase hex; the salt stops a reader guessing short questions.
pub fn salted_hash(salt: &[u8], text: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt);
    h.update(text.as_bytes());
    hex::encode(h.finalize())
}

/// Something that can sign a Nostr event as one identity.
pub trait Signer {
    /// The signing identity's x-only public key, hex.
    fn pubkey_hex(&self) -> String;
    /// Sign an unsigned event whose `pubkey` is [`Signer::pubkey_hex`].
    fn sign(&self, event: UnsignedEvent) -> Result<NostrEvent, Error>;
}

/// A signer holding a key in memory. For tests and standalone tools; agentbox signs through its
/// identity port instead (see [`CommandSigner`]).
pub struct KeySigner(SigningKey);

impl KeySigner {
    /// From a 32-byte secret key in hex.
    pub fn from_secret_hex(s: &str) -> Result<Self, Error> {
        let mut bytes = [0u8; 32];
        hex::decode_to_slice(s.trim(), &mut bytes).map_err(|e| Error::Signer(e.to_string()))?;
        signing_key_from_bytes(&bytes).map(Self).map_err(|e| Error::Signer(e.to_string()))
    }

    /// A fresh random key.
    pub fn generate() -> Result<(Self, String), Error> {
        let mut secret = [0u8; 32];
        loop {
            getrandom::getrandom(&mut secret).map_err(|e| Error::Signer(e.to_string()))?;
            if let Ok(k) = signing_key_from_bytes(&secret) {
                return Ok((Self(k), hex::encode(secret)));
            }
        }
    }
}

impl Signer for KeySigner {
    fn pubkey_hex(&self) -> String {
        hex::encode(self.0.verifying_key().to_bytes())
    }

    fn sign(&self, event: UnsignedEvent) -> Result<NostrEvent, Error> {
        sign_event(event, &self.0).map_err(|e| Error::Signer(format!("{e:?}")))
    }
}

/// A signer that delegates to an external program, keeping the key outside this process.
///
/// The program receives the unsigned event as JSON on stdin and must print the signed event as
/// JSON on stdout. Whatever it returns is verified before use.
pub struct CommandSigner {
    /// Program and arguments.
    pub command: Vec<String>,
    /// The identity the program signs as.
    pub pubkey: String,
}

impl Signer for CommandSigner {
    fn pubkey_hex(&self) -> String {
        self.pubkey.clone()
    }

    fn sign(&self, event: UnsignedEvent) -> Result<NostrEvent, Error> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let (program, args) = self.command.split_first().ok_or_else(|| Error::Signer("empty command".into()))?;
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| Error::Signer(e.to_string()))?;
        let input = serde_json::to_vec(&event).map_err(|e| Error::Signer(e.to_string()))?;
        child.stdin.take().ok_or_else(|| Error::Signer("no stdin".into()))?.write_all(&input).map_err(|e| Error::Signer(e.to_string()))?;
        let out = child.wait_with_output().map_err(|e| Error::Signer(e.to_string()))?;
        if !out.status.success() {
            return Err(Error::Signer(format!("signer exited with {}", out.status)));
        }
        serde_json::from_slice(&out.stdout).map_err(|e| Error::Signer(e.to_string()))
    }
}

fn tags(r: &Receipt) -> Vec<Vec<String>> {
    let m = &r.mechanism;
    let mut t = vec![
        vec!["v".into(), VERSION.into()],
        vec!["memory".into(), r.memory.clone()],
        vec!["mech".into(), m.name.clone(), m.sigma.to_string(), m.clip.to_string()],
        vec!["dp".into(), m.epsilon.to_string(), m.delta.to_string(), "per-document".into()],
    ];
    match &r.body {
        Body::Disclosure { query_hash, answer_hash, requester } => {
            t.push(vec!["query".into(), query_hash.clone()]);
            t.push(vec!["answer".into(), answer_hash.clone()]);
            if let Some(d) = requester {
                t.push(vec!["requester".into(), d.clone()]);
            }
        }
        Body::Revocation { document_hash } => t.push(vec!["document".into(), document_hash.clone()]),
    }
    if let Some(p) = &r.prev {
        t.push(vec!["prev".into(), p.clone()]);
    }
    t
}

fn kind_of(b: &Body) -> u64 {
    match b {
        Body::Disclosure { .. } => KIND_DISCLOSURE,
        Body::Revocation { .. } => KIND_REVOCATION,
    }
}

fn content_of(r: &Receipt) -> String {
    let m = &r.mechanism;
    let what = match &r.body {
        Body::Disclosure { .. } => "Answer released",
        Body::Revocation { .. } => "Document revoked",
    };
    format!(
        "{what} from memory {}; {} mechanism, sigma {}, clip {}; per-document epsilon {} at delta {}.",
        short(&r.memory), m.name, m.sigma, m.clip, m.epsilon, m.delta
    )
}

fn short(h: &str) -> &str {
    &h[..h.len().min(12)]
}

fn check_receipt(r: &Receipt) -> Result<(), Error> {
    let hex_ok = |name: &str, v: &str| if is_hex64(v) { Ok(()) } else { Err(Error::Schema(format!("{name} must be 64 lowercase hex characters"))) };
    hex_ok("memory", &r.memory)?;
    let m = &r.mechanism;
    if m.name.is_empty() {
        return Err(Error::Schema("mechanism name is empty".into()));
    }
    for (name, v) in [("sigma", m.sigma), ("clip", m.clip), ("epsilon", m.epsilon), ("delta", m.delta)] {
        if !v.is_finite() || v < 0.0 {
            return Err(Error::Schema(format!("{name} must be a finite non-negative number")));
        }
    }
    match &r.body {
        Body::Disclosure { query_hash, answer_hash, requester } => {
            hex_ok("query", query_hash)?;
            hex_ok("answer", answer_hash)?;
            if let Some(d) = requester {
                parse_did_nostr(d)?;
            }
        }
        Body::Revocation { document_hash } => hex_ok("document", document_hash)?,
    }
    if let Some(p) = &r.prev {
        hex_ok("prev", p)?;
    }
    Ok(())
}

/// Sign a receipt. The returned event is verified before it is returned.
pub fn issue(r: &Receipt, signer: &dyn Signer) -> Result<NostrEvent, Error> {
    check_receipt(r)?;
    let unsigned = UnsignedEvent {
        pubkey: signer.pubkey_hex(),
        created_at: r.created_at,
        kind: kind_of(&r.body),
        tags: tags(r),
        content: content_of(r),
    };
    let event = signer.sign(unsigned)?;
    let v = verify(&event)?;
    if v.issuer != did_nostr(&signer.pubkey_hex()) || v.receipt != *r {
        return Err(Error::Signer("signer returned a different event".into()));
    }
    Ok(event)
}

/// Verify a receipt: the event id and Schnorr signature, then the schema.
pub fn verify(event: &NostrEvent) -> Result<Verified, Error> {
    verify_event_strict(event).map_err(|e| Error::Signature(e.to_string()))?;
    let one = |name: &str| -> Result<&Vec<String>, Error> {
        let mut it = event.tags.iter().filter(|t| t.first().map(String::as_str) == Some(name));
        let t = it.next().ok_or_else(|| Error::Schema(format!("missing {name} tag")))?;
        if it.next().is_some() {
            return Err(Error::Schema(format!("repeated {name} tag")));
        }
        Ok(t)
    };
    let opt = |name: &str| -> Result<Option<&Vec<String>>, Error> {
        match one(name) {
            Ok(t) => Ok(Some(t)),
            Err(Error::Schema(m)) if m.starts_with("missing") => Ok(None),
            Err(e) => Err(e),
        }
    };
    let field = |t: &Vec<String>, i: usize| -> Result<String, Error> {
        t.get(i).cloned().ok_or_else(|| Error::Schema(format!("{} tag is short", t[0])))
    };
    let num = |t: &Vec<String>, i: usize| -> Result<f64, Error> {
        field(t, i)?.parse::<f64>().map_err(|_| Error::Schema(format!("{} tag field {i} is not a number", t[0])))
    };
    if field(one("v")?, 1)? != VERSION {
        return Err(Error::Schema("unsupported receipt version".into()));
    }
    let mech = one("mech")?;
    let dp = one("dp")?;
    if field(dp, 3)? != "per-document" {
        return Err(Error::Schema("dp tag scope must be per-document".into()));
    }
    let body = match event.kind {
        KIND_DISCLOSURE => Body::Disclosure {
            query_hash: field(one("query")?, 1)?,
            answer_hash: field(one("answer")?, 1)?,
            requester: opt("requester")?.map(|t| field(t, 1)).transpose()?,
        },
        KIND_REVOCATION => Body::Revocation { document_hash: field(one("document")?, 1)? },
        k => return Err(Error::Schema(format!("kind {k} is not a receipt kind"))),
    };
    let receipt = Receipt {
        memory: field(one("memory")?, 1)?,
        mechanism: Mechanism { name: field(mech, 1)?, sigma: num(mech, 2)?, clip: num(mech, 3)?, epsilon: num(dp, 1)?, delta: num(dp, 2)? },
        body,
        prev: opt("prev")?.map(|t| field(t, 1)).transpose()?,
        created_at: event.created_at,
    };
    check_receipt(&receipt)?;
    if event.content != content_of(&receipt) {
        return Err(Error::Schema("content does not match the tags".into()));
    }
    Ok(Verified { id: event.id.clone(), issuer: did_nostr(&event.pubkey), receipt })
}

/// Does a verified disclosure receipt match this question and answer?
pub fn matches(v: &Verified, salt: &[u8], question: &str, answer: &str) -> bool {
    match &v.receipt.body {
        Body::Disclosure { query_hash, answer_hash, .. } => {
            *query_hash == salted_hash(salt, question) && *answer_hash == sha256_hex(answer.as_bytes())
        }
        Body::Revocation { .. } => false,
    }
}
