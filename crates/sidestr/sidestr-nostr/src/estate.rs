//! agentbox's own kinds: the account binding (38420) and the five
//! settlement domain events (38421–38425), from the 38400–38499 band
//! (ADR-2098 D2 and amendments, ADR-2105, DDD-022 "Domain Events").
//!
//! # The account binding, 38420
//!
//! `sidestr-account-binding`: addressable, `d` = `<chain id>:<did hex>`,
//! content = the derived spend pubkey, **signed by the identity key**. The
//! binding says "on this chain, this principal spends with this key"; because
//! the identity key signs it, the `did hex` in `d` must be the event's author
//! ([`parse_account_binding`] refuses otherwise), and because "a name is
//! never monetary identity" (ADR-2098 amendment) it pins the genesis hash in a
//! `genesis` tag. Re-sealing a chain under the same name is a different
//! genesis, so a binding to the old one does not carry over.
//!
//! # The domain events, 38421–38425
//!
//! DDD-022 names the five facts upstream has no event for, and what each is
//! for. They are **regular** events — evidence accretes, nothing replaces
//! it — and their content is JSON with the chain id inside it (content is
//! authoritative; the `chain` tag is an index, and [`Error::Disagree`] is the
//! answer to a mismatch). Every URN they carry was minted by the estate's sole
//! mint (`management-api/lib/uris.js`, ADR-013): this crate takes [`Urn`]s as
//! given and refuses only what is plainly not one.
//!
//! | kind | event | trigger (DDD-022) |
//! |---|---|---|
//! | 38421 | [`PegOutDefaulted`] | `pegoutBlocks` elapsed unpaid; upstream has no such fact |
//! | 38422 | [`ChildChainOpened`] | a child chain sealed and bound at `phase=create` |
//! | 38423 | [`ChildChainClosing`] | the `closePolicy` boundary reached |
//! | 38424 | [`ChainTombstoned`] | the closing hash checkpointed into the parent |
//! | 38425 | [`SettlementRecorded`] | a settlement finalised, if receipts federate (PRD-024 decides) |
//!
//! ```
//! use sidestr_nostr::estate::{parse_account_binding, sign_account_binding, AccountBinding};
//! use sidestr_nostr::event::{SecretKeySigner, Signer};
//!
//! let identity = SecretKeySigner::from_bytes(&[11u8; 32]).unwrap();
//! let b = AccountBinding {
//!     chain_id: "sidestr:dreamlab".into(),
//!     genesis_hash: "4d".repeat(32),
//!     did_hex: identity.pubkey_hex().unwrap(),
//!     spend_pubkey: "ab".repeat(32),
//! };
//! let ev = sign_account_binding(&identity, &b, 1_790_100_000).unwrap();
//! assert_eq!(ev.tags[0][1], format!("sidestr:dreamlab:{}", b.did_hex));
//! assert_eq!(parse_account_binding(&ev).unwrap(), b);
//! ```

use serde::{Deserialize, Serialize};

use crate::error::{hex_of, Error, Result};
use crate::event::{sign, Event, Signer, UnsignedEvent};
use crate::kinds::{
    expect_kind, KIND_ACCOUNT_BINDING, KIND_CHAIN_TOMBSTONED, KIND_CHILD_CHAIN_CLOSING,
    KIND_CHILD_CHAIN_OPENED, KIND_PEGOUT_DEFAULTED, KIND_SETTLEMENT_RECORDED,
};
use crate::tags::{first, required, tag, Outpoint, TAG_CHAIN, TAG_D, TAG_GENESIS};

/// An `urn:agentbox:` identifier minted elsewhere (ADR-013). This crate
/// never composes one; it checks the prefix and carries the string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Urn(String);

impl Urn {
    /// Accept a minted URN: `urn:agentbox:<kind>:…`, nothing else.
    pub fn parse(s: &str) -> Result<Self> {
        let s = s.trim();
        let rest = s
            .strip_prefix("urn:agentbox:")
            .ok_or_else(|| Error::Urn(format!("{s:?} is not an urn:agentbox: identifier")))?;
        if rest.is_empty() || rest.starts_with(':') || !rest.contains(':') {
            return Err(Error::Urn(format!("{s:?} has no kind and local part")));
        }
        Ok(Self(s.to_string()))
    }

