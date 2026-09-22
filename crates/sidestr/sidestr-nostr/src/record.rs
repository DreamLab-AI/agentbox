//! Kind 33502: the peg record **or** the desk's pledge, told apart by
//! structure and never guessed (ADR-2098 D2).
//!
//! SPEC Appendix A lists 33502 as "peg record, `d` = parent txid : vout" and
//! says nothing about its content. `proposals/desk.md` and
//! `siding/lib/pledge.mjs` use the same number for a **pledge**: "the miner
//! publishes it as a kind 33502 event, `d` = the reward's outpoint, content
//! the transaction hex", and the producer's `onPledge` (`bin/siding.mjs`)
//! reads exactly that — `d` as `<txid>:<vout>`, content a pre-signed
//! maturity transaction with one input, two outputs, output 1 a `pegin:`
//! marker naming the chain and a 34-byte payee script — after `subscribe`
//! has required the `chain` tag. DDD-022 calls this "two schemas on one kind
//! … distinguished only by `d`-tag shape" and asks that "our parser
//! disambiguates structurally rather than by kind number".
//!
//! So [`parse_record`] returns one of three things:
//!
//! - [`Record::Pledge`] when the content is a transaction of the pledge
//!   shape (one input, two outputs, output 1 a `pegin:<chain id>:<script>`
//!   marker, a lock time). The producer's other checks — the reward exists,
//!   is a locked coinbase, the signature verifies, the fee is in range — need
//!   a parent view and stay in the desk (`pledge.mjs verifyPledge`).
//! - [`Record::PegRecord`] when the content is a JSON object: the peg record
//!   the spec names and never defines, carried as its fields.
//! - [`Record::Ambiguous`] otherwise, with the reason: a transaction that is
//!   not pledge-shaped, a pledge whose marker names a chain other than the
//!   `chain` tag, or content that is neither. A consumer that wants to act
//!   on an ambiguous record must decide for itself, and say so.
//!
//! A malformed `d` or the wrong kind is an error, not a record: the number
//! and the address are the contract both schemas share.
//!
//! ```
//! use sidestr_nostr::event::SecretKeySigner;
//! use sidestr_nostr::record::{parse_record, sign_pledge, Record};
//! use sidestr_nostr::tags::Outpoint;
//!
//! // a pledge-shaped transaction: 1 in, 2 out, output 1 = OP_RETURN "pegin:sidestr:example:<34 bytes>"
//! let marker = { let mut d = b"pegin:sidestr:example:".to_vec(); d.push(0x51); d.push(0x20); d.extend([7u8; 32]); d };
//! let mut tx = hex::decode("02000000").unwrap();
//! tx.push(1); tx.extend([0xaa; 32]); tx.extend(0u32.to_le_bytes()); tx.push(0); tx.extend(0xfffffffeu32.to_le_bytes());
//! tx.push(2);
//! tx.extend(4_999_000_000u64.to_le_bytes()); tx.push(34); tx.push(0x51); tx.push(0x20); tx.extend([9u8; 32]);
//! tx.extend(0u64.to_le_bytes()); tx.push(marker.len() as u8 + 2); tx.push(0x6a); tx.push(marker.len() as u8); tx.extend(&marker);
//! tx.extend(151_460u32.to_le_bytes());
//!
//! let miner = SecretKeySigner::from_bytes(&[5u8; 32]).unwrap();
//! let outpoint = Outpoint { txid: "aa".repeat(32), vout: 0 };
//! let ev = sign_pledge(&miner, "sidestr:example", &outpoint, &hex::encode(&tx), 1_790_100_000).unwrap();
//! match parse_record(&ev).unwrap() {
//!     Record::Pledge(p) => { assert_eq!(p.lock_time, 151_460); assert_eq!(p.chain_id, "sidestr:example"); }
//!     other => panic!("{other:?}"),
//! }
//! ```

use bitcoin::consensus::encode::deserialize;
use bitcoin::Transaction;
use serde::{Deserialize, Serialize};
use sidestr_core::marker::op_return_data;

use crate::error::{any_hex, Error, Result};
use crate::event::{sign, Event, Signer, UnsignedEvent};
use crate::kinds::{expect_kind, KIND_PEG_RECORD};
use crate::tags::{first, required, tag, Outpoint, TAG_CHAIN, TAG_D};

