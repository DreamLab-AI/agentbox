//! The two NIP-01 event shapes, owned here.
//!
//! # Why this crate defines its own
//!
//! These are the canonical Nostr event structures — seven fields fixed by
//! NIP-01, not by any particular library. Depending on someone's crate for them
//! bought nothing and cost the ability to publish: the implementation this crate
//! originally borrowed them from is deliberately unpublished, which made every
//! crate downstream of it unpublishable too.
//!
//! So the types live here, and a caller that already has a Nostr library
//! converts at the boundary — one `From` impl, written once, where the crypto
//! lives. This crate still signs nothing and verifies nothing; it reads and
//! writes structure, and the signature belongs to whoever holds the key.
//!
//! Field names and JSON shape are exactly NIP-01, so these serialise
//! interchangeably with any other implementation's.
//!
//! ```
//! use colloquy_nostr::event::{NostrEvent, UnsignedEvent};
//!
//! let json = r#"{"id":"ab","pubkey":"cd","created_at":1,"kind":38210,
//!                "tags":[["d","x"]],"content":"{}","sig":"ef"}"#;
//! let ev: NostrEvent = serde_json::from_str(json).unwrap();
//! assert_eq!(ev.kind, 38210);
//! assert_eq!(ev.tags[0], vec!["d", "x"]);
//! ```

use serde::{Deserialize, Serialize};

/// An event template before it has been signed.
///
/// Carries everything the event id is computed over, and nothing else — no id,
/// no signature. Build one of these, hand it to a signer, get a
/// [`NostrEvent`] back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsignedEvent {
    /// The author's x-only public key, 64 lowercase hex characters.
    pub pubkey: String,
    /// Unix seconds.
    pub created_at: u64,
    /// Event kind. Colloquy's are `38210`–`38215`; see [`crate::kinds`].
    pub kind: u64,
    /// Tags, each a non-empty list whose first element is the tag name.
    pub tags: Vec<Vec<String>>,
    /// The event body. For a colloquy unit this is the unit's own JSON.
    pub content: String,
}

/// A signed event, as it travels on the wire and arrives from a relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NostrEvent {
    /// The event id: 64 hex characters, the SHA-256 of the canonical
    /// serialisation. **Not verified by this crate** — verify before decoding.
    pub id: String,
    /// The author's x-only public key.
    pub pubkey: String,
    /// Unix seconds.
    pub created_at: u64,
    /// Event kind.
    pub kind: u64,
    /// Tags.
    pub tags: Vec<Vec<String>>,
    /// The event body.
    pub content: String,
    /// The BIP-340 Schnorr signature, 128 hex characters. **Not verified by
    /// this crate.**
    pub sig: String,
}

impl NostrEvent {
    /// Strip the id and signature, recovering the template the event was
    /// signed from.
    ///
    /// Useful for re-signing under a different key, and for a caller that wants
    /// to recompute the id and compare. The result round-trips: an event whose
    /// id does not match this template's hash was tampered with.
    pub fn to_unsigned(&self) -> UnsignedEvent {
        UnsignedEvent {
            pubkey: self.pubkey.clone(),
            created_at: self.created_at,
            kind: self.kind,
            tags: self.tags.clone(),
            content: self.content.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed() -> NostrEvent {
        NostrEvent {
            id: "a".repeat(64),
            pubkey: "b".repeat(64),
            created_at: 1_767_225_600,
            kind: 38_210,
            tags: vec![vec!["d".into(), "abc".into()], vec!["t".into(), "http".into()]],
            content: "{}".into(),
            sig: "c".repeat(128),
        }
    }

    #[test]
    fn the_json_shape_is_nip01_field_for_field() {
        let v: serde_json::Value = serde_json::to_value(signed()).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["content", "created_at", "id", "kind", "pubkey", "sig", "tags"]
        );
    }

    #[test]
    fn an_event_from_any_implementation_parses() {
        // Field order is irrelevant to serde, as it is on the wire.
        let json = r#"{"sig":"ff","content":"body","tags":[],"kind":1,
                       "created_at":7,"pubkey":"pk","id":"eid"}"#;
        let ev: NostrEvent = serde_json::from_str(json).unwrap();
        assert_eq!((ev.id.as_str(), ev.kind, ev.created_at), ("eid", 1, 7));
    }

    #[test]
    fn to_unsigned_drops_exactly_the_id_and_signature() {
        let ev = signed();
        let u = ev.to_unsigned();
        assert_eq!(u.pubkey, ev.pubkey);
        assert_eq!(u.created_at, ev.created_at);
        assert_eq!(u.kind, ev.kind);
        assert_eq!(u.tags, ev.tags);
        assert_eq!(u.content, ev.content);

        let v: serde_json::Value = serde_json::to_value(&u).unwrap();
        assert!(v.get("id").is_none() && v.get("sig").is_none());
    }

    #[test]
    fn round_trips_through_json() {
        let ev = signed();
        assert_eq!(
            serde_json::from_str::<NostrEvent>(&serde_json::to_string(&ev).unwrap()).unwrap(),
            ev
        );
    }
}