    /// The string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Urn {
    type Error = Error;
    fn try_from(s: String) -> Result<Self> {
        Self::parse(&s)
    }
}
impl From<Urn> for String {
    fn from(u: Urn) -> String {
        u.0
    }
}
impl core::fmt::Display for Urn {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The 38420 binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountBinding {
    /// The chain, `sidestr:<name>`.
    pub chain_id: String,
    /// The chain's genesis hash, 64 hex: the monetary identity the name alone is not.
    pub genesis_hash: String,
    /// The principal's identity pubkey, 64 hex — the event's author.
    pub did_hex: String,
    /// The derived spend pubkey on this chain, 64 hex (ADR-2101 D3: never the identity key).
    pub spend_pubkey: String,
}

/// The `d` value of a binding: `<chain id>:<did hex>`.
pub fn binding_address(chain_id: &str, did_hex: &str) -> String {
    format!("{chain_id}:{did_hex}")
}

/// Split a binding `d`. The chain id contains a colon, so the DID is what
/// follows the last one and must be 64 hex.
pub fn parse_binding_address(d: &str) -> Result<(String, String)> {
    let (chain, did) = d.rsplit_once(':').ok_or_else(|| Error::Tag {
        tag: TAG_D,
        reason: format!("{d:?} is not <chain id>:<did hex>"),
    })?;
    if chain.is_empty() {
        return Err(Error::Tag {
            tag: TAG_D,
            reason: format!("{d:?} names no chain"),
        });
    }
    let did = hex_of("did hex", did, 32).map_err(|e| Error::Tag {
        tag: TAG_D,
        reason: e.to_string(),
    })?;
    Ok((chain.to_string(), did))
}

/// The unsigned 38420: `d`, `chain`, `genesis`; content the spend pubkey.
pub fn account_binding_event(b: &AccountBinding, created_at: u64) -> Result<UnsignedEvent> {
    Ok(UnsignedEvent {
        pubkey: hex_of("did hex", &b.did_hex, 32)?,
        created_at,
        kind: KIND_ACCOUNT_BINDING,
        tags: vec![
            tag(
                TAG_D,
                binding_address(&b.chain_id, &b.did_hex.to_ascii_lowercase()),
            ),
            tag(TAG_CHAIN, &b.chain_id),
            tag(TAG_GENESIS, hex_of("genesis hash", &b.genesis_hash, 32)?),
        ],
        content: hex_of("spend pubkey", &b.spend_pubkey, 32)?,
    })
}

/// Sign a binding with the identity key. The signer must *be* `did_hex`:
/// a binding signed by any other key is refused before it is made.
pub fn sign_account_binding(
    signer: &dyn Signer,
    b: &AccountBinding,
    created_at: u64,
) -> Result<Event> {
    let me = signer.pubkey_hex()?;
    if !me.eq_ignore_ascii_case(b.did_hex.trim()) {
        return Err(Error::Key(
            "a binding is signed by the identity key it names".into(),
        ));
    }
    sign(signer, account_binding_event(b, created_at)?)
}

/// Decode a 38420. The `d` DID must be the author. Does not verify the
/// signature.
pub fn parse_account_binding(ev: &Event) -> Result<AccountBinding> {
    expect_kind(ev.kind, KIND_ACCOUNT_BINDING, "sidestr-account-binding")?;
    let (chain_id, did_hex) = parse_binding_address(required(&ev.tags, TAG_D)?)?;
    if !ev.pubkey.eq_ignore_ascii_case(&did_hex) {
        return Err(Error::Chain(format!(
            "binding for {did_hex} is signed by {}: not the identity key",
            ev.pubkey
        )));
    }
    if let Some(c) = first(&ev.tags, TAG_CHAIN) {
        if c != chain_id {
            return Err(Error::Disagree {
                tag: TAG_CHAIN,
                tag_value: c.to_string(),
                content_value: chain_id,
            });
        }
    }
    Ok(AccountBinding {
        chain_id,
        genesis_hash: hex_of("genesis hash", required(&ev.tags, TAG_GENESIS)?, 32)?,
        did_hex,
        spend_pubkey: hex_of("spend pubkey", &ev.content, 32)?,
    })
}

/// A child chain's close boundary (DDD-022 `closePolicy`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClosePolicy {
    /// Close at a sidechain height.
    Height(u32),
    /// Close at a unix time.
    Time(u64),
}