/// A desk pledge (`proposals/desk.md`, SPEC 6.2): a pre-signed maturity
/// transaction spending a locked reward to the chain's peg, with the peg-in
/// marker naming the pledger's sidechain script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pledge {
    /// The reward, from `d`.
    pub outpoint: Outpoint,
    /// The chain the marker names.
    pub chain_id: String,
    /// The transaction, lowercase hex.
    pub tx_hex: String,
    /// `nLockTime`: the reward's maturity height.
    pub lock_time: u32,
    /// The key-path script the marker names, hex (`5120` + 32 bytes).
    pub payee_script: String,
    /// What output 0 pays to the peg, sats.
    pub peg_value: u64,
    /// Output 0's script, hex: the desk checks it is `pegScript`.
    pub peg_script: String,
}

/// The peg record the spec names (Appendix A) and never defines: its fields
/// as published.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PegRecord {
    /// The peg output, from `d`.
    pub outpoint: Outpoint,
    /// The chain from the `chain` tag, when tagged.
    pub chain_id: Option<String>,
    /// The content's fields.
    pub fields: serde_json::Map<String, serde_json::Value>,
}

/// A 33502 event whose schema could not be told.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ambiguous {
    /// The outpoint, from `d`: always well-formed, or the event was an error.
    pub outpoint: Outpoint,
    /// Why neither schema fits.
    pub reason: String,
}

/// What a 33502 event turned out to be.
#[derive(Debug, Clone, PartialEq)]
pub enum Record {
    /// A desk pledge.
    Pledge(Pledge),
    /// A peg record.
    PegRecord(PegRecord),
    /// Neither, with the reason.
    Ambiguous(Ambiguous),
}

impl Serialize for Outpoint {
    fn serialize<S: serde::Serializer>(&self, s: S) -> core::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Outpoint {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> core::result::Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Outpoint::parse(&s).map_err(serde::de::Error::custom)
    }
}

/// The unsigned pledge event: `chain` tag (the producer's `subscribe`
/// requires it), `d` = the reward's outpoint, content the transaction hex.
pub fn pledge_event(
    chain_id: &str,
    reward: &Outpoint,
    tx_hex: &str,
    created_at: u64,
) -> Result<UnsignedEvent> {
    let tx_hex = any_hex("pledge transaction", tx_hex)?;
    let tx: Transaction = deserialize(&hex::decode(&tx_hex).expect("checked hex"))
        .map_err(|e| Error::Content(format!("not a transaction: {e}")))?;
    let p = pledge_shape(&tx).map_err(Error::Content)?;
    if p.0 != chain_id {
        return Err(Error::Chain(format!(
            "the marker names {}, not {chain_id}",
            p.0
        )));
    }
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_PEG_RECORD,
        tags: vec![tag(TAG_CHAIN, chain_id), tag(TAG_D, reward.to_string())],
        content: tx_hex,
    })
}

/// Sign a pledge with the miner's key — the key that owns the reward, as
/// `pledge.mjs buildPledge` requires.
pub fn sign_pledge(
    signer: &dyn Signer,
    chain_id: &str,
    reward: &Outpoint,
    tx_hex: &str,
    created_at: u64,
) -> Result<Event> {
    sign(signer, pledge_event(chain_id, reward, tx_hex, created_at)?)
}

/// The unsigned peg-record event: `d` = the peg outpoint, `chain` when
/// given, content the fields as a JSON object.
pub fn peg_record_event(
    chain_id: Option<&str>,
    peg: &Outpoint,
    fields: &serde_json::Map<String, serde_json::Value>,
    created_at: u64,
) -> Result<UnsignedEvent> {
    let mut tags = vec![tag(TAG_D, peg.to_string())];
    if let Some(c) = chain_id {
        tags.insert(0, tag(TAG_CHAIN, c));
    }
    Ok(UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_PEG_RECORD,
        tags,
        content: serde_json::to_string(fields)?,
    })
}

/// Sign a peg record.
pub fn sign_peg_record(
    signer: &dyn Signer,
    chain_id: Option<&str>,
    peg: &Outpoint,
    fields: &serde_json::Map<String, serde_json::Value>,
    created_at: u64,
) -> Result<Event> {
    sign(signer, peg_record_event(chain_id, peg, fields, created_at)?)
}

/// The payee script's length in a pledge marker: a 34-byte key-path script
/// (`pledge.mjs verifyPledge`).
const PAYEE_LEN: usize = 34;

