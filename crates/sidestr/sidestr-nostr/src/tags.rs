//! The tag grammar the sidestr kinds share, and the rule behind it.
//!
//! **Relays index single-letter tags only.** That one fact shapes every
//! sidestr event: a tip is addressable by `d` = chain id so a relay can
//! answer `#d`, and tagged `t` = `sidestr` so a directory can ask for every
//! sidestr chain at once; but a transaction's `chain` tag is *not* indexed, so
//! a producer subscribes by kind and checks the tag on receipt
//! (`siding/lib/relay.mjs subscribe`: "relays index single-letter tags for
//! filtering and refuse `#chain`"). [`is_for_chain`] is that check.
//!
//! **Content is authoritative; tags are an index.** Where a fact appears in
//! both, the codecs re-derive from the content and refuse a disagreement
//! ([`crate::Error::Disagree`]) rather than picking one.

use crate::error::{hex_of, Error, Result};

/// Addressable identifier (NIP-33). A chain id on a tip, `<chain id>:<height>`
/// on a rule document, `<parent txid>:<vout>` on a 33502 record.
pub const TAG_D: &str = "d";
/// Event reference: a partial signature's proposal, a co-signed PSBT's request.
pub const TAG_E: &str = "e";
/// The chain id on every ephemeral sidestr event (SPEC 11); not relay-indexed.
pub const TAG_CHAIN: &str = "chain";
/// The announced height on a tip (SPEC 11).
pub const TAG_TIP: &str = "tip";
/// The NIP-333 network name, the chain id again, on a tip.
pub const TAG_N: &str = "n";
/// The topic every tip carries, `sidestr`, so a directory can filter on it.
pub const TAG_T: &str = "t";
/// A mirror's base URL on a tip; one tag per mirror, third element `mirror`.
pub const TAG_U: &str = "u";
/// The NIP-31 human summary on a tip.
pub const TAG_ALT: &str = "alt";
/// The block height a level-2 round event is about.
pub const TAG_H: &str = "h";
/// The genesis hash an estate event pins (ADR-2098 amendment: a name is never
/// monetary identity).
pub const TAG_GENESIS: &str = "genesis";

/// The topic value every tip carries.
pub const TOPIC_SIDESTR: &str = "sidestr";
/// The third element of a `u` tag on a tip.
pub const MARKER_MIRROR: &str = "mirror";

/// First value of the first tag with this name.
pub fn first<'a>(tags: &'a [Vec<String>], name: &str) -> Option<&'a str> {
    tags.iter()
        .find(|t| t.len() >= 2 && t[0] == name)
        .map(|t| t[1].as_str())
}

/// Every value carried by tags with this name, in order.
pub fn all<'a>(tags: &'a [Vec<String>], name: &str) -> Vec<&'a str> {
    tags.iter()
        .filter(|t| t.len() >= 2 && t[0] == name)
        .map(|t| t[1].as_str())
        .collect()
}

/// The first value of a required tag, or [`Error::MissingTag`].
pub fn required<'a>(tags: &'a [Vec<String>], name: &'static str) -> Result<&'a str> {
    first(tags, name).ok_or(Error::MissingTag(name))
}

/// Whether the event carries `chain` = this chain id (`siding/lib/relay.mjs
/// subscribe`: "another chain's, or untagged"). The producer's check on
/// receipt, since a relay cannot filter on it.
pub fn is_for_chain(tags: &[Vec<String>], chain_id: &str) -> bool {
    tags.iter()
        .any(|t| t.len() >= 2 && t[0] == TAG_CHAIN && t[1] == chain_id)
}

/// The `chain` tag's value, checked against the chain the caller expects
/// when one is given.
pub fn chain_tag<'a>(tags: &'a [Vec<String>], expect: Option<&str>) -> Result<&'a str> {
    let c = required(tags, TAG_CHAIN)?;
    match expect {
        Some(e) if e != c => Err(Error::Chain(format!("event is for {c}, not {e}"))),
        _ => Ok(c),
    }
}

