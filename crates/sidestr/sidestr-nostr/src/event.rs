//! The NIP-01 event, owned here, with its id, its BIP-340 signature and the
//! port a key sits behind.
//!
//! # Why this crate defines its own event
//!
//! Seven fields fixed by NIP-01, not by any library (the colloquy-nostr
//! precedent, ADR-2096 D2). A caller with a Nostr library converts at the
//! boundary; the JSON shape is exactly NIP-01, so the two serialise
//! interchangeably. What this crate adds over colloquy-nostr is the crypto:
//! sidestr's producer must verify what a relay hands it before a transaction
//! reaches the mempool, so [`Event::verify`] is here, and it is the reference
//! kernel's rule (`schema/codec/nostr.js verifyNostrEvent`): the id is the
//! SHA-256 of `[0, pubkey, created_at, kind, tags, content]` as JSON, and the
//! signature is BIP-340 over the id. Hashing is RustCrypto `sha2`; Schnorr is
//! `secp256k1` through `bitcoin`, the same context `sidestr-core` seals blocks
//! with. Nothing is hand-rolled.
//!
//! # The signer port (ADR-2101)
//!
//! siding passes a raw 32-byte hex key into every function that signs, and
//! reuses that one key as Nostr identity, taproot spending key and
//! block-sealing key. ADR-2101 separates the roles and says the identity port
//! "permits named derivations and operations only; a generic 'sign this
//! payload' port is a bypass". So a [`Signer`] here is never handed a digest
//! to sign. It receives a [`SignRequest`], which wraps the whole unsigned
//! event and has **no public constructor**: only this crate's named
//! constructors ([`crate::tip::sign_tip`],
//! [`crate::tx::sign_transaction_event`], …) can make one. A signer that
//! wants to enforce policy reads [`SignRequest::event`] and refuses by kind or
//! tag; a signer that cannot see what it signs cannot refuse anything, which
//! is the bypass the record names.
//!
//! [`SecretKeySigner`] is the in-memory implementation for a key that is a
//! file, as siding's are. It signs with **zero BIP-340 auxiliary
//! randomness**, so an event is a pure function of its fields and the key —
//! two producers with the same key announce identical bytes, and the oracle
//! test can compare signatures rather than only verify them. siding's
//! `schnorr.mjs` draws random aux by default, which is equally valid on the
//! wire; the choice here matches how `sidestr-core` seals blocks.
//!
//! ```
//! use sidestr_nostr::event::{Event, SecretKeySigner, Signer};
//! use sidestr_nostr::tx::{parse_transaction, sign_transaction_event};
//!
//! let signer = SecretKeySigner::from_hex(&"07".repeat(32)).unwrap();
//! let ev = sign_transaction_event(&signer, "sidestr:example", "0200000000", 1_790_100_000).unwrap();
//! assert_eq!(ev.pubkey, signer.pubkey_hex().unwrap());
//! ev.verify().unwrap();                                   // id and signature
//! assert_eq!(parse_transaction(&ev, None).unwrap().tx_hex, "0200000000");
//!
//! // any change to a signed field is caught
//! let mut forged = ev.clone();
//! forged.content.push_str("00");
//! assert!(forged.verify().is_err());
//! ```

use bitcoin::secp256k1::{schnorr::Signature, Keypair, Message, SecretKey, XOnlyPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{hex_of, Error, Result};

/// An event template before it has been signed: everything the id is
/// computed over and nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsignedEvent {
    /// The author's x-only public key, 64 lowercase hex characters.
    pub pubkey: String,
    /// Unix seconds.
    pub created_at: u64,
    /// The event kind; see [`crate::kinds`].
    pub kind: u32,
    /// Tags, each a non-empty list whose first element is the tag name.
    pub tags: Vec<Vec<String>>,
    /// The event body.
    pub content: String,
}

