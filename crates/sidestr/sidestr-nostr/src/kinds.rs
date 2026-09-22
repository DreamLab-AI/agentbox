//! Every kind this crate speaks, with who owns it (SPEC Appendix A;
//! `docs/PROTOCOL-registry.md`, ADR-2098 D2, ADR-2105).
//!
//! The 2xxxx and 3xxxx numbers are the sidestr spec's, which says its field
//! names, kinds and document shapes are provisional: they are recorded as
//! **externally owned**, and an upstream change to any of them is ADR-2098's
//! review trigger. 38420–38425 are agentbox's, from its 38400–38499 band.
//!
//! Three NIP-01 classes matter here. **Ephemeral** (2xxxx) events are not
//! stored by a relay, so a transaction or a round message that nobody was
//! listening for is gone — durability is the publisher's problem, never the
//! relay's (ADR-2098 amendment: "relay drop is a normal condition").
//! **Addressable** (3xxxx) events are replaced per `(kind, pubkey, d)`, so a
//! tip announcement overwrites the last one and a rule document is one row
//! per activation height. **Regular** events accrete, which is what an
//! evidence trail needs, so the five settlement events are regular.
//!
//! ```
//! use sidestr_nostr::kinds::{lookup, Owner, Class, KIND_TIP, KIND_ACCOUNT_BINDING};
//!
//! let tip = lookup(KIND_TIP).unwrap();
//! assert_eq!((tip.owner, tip.class), (Owner::External, Class::Addressable));
//! assert_eq!(tip.d_tag, Some("chain id"));
//! assert_eq!(lookup(KIND_ACCOUNT_BINDING).unwrap().owner, Owner::Estate);
//! assert!(lookup(1).is_none());
//! ```

/// Transaction: content the transaction hex, `chain` = chain id, any key (SPEC 11).
pub const KIND_TRANSACTION: u32 = 23500;
/// Faucet request: content an address, tagged like a transaction (SPEC 11).
pub const KIND_FAUCET_REQUEST: u32 = 23501;
/// Level-2 block proposal: content the block hex without its solution (SPEC 9.1).
pub const KIND_BLOCK_PROPOSAL: u32 = 23510;
/// Level-2 partial block signature, `e` = the proposal (SPEC 9.1).
pub const KIND_PARTIAL_SIGNATURE: u32 = 23511;
/// Level-2 peg-out PSBT to co-sign, `d` = the burn's outpoint (SPEC 9.1).
pub const KIND_PEGOUT_PSBT: u32 = 23512;
/// Level-2 co-signed peg-out PSBT, `e` = the 23512 (SPEC 9.1).
pub const KIND_PEGOUT_SIGNED: u32 = 23513;
/// Level-2 sealed block, content the block hex (SPEC 9.1).
pub const KIND_SEALED_BLOCK: u32 = 23514;
/// The tip announcement in the NIP-333 shape, `d` = chain id (SPEC 11).
pub const KIND_TIP: u32 = 33333;
/// A rule document, `d` = chain id `:` activation height (SPEC 8).
pub const KIND_RULE_DOCUMENT: u32 = 33500;
/// The genesis document, `d` = chain id (SPEC Appendix A).
pub const KIND_GENESIS_DOCUMENT: u32 = 33501;
/// The peg record *or* the desk's pledge, `d` = parent txid `:` vout
/// (SPEC Appendix A; `proposals/desk.md`). Two schemas on one number.
pub const KIND_PEG_RECORD: u32 = 33502;
/// agentbox: `sidestr-account-binding`, `d` = `<chain id>:<did hex>`,
/// content the derived spend pubkey, signed by the identity key (ADR-2098 D2).
pub const KIND_ACCOUNT_BINDING: u32 = 38420;
/// agentbox: `PegOutDefaulted` — `pegoutBlocks` elapsed unpaid (DDD-022).
pub const KIND_PEGOUT_DEFAULTED: u32 = 38421;
/// agentbox: `ChildChainOpened` — a child chain sealed and bound at session create (DDD-022).
pub const KIND_CHILD_CHAIN_OPENED: u32 = 38422;
/// agentbox: `ChildChainClosing` — the `closePolicy` boundary reached (DDD-022).
pub const KIND_CHILD_CHAIN_CLOSING: u32 = 38423;
/// agentbox: `ChainTombstoned` — the closing hash checkpointed into the parent (DDD-022).
pub const KIND_CHAIN_TOMBSTONED: u32 = 38424;
/// agentbox: `SettlementRecorded` — a settlement finalised (DDD-022).
pub const KIND_SETTLEMENT_RECORDED: u32 = 38425;

