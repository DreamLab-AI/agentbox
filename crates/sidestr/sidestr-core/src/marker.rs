//! The marker grammar: the `OP_RETURN` texts by which pegs, claims, burns and
//! checkpoints are written on the sidechain and on the parent (SPEC 6, 7, 11).
//!
//! A port of `siding/lib/marker.mjs`, the marker halves of `lib/overlay.mjs`,
//! `lib/parent.mjs` and `lib/checkpoint.mjs`, and the record primitives of
//! `lib/records.mjs`. All pure: a browser builds a peg-in marker with the same
//! code the validator parses it with.
//!
//! | marker | where | text |
//! |---|---|---|
//! | peg-in | parent | `pegin:<chain id>:` then the sidechain script as raw bytes (hex text accepted) |
//! | claim | sidechain coinbase | `claim:<parent txid>:<vout>`, immediately after its payout output |
//! | burn (peg-out) | sidechain | `pegout:<parent output script hex>` with a value |
//! | peg-out record | parent | `pegout:<chain id>:` then the sidechain txid as 32 raw bytes |
//! | checkpoint | parent | `ckpt:<chain id>:` then the height as 4 LE bytes, `:`, the 32-byte hash |
//!
//! ```
//! use sidestr_core::marker::{claim_marker, parse_claims, pegout_marker, parse_pegout};
//! use bitcoin::{Amount, ScriptBuf, TxOut, Transaction, transaction::Version, absolute::LockTime};
//!
//! let you = ScriptBuf::from_hex(&format!("5120{}", "ab".repeat(32))).unwrap();
//! let peg = "a".repeat(64);
//! let coinbase = Transaction { version: Version::TWO, lock_time: LockTime::ZERO, input: vec![], output: vec![
//!     TxOut { value: Amount::from_sat(2_500_000_000), script_pubkey: you.clone() },
//!     TxOut { value: Amount::ZERO, script_pubkey: claim_marker(&peg, 0) },
//! ] };
//! let (claims, errors) = parse_claims(&coinbase);
//! assert!(errors.is_empty());
//! assert_eq!(claims[0].txid, peg);
//! assert_eq!(claims[0].payout.value, 2_500_000_000);
//!
//! let parent = format!("5120{}", "e9".repeat(32));
//! assert_eq!(parse_pegout(&pegout_marker(&parent)), Some(parent));
//! assert_eq!(parse_pegout(&pegout_marker("00")), None); // 2 to 40 bytes only
//! ```

use bitcoin::{Script, ScriptBuf, Transaction, TxOut};

use crate::error::{Error, Result};

/// The data of an `OP_RETURN` output that is one push: `6a`, an optional
/// `OP_PUSHDATA1`, a length byte, and exactly that many bytes
/// (`siding/lib/overlay.mjs opReturnData`). `None` for anything else.
pub fn op_return_data(spk: &Script) -> Option<&[u8]> {
    let b = spk.as_bytes();
    if b.len() < 2 || b[0] != 0x6a {
        return None;
    }
    let (len, data) = if b[1] == 0x4c {
        if b.len() < 3 {
            return None;
        }
        (usize::from(b[2]), &b[3..])
    } else {
        (usize::from(b[1]), &b[2..])
    };
    (len == data.len()).then_some(data)
}

/// The text of an `OP_RETURN` output, or `None` when it is not a single push
/// of at most 255 bytes of UTF-8 (`siding/lib/records.mjs recordText`). A
/// push must be minimal: a direct push for up to 75 bytes, `OP_PUSHDATA1`
/// above that.
pub fn record_text(spk: &Script) -> Option<String> {
    let b = spk.as_bytes();
    if b.len() < 2 || b[0] != 0x6a {
        return None;
    }
    let (len, data) = if b[1] == 0x4c {
        if b.len() < 3 || b[2] <= 75 {
            return None;
        }
        (usize::from(b[2]), &b[3..])
    } else {
        if b[1] > 75 {
            return None;
        }
        (usize::from(b[1]), &b[2..])
    };
    if data.len() != len {
        return None;
    }
    String::from_utf8(data.to_vec()).ok()
}

/// A record: `OP_RETURN` with a minimal single push of the text
/// (`siding/lib/records.mjs recordScript`); at most 255 bytes.
pub fn record_script(text: &str) -> Result<ScriptBuf> {
    let b = text.as_bytes();
    if b.len() > 255 {
        return Err(Error::Block("a record is at most 255 bytes".into()));
    }
    Ok(op_return(b))
}

