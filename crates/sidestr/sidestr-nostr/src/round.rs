//! The level-2 round's events, codecs only (SPEC 9.1, `proposals/level-2.md`;
//! `siding/lib/round.mjs`, `pegoutround.mjs`).
//!
//! From `round.mjs`: the proposer for a height builds the block and
//! publishes it as a kind 23510 event; each other signer checks it against
//! its own chain and mempool and answers with a kind 23511 partial
//! signature; with `k` the proposer seals the block, adds it, publishes it
//! as a kind 23514 event for the others and announces it. Signer keys are
//! Nostr keys, so an event's author is the signer. From `pegoutround.mjs`: a
//! burn is paid from the k-of-n peg by a PSBT round — the payer funds and
//! signs a PSBT and publishes it as kind 23512, `d` = the burn's outpoint;
//! each other signer checks it pays exactly that burn from the peg, signs it
//! with its wallet, and answers with kind 23513.
//!
//! **What is not here.** The round logic — who is entitled to propose when,
//! one signature per height, the re-sign-after-timeout rule ADR-2101 rejects,
//! the seal — is a consensus matter for `sidestr-core` and the producer, not
//! a wire format. These are the five envelopes: what each carries, what each
//! must not lack. A consumer checks the author against the signer set
//! (`fed.signers.includes(ev.pubkey)`) before anything else, as upstream
//! does, and the ADR-2101 amendment applies on top: a signer never signs two
//! proposals at one height.
//!
//! ```
//! use sidestr_nostr::event::SecretKeySigner;
//! use sidestr_nostr::round::{parse_partial, parse_proposal, sign_partial, sign_proposal, Partial, Proposal};
//!
//! let proposer = SecretKeySigner::from_bytes(&[1u8; 32]).unwrap();
//! let co = SecretKeySigner::from_bytes(&[2u8; 32]).unwrap();
//! let p = sign_proposal(&proposer, &Proposal { chain_id: "sidestr:fed".into(), height: 7, block_hex: "00".repeat(90) }, 1_790_100_000).unwrap();
//! let s = sign_partial(&co, &Partial { chain_id: "sidestr:fed".into(), height: 7, proposal: p.id.clone(), signature_hex: "ab".repeat(64) }, 1_790_100_001).unwrap();
//! assert_eq!(parse_proposal(&p, Some("sidestr:fed")).unwrap().height, 7);
//! assert_eq!(parse_partial(&s, Some("sidestr:fed")).unwrap().proposal, p.id);
//! ```

use crate::error::{any_hex, hex_of, Error, Result};
use crate::event::{sign, Event, Signer, UnsignedEvent};
use crate::kinds::{
    expect_kind, KIND_BLOCK_PROPOSAL, KIND_PARTIAL_SIGNATURE, KIND_PEGOUT_PSBT, KIND_PEGOUT_SIGNED,
    KIND_SEALED_BLOCK,
};
use crate::tags::{
    chain_tag, event_id_tag, height_tag, required, tag, Outpoint, TAG_CHAIN, TAG_D, TAG_E, TAG_H,
};

/// A block proposal (23510) or a sealed block (23514): the same envelope,
/// content the block hex — without its solution for a proposal, with it once
/// sealed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proposal {
    /// The chain.
    pub chain_id: String,
    /// The height the block is for (`h`).
    pub height: u32,
    /// The block, lowercase hex.
    pub block_hex: String,
}

/// A partial signature (23511) on a proposal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Partial {
    /// The chain.
    pub chain_id: String,
    /// The height (`h`).
    pub height: u32,
    /// The proposal event's id (`e`).
    pub proposal: String,
    /// The partial signature, hex, as `federation.mjs partialSignature` emits it.
    pub signature_hex: String,
}

/// A peg-out PSBT to co-sign (23512).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PegoutPsbt {
    /// The chain.
    pub chain_id: String,
    /// The burn it pays (`d`).
    pub burn: Outpoint,
    /// The sidechain height of the burn (`h`).
    pub height: u32,
    /// The PSBT, base64 as the wallet emits it, whitespace trimmed.
    pub psbt: String,
}

/// A co-signed peg-out PSBT (23513) answering a 23512.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PegoutSigned {
    /// The chain.
    pub chain_id: String,
    /// The burn (`d`).
    pub burn: Outpoint,
    /// The 23512 event's id (`e`).
    pub request: String,
    /// The PSBT with this signer's signatures added.
    pub psbt: String,
}

fn block_event(kind: u32, p: &Proposal, created_at: u64) -> Result<UnsignedEvent> {
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind,
        tags: vec![
            tag(TAG_CHAIN, &p.chain_id),
            tag(TAG_H, p.height.to_string()),
        ],
        content: any_hex("block", &p.block_hex)?,
    })
}

fn parse_block(
    ev: &Event,
    kind: u32,
    what: &'static str,
    expect: Option<&str>,
) -> Result<Proposal> {
    expect_kind(ev.kind, kind, what)?;
    Ok(Proposal {
        chain_id: chain_tag(&ev.tags, expect)?.to_string(),
        height: height_tag(&ev.tags, TAG_H)?,
        block_hex: any_hex("block", &ev.content)?,
    })
}