/// Who owns a kind's number and shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Owner {
    /// The sidestr spec (pre-0.0.1, provisional): consumed and published as-is.
    External,
    /// agentbox, from its 38400–38499 band (ADR-2105).
    Estate,
}

/// The NIP-01 storage class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// 20000–29999: not stored by relays.
    Ephemeral,
    /// 30000–39999: replaced per `(kind, pubkey, d)`.
    Addressable,
    /// Stored and accreted.
    Regular,
}

/// Where a codec's confidence comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Conformance {
    /// Ported from upstream implementing code and checked against it.
    Ported,
    /// SPEC prose only: upstream has no implementing code or wire example.
    ProseOnly,
    /// Defined by the estate's own records.
    Estate,
}

/// One row of the registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KindInfo {
    /// The number.
    pub kind: u32,
    /// The name the registry uses.
    pub name: &'static str,
    /// Who owns it.
    pub owner: Owner,
    /// Its storage class.
    pub class: Class,
    /// What the `d` tag carries, for addressable kinds.
    pub d_tag: Option<&'static str>,
    /// What the codec is conformant to.
    pub conformance: Conformance,
    /// SPEC section, or the estate record.
    pub spec: &'static str,
    /// The upstream file the codec was ported from, or the estate record.
    pub source: &'static str,
}

/// The registry, in kind order.
pub const REGISTRY: [KindInfo; 17] = [
    KindInfo {
        kind: KIND_TRANSACTION,
        name: "transaction",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: None,
        conformance: Conformance::Ported,
        spec: "SPEC 11, Appendix A",
        source: "siding/lib/relay.mjs txEvent",
    },
    KindInfo {
        kind: KIND_FAUCET_REQUEST,
        name: "faucet request",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: None,
        conformance: Conformance::Ported,
        spec: "SPEC 11, Appendix A",
        source: "siding/lib/relay.mjs FAUCET_KIND, bin/siding.mjs faucet",
    },
    KindInfo {
        kind: KIND_BLOCK_PROPOSAL,
        name: "block proposal",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: None,
        conformance: Conformance::Ported,
        spec: "SPEC 9.1, proposals/level-2.md",
        source: "siding/lib/round.mjs propose",
    },
    KindInfo {
        kind: KIND_PARTIAL_SIGNATURE,
        name: "partial block signature",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: None,
        conformance: Conformance::Ported,
        spec: "SPEC 9.1",
        source: "siding/lib/round.mjs onProposal",
    },
    KindInfo {
        kind: KIND_PEGOUT_PSBT,
        name: "peg-out PSBT",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: Some("burn outpoint"),
        conformance: Conformance::Ported,
        spec: "SPEC 9.1, level-2 step 6",
        source: "siding/lib/pegoutround.mjs propose",
    },
    KindInfo {
        kind: KIND_PEGOUT_SIGNED,
        name: "co-signed peg-out PSBT",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: Some("burn outpoint"),
        conformance: Conformance::Ported,
        spec: "SPEC 9.1",
        source: "siding/lib/pegoutround.mjs onProposal",
    },
    KindInfo {
        kind: KIND_SEALED_BLOCK,
        name: "sealed block",
        owner: Owner::External,
        class: Class::Ephemeral,
        d_tag: None,
        conformance: Conformance::Ported,
        spec: "SPEC 9.1",
        source: "siding/lib/round.mjs maybeSeal",
    },
    KindInfo {
        kind: KIND_TIP,
        name: "tip",
        owner: Owner::External,
        class: Class::Addressable,
        d_tag: Some("chain id"),
        conformance: Conformance::Ported,
        spec: "SPEC 11",
        source: "siding/lib/announce.mjs",
    },
    KindInfo {
        kind: KIND_RULE_DOCUMENT,
        name: "rule document",
        owner: Owner::External,
        class: Class::Addressable,
        d_tag: Some("chain id : activation height"),
        conformance: Conformance::ProseOnly,
        spec: "SPEC 8",
        source: "none upstream",
    },
    KindInfo {
        kind: KIND_GENESIS_DOCUMENT,
        name: "genesis document",
        owner: Owner::External,
        class: Class::Addressable,
        d_tag: Some("chain id"),
        conformance: Conformance::ProseOnly,
        spec: "SPEC Appendix A",
        source: "none upstream",
    },
    KindInfo {
        kind: KIND_PEG_RECORD,
        name: "peg record | pledge",
        owner: Owner::External,
        class: Class::Addressable,
        d_tag: Some("parent txid : vout"),
        conformance: Conformance::Ported,
        spec: "SPEC Appendix A, 6.2, proposals/desk.md",
        source: "siding/lib/pledge.mjs, bin/siding.mjs onPledge (pledge); prose only (peg record)",
    },
    KindInfo {
        kind: KIND_ACCOUNT_BINDING,
        name: "sidestr-account-binding",
        owner: Owner::Estate,
        class: Class::Addressable,
        d_tag: Some("chain id : did hex"),
        conformance: Conformance::Estate,
        spec: "ADR-2098 D2, ADR-2101 D4",
        source: "docs/PROTOCOL-registry.md",
    },
    KindInfo {
        kind: KIND_PEGOUT_DEFAULTED,
        name: "PegOutDefaulted",
        owner: Owner::Estate,
        class: Class::Regular,
        d_tag: None,
        conformance: Conformance::Estate,
        spec: "DDD-022 domain events",
        source: "docs/proposals/sovereign-settlement-domain.md",
    },
    KindInfo {
        kind: KIND_CHILD_CHAIN_OPENED,
        name: "ChildChainOpened",
        owner: Owner::Estate,
        class: Class::Regular,
        d_tag: None,
        conformance: Conformance::Estate,
        spec: "DDD-022 domain events",
        source: "docs/proposals/sovereign-settlement-domain.md",
    },
    KindInfo {
        kind: KIND_CHILD_CHAIN_CLOSING,
        name: "ChildChainClosing",
        owner: Owner::Estate,
        class: Class::Regular,
        d_tag: None,
        conformance: Conformance::Estate,
        spec: "DDD-022 domain events",
        source: "docs/proposals/sovereign-settlement-domain.md",
    },
    KindInfo {
        kind: KIND_CHAIN_TOMBSTONED,
        name: "ChainTombstoned",
        owner: Owner::Estate,
        class: Class::Regular,
        d_tag: None,
        conformance: Conformance::Estate,
        spec: "DDD-022 domain events",
        source: "docs/proposals/sovereign-settlement-domain.md",
    },
    KindInfo {
        kind: KIND_SETTLEMENT_RECORDED,
        name: "SettlementRecorded",
        owner: Owner::Estate,
        class: Class::Regular,
        d_tag: None,
        conformance: Conformance::Estate,
        spec: "DDD-022 domain events",
        source: "docs/proposals/sovereign-settlement-domain.md",
    },
];