fn op_return(data: &[u8]) -> ScriptBuf {
    let mut out = vec![0x6a];
    if data.len() > 75 {
        out.push(0x4c);
    }
    out.push(data.len() as u8);
    out.extend_from_slice(data);
    ScriptBuf::from_bytes(out)
}

fn is_lower_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

// --- peg-in (SPEC 6) -------------------------------------------------------

/// The peg-in marker's data: `pegin:<chain id>:` then the sidechain output
/// script as raw bytes when that fits the parent's 80-byte data limit, as hex
/// text otherwise (`siding/lib/marker.mjs pegMarkerData`).
pub fn peg_marker_data(chain_id: &str, script: &Script) -> Vec<u8> {
    let head = format!("pegin:{chain_id}:");
    if head.len() + script.len() <= 80 {
        let mut out = head.into_bytes();
        out.extend_from_slice(script.as_bytes());
        out
    } else {
        format!("{head}{}", hex::encode(script.as_bytes())).into_bytes()
    }
}

/// The sidechain script a peg-in marker names, raw or hex form, for this
/// chain; `None` for any other output (`siding/lib/marker.mjs parsePegMarker`).
pub fn parse_peg_marker(spk: &Script, chain_id: &str) -> Option<ScriptBuf> {
    let d = op_return_data(spk)?;
    let head = format!("pegin:{chain_id}:");
    let rest = d.strip_prefix(head.as_bytes())?;
    if rest.is_empty() {
        return None;
    }
    if let Ok(text) = std::str::from_utf8(rest) {
        if !text.is_empty() && text.len() % 2 == 0 && text.bytes().all(|b| b.is_ascii_hexdigit()) {
            return hex::decode(text.to_ascii_lowercase())
                .ok()
                .map(ScriptBuf::from_bytes);
        }
    }
    Some(ScriptBuf::from_bytes(rest.to_vec()))
}

// --- claims (SPEC 6) -------------------------------------------------------

/// The payout output a claim marker follows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Payout {
    /// Index of the payout in the coinbase.
    pub index: usize,
    /// Its value in sats.
    pub value: u64,
    /// The script paid: the one the peg-in marker named.
    pub script_pubkey: ScriptBuf,
}

/// A claim: two consecutive coinbase outputs, the payout then `claim:<txid>:<vout>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
    /// Index of the marker output in the coinbase.
    pub index: usize,
    /// The parent txid claimed, display order.
    pub txid: String,
    /// The parent output index claimed.
    pub vout: u32,
    /// The payout before the marker.
    pub payout: Payout,
}

/// `OP_RETURN claim:<txid>:<vout>` (`siding/lib/overlay.mjs claimMarker`).
pub fn claim_marker(txid: &str, vout: u32) -> ScriptBuf {
    op_return(format!("claim:{txid}:{vout}").as_bytes())
}

/// The claims a coinbase makes and the malformed ones (`siding/lib/overlay.mjs
/// parseClaims`). A claim is two consecutive coinbase outputs: the payout,
/// then an `OP_RETURN` carrying `claim:<parent txid>:<vout>`. The pairing is
/// structural, so a level-1 validator, which has no parent view, can still
/// bind each claimed amount to one outpoint; a level-2 validator checks the
/// pair against the parent. A marker without a positive, spendable payout
/// right before it is an error, not a claim.
pub fn parse_claims(coinbase: &Transaction) -> (Vec<Claim>, Vec<String>) {
    let mut claims = Vec::new();
    let mut errors = Vec::new();
    for (i, o) in coinbase.output.iter().enumerate() {
        let Some(d) = op_return_data(&o.script_pubkey) else {
            continue;
        };
        let Ok(t) = std::str::from_utf8(d) else {
            continue;
        };
        let Some((txid, vout)) = parse_claim_text(t) else {
            continue;
        };
        let payout = i.checked_sub(1).map(|p| &coinbase.output[p]);
        match payout {
            Some(p) if !p.script_pubkey.is_op_return() && p.value.to_sat() > 0 => {
                claims.push(Claim {
                    index: i,
                    txid,
                    vout,
                    payout: Payout {
                        index: i - 1,
                        value: p.value.to_sat(),
                        script_pubkey: p.script_pubkey.clone(),
                    },
                })
            }
            _ => errors.push(format!("claim at output {i} has no payout before it")),
        }
    }
    (claims, errors)
}

/// `claim:<64 lower hex>:<1..5 digits>`.
fn parse_claim_text(t: &str) -> Option<(String, u32)> {
    let rest = t.strip_prefix("claim:")?;
    let (txid, vout) = rest.split_once(':')?;
    if txid.len() != 64 || !is_lower_hex(txid) {
        return None;
    }
    if vout.is_empty() || vout.len() > 5 || !vout.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((txid.to_string(), vout.parse().ok()?))
}