/// The unsigned 23510 (`round.mjs propose`): `chain`, `h`, content the block hex.
pub fn proposal_event(p: &Proposal, created_at: u64) -> Result<UnsignedEvent> {
    block_event(KIND_BLOCK_PROPOSAL, p, created_at)
}
/// Sign a proposal with the proposer's signer key.
pub fn sign_proposal(signer: &dyn Signer, p: &Proposal, created_at: u64) -> Result<Event> {
    sign(signer, proposal_event(p, created_at)?)
}
/// Decode a 23510. Check `ev.pubkey` against the signer set first.
pub fn parse_proposal(ev: &Event, expect: Option<&str>) -> Result<Proposal> {
    parse_block(ev, KIND_BLOCK_PROPOSAL, "block proposal", expect)
}

/// The unsigned 23514 (`round.mjs maybeSeal`): the same envelope, the sealed block.
pub fn sealed_event(p: &Proposal, created_at: u64) -> Result<UnsignedEvent> {
    block_event(KIND_SEALED_BLOCK, p, created_at)
}
/// Sign a sealed-block event.
pub fn sign_sealed(signer: &dyn Signer, p: &Proposal, created_at: u64) -> Result<Event> {
    sign(signer, sealed_event(p, created_at)?)
}
/// Decode a 23514.
pub fn parse_sealed(ev: &Event, expect: Option<&str>) -> Result<Proposal> {
    parse_block(ev, KIND_SEALED_BLOCK, "sealed block", expect)
}

/// The unsigned 23511 (`round.mjs onProposal`): `chain`, `h`, `e` = the
/// proposal, content the partial signature.
pub fn partial_event(p: &Partial, created_at: u64) -> Result<UnsignedEvent> {
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_PARTIAL_SIGNATURE,
        tags: vec![
            tag(TAG_CHAIN, &p.chain_id),
            tag(TAG_H, p.height.to_string()),
            tag(TAG_E, hex_of("proposal id", &p.proposal, 32)?),
        ],
        content: any_hex("partial signature", &p.signature_hex)?,
    })
}
/// Sign a partial signature event with the co-signer's signer key.
pub fn sign_partial(signer: &dyn Signer, p: &Partial, created_at: u64) -> Result<Event> {
    sign(signer, partial_event(p, created_at)?)
}
/// Decode a 23511.
pub fn parse_partial(ev: &Event, expect: Option<&str>) -> Result<Partial> {
    expect_kind(ev.kind, KIND_PARTIAL_SIGNATURE, "partial block signature")?;
    Ok(Partial {
        chain_id: chain_tag(&ev.tags, expect)?.to_string(),
        height: height_tag(&ev.tags, TAG_H)?,
        proposal: event_id_tag(&ev.tags, TAG_E)?,
        signature_hex: any_hex("partial signature", &ev.content)?,
    })
}

fn psbt_of(s: &str) -> Result<String> {
    let s = s.trim();
    if s.is_empty()
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
    {
        return Err(Error::Content("a PSBT is base64".into()));
    }
    Ok(s.to_string())
}

/// The unsigned 23512 (`pegoutround.mjs propose`): `chain`, `d` = burn
/// outpoint, `h`, content the PSBT.
pub fn pegout_psbt_event(p: &PegoutPsbt, created_at: u64) -> Result<UnsignedEvent> {
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_PEGOUT_PSBT,
        tags: vec![
            tag(TAG_CHAIN, &p.chain_id),
            tag(TAG_D, p.burn.to_string()),
            tag(TAG_H, p.height.to_string()),
        ],
        content: psbt_of(&p.psbt)?,
    })
}
/// Sign a peg-out PSBT request with the payer's signer key.
pub fn sign_pegout_psbt(signer: &dyn Signer, p: &PegoutPsbt, created_at: u64) -> Result<Event> {
    sign(signer, pegout_psbt_event(p, created_at)?)
}
/// Decode a 23512.
pub fn parse_pegout_psbt(ev: &Event, expect: Option<&str>) -> Result<PegoutPsbt> {
    expect_kind(ev.kind, KIND_PEGOUT_PSBT, "peg-out PSBT")?;
    Ok(PegoutPsbt {
        chain_id: chain_tag(&ev.tags, expect)?.to_string(),
        burn: Outpoint::parse(required(&ev.tags, TAG_D)?)?,
        height: height_tag(&ev.tags, TAG_H)?,
        psbt: psbt_of(&ev.content)?,
    })
}

