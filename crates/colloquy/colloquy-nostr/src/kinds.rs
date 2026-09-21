//! Event-kind allocation, inside the range this repo already owns.
//!
//! Kinds are not free: an allocation has to be recorded in the protocol
//! registry, carried by an ADR, and backed by paired cross-repo fixtures, or CI
//! refuses it. These six sit in the agentbox second allocation band
//! `38202-38299` (ADR-2105), which no record reserves: the first band
//! `38000-38201` is fully spoken for by `38000-38099` agent intent (ADR-009,
//! PRD-004), `38100-38199` agent response (the same two records, enforced live
//! at `mcp/nostr-bridge/relay-consumer.js`) and the `38200`/`38201` payment
//! pair. Nothing outside this repo has to move to accommodate them.
//!
//! | Kind | Name | Shape | Author |
//! |---|---|---|---|
//! | 38210 | [`KIND_KNOWLEDGE_UNIT`] | addressable, `d` = unit id hex | agent or human |
//! | 38211 | [`KIND_CONFIRMATION`] | regular, append-only | agent or human |
//! | 38212 | [`KIND_FLAG`] | regular, append-only | agent or human |
//! | 38213 | [`KIND_SUPERSESSION`] | regular | the proposer |
//! | 38214 | [`KIND_GRADUATION`] | regular, cites a signed `31403` | human principal |
//! | 38215 | [`KIND_TOOL_GAP_SIGNAL`] | addressable, `d` = cluster id | agent |
//!
//! # Why the split
//!
//! The unit itself is **replaceable** so its proposer can correct a typo without
//! forking its identity. Confirmations and flags are **regular** events, so
//! evidence accretes and the proposer cannot rewrite what others said about
//! their own unit. That is the same separation the governance ledger already
//! enforces between a decision and its append-only audit log.

/// The knowledge unit. Addressable: `d` carries the unit id's hex portion.
pub const KIND_KNOWLEDGE_UNIT: u64 = 38210;
/// An independent confirmation of a unit. Append-only.
pub const KIND_CONFIRMATION: u64 = 38211;
/// A flag: this unit is wrong or stale. Append-only, and suppresses nothing.
pub const KIND_FLAG: u64 = 38212;
/// A supersession: this unit replaces that one.
pub const KIND_SUPERSESSION: u64 = 38213;
/// A tier promotion, citing the signed decision that authorised it.
pub const KIND_GRADUATION: u64 = 38214;
/// An emergent tooling-gap signal aggregated from level-2 workarounds.
pub const KIND_TOOL_GAP_SIGNAL: u64 = 38215;

/// The contiguous range these kinds occupy.
pub const COLLOQUY_KIND_RANGE: std::ops::RangeInclusive<u64> =
    KIND_KNOWLEDGE_UNIT..=KIND_TOOL_GAP_SIGNAL;

/// Every colloquy kind, ascending.
pub const ALL_KINDS: [u64; 6] = [
    KIND_KNOWLEDGE_UNIT,
    KIND_CONFIRMATION,
    KIND_FLAG,
    KIND_SUPERSESSION,
    KIND_GRADUATION,
    KIND_TOOL_GAP_SIGNAL,
];

/// Whether a kind belongs to colloquy.
pub const fn is_colloquy_kind(kind: u64) -> bool {
    kind >= *COLLOQUY_KIND_RANGE.start() && kind <= *COLLOQUY_KIND_RANGE.end()
}

/// Whether a kind is addressable (NIP-33 parameterised-replaceable), and so
/// requires a `d` tag and is identified by `<kind>:<pubkey>:<d>`.
pub const fn is_addressable(kind: u64) -> bool {
    matches!(kind, KIND_KNOWLEDGE_UNIT | KIND_TOOL_GAP_SIGNAL)
}

/// Whether a kind is append-only evidence that its subject's author must not be
/// able to rewrite.
pub const fn is_append_only(kind: u64) -> bool {
    matches!(kind, KIND_CONFIRMATION | KIND_FLAG | KIND_GRADUATION)
}

/// The human-readable name of a colloquy kind.
pub const fn kind_name(kind: u64) -> Option<&'static str> {
    Some(match kind {
        KIND_KNOWLEDGE_UNIT => "KnowledgeUnit",
        KIND_CONFIRMATION => "Confirmation",
        KIND_FLAG => "Flag",
        KIND_SUPERSESSION => "Supersession",
        KIND_GRADUATION => "Graduation",
        KIND_TOOL_GAP_SIGNAL => "ToolGapSignal",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_block_does_not_collide_with_any_reserved_range() {
        for k in ALL_KINDS {
            assert!(
                (38_202..=38_299).contains(&k),
                "{k} must sit in the agentbox second allocation band"
            );
            assert!(!(38_000..=38_099).contains(&k), "{k} collides with agent intent");
            assert!(
                !(38_100..=38_199).contains(&k),
                "{k} collides with the ADR-009 agent-response reservation"
            );
            assert!(k != 38_200 && k != 38_201, "{k} collides with the payment pair");
            assert!(!(31_400..=31_405).contains(&k), "{k} collides with governance");
        }
    }

    #[test]
    fn the_range_is_exactly_the_allocated_kinds() {
        let in_range: Vec<u64> = (0..40_000).filter(|k| is_colloquy_kind(*k)).collect();
        assert_eq!(in_range, ALL_KINDS.to_vec());
    }

    #[test]
    fn every_kind_is_named_and_nothing_else_is() {
        for k in ALL_KINDS {
            assert!(kind_name(k).is_some(), "{k} needs a name");
        }
        assert_eq!(kind_name(38_209), None);
        assert_eq!(kind_name(38_216), None);
    }

    #[test]
    fn only_the_two_replaceable_kinds_are_addressable() {
        let addressable: Vec<u64> = ALL_KINDS.into_iter().filter(|k| is_addressable(*k)).collect();
        assert_eq!(addressable, vec![KIND_KNOWLEDGE_UNIT, KIND_TOOL_GAP_SIGNAL]);
    }

    #[test]
    fn evidence_kinds_are_append_only_and_units_are_not() {
        assert!(is_append_only(KIND_CONFIRMATION));
        assert!(is_append_only(KIND_FLAG));
        assert!(is_append_only(KIND_GRADUATION));
        assert!(
            !is_append_only(KIND_KNOWLEDGE_UNIT),
            "a proposer must be able to correct their own unit"
        );
    }
}