/// `(chain id, payee script hex, peg value, peg script hex, lock time)` when
/// the transaction has the pledge shape, else why not.
fn pledge_shape(
    tx: &Transaction,
) -> core::result::Result<(String, String, u64, String, u32), String> {
    if tx.input.len() != 1 || tx.output.len() != 2 {
        return Err(format!(
            "a pledge has one input and two outputs, not {} and {}",
            tx.input.len(),
            tx.output.len()
        ));
    }
    let data = op_return_data(&tx.output[1].script_pubkey)
        .ok_or_else(|| "output 1 is not the marker".to_string())?;
    let rest = data
        .strip_prefix(b"pegin:")
        .ok_or_else(|| "output 1 is not a pegin: marker".to_string())?;
    // A chain id contains a colon (`sidestr:<name>`), so the marker cannot be split on the
    // first one. `verifyPledge` fixes the payee instead: exactly 34 bytes, a key-path script
    // (`data.length !== head.length + 34`, `/^5120[0-9a-f]{64}$/`). So the script is the
    // last 34 bytes, the byte before them is the separator, and the chain id is the rest.
    if rest.len() < PAYEE_LEN + 2 || rest[rest.len() - PAYEE_LEN - 1] != b':' {
        return Err("the marker does not name a chain and a 34-byte script".into());
    }
    let (chain, script) = rest.split_at(rest.len() - PAYEE_LEN - 1);
    let script = &script[1..];
    if script[0] != 0x51 || script[1] != 0x20 {
        return Err("the payee is not a key-path script".into());
    }
    let chain_id = core::str::from_utf8(chain)
        .map_err(|_| "the marker's chain id is not UTF-8".to_string())?
        .to_string();
    if chain_id.is_empty() {
        return Err("the marker does not name a chain".into());
    }
    Ok((
        chain_id,
        hex::encode(script),
        tx.output[0].value.to_sat(),
        hex::encode(tx.output[0].script_pubkey.as_bytes()),
        tx.lock_time.to_consensus_u32(),
    ))
}