/// The unsigned 23513 (`pegoutround.mjs onProposal`): `chain`, `d`, `e` =
/// the 23512, content the co-signed PSBT.
pub fn pegout_signed_event(p: &PegoutSigned, created_at: u64) -> Result<UnsignedEvent> {
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_PEGOUT_SIGNED,
        tags: vec![
            tag(TAG_CHAIN, &p.chain_id),
            tag(TAG_D, p.burn.to_string()),
            tag(TAG_E, hex_of("request id", &p.request, 32)?),
        ],
        content: psbt_of(&p.psbt)?,
    })
}
/// Sign a co-signed PSBT event.
pub fn sign_pegout_signed(signer: &dyn Signer, p: &PegoutSigned, created_at: u64) -> Result<Event> {
    sign(signer, pegout_signed_event(p, created_at)?)
}
/// Decode a 23513.
pub fn parse_pegout_signed(ev: &Event, expect: Option<&str>) -> Result<PegoutSigned> {
    expect_kind(ev.kind, KIND_PEGOUT_SIGNED, "co-signed peg-out PSBT")?;
    Ok(PegoutSigned {
        chain_id: chain_tag(&ev.tags, expect)?.to_string(),
        burn: Outpoint::parse(required(&ev.tags, TAG_D)?)?,
        request: event_id_tag(&ev.tags, TAG_E)?,
        psbt: psbt_of(&ev.content)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::SecretKeySigner;

    fn s() -> SecretKeySigner {
        SecretKeySigner::from_bytes(&[1u8; 32]).unwrap()
    }
    fn burn() -> Outpoint {
        Outpoint {
            txid: "cd".repeat(32),
            vout: 1,
        }
    }

    #[test]
    fn proposal_and_sealed_round_trip() {
        let p = Proposal {
            chain_id: "sidestr:f".into(),
            height: 7,
            block_hex: "AB".repeat(50),
        };
        let ev = sign_proposal(&s(), &p, 1).unwrap();
        assert_eq!(ev.tags, vec![vec!["chain", "sidestr:f"], vec!["h", "7"]]);
        let back = parse_proposal(&ev, Some("sidestr:f")).unwrap();
        assert_eq!(back.block_hex, "ab".repeat(50));
        assert!(
            parse_sealed(&ev, None).is_err(),
            "a proposal is not a sealed block"
        );
        let sealed = sign_sealed(&s(), &p, 1).unwrap();
        assert_eq!(parse_sealed(&sealed, None).unwrap().height, 7);
        let mut noh = ev.clone();
        noh.tags.pop();
        assert!(matches!(
            parse_proposal(&noh, None),
            Err(Error::MissingTag("h"))
        ));
        let mut bad = ev;
        bad.content = "abc".into();
        assert!(parse_proposal(&bad, None).is_err());
        assert!(proposal_event(
            &Proposal {
                block_hex: "".into(),
                ..p
            },
            1
        )
        .is_err());
    }

    #[test]
    fn partial_round_trip_and_rejections() {
        let p = Partial {
            chain_id: "sidestr:f".into(),
            height: 7,
            proposal: "EF".repeat(32),
            signature_hex: "ab".repeat(64),
        };
        let ev = sign_partial(&s(), &p, 1).unwrap();
        assert_eq!(ev.tags[2], vec!["e", &"ef".repeat(32)]);
        let back = parse_partial(&ev, None).unwrap();
        assert_eq!(back.proposal, "ef".repeat(32));
        assert!(partial_event(
            &Partial {
                proposal: "ef".into(),
                ..p.clone()
            },
            1
        )
        .is_err());
        assert!(partial_event(
            &Partial {
                signature_hex: "".into(),
                ..p
            },
            1
        )
        .is_err());
        let mut noe = ev;
        noe.tags.pop();
        assert!(matches!(
            parse_partial(&noe, None),
            Err(Error::MissingTag("e"))
        ));
    }

    #[test]
    fn pegout_round_trip_and_rejections() {
        let p = PegoutPsbt {
            chain_id: "sidestr:f".into(),
            burn: burn(),
            height: 9,
            psbt: " cHNidP8BAA== ".into(),
        };
        let ev = sign_pegout_psbt(&s(), &p, 1).unwrap();
        assert_eq!(ev.tags[1], vec!["d", &format!("{}:1", "cd".repeat(32))]);
        let back = parse_pegout_psbt(&ev, Some("sidestr:f")).unwrap();
        assert_eq!(
            (back.burn, back.height, back.psbt.as_str()),
            (burn(), 9, "cHNidP8BAA==")
        );
        let signed = sign_pegout_signed(
            &s(),
            &PegoutSigned {
                chain_id: "sidestr:f".into(),
                burn: burn(),
                request: ev.id.clone(),
                psbt: "cHNidP8BAA==".into(),
            },
            2,
        )
        .unwrap();
        assert_eq!(parse_pegout_signed(&signed, None).unwrap().request, ev.id);
        assert!(pegout_psbt_event(
            &PegoutPsbt {
                psbt: "not base64!".into(),
                ..p.clone()
            },
            1
        )
        .is_err());
        assert!(pegout_psbt_event(
            &PegoutPsbt {
                psbt: "".into(),
                ..p
            },
            1
        )
        .is_err());
        let mut d = ev.clone();
        d.tags[1][1] = "x".into();
        assert!(matches!(
            parse_pegout_psbt(&d, None),
            Err(Error::Tag { tag: "d", .. })
        ));
        let mut other = ev;
        other.tags[0][1] = "sidestr:g".into();
        assert!(matches!(
            parse_pegout_psbt(&other, Some("sidestr:f")),
            Err(Error::Chain(_))
        ));
    }
}