/// 38421: a burn the peg holders did not pay within `pegoutBlocks`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PegOutDefaulted {
    /// The chain URN (pins the genesis).
    pub chain: Urn,
    /// The chain id on the wire.
    pub chain_id: String,
    /// The burn, sidechain txid : vout.
    pub burn: Outpoint,
    /// What was burned, sats.
    pub value: u64,
    /// The parent script it was owed to, hex.
    pub script: String,
    /// The sidechain height of the burn.
    pub burn_height: u32,
    /// The parent height by which it was due.
    pub due_parent_height: u32,
}

/// 38422: a child chain sealed and bound to a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildChainOpened {
    /// The child's chain URN.
    pub chain: Urn,
    /// The child's id, `sidestr:dl-s-<sha12>`.
    pub chain_id: String,
    /// The parent (root) chain id.
    pub parent_chain_id: String,
    /// The child's genesis hash, 64 hex.
    pub genesis_hash: String,
    /// The session URN it settles for (`boundTo`).
    pub bound_to: Urn,
    /// When it closes.
    pub close_policy: ClosePolicy,
}

/// 38423: the close boundary reached; no new blocks past it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildChainClosing {
    /// The child's chain URN.
    pub chain: Urn,
    /// The child's id.
    pub chain_id: String,
    /// The boundary that was reached.
    pub close_policy: ClosePolicy,
    /// The child's height at the boundary.
    pub height: u32,
}

/// 38424: the closing hash checkpointed into the parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainTombstoned {
    /// The chain URN.
    pub chain: Urn,
    /// The chain id.
    pub chain_id: String,
    /// The closing height.
    pub height: u32,
    /// The closing block hash, 64 hex.
    pub hash: String,
    /// The parent transaction carrying the `ckpt:` record, 64 hex.
    pub parent_txid: String,
}

/// 38425: a settlement finalised.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementRecorded {
    /// The chain URN.
    pub chain: Urn,
    /// The chain id.
    pub chain_id: String,
    /// The settling transaction, 64 hex.
    pub txid: String,
    /// The amount, sats or asset units.
    pub amount: u64,
    /// The asset URN, `None` for the pegged coin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<Urn>,
    /// The `SettlementReceipt` URN.
    pub receipt: Urn,
    /// The height at which it became final.
    pub final_height: u32,
}

/// One of the five, decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainEvent {
    /// 38421.
    PegOutDefaulted(PegOutDefaulted),
    /// 38422.
    ChildChainOpened(ChildChainOpened),
    /// 38423.
    ChildChainClosing(ChildChainClosing),
    /// 38424.
    ChainTombstoned(ChainTombstoned),
    /// 38425.
    SettlementRecorded(SettlementRecorded),
}

impl DomainEvent {
    /// The kind this event is published as.
    pub fn kind(&self) -> u32 {
        match self {
            DomainEvent::PegOutDefaulted(_) => KIND_PEGOUT_DEFAULTED,
            DomainEvent::ChildChainOpened(_) => KIND_CHILD_CHAIN_OPENED,
            DomainEvent::ChildChainClosing(_) => KIND_CHILD_CHAIN_CLOSING,
            DomainEvent::ChainTombstoned(_) => KIND_CHAIN_TOMBSTONED,
            DomainEvent::SettlementRecorded(_) => KIND_SETTLEMENT_RECORDED,
        }
    }

