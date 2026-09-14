//! The one place two Nostr event representations meet.
//!
//! `colloquy-nostr` owns plain NIP-01 structs so it can be published;
//! `nostr-bbs-core` owns the estate's audited signing and verification. Both
//! describe the same seven fields, and this module is the single seam between
//! them — written once, here, where the crypto already lives.
//!
//! The conversions are total and lossless in both directions: every field maps
//! to the field of the same name, and there is nothing else in either type.

use colloquy_nostr::event::{NostrEvent as CqEvent, UnsignedEvent as CqUnsigned};
use nostr_bbs_core::event::{NostrEvent as BbsEvent, UnsignedEvent as BbsUnsigned};

/// Hand a colloquy template to the estate's signer.
pub fn to_bbs_unsigned(u: CqUnsigned) -> BbsUnsigned {
    BbsUnsigned {
        pubkey: u.pubkey,
        created_at: u.created_at,
        kind: u.kind,
        tags: u.tags,
        content: u.content,
    }
}

/// Take a signed event back from the estate's signer or a relay.
pub fn from_bbs_event(e: BbsEvent) -> CqEvent {
    CqEvent {
        id: e.id,
        pubkey: e.pubkey,
        created_at: e.created_at,
        kind: e.kind,
        tags: e.tags,
        content: e.content,
        sig: e.sig,
    }
}

/// Hand a signed event to the estate's verifier.
pub fn to_bbs_event(e: CqEvent) -> BbsEvent {
    BbsEvent {
        id: e.id,
        pubkey: e.pubkey,
        created_at: e.created_at,
        kind: e.kind,
        tags: e.tags,
        content: e.content,
        sig: e.sig,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cq() -> CqEvent {
        CqEvent {
            id: "a".repeat(64),
            pubkey: "b".repeat(64),
            created_at: 42,
            kind: 38_100,
            tags: vec![vec!["d".into(), "abc".into()]],
            content: "{\"x\":1}".into(),
            sig: "c".repeat(128),
        }
    }

    #[test]
    fn a_signed_event_survives_the_round_trip_unchanged() {
        let before = cq();
        let after = from_bbs_event(to_bbs_event(before.clone()));
        assert_eq!(before, after);
    }

    #[test]
    fn the_seam_is_lossless_at_the_json_level_too() {
        // If either side ever gains a field the other lacks, this is where it
        // shows up — the two documents stop matching.
        let cq_json = serde_json::to_value(cq()).unwrap();
        let bbs_json = serde_json::to_value(to_bbs_event(cq())).unwrap();
        assert_eq!(cq_json, bbs_json);
    }

    #[test]
    fn a_template_carries_neither_id_nor_signature_across() {
        let u = cq().to_unsigned();
        let bbs = to_bbs_unsigned(u.clone());
        assert_eq!(bbs.pubkey, u.pubkey);
        assert_eq!(bbs.tags, u.tags);
        let v = serde_json::to_value(&bbs).unwrap();
        assert!(v.get("id").is_none() && v.get("sig").is_none());
    }
}