/// A signed event, as it travels on the wire and arrives from a relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    /// The event id: the SHA-256 of the NIP-01 serialisation, 64 hex characters.
    pub id: String,
    /// The author's x-only public key, 64 hex characters.
    pub pubkey: String,
    /// Unix seconds.
    pub created_at: u64,
    /// The event kind.
    pub kind: u32,
    /// Tags.
    pub tags: Vec<Vec<String>>,
    /// The event body.
    pub content: String,
    /// The BIP-340 Schnorr signature over the id, 128 hex characters.
    pub sig: String,
}

impl UnsignedEvent {
    /// The NIP-01 id: SHA-256 of `[0, pubkey, created_at, kind, tags, content]`
    /// serialised as compact JSON (`siding/lib/relay.mjs eventId`,
    /// `schema/codec/nostr.js verifyNostrEvent`). `serde_json` and
    /// `JSON.stringify` agree on this serialisation: no whitespace, the same
    /// string escapes, integers as digits.
    pub fn id_bytes(&self) -> [u8; 32] {
        let serial = serde_json::to_vec(&(
            0u8,
            &self.pubkey,
            self.created_at,
            self.kind,
            &self.tags,
            &self.content,
        ))
        .expect("strings and integers always serialise");
        Sha256::digest(serial).into()
    }

    /// [`Self::id_bytes`] as lowercase hex.
    pub fn id(&self) -> String {
        hex::encode(self.id_bytes())
    }

    /// Attach an id and signature the caller obtained elsewhere (a hardware
    /// signer, a Nostr library). The pair is verified before it is accepted.
    pub fn with_signature(self, sig_hex: &str) -> Result<Event> {
        let ev = Event {
            id: self.id(),
            pubkey: self.pubkey,
            created_at: self.created_at,
            kind: self.kind,
            tags: self.tags,
            content: self.content,
            sig: hex_of("signature", sig_hex, 64)?,
        };
        ev.verify()?;
        Ok(ev)
    }
}

impl Event {
    /// Strip the id and signature, recovering the template.
    pub fn to_unsigned(&self) -> UnsignedEvent {
        UnsignedEvent {
            pubkey: self.pubkey.clone(),
            created_at: self.created_at,
            kind: self.kind,
            tags: self.tags.clone(),
            content: self.content.clone(),
        }
    }

    /// The reference kernel's check (`schema/codec/nostr.js verifyNostrEvent`):
    /// the id is the hash of the fields **and** the signature is BIP-340 over
    /// the id under `pubkey`. Both, or [`Error::Signature`]. Nothing from a
    /// relay is trusted before this passes (`siding/lib/relay.mjs`: "the event
    /// signature is checked, then the transaction itself must validate").
    pub fn verify(&self) -> Result<()> {
        let want = self.to_unsigned().id();
        if !self.id.eq_ignore_ascii_case(&want) {
            return Err(Error::Signature(format!(
                "id {} is not the hash of the event's fields ({want})",
                self.id
            )));
        }
        let pk = pubkey_from_hex(&self.pubkey)?;
        let sig = Signature::from_slice(
            &hex::decode(self.sig.trim())
                .map_err(|e| Error::Signature(format!("signature is not hex: {e}")))?,
        )
        .map_err(|e| Error::Signature(format!("signature is not 64 bytes: {e}")))?;
        let msg = Message::from_digest(self.to_unsigned().id_bytes());
        sidestr_core::block::secp()
            .verify_schnorr(&sig, &msg, &pk)
            .map_err(|_| Error::Signature("BIP-340 signature does not verify".into()))
    }

    /// Whether the event was signed by this key (hex, case-insensitive).
    pub fn is_by(&self, pubkey_hex: &str) -> bool {
        self.pubkey.eq_ignore_ascii_case(pubkey_hex.trim())
    }
}

/// Parse an x-only public key from 64 hex characters.
pub fn pubkey_from_hex(hex_str: &str) -> Result<XOnlyPublicKey> {
    let bytes = hex::decode(hex_of("pubkey", hex_str, 32)?).expect("checked hex");
    XOnlyPublicKey::from_slice(&bytes).map_err(|e| Error::Key(format!("pubkey: {e}")))
}