    /// The chain id the content names.
    pub fn chain_id(&self) -> &str {
        match self {
            DomainEvent::PegOutDefaulted(e) => &e.chain_id,
            DomainEvent::ChildChainOpened(e) => &e.chain_id,
            DomainEvent::ChildChainClosing(e) => &e.chain_id,
            DomainEvent::ChainTombstoned(e) => &e.chain_id,
            DomainEvent::SettlementRecorded(e) => &e.chain_id,
        }
    }

    fn check(&self) -> Result<()> {
        match self {
            DomainEvent::PegOutDefaulted(e) => {
                hex_of("script", &e.script, e.script.len() / 2).map(drop)
            }
            DomainEvent::ChildChainOpened(e) => {
                hex_of("genesis hash", &e.genesis_hash, 32).map(drop)
            }
            DomainEvent::ChildChainClosing(_) => Ok(()),
            DomainEvent::ChainTombstoned(e) => {
                hex_of("hash", &e.hash, 32)?;
                hex_of("parent txid", &e.parent_txid, 32).map(drop)
            }
            DomainEvent::SettlementRecorded(e) => hex_of("txid", &e.txid, 32).map(drop),
        }
    }

    fn content(&self) -> Result<String> {
        Ok(match self {
            DomainEvent::PegOutDefaulted(e) => serde_json::to_string(e)?,
            DomainEvent::ChildChainOpened(e) => serde_json::to_string(e)?,
            DomainEvent::ChildChainClosing(e) => serde_json::to_string(e)?,
            DomainEvent::ChainTombstoned(e) => serde_json::to_string(e)?,
            DomainEvent::SettlementRecorded(e) => serde_json::to_string(e)?,
        })
    }
}

/// The unsigned event for a domain event: `chain` tag as an index, content
/// the JSON.
pub fn domain_event(e: &DomainEvent, created_at: u64) -> Result<UnsignedEvent> {
    e.check()?;
    if e.chain_id().is_empty() {
        return Err(Error::Chain("empty chain id".into()));
    }
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: e.kind(),
        tags: vec![tag(TAG_CHAIN, e.chain_id())],
        content: e.content()?,
    })
}

/// Sign a domain event with the estate's publishing key for the chain plane.
pub fn sign_domain_event(signer: &dyn Signer, e: &DomainEvent, created_at: u64) -> Result<Event> {
    sign(signer, domain_event(e, created_at)?)
}