/// A parent-chain outpoint as the tags write it: `<txid>:<vout>`, the txid in
/// display order (`siding/bin/siding.mjs onPledge`, `pegoutround.mjs`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Outpoint {
    /// 64 lowercase hex characters, display order.
    pub txid: String,
    /// The output index.
    pub vout: u32,
}

impl Outpoint {
    /// Parse `<64 hex>:<decimal>`; anything else is [`Error::Tag`] on `d`.
    pub fn parse(s: &str) -> Result<Self> {
        let (txid, vout) = s.split_once(':').ok_or_else(|| Error::Tag {
            tag: TAG_D,
            reason: format!("{s:?} is not <txid>:<vout>"),
        })?;
        let txid = hex_of("txid", txid, 32).map_err(|e| Error::Tag {
            tag: TAG_D,
            reason: e.to_string(),
        })?;
        if vout.is_empty() || !vout.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Error::Tag {
                tag: TAG_D,
                reason: format!("vout {vout:?} is not a decimal"),
            });
        }
        let vout = vout.parse().map_err(|_| Error::Tag {
            tag: TAG_D,
            reason: format!("vout {vout:?} is too large"),
        })?;
        Ok(Self { txid, vout })
    }
}

impl core::fmt::Display for Outpoint {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{}:{}", self.txid, self.vout)
    }
}

/// A decimal height tag, or [`Error::Tag`].
pub fn height_tag(tags: &[Vec<String>], name: &'static str) -> Result<u32> {
    let v = required(tags, name)?;
    if v.is_empty() || !v.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::Tag {
            tag: name,
            reason: format!("{v:?} is not a height"),
        });
    }
    v.parse().map_err(|_| Error::Tag {
        tag: name,
        reason: format!("{v:?} is too large"),
    })
}

/// An event-id tag (64 hex), or [`Error::Tag`].
pub fn event_id_tag(tags: &[Vec<String>], name: &'static str) -> Result<String> {
    hex_of("event id", required(tags, name)?, 32).map_err(|e| Error::Tag {
        tag: name,
        reason: e.to_string(),
    })
}

/// A two-element tag.
pub fn tag(name: &str, value: impl Into<String>) -> Vec<String> {
    vec![name.to_string(), value.into()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outpoint_grammar() {
        let o = Outpoint::parse(&format!("{}:7", "AB".repeat(32))).unwrap();
        assert_eq!((o.txid.as_str(), o.vout), ("ab".repeat(32).as_str(), 7));
        assert_eq!(o.to_string(), format!("{}:7", "ab".repeat(32)));
        for bad in [
            "",
            "abc",
            &"ab".repeat(32),
            &format!("{}:x", "ab".repeat(32)),
            &format!("{}:-1", "ab".repeat(32)),
            &format!("{}:1", "ab".repeat(31)),
        ] {
            assert!(
                matches!(Outpoint::parse(bad), Err(Error::Tag { tag: "d", .. })),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn chain_check_is_exact() {
        let tags = vec![tag(TAG_CHAIN, "sidestr:a")];
        assert!(is_for_chain(&tags, "sidestr:a"));
        assert!(!is_for_chain(&tags, "sidestr:ab"));
        assert!(!is_for_chain(&[vec!["chain".into()]], "sidestr:a"));
        assert!(matches!(
            chain_tag(&tags, Some("sidestr:b")),
            Err(Error::Chain(_))
        ));
        assert!(matches!(
            chain_tag(&[], None),
            Err(Error::MissingTag("chain"))
        ));
    }

    #[test]
    fn heights_and_ids() {
        assert_eq!(height_tag(&[tag(TAG_H, "12")], TAG_H).unwrap(), 12);
        assert!(height_tag(&[tag(TAG_H, "-1")], TAG_H).is_err());
        assert!(height_tag(&[tag(TAG_H, "99999999999")], TAG_H).is_err());
        assert!(event_id_tag(&[tag(TAG_E, "ab")], TAG_E).is_err());
        assert_eq!(
            event_id_tag(&[tag(TAG_E, "AB".repeat(32))], TAG_E).unwrap(),
            "ab".repeat(32)
        );
    }
}