/// What a [`Signer`] is asked to sign: the whole unsigned event, with its id
/// already computed. There is no public constructor — only this crate's named
/// constructors build one — so a signer is never driven by a bare payload.
#[derive(Debug)]
pub struct SignRequest<'a> {
    event: &'a UnsignedEvent,
    id: [u8; 32],
}

impl<'a> SignRequest<'a> {
    pub(crate) fn new(event: &'a UnsignedEvent) -> Self {
        Self {
            event,
            id: event.id_bytes(),
        }
    }

    /// The event being signed, for a signer that enforces policy by kind or
    /// tag before it signs.
    pub fn event(&self) -> &'a UnsignedEvent {
        self.event
    }

    /// The 32 bytes the BIP-340 signature is over.
    pub fn id(&self) -> &[u8; 32] {
        &self.id
    }
}

/// The port a key sits behind. Implemented by [`SecretKeySigner`] for an
/// in-memory key; by the estate for the identity key or a remote signer.
pub trait Signer {
    /// The x-only public key every event from this signer carries, as 64
    /// lowercase hex characters.
    fn pubkey_hex(&self) -> Result<String>;
    /// A BIP-340 signature over [`SignRequest::id`], or a refusal.
    fn sign(&self, request: &SignRequest<'_>) -> Result<[u8; 64]>;
}

/// Sign a template with a signer: the crate-internal step every named
/// constructor ends with. Fills `pubkey` from the signer, so a template's
/// pubkey is the signer's whatever it said before.
pub(crate) fn sign(signer: &dyn Signer, mut event: UnsignedEvent) -> Result<Event> {
    event.pubkey = signer.pubkey_hex()?;
    let request = SignRequest::new(&event);
    let sig = signer.sign(&request)?;
    let ev = Event {
        id: hex::encode(request.id),
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sig: hex::encode(sig),
    };
    ev.verify()?;
    Ok(ev)
}

/// A secp256k1 secret key held in memory, signing with zero auxiliary
/// randomness. Built from a key file's text ([`Self::from_hex`]), as siding's
/// `loadKey` reads one; nothing here prints or displays a key.
pub struct SecretKeySigner {
    keypair: Keypair,
}

impl core::fmt::Debug for SecretKeySigner {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("SecretKeySigner")
            .field("pubkey", &self.pubkey_hex().unwrap_or_default())
            .finish_non_exhaustive()
    }
}

impl SecretKeySigner {
    /// From a 32-byte secret key.
    pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self> {
        let sk = SecretKey::from_slice(bytes).map_err(|e| Error::Key(e.to_string()))?;
        Ok(Self {
            keypair: Keypair::from_secret_key(sidestr_core::block::secp(), &sk),
        })
    }

    /// From a key file's text: 64 hex characters, surrounding whitespace
    /// ignored (`siding/lib/sign.mjs loadKey`).
    pub fn from_hex(text: &str) -> Result<Self> {
        let bytes: [u8; 32] = hex::decode(hex_of("secret key", text, 32)?)
            .expect("checked hex")
            .try_into()
            .expect("32 bytes");
        Self::from_bytes(&bytes)
    }
}

impl Signer for SecretKeySigner {
    fn pubkey_hex(&self) -> Result<String> {
        Ok(hex::encode(self.keypair.x_only_public_key().0.serialize()))
    }

    fn sign(&self, request: &SignRequest<'_>) -> Result<[u8; 64]> {
        let msg = Message::from_digest(*request.id());
        let sig =
            sidestr_core::block::secp().sign_schnorr_with_aux_rand(&msg, &self.keypair, &[0u8; 32]);
        Ok(*sig.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer() -> SecretKeySigner {
        SecretKeySigner::from_hex(&"07".repeat(32)).unwrap()
    }

    fn template() -> UnsignedEvent {
        UnsignedEvent {
            pubkey: String::new(),
            created_at: 1_790_100_000,
            kind: 23500,
            tags: vec![vec!["chain".into(), "sidestr:t".into()]],
            content: "0200".into(),
        }
    }

    #[test]
    fn the_json_shape_is_nip01_field_for_field() {
        let ev = sign(&signer(), template()).unwrap();
        let v: serde_json::Value = serde_json::to_value(&ev).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "content",
                "created_at",
                "id",
                "kind",
                "pubkey",
                "sig",
                "tags"
            ]
        );
        let back: Event = serde_json::from_str(&serde_json::to_string(&ev).unwrap()).unwrap();
        assert_eq!(back, ev);
    }

