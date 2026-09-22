//! Rules as documents (kind 33500, SPEC 8) and the genesis document (kind
//! 33501, SPEC Appendix A).
//!
//! **Conformant to SPEC prose only.** Upstream has no implementing code and
//! no wire example for either kind (`docs/PROTOCOL-registry.md`), so what is
//! here is the prose, read literally, and nothing more:
//!
//! - SPEC 8: "The chain's rules are engine overlay documents: JSON-LD, one
//!   per change, each with an activation height, published as addressable
//!   Nostr events (kind 33500, `d` = chain id : activation height) signed by
//!   a rule key. A node is configured with the rule keys it follows. It
//!   applies a rule from its activation height because its operator chose
//!   that key, and it shows the rule text before applying anything from a
//!   key it has not seen."
//! - Appendix A: "33501 | genesis document, `d` = chain id | addressable".
//!
//! So a rule document's content is the overlay document as JSON (carried as
//! [`serde_json::Value`]: its shape is the engine's, not this crate's), and a
//! genesis document's content is the chain document
//! ([`sidestr_core::document::ChainDocument`]) whose `id` must equal `d`. An
//! upstream wire example, when one appears, is the review trigger for this
//! module. The estate's `RuleActivated` and `ChainSealed` events (DDD-022)
//! ride these two kinds.
//!
//! What this module does **not** decide is trust: which rule keys a node
//! follows is configuration, and [`parse_rule`] hands back the author so the
//! caller can check it against that list.
//!
//! ```
//! use sidestr_nostr::event::SecretKeySigner;
//! use sidestr_nostr::rules::{parse_rule, sign_rule, RuleDocument};
//!
//! let rule_key = SecretKeySigner::from_bytes(&[3u8; 32]).unwrap();
//! let doc = RuleDocument {
//!     chain_id: "sidestr:example".into(),
//!     activation_height: 1000,
//!     document: serde_json::json!({"@context": "https://…/overlay.jsonld", "rule": "assets"}),
//! };
//! let ev = sign_rule(&rule_key, &doc, 1_790_100_000).unwrap();
//! assert_eq!(ev.tags[0], vec!["d", "sidestr:example:1000"]);
//! let back = parse_rule(&ev).unwrap();
//! assert_eq!(back.activation_height, 1000);
//! ```

use serde::{Deserialize, Serialize};
use sidestr_core::document::ChainDocument;

use crate::error::{Error, Result};
use crate::event::{sign, Event, Signer, UnsignedEvent};
use crate::kinds::{expect_kind, KIND_GENESIS_DOCUMENT, KIND_RULE_DOCUMENT};
use crate::tags::{chain_tag, first, required, tag, TAG_CHAIN, TAG_D};

/// A rule document: one change to a chain's rules, from a height.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleDocument {
    /// The chain it amends.
    pub chain_id: String,
    /// The height it applies from.
    pub activation_height: u32,
    /// The engine overlay document (JSON-LD), carried as it is.
    pub document: serde_json::Value,
}

/// The `d` value of a rule document: `<chain id>:<activation height>`.
pub fn rule_address(chain_id: &str, activation_height: u32) -> String {
    format!("{chain_id}:{activation_height}")
}

/// Split a rule `d` value. A chain id contains a colon (`sidestr:<name>`),
/// so the height is what follows the *last* one.
pub fn parse_rule_address(d: &str) -> Result<(String, u32)> {
    let (chain, height) = d.rsplit_once(':').ok_or_else(|| Error::Tag {
        tag: TAG_D,
        reason: format!("{d:?} is not <chain id>:<activation height>"),
    })?;
    if chain.is_empty() || height.is_empty() || !height.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::Tag {
            tag: TAG_D,
            reason: format!("{d:?} is not <chain id>:<activation height>"),
        });
    }
    let height = height.parse().map_err(|_| Error::Tag {
        tag: TAG_D,
        reason: format!("height in {d:?} is too large"),
    })?;
    Ok((chain.to_string(), height))
}

/// The unsigned kind-33500 event: `d` = `<chain id>:<height>`, `chain` as an
/// index, content the document as compact JSON.
pub fn rule_event(r: &RuleDocument, created_at: u64) -> Result<UnsignedEvent> {
    if !r.document.is_object() {
        return Err(Error::Content("a rule document is a JSON object".into()));
    }
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_RULE_DOCUMENT,
        tags: vec![
            tag(TAG_D, rule_address(&r.chain_id, r.activation_height)),
            tag(TAG_CHAIN, &r.chain_id),
        ],
        content: serde_json::to_string(&r.document)?,
    })
}

/// Sign a rule document with a rule key.
pub fn sign_rule(signer: &dyn Signer, r: &RuleDocument, created_at: u64) -> Result<Event> {
    sign(signer, rule_event(r, created_at)?)
}

/// Decode a kind-33500 event. The author (`ev.pubkey`) is the rule key; whether
/// the node follows it is the caller's configuration.
pub fn parse_rule(ev: &Event) -> Result<RuleDocument> {
    expect_kind(ev.kind, KIND_RULE_DOCUMENT, "rule document")?;
    let (chain_id, activation_height) = parse_rule_address(required(&ev.tags, TAG_D)?)?;
    if let Some(c) = first(&ev.tags, TAG_CHAIN) {
        if c != chain_id {
            return Err(Error::Disagree {
                tag: TAG_CHAIN,
                tag_value: c.to_string(),
                content_value: chain_id,
            });
        }
    }
    let document: serde_json::Value = serde_json::from_str(&ev.content)?;
    if !document.is_object() {
        return Err(Error::Content("a rule document is a JSON object".into()));
    }
    Ok(RuleDocument {
        chain_id,
        activation_height,
        document,
    })
}