/// Decode a kind-33502 event by structure. Does not verify the signature.
pub fn parse_record(ev: &Event) -> Result<Record> {
    expect_kind(ev.kind, KIND_PEG_RECORD, "peg record | pledge")?;
    let outpoint = Outpoint::parse(required(&ev.tags, TAG_D)?)?;
    let chain_tag = first(&ev.tags, TAG_CHAIN).map(str::to_string);
    let content = ev.content.trim();
    let ambiguous = |reason: String| {
        Ok(Record::Ambiguous(Ambiguous {
            outpoint: outpoint.clone(),
            reason,
        }))
    };
    if content.starts_with('{') {
        return match serde_json::from_str::<serde_json::Value>(content) {
            Ok(serde_json::Value::Object(fields)) => Ok(Record::PegRecord(PegRecord {
                outpoint,
                chain_id: chain_tag,
                fields,
            })),
            Ok(_) => ambiguous("JSON, but not an object".into()),
            Err(e) => ambiguous(format!("looks like JSON but does not parse: {e}")),
        };
    }
    let Ok(tx_hex) = any_hex("content", content) else {
        return ambiguous("neither a transaction hex nor a JSON object".into());
    };
    let tx: Transaction = match deserialize(&hex::decode(&tx_hex).expect("checked hex")) {
        Ok(tx) => tx,
        Err(e) => return ambiguous(format!("hex, but not a transaction: {e}")),
    };
    match pledge_shape(&tx) {
        Ok((chain_id, payee_script, peg_value, peg_script, lock_time)) => {
            if let Some(c) = &chain_tag {
                if *c != chain_id {
                    return ambiguous(format!(
                        "the chain tag says {c} but the marker names {chain_id}"
                    ));
                }
            }
            Ok(Record::Pledge(Pledge {
                outpoint,
                chain_id,
                tx_hex,
                lock_time,
                payee_script,
                peg_value,
                peg_script,
            }))
        }
        Err(why) => ambiguous(format!("a transaction, but not a pledge: {why}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::SecretKeySigner;

    fn signer() -> SecretKeySigner {
        SecretKeySigner::from_bytes(&[5u8; 32]).unwrap()
    }
    fn reward() -> Outpoint {
        Outpoint {
            txid: "ab".repeat(32),
            vout: 0,
        }
    }
    fn pledge_tx(chain: &str, outs: usize) -> String {
        let mut marker = format!("pegin:{chain}:").into_bytes();
        marker.extend([0x51, 0x20]);
        marker.extend([7u8; 32]);
        let mut tx = vec![2, 0, 0, 0, 1];
        tx.extend([0xab; 32]);
        tx.extend(0u32.to_le_bytes());
        tx.push(0);
        tx.extend(0xfffffffeu32.to_le_bytes());
        tx.push(outs as u8);
        tx.extend(4_999_000_000u64.to_le_bytes());
        tx.extend([34, 0x51, 0x20]);
        tx.extend([9u8; 32]);
        if outs > 1 {
            tx.extend(0u64.to_le_bytes());
            tx.push(marker.len() as u8 + 2);
            tx.extend([0x6a, marker.len() as u8]);
            tx.extend(&marker);
        }
        tx.extend(151_460u32.to_le_bytes());
        hex::encode(tx)
    }

    #[test]
    fn a_pledge_is_recognised_by_shape() {
        let ev = sign_pledge(
            &signer(),
            "sidestr:t",
            &reward(),
            &pledge_tx("sidestr:t", 2),
            1,
        )
        .unwrap();
        assert_eq!(
            ev.tags,
            vec![
                vec!["chain", "sidestr:t"],
                vec!["d", &format!("{}:0", "ab".repeat(32))]
            ]
        );
        let Record::Pledge(p) = parse_record(&ev).unwrap() else {
            panic!()
        };
        assert_eq!(p.outpoint, reward());
        assert_eq!(p.chain_id, "sidestr:t");
        assert_eq!(p.lock_time, 151_460);
        assert_eq!(p.payee_script, format!("5120{}", "07".repeat(32)));
        assert_eq!(p.peg_script, format!("5120{}", "09".repeat(32)));
        assert_eq!(p.peg_value, 4_999_000_000);
        // building a pledge for the wrong chain is refused before signing
        assert!(matches!(
            pledge_event("sidestr:u", &reward(), &pledge_tx("sidestr:t", 2), 1),
            Err(Error::Chain(_))
        ));
        assert!(pledge_event("sidestr:t", &reward(), "0200", 1).is_err());
    }

    #[test]
    fn a_peg_record_is_a_json_object() {
        let mut f = serde_json::Map::new();
        f.insert("amount".into(), 5.into());
        let ev = sign_peg_record(&signer(), Some("sidestr:t"), &reward(), &f, 1).unwrap();
        let Record::PegRecord(r) = parse_record(&ev).unwrap() else {
            panic!()
        };
        assert_eq!(
            (r.chain_id.as_deref(), r.fields["amount"].as_u64()),
            (Some("sidestr:t"), Some(5))
        );
        let untagged = sign_peg_record(&signer(), None, &reward(), &f, 1).unwrap();
        let Record::PegRecord(r) = parse_record(&untagged).unwrap() else {
            panic!()
        };
        assert_eq!(r.chain_id, None);
        assert_eq!(
            serde_json::to_string(&r.outpoint).unwrap(),
            format!("\"{}:0\"", "ab".repeat(32))
        );
    }

    #[test]
    fn ambiguity_is_reported_never_guessed() {
        let ev = sign_pledge(
            &signer(),
            "sidestr:t",
            &reward(),
            &pledge_tx("sidestr:t", 2),
            1,
        )
        .unwrap();
        let with = |content: &str, chain: Option<&str>| {
            let mut e = ev.clone();
            e.content = content.into();
            if let Some(c) = chain {
                e.tags[0][1] = c.into();
            }
            match parse_record(&e).unwrap() {
                Record::Ambiguous(a) => a.reason,
                other => panic!("{other:?}"),
            }
        };
        assert!(with("hello", None).contains("neither"));
        assert!(with("0200", None).contains("not a transaction"));
        assert!(with(&pledge_tx("sidestr:t", 1), None).contains("one input and two outputs"));
        assert!(with(&pledge_tx("sidestr:t", 2), Some("sidestr:u"))
            .contains("chain tag says sidestr:u"));
        assert!(with("{", None).contains("does not parse"));
        assert!(with("{\"a\":1} x", None).contains("does not parse"));
        // the marker is not a pegin
        let mut tx = pledge_tx("sidestr:t", 2);
        let at = tx.find(&hex::encode("pegin:")).unwrap();
        tx.replace_range(at..at + 10, &hex::encode("pegou"));
        assert!(with(&tx, None).contains("not a pegin"));
    }

    #[test]
    fn the_address_and_kind_are_the_shared_contract() {
        let ev = sign_pledge(
            &signer(),
            "sidestr:t",
            &reward(),
            &pledge_tx("sidestr:t", 2),
            1,
        )
        .unwrap();
        let mut d = ev.clone();
        d.tags[1][1] = "nope".into();
        assert!(matches!(parse_record(&d), Err(Error::Tag { tag: "d", .. })));
        let mut nod = ev.clone();
        nod.tags.pop();
        assert!(matches!(parse_record(&nod), Err(Error::MissingTag("d"))));
        let mut k = ev;
        k.kind = 33501;
        assert!(matches!(parse_record(&k), Err(Error::Kind { .. })));
    }
}