    #[test]
    fn id_matches_json_stringify_semantics() {
        // control characters, quotes and non-ASCII escape as JSON.stringify does
        let mut t = template();
        t.pubkey = "ab".repeat(32);
        t.content = "a\"b\\c\n\t\u{1}é".into();
        let serial =
            serde_json::to_string(&(0u8, &t.pubkey, t.created_at, t.kind, &t.tags, &t.content))
                .unwrap();
        assert_eq!(
            serial,
            format!("[0,\"{}\",1790100000,23500,[[\"chain\",\"sidestr:t\"]],\"a\\\"b\\\\c\\n\\t\\u0001é\"]", "ab".repeat(32))
        );
        assert_eq!(t.id().len(), 64);
    }

    #[test]
    fn signing_is_deterministic_and_verifies() {
        let a = sign(&signer(), template()).unwrap();
        let b = sign(&signer(), template()).unwrap();
        assert_eq!(a, b);
        a.verify().unwrap();
        assert!(a.is_by(&signer().pubkey_hex().unwrap().to_uppercase()));
    }

    #[test]
    fn tampering_is_caught() {
        let ev = sign(&signer(), template()).unwrap();
        let mut c = ev.clone();
        c.created_at += 1;
        assert!(matches!(c.verify(), Err(Error::Signature(m)) if m.contains("not the hash")));
        let mut s = ev.clone();
        s.id = s.to_unsigned().id(); // consistent id, but the signature is over the old one
        s.content = "ff".into();
        s.id = s.to_unsigned().id();
        assert!(matches!(s.verify(), Err(Error::Signature(m)) if m.contains("does not verify")));
        let mut p = ev.clone();
        p.pubkey = "zz".repeat(32);
        p.id = p.to_unsigned().id(); // a consistent id, but no such key
        assert!(matches!(p.verify(), Err(Error::Hex { .. })));
        let mut g = ev;
        g.sig = "ab".repeat(10);
        assert!(g.verify().is_err());
    }

    #[test]
    fn with_signature_accepts_only_a_valid_pair() {
        let ev = sign(&signer(), template()).unwrap();
        let ok = ev.to_unsigned().with_signature(&ev.sig).unwrap();
        assert_eq!(ok, ev);
        assert!(ev.to_unsigned().with_signature(&"00".repeat(64)).is_err());
    }

    #[test]
    fn a_policy_signer_can_refuse_by_kind() {
        struct OnlyTx(SecretKeySigner);
        impl Signer for OnlyTx {
            fn pubkey_hex(&self) -> Result<String> {
                self.0.pubkey_hex()
            }
            fn sign(&self, r: &SignRequest<'_>) -> Result<[u8; 64]> {
                if r.event().kind != 23500 {
                    return Err(Error::Key(format!(
                        "policy: will not sign kind {}",
                        r.event().kind
                    )));
                }
                self.0.sign(r)
            }
        }
        let s = OnlyTx(signer());
        assert!(sign(&s, template()).is_ok());
        let mut t = template();
        t.kind = 33333;
        assert!(matches!(sign(&s, t), Err(Error::Key(m)) if m.contains("policy")));
    }

    #[test]
    fn keys_are_refused_when_malformed() {
        assert!(SecretKeySigner::from_hex("abc").is_err());
        assert!(SecretKeySigner::from_hex(&"00".repeat(32)).is_err()); // zero is not a key
        assert!(SecretKeySigner::from_hex(&format!(" {} \n", "07".repeat(32))).is_ok());
        assert!(!format!("{:?}", signer()).contains(&"07".repeat(32)));
    }
}