/// The unsigned kind-33501 event: `d` = chain id, content the chain document
/// as `sidestr-core` writes it.
pub fn genesis_event(doc: &ChainDocument, created_at: u64) -> Result<UnsignedEvent> {
    if doc.genesis_hash.is_none() {
        return Err(Error::Content(
            "a genesis document names its genesisHash: seal the chain first".into(),
        ));
    }
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_GENESIS_DOCUMENT,
        tags: vec![tag(TAG_D, &doc.id), tag(TAG_CHAIN, &doc.id)],
        content: serde_json::to_string(doc)?,
    })
}

/// Sign a genesis document with the chain's signer.
pub fn sign_genesis(signer: &dyn Signer, doc: &ChainDocument, created_at: u64) -> Result<Event> {
    sign(signer, genesis_event(doc, created_at)?)
}

/// Decode a kind-33501 event: the document's `id` must equal `d`, and when
/// `expect` names a chain, that one. The document is not validated beyond its
/// shape; `ChainDocument::validate` is the caller's next step.
pub fn parse_genesis(ev: &Event, expect: Option<&str>) -> Result<ChainDocument> {
    expect_kind(ev.kind, KIND_GENESIS_DOCUMENT, "genesis document")?;
    let d = required(&ev.tags, TAG_D)?;
    if let Some(e) = expect {
        if d != e {
            return Err(Error::Chain(format!("event is for {d}, not {e}")));
        }
    }
    if first(&ev.tags, TAG_CHAIN).is_some() {
        chain_tag(&ev.tags, Some(d))?;
    }
    let doc: ChainDocument = serde_json::from_str(&ev.content)?;
    if doc.id != d {
        return Err(Error::Disagree {
            tag: TAG_D,
            tag_value: d.to_string(),
            content_value: doc.id,
        });
    }
    if doc.genesis_hash.is_none() {
        return Err(Error::Content(
            "a genesis document names its genesisHash".into(),
        ));
    }
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::SecretKeySigner;

    fn signer() -> SecretKeySigner {
        SecretKeySigner::from_bytes(&[3u8; 32]).unwrap()
    }
    fn rule() -> RuleDocument {
        RuleDocument {
            chain_id: "sidestr:t".into(),
            activation_height: 500,
            document: serde_json::json!({"@context": "x", "rule": "assets", "n": 1}),
        }
    }
    fn doc_json() -> String {
        format!(
            r#"{{"id":"sidestr:t","name":"t","parent":"tbtc4","challenge":"5120{k}","powLimit":"7f{f}","addressPrefix":"t","genesisTime":1,"pegs":[],"signer":"{k}","genesisHash":"{g}"}}"#,
            k = "ab".repeat(32),
            f = "ff".repeat(31),
            g = "cd".repeat(32)
        )
    }

    #[test]
    fn rule_address_grammar() {
        assert_eq!(
            parse_rule_address("sidestr:t:500").unwrap(),
            ("sidestr:t".into(), 500)
        );
        for bad in [
            "sidestr:t",
            "sidestr:t:",
            ":500",
            "sidestr:t:x",
            "sidestr:t:99999999999",
        ] {
            assert!(
                matches!(parse_rule_address(bad), Err(Error::Tag { tag: "d", .. })),
                "{bad}"
            );
        }
    }

    #[test]
    fn rule_round_trip_and_rejections() {
        let ev = sign_rule(&signer(), &rule(), 1).unwrap();
        assert_eq!(ev.kind, 33500);
        assert_eq!(parse_rule(&ev).unwrap(), rule());
        let mut c = ev.clone();
        c.tags[1][1] = "sidestr:u".into();
        assert!(matches!(
            parse_rule(&c),
            Err(Error::Disagree { tag: "chain", .. })
        ));
        let mut arr = ev.clone();
        arr.content = "[1]".into();
        assert!(matches!(parse_rule(&arr), Err(Error::Content(_))));
        let mut junk = ev.clone();
        junk.content = "{".into();
        assert!(matches!(parse_rule(&junk), Err(Error::Json(_))));
        let mut nod = ev;
        nod.tags.remove(0);
        assert!(matches!(parse_rule(&nod), Err(Error::MissingTag("d"))));
        let mut r = rule();
        r.document = serde_json::json!(1);
        assert!(rule_event(&r, 1).is_err());
    }

    #[test]
    fn genesis_round_trip_and_rejections() {
        let doc = ChainDocument::from_json(&doc_json()).unwrap();
        let ev = sign_genesis(&signer(), &doc, 1).unwrap();
        assert_eq!((ev.kind, ev.tags[0][1].as_str()), (33501, "sidestr:t"));
        assert_eq!(parse_genesis(&ev, Some("sidestr:t")).unwrap(), doc);
        assert!(matches!(
            parse_genesis(&ev, Some("sidestr:u")),
            Err(Error::Chain(_))
        ));
        let mut d = ev.clone();
        d.tags[0][1] = "sidestr:u".into();
        d.tags[1][1] = "sidestr:u".into();
        assert!(matches!(
            parse_genesis(&d, None),
            Err(Error::Disagree { tag: "d", .. })
        ));
        let mut unsealed = doc.clone();
        unsealed.genesis_hash = None;
        assert!(genesis_event(&unsealed, 1).is_err());
        let mut e = ev;
        e.content = serde_json::to_string(&unsealed).unwrap();
        assert!(matches!(parse_genesis(&e, None), Err(Error::Content(_))));
    }
}