/// The registry row for a kind, if this crate speaks it.
pub fn lookup(kind: u32) -> Option<&'static KindInfo> {
    REGISTRY.iter().find(|k| k.kind == kind)
}

/// Whether this is one of the sidestr spec's kinds.
pub fn is_external(kind: u32) -> bool {
    matches!(lookup(kind), Some(k) if k.owner == Owner::External)
}

/// Whether this is one of agentbox's kinds (38420–38425).
pub fn is_estate(kind: u32) -> bool {
    matches!(lookup(kind), Some(k) if k.owner == Owner::Estate)
}

/// Refuse an event of the wrong kind, by name.
pub(crate) fn expect_kind(found: u32, expected: u32, what: &'static str) -> crate::Result<()> {
    if found == expected {
        Ok(())
    } else {
        Err(crate::Error::Kind {
            expected,
            found,
            what,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_sorted_unique_and_classed_by_number() {
        let mut prev = 0;
        for k in REGISTRY {
            assert!(k.kind > prev, "{} out of order", k.kind);
            prev = k.kind;
            let class = match k.kind {
                20000..=29999 => Class::Ephemeral,
                30000..=39999 if k.owner == Owner::External => Class::Addressable,
                _ => k.class,
            };
            assert_eq!(k.class, class, "{}", k.kind);
            assert_eq!(
                k.owner == Owner::Estate,
                (38420..=38425).contains(&k.kind),
                "{}",
                k.kind
            );
            assert!(
                k.d_tag.is_some() || k.class != Class::Addressable,
                "{}",
                k.kind
            );
        }
        assert!(is_external(KIND_TIP) && !is_estate(KIND_TIP));
        assert!(is_estate(KIND_SETTLEMENT_RECORDED));
        assert!(matches!(
            expect_kind(1, KIND_TIP, "tip"),
            Err(crate::Error::Kind { found: 1, .. })
        ));
    }
}