/// Decode any of 38421–38425. Any other kind is [`Error::Kind`] against
/// 38421. Does not verify the signature.
pub fn parse_domain_event(ev: &Event) -> Result<DomainEvent> {
    let e = match ev.kind {
        KIND_PEGOUT_DEFAULTED => DomainEvent::PegOutDefaulted(serde_json::from_str(&ev.content)?),
        KIND_CHILD_CHAIN_OPENED => {
            DomainEvent::ChildChainOpened(serde_json::from_str(&ev.content)?)
        }
        KIND_CHILD_CHAIN_CLOSING => {
            DomainEvent::ChildChainClosing(serde_json::from_str(&ev.content)?)
        }
        KIND_CHAIN_TOMBSTONED => DomainEvent::ChainTombstoned(serde_json::from_str(&ev.content)?),
        KIND_SETTLEMENT_RECORDED => {
            DomainEvent::SettlementRecorded(serde_json::from_str(&ev.content)?)
        }
        other => {
            return Err(Error::Kind {
                expected: KIND_PEGOUT_DEFAULTED,
                found: other,
                what: "a settlement domain event (38421-38425)",
            })
        }
    };
    e.check()?;
    if let Some(c) = first(&ev.tags, TAG_CHAIN) {
        if c != e.chain_id() {
            return Err(Error::Disagree {
                tag: TAG_CHAIN,
                tag_value: c.to_string(),
                content_value: e.chain_id().to_string(),
            });
        }
    }
    Ok(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::SecretKeySigner;

    fn identity() -> SecretKeySigner {
        SecretKeySigner::from_bytes(&[11u8; 32]).unwrap()
    }
    fn urn(s: &str) -> Urn {
        Urn::parse(s).unwrap()
    }
    fn binding() -> AccountBinding {
        AccountBinding {
            chain_id: "sidestr:dreamlab".into(),
            genesis_hash: "4D".repeat(32),
            did_hex: identity().pubkey_hex().unwrap(),
            spend_pubkey: "ab".repeat(32),
        }
    }

    #[test]
    fn urn_is_checked_not_minted() {
        assert!(Urn::parse("urn:agentbox:chain:dreamlab:4db3751772").is_ok());
        for bad in [
            "urn:visionclaw:chain:x",
            "urn:agentbox:",
            "urn:agentbox:chain",
            "urn:agentbox::x",
            "chain:x",
        ] {
            assert!(matches!(Urn::parse(bad), Err(Error::Urn(_))), "{bad}");
        }
        let u: Urn = serde_json::from_str("\"urn:agentbox:session:abc\"").unwrap();
        assert_eq!(u.to_string(), "urn:agentbox:session:abc");
        assert!(serde_json::from_str::<Urn>("\"nope\"").is_err());
    }

    #[test]
    fn binding_round_trip() {
        let ev = sign_account_binding(&identity(), &binding(), 1).unwrap();
        assert_eq!(ev.kind, 38420);
        assert_eq!(ev.tags[2], vec!["genesis", &"4d".repeat(32)]);
        let b = parse_account_binding(&ev).unwrap();
        assert_eq!(b.genesis_hash, "4d".repeat(32));
        assert_eq!(b.chain_id, "sidestr:dreamlab");
        assert_eq!(
            parse_binding_address(&ev.tags[0][1]).unwrap().0,
            "sidestr:dreamlab"
        );
    }

    #[test]
    fn a_binding_is_signed_by_the_identity_it_names() {
        let other = SecretKeySigner::from_bytes(&[12u8; 32]).unwrap();
        assert!(matches!(
            sign_account_binding(&other, &binding(), 1),
            Err(Error::Key(_))
        ));
        // an event whose d names a DID other than its author
        let mut b = binding();
        b.did_hex = other.pubkey_hex().unwrap();
        let ev = sign_account_binding(&other, &b, 1).unwrap();
        let mut forged = ev.clone();
        forged.pubkey = identity().pubkey_hex().unwrap();
        assert!(matches!(
            parse_account_binding(&forged),
            Err(Error::Chain(_))
        ));
        let mut chain = ev.clone();
        chain.tags[1][1] = "sidestr:other".into();
        assert!(matches!(
            parse_account_binding(&chain),
            Err(Error::Disagree { tag: "chain", .. })
        ));
        let mut nog = ev.clone();
        nog.tags.pop();
        assert!(matches!(
            parse_account_binding(&nog),
            Err(Error::MissingTag("genesis"))
        ));
        let mut short = ev;
        short.content = "ab".into();
        assert!(matches!(
            parse_account_binding(&short),
            Err(Error::Hex { .. })
        ));
        assert!(parse_binding_address("sidestr:x:zz").is_err());
        assert!(parse_binding_address(&format!(":{}", "ab".repeat(32))).is_err());
        assert!(account_binding_event(
            &AccountBinding {
                genesis_hash: "x".into(),
                ..binding()
            },
            1
        )
        .is_err());
    }

    fn all_five() -> Vec<DomainEvent> {
        vec![
            DomainEvent::PegOutDefaulted(PegOutDefaulted {
                chain: urn("urn:agentbox:chain:dreamlab:4db3751772"),
                chain_id: "sidestr:dreamlab".into(),
                burn: Outpoint {
                    txid: "aa".repeat(32),
                    vout: 1,
                },
                value: 20_000,
                script: "0014".to_string() + &"bb".repeat(20),
                burn_height: 40,
                due_parent_height: 153_700,
            }),
            DomainEvent::ChildChainOpened(ChildChainOpened {
                chain: urn("urn:agentbox:chain:dl-s-abcdef012345:0123456789ab"),
                chain_id: "sidestr:dl-s-abcdef012345".into(),
                parent_chain_id: "sidestr:dreamlab".into(),
                genesis_hash: "cc".repeat(32),
                bound_to: urn("urn:agentbox:session:abc"),
                close_policy: ClosePolicy::Height(500),
            }),
            DomainEvent::ChildChainClosing(ChildChainClosing {
                chain: urn("urn:agentbox:chain:dl-s-abcdef012345:0123456789ab"),
                chain_id: "sidestr:dl-s-abcdef012345".into(),
                close_policy: ClosePolicy::Time(1_790_200_000),
                height: 500,
            }),
            DomainEvent::ChainTombstoned(ChainTombstoned {
                chain: urn("urn:agentbox:chain:dl-s-abcdef012345:0123456789ab"),
                chain_id: "sidestr:dl-s-abcdef012345".into(),
                height: 500,
                hash: "dd".repeat(32),
                parent_txid: "ee".repeat(32),
            }),
            DomainEvent::SettlementRecorded(SettlementRecorded {
                chain: urn("urn:agentbox:chain:dreamlab:4db3751772"),
                chain_id: "sidestr:dreamlab".into(),
                txid: "ff".repeat(32),
                amount: 1234,
                asset: None,
                receipt: urn("urn:agentbox:receipt:abc:sha256-12-0123456789ab"),
                final_height: 41,
            }),
        ]
    }

    #[test]
    fn the_five_round_trip_with_content_authoritative() {
        let s = identity();
        for (i, e) in all_five().into_iter().enumerate() {
            let ev = sign_domain_event(&s, &e, 1).unwrap();
            assert_eq!(ev.kind, 38421 + i as u32);
            assert_eq!(ev.tags, vec![vec!["chain", e.chain_id()]]);
            assert_eq!(parse_domain_event(&ev).unwrap(), e);
            let mut c = ev.clone();
            c.tags[0][1] = "sidestr:elsewhere".into();
            assert!(matches!(
                parse_domain_event(&c),
                Err(Error::Disagree { .. })
            ));
            let mut junk = ev;
            junk.content = "{}".into();
            assert!(matches!(parse_domain_event(&junk), Err(Error::Json(_))));
        }
        let v: serde_json::Value =
            serde_json::from_str(&sign_domain_event(&s, &all_five()[1], 1).unwrap().content)
                .unwrap();
        assert_eq!(v["closePolicy"], serde_json::json!({"height": 500}));
        assert_eq!(v["boundTo"], "urn:agentbox:session:abc");
    }

    #[test]
    fn domain_event_rejections() {
        let mut ev = sign_domain_event(&identity(), &all_five()[4], 1).unwrap();
        ev.kind = 38420;
        assert!(matches!(
            parse_domain_event(&ev),
            Err(Error::Kind { found: 38420, .. })
        ));
        let DomainEvent::ChainTombstoned(mut t) = all_five()[3].clone() else {
            panic!()
        };
        t.hash = "dd".into();
        assert!(matches!(
            domain_event(&DomainEvent::ChainTombstoned(t.clone()), 1),
            Err(Error::Hex { .. })
        ));
        let bad_urn = serde_json::json!({"chain":"urn:x","chainId":"sidestr:d","height":1,"hash":"dd".repeat(32),"parentTxid":"ee".repeat(32)});
        let mut e = sign_domain_event(&identity(), &all_five()[3], 1).unwrap();
        e.content = bad_urn.to_string();
        assert!(matches!(parse_domain_event(&e), Err(Error::Json(_))));
        let DomainEvent::PegOutDefaulted(mut p) = all_five()[0].clone() else {
            panic!()
        };
        p.chain_id = String::new();
        assert!(matches!(
            domain_event(&DomainEvent::PegOutDefaulted(p), 1),
            Err(Error::Chain(_))
        ));
    }
}