// --- burns (SPEC 7) --------------------------------------------------------

/// A burn the chain validated: the value left the supply and the peg holders
/// owe `script` that value on the parent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Burn {
    /// Sidechain txid, display order.
    pub txid: String,
    /// Output index of the burn.
    pub vout: u32,
    /// The parent output script named, lower hex.
    pub script: String,
    /// Sats burned.
    pub value: u64,
    /// The height of the block that carried it.
    pub height: u32,
}

/// `OP_RETURN pegout:<parent output script hex>` (`siding/lib/overlay.mjs pegoutMarker`).
pub fn pegout_marker(script_hex: &str) -> ScriptBuf {
    op_return(format!("pegout:{}", script_hex.to_ascii_lowercase()).as_bytes())
}

/// The parent output script a burn names, when it is 2 to 40 bytes of lower
/// hex (`siding/lib/overlay.mjs parsePegout`); `None` otherwise.
pub fn parse_pegout(spk: &Script) -> Option<String> {
    let d = op_return_data(spk)?;
    let t = std::str::from_utf8(d).ok()?;
    let s = t.strip_prefix("pegout:")?;
    (s.len() % 2 == 0 && (4..=80).contains(&s.len()) && is_lower_hex(s)).then(|| s.to_string())
}

/// Every burn in a transaction (`siding/lib/overlay.mjs parsePegouts`); the
/// height is the caller's to fill.
pub fn parse_pegouts(tx: &Transaction, txid: &str, height: u32) -> Vec<Burn> {
    tx.output
        .iter()
        .enumerate()
        .filter_map(|(i, o)| {
            parse_pegout(&o.script_pubkey).map(|script| Burn {
                txid: txid.to_string(),
                vout: i as u32,
                script,
                value: o.value.to_sat(),
                height,
            })
        })
        .collect()
}

/// Whether an `OP_RETURN` output *looks like* a burn: its bytes after the
/// push prefix start with `pegout:`, whether or not they parse. The rules
/// refuse such an output that does not parse rather than ignore it.
pub fn looks_like_pegout(o: &TxOut) -> bool {
    let b = o.script_pubkey.as_bytes();
    b.len() > 2 && b[0] == 0x6a && String::from_utf8_lossy(&b[2..]).starts_with("pegout:")
}

// --- the parent-side records (SPEC 7, 11) ------------------------------------

/// The parent transaction's record of a paid burn: `pegout:<chain id>:` then
/// the sidechain txid as 32 raw bytes, so it fits the parent's data limit
/// (`siding/lib/parent.mjs pegoutMarkerData`).
pub fn pegout_marker_data(chain_id: &str, side_txid: &str) -> Result<Vec<u8>> {
    let mut out = format!("pegout:{chain_id}:").into_bytes();
    let txid = hex::decode(side_txid).map_err(|e| Error::Encoding(e.to_string()))?;
    if txid.len() != 32 {
        return Err(Error::Encoding("a txid is 32 bytes".into()));
    }
    out.extend_from_slice(&txid);
    Ok(out)
}

/// The sidechain txid a parent record names for this chain, or `None`
/// (`siding/lib/parent.mjs parsePegoutMarker`).
pub fn parse_pegout_marker(spk: &Script, chain_id: &str) -> Option<String> {
    let d = op_return_data(spk)?;
    let rest = d.strip_prefix(format!("pegout:{chain_id}:").as_bytes())?;
    (rest.len() == 32).then(|| hex::encode(rest))
}

/// A checkpoint's data (`siding/lib/checkpoint.mjs checkpointData`): `ckpt:<chain
/// id>:`, the height as 4 little-endian bytes, `:`, the 32-byte block hash
/// (display-order hex in, the bytes of that hex out). 58 bytes for a 15-byte
/// chain id; over 80 is an error.
pub fn checkpoint_data(chain_id: &str, height: u32, hash: &str) -> Result<Vec<u8>> {
    let mut out = format!("ckpt:{chain_id}:").into_bytes();
    out.extend_from_slice(&height.to_le_bytes());
    out.push(b':');
    let h = hex::decode(hash).map_err(|e| Error::Encoding(e.to_string()))?;
    if h.len() != 32 {
        return Err(Error::Encoding("a block hash is 32 bytes".into()));
    }
    out.extend_from_slice(&h);
    if out.len() > 80 {
        return Err(Error::Block(format!(
            "checkpoint of {} bytes exceeds the 80-byte data limit; the chain id is too long",
            out.len()
        )));
    }
    Ok(out)
}

/// A checkpoint on the parent for this chain: `(height, hash)`, or `None`
/// (`siding/lib/checkpoint.mjs parseCheckpoint`).
pub fn parse_checkpoint(spk: &Script, chain_id: &str) -> Option<(u32, String)> {
    let d = op_return_data(spk)?;
    let rest = d.strip_prefix(format!("ckpt:{chain_id}:").as_bytes())?;
    if rest.len() != 37 || rest[4] != b':' {
        return None;
    }
    Some((
        u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]),
        hex::encode(&rest[5..]),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peg_marker_both_forms() {
        let script = ScriptBuf::from_hex(&format!("5120{}", "ab".repeat(32))).unwrap();
        let raw = peg_marker_data("sidestr:trial", &script);
        assert_eq!(raw.len(), 20 + 34);
        assert_eq!(
            parse_peg_marker(&op_return(&raw), "sidestr:trial"),
            Some(script.clone())
        );
        assert_eq!(parse_peg_marker(&op_return(&raw), "sidestr:other"), None);
        let long_id = "sidestr:".to_string() + &"x".repeat(60);
        let hexform = peg_marker_data(&long_id, &script);
        assert!(hexform.len() > 80 && hexform.ends_with(b"ab"));
        let text = format!("pegin:sidestr:trial:{}", script.to_hex_string());
        assert_eq!(
            parse_peg_marker(&op_return(text.as_bytes()), "sidestr:trial"),
            Some(script)
        );
    }

    #[test]
    fn claims_and_burns() {
        let peg = "b".repeat(64);
        assert_eq!(
            parse_claim_text(&format!("claim:{peg}:12")),
            Some((peg.clone(), 12))
        );
        assert_eq!(parse_claim_text(&format!("claim:{peg}:123456")), None);
        assert_eq!(
            parse_claim_text(&format!("claim:{}:0", "B".repeat(64))),
            None
        );
        let parent = format!("5120{}", "e9".repeat(32));
        let m = pegout_marker(&parent);
        assert!(m.to_hex_string().starts_with("6a4b"));
        assert_eq!(parse_pegout(&m), Some(parent));
        assert_eq!(parse_pegout(&pegout_marker("00")), None);
        assert_eq!(parse_pegout(&pegout_marker(&"ab".repeat(41))), None);
        assert_eq!(
            parse_pegout(&pegout_marker(&"ab".repeat(40))).map(|s| s.len()),
            Some(80)
        );
        let bad = ScriptBuf::from_bytes([&[0x6a, 0x0a][..], b"pegout:zz"].concat());
        assert!(
            looks_like_pegout(&TxOut {
                value: bitcoin::Amount::ZERO,
                script_pubkey: bad.clone()
            }) && parse_pegout(&bad).is_none()
        );
    }

    #[test]
    fn parent_records() {
        let txid = "c".repeat(64);
        let d = pegout_marker_data("sidestr:pegouttest", &txid).unwrap();
        assert!(d.len() <= 80);
        assert_eq!(
            parse_pegout_marker(&op_return(&d), "sidestr:pegouttest"),
            Some(txid)
        );
        assert_eq!(parse_pegout_marker(&op_return(&d), "sidestr:other"), None);
        let ck = checkpoint_data("sidestr:gitmark", 70_000, &"d".repeat(64)).unwrap();
        assert_eq!(ck.len(), 21 + 37);
        assert_eq!(
            parse_checkpoint(&op_return(&ck), "sidestr:gitmark"),
            Some((70_000, "d".repeat(64)))
        );
        assert!(checkpoint_data(&"x".repeat(50), 1, &"d".repeat(64)).is_err());
    }

    #[test]
    fn records() {
        assert_eq!(
            record_text(&record_script("issue:SHELL:2").unwrap()).as_deref(),
            Some("issue:SHELL:2")
        );
        assert_eq!(
            record_text(&record_script(&"x".repeat(200)).unwrap()).as_deref(),
            Some("x".repeat(200).as_str())
        );
        assert!(record_script(&"x".repeat(256)).is_err());
        assert_eq!(
            record_text(&ScriptBuf::from_bytes(vec![0x6a, 0x4c, 0x02, 0x41, 0x42])),
            None
        ); // non-minimal
        assert_eq!(
            record_text(&ScriptBuf::from_bytes(vec![0x6a, 0x03, 0x41, 0x42])),
            None
        ); // short
        assert_eq!(
            op_return_data(&ScriptBuf::from_bytes(vec![0x6a, 0x4c])),
            None
        );
        assert_eq!(op_return_data(&ScriptBuf::from_bytes(vec![0x51])), None);
    }
}
