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

/// The data of an `OP_RETURN` output that is one push, read exactly as
/// `siding/lib/overlay.mjs opReturnData` (and `marker.mjs parsePegMarker`)
/// reads it: `6a`, an optional `4c` (`OP_PUSHDATA1`), one length byte, and
/// exactly that many bytes; `None` for anything else.
///
/// The length byte is a length whatever opcode it would be to Bitcoin — the
/// reference's own `pegoutMarker` writes `6a 57 …` for a 40-byte parent
/// script, which is `OP_7` to a script interpreter, and its rule reads that
/// back — and an `OP_PUSHDATA1` prefix is accepted for any length, minimal or
/// not. A bare `4c` is always read as the prefix, so a direct push of exactly
/// 76 bytes is `None` in both engines. This is consensus for the burn rule
/// and the parent-side markers, so it matches the reference byte for byte;
/// [`record_text`] is the stricter grammar of SPEC 12.1.
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

/// The UTF-8 byte-order mark, which the reference's `TextDecoder` drops
/// when it leads the bytes it decodes.
const BOM: &[u8] = b"\xef\xbb\xbf";

/// `d` less one leading byte-order mark: the bytes a WHATWG `TextDecoder`
/// actually decodes (its default `ignoreBOM: false` consumes `EF BB BF` at
/// the start of the stream and never yields U+FEFF for it). Every reader
/// below that the reference text-decodes goes through this, and only those:
/// the parent-side peg-out record and the checkpoint are compared as bytes
/// there and here (`parent.mjs parsePegoutMarker`, `checkpoint.mjs
/// parseCheckpoint`), so a marker leading with a BOM is not one of them in
/// either engine.
fn without_bom(d: &[u8]) -> &[u8] {
    d.strip_prefix(BOM).unwrap_or(d)
}

/// `d` as the reference's `TextDecoder` yields it: strict UTF-8 after
/// [`without_bom`], `None` where the decoder would throw or, in the
/// non-fatal readers, yield U+FFFD (which no marker grammar then matches).
fn marker_text(d: &[u8]) -> Option<&str> {
    std::str::from_utf8(without_bom(d)).ok()
}

/// The text of an `OP_RETURN` output, or `None` when it is not a single push
/// of at most 255 bytes of UTF-8 (`siding/lib/records.mjs recordText`). A
/// push must be minimal: a direct push for up to 75 bytes, `OP_PUSHDATA1`
/// above that. A leading byte-order mark is dropped, as the reference's
/// `TextDecoder` drops it: `EF BB BF` + `issue:X:0` is the record `issue:X:0`.
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
    marker_text(data).map(str::to_string)
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

/// `OP_RETURN` with one minimal push of `data`: direct to 75 bytes,
/// `OP_PUSHDATA1` to 255, `OP_PUSHDATA2` to 65 535, `OP_PUSHDATA4` beyond.
/// The marker grammar ([`op_return_data`]) reads only the first two forms;
/// the checked constructors bound their input so the script they return is
/// one the parsers read back. The unchecked ones never truncate a length
/// into a smaller push: an out-of-domain input yields a well-formed script
/// that no marker parser matches.
fn op_return(data: &[u8]) -> ScriptBuf {
    let mut out = vec![0x6a];
    match data.len() {
        n @ 0..=75 => out.push(n as u8),
        n @ 76..=255 => out.extend_from_slice(&[0x4c, n as u8]),
        n @ 256..=65_535 => {
            out.push(0x4d);
            out.extend_from_slice(&(n as u16).to_le_bytes());
        }
        n => {
            out.push(0x4e);
            out.extend_from_slice(&(n as u32).to_le_bytes());
        }
    }
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
///
/// The remainder is hex form when, text-decoded as the reference decodes it
/// (one leading byte-order mark dropped), it is hex pairs; otherwise it is
/// the raw script, every byte of it — the reference returns `toHex(rest)`
/// of the undecoded bytes, BOM included, and so does this.
pub fn parse_peg_marker(spk: &Script, chain_id: &str) -> Option<ScriptBuf> {
    let d = op_return_data(spk)?;
    let head = format!("pegin:{chain_id}:");
    let rest = d.strip_prefix(head.as_bytes())?;
    if rest.is_empty() {
        return None;
    }
    if let Some(text) = marker_text(rest) {
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

/// The largest output index a claim can name: `parseClaims` reads one to
/// five decimal digits (`siding/lib/overlay.mjs`), and this port keeps that
/// grammar rather than coordinate a rule change.
pub const CLAIM_VOUT_MAX: u32 = 99_999;

/// `OP_RETURN claim:<txid>:<vout>` (`siding/lib/overlay.mjs claimMarker`),
/// unchecked: the domain is a 64-character lower-hex parent txid and a
/// `vout` of at most [`CLAIM_VOUT_MAX`]. Outside it the script is well
/// formed but [`parse_claims`] does not read it as a claim — a coinbase
/// carrying it would fail `btc:rule-blockctx-coinbase-amount`, not this
/// call. [`try_claim_marker`] refuses such input instead.
pub fn claim_marker(txid: &str, vout: u32) -> ScriptBuf {
    op_return(format!("claim:{txid}:{vout}").as_bytes())
}

/// [`claim_marker`] that refuses what [`parse_claims`] would not read back:
/// a txid that is not 64 lower-hex characters, or a `vout` above
/// [`CLAIM_VOUT_MAX`] (`Error::Encoding`).
///
/// ```
/// use sidestr_core::marker::{try_claim_marker, CLAIM_VOUT_MAX};
/// assert!(try_claim_marker(&"a".repeat(64), CLAIM_VOUT_MAX).is_ok());
/// assert!(try_claim_marker(&"a".repeat(64), CLAIM_VOUT_MAX + 1).is_err());
/// assert!(try_claim_marker(&"A".repeat(64), 0).is_err());
/// ```
pub fn try_claim_marker(txid: &str, vout: u32) -> Result<ScriptBuf> {
    if txid.len() != 64 || !is_lower_hex(txid) {
        return Err(Error::Encoding(
            "a claim names its parent txid as 64 lower-hex characters".into(),
        ));
    }
    if vout > CLAIM_VOUT_MAX {
        return Err(Error::Encoding(format!(
            "a claim's vout is at most {CLAIM_VOUT_MAX} (five decimal digits), not {vout}"
        )));
    }
    Ok(claim_marker(txid, vout))
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
        let Some(t) = marker_text(d) else {
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

/// `OP_RETURN pegout:<parent output script hex>` (`siding/lib/overlay.mjs
/// pegoutMarker`), unchecked: the domain is the hex of a parent output
/// script of 2 to 40 bytes, either case. Outside it the script is well
/// formed but [`parse_pegout`] does not read it — and, as it still starts
/// `pegout:`, the burn rule *refuses* a block carrying it
/// (`sidestr:rule-pegouts`) rather than ignore it. [`try_pegout_marker`]
/// refuses such input instead.
pub fn pegout_marker(script_hex: &str) -> ScriptBuf {
    op_return(format!("pegout:{}", script_hex.to_ascii_lowercase()).as_bytes())
}

/// [`pegout_marker`] that refuses what [`parse_pegout`] would not read back:
/// anything but the hex of 2 to 40 bytes (`Error::Encoding`).
///
/// ```
/// use sidestr_core::marker::try_pegout_marker;
/// assert!(try_pegout_marker(&"5120".to_string()).is_ok()); // 2 bytes, the least
/// assert!(try_pegout_marker(&"AB".repeat(40)).is_ok());    // 40 bytes, the most
/// assert!(try_pegout_marker(&"ab".repeat(41)).is_err());
/// assert!(try_pegout_marker("abc").is_err());
/// assert!(try_pegout_marker("zz").is_err());
/// ```
pub fn try_pegout_marker(script_hex: &str) -> Result<ScriptBuf> {
    let s = script_hex.to_ascii_lowercase();
    if s.len() % 2 != 0 || !(4..=80).contains(&s.len()) || !is_lower_hex(&s) {
        return Err(Error::Encoding(format!(
            "a burn names a parent output script of 2 to 40 bytes as hex, not {script_hex:?}"
        )));
    }
    Ok(pegout_marker(&s))
}

/// The parent output script a burn names, when it is 2 to 40 bytes of lower
/// hex (`siding/lib/overlay.mjs parsePegout`); `None` otherwise. The push is
/// text-decoded as the reference decodes it, one leading byte-order mark
/// dropped: `EF BB BF pegout:abcd` names `abcd`.
pub fn parse_pegout(spk: &Script) -> Option<String> {
    let d = op_return_data(spk)?;
    let t = marker_text(d)?;
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

/// Whether an `OP_RETURN` output *looks like* a burn: it is one push (as
/// [`op_return_data`] reads it) whose data, decoded as UTF-8 with
/// replacement and one leading byte-order mark dropped, starts with
/// `pegout:`, whether or not it parses as a burn. The rules refuse such an
/// output that does not parse rather than ignore it (`siding/lib/overlay.mjs
/// sidestr:rule-pegouts`: `opReturnData`, then a non-fatal `TextDecoder`,
/// then `startsWith('pegout:')`).
pub fn looks_like_pegout(o: &TxOut) -> bool {
    op_return_data(&o.script_pubkey)
        .is_some_and(|d| String::from_utf8_lossy(without_bom(d)).starts_with("pegout:"))
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
        let out = |s: &ScriptBuf| TxOut {
            value: bitcoin::Amount::ZERO,
            script_pubkey: s.clone(),
        };
        let bad = ScriptBuf::from_bytes([&[0x6a, 0x09][..], b"pegout:zz"].concat());
        assert!(looks_like_pegout(&out(&bad)) && parse_pegout(&bad).is_none());
        // the OP_PUSHDATA1 form is a burn too (re-audit F2): byte 2 is a length, not the text
        let long = pegout_marker(&"ab".repeat(40));
        assert!(long.to_hex_string().starts_with("6a4c57"));
        assert!(looks_like_pegout(&out(&long)) && parse_pegout(&long).is_some());
        let bad_long = ScriptBuf::from_bytes(
            [
                &[0x6a, 0x4c, 0x4c][..],
                format!("pegout:{}", "a".repeat(69)).as_bytes(),
            ]
            .concat(),
        );
        assert!(looks_like_pegout(&out(&bad_long)) && parse_pegout(&bad_long).is_none());
        // a length that disagrees with the data is not a push at all
        let not_push = ScriptBuf::from_bytes([&[0x6a, 0x4c, 0x0b][..], b"pegout:zz"].concat());
        assert!(!looks_like_pegout(&out(&not_push)));
    }

    /// Audit F1 (2026-09-22): the reference's `TextDecoder` drops one leading
    /// byte-order mark, so a BOM changes what a marker names at exactly the
    /// boundaries the reference text-decodes and nowhere else.
    #[test]
    fn bom_is_dropped_exactly_where_the_reference_text_decodes() {
        let bom = |rest: &[u8]| op_return(&[BOM, rest].concat());
        let out = |s: &ScriptBuf| TxOut {
            value: bitcoin::Amount::ZERO,
            script_pubkey: s.clone(),
        };
        // burns: `bom-bare` records `abcd`, `badbom-bare` is refused, not ignored
        assert_eq!(parse_pegout(&bom(b"pegout:abcd")).as_deref(), Some("abcd"));
        let bad = bom(b"pegout:abcde");
        assert!(looks_like_pegout(&out(&bad)) && parse_pegout(&bad).is_none());
        // one BOM only: a second is text, and `\u{feff}pegout:` is not a burn
        let twice = op_return(&[BOM, BOM, b"pegout:abcd"].concat());
        assert!(!looks_like_pegout(&out(&twice)) && parse_pegout(&twice).is_none());
        // claims
        let peg = "b".repeat(64);
        let mut tx = Transaction {
            version: bitcoin::transaction::Version::TWO,
            lock_time: bitcoin::absolute::LockTime::ZERO,
            input: vec![],
            output: vec![
                TxOut {
                    value: bitcoin::Amount::from_sat(1),
                    script_pubkey: ScriptBuf::from_bytes(vec![0x51]),
                },
                out(&bom(format!("claim:{peg}:7").as_bytes())),
            ],
        };
        let (claims, errors) = parse_claims(&tx);
        assert!(errors.is_empty());
        assert_eq!((claims[0].txid.as_str(), claims[0].vout), (peg.as_str(), 7));
        tx.output[1] = out(&op_return(
            &[BOM, BOM, format!("claim:{peg}:7").as_bytes()].concat(),
        ));
        assert!(parse_claims(&tx).0.is_empty());
        // peg-in: the BOM is dropped for the hex-form decision only; a raw
        // remainder keeps every byte, as `toHex(rest)` does
        let hexform = op_return(&[b"pegin:sidestr:trial:", BOM, b"abcd"].concat());
        assert_eq!(
            parse_peg_marker(&hexform, "sidestr:trial").map(|s| s.to_hex_string()),
            Some("abcd".into())
        );
        let raw = op_return(&[b"pegin:sidestr:trial:", BOM, b"abc"].concat());
        assert_eq!(
            parse_peg_marker(&raw, "sidestr:trial").map(|s| s.to_hex_string()),
            Some("efbbbf616263".into())
        );
        let only = op_return(&[b"pegin:sidestr:trial:", BOM].concat());
        assert_eq!(
            parse_peg_marker(&only, "sidestr:trial").map(|s| s.to_hex_string()),
            Some("efbbbf".into())
        );
        // records
        assert_eq!(
            record_text(&bom(b"issue:X:0")).as_deref(),
            Some("issue:X:0")
        );
        // and not the byte-compared parent records
        let d = pegout_marker_data("sidestr:t", &"c".repeat(64)).unwrap();
        assert_eq!(parse_pegout_marker(&bom(&d), "sidestr:t"), None);
        let ck = checkpoint_data("sidestr:t", 1, &"d".repeat(64)).unwrap();
        assert_eq!(parse_checkpoint(&bom(&ck), "sidestr:t"), None);
    }

    /// Audit F3 (2026-09-22): the checked constructors refuse what the
    /// parsers would not read back; the unchecked ones never truncate.
    #[test]
    fn checked_constructors_and_untruncated_pushes() {
        let peg = "a".repeat(64);
        assert!(try_claim_marker(&peg, CLAIM_VOUT_MAX).is_ok());
        assert!(try_claim_marker(&peg, CLAIM_VOUT_MAX + 1).is_err());
        assert!(try_claim_marker(&peg, u32::MAX).is_err());
        assert!(try_claim_marker(&"a".repeat(63), 0).is_err());
        assert!(try_claim_marker(&"A".repeat(64), 0).is_err());
        assert_eq!(try_claim_marker(&peg, 5).unwrap(), claim_marker(&peg, 5));
        assert!(try_pegout_marker("5120").is_ok());
        assert_eq!(
            try_pegout_marker(&"AB".repeat(40)).unwrap(),
            pegout_marker(&"ab".repeat(40))
        );
        assert!(try_pegout_marker("00").is_err());
        assert!(try_pegout_marker("abc").is_err());
        assert!(try_pegout_marker("zz").is_err());
        assert!(try_pegout_marker(&"ab".repeat(41)).is_err());
        assert!(try_pegout_marker("").is_err());
        // an unchecked 257-byte payload is a whole OP_PUSHDATA2 push, not a
        // length truncated to one byte; no marker parser reads it
        let long = pegout_marker(&"ab".repeat(125));
        let b = long.as_bytes();
        assert_eq!(&b[..4], &[0x6a, 0x4d, 0x01, 0x01]);
        assert_eq!(b.len(), 4 + 257);
        assert!(op_return_data(&long).is_none() && parse_pegout(&long).is_none());
        assert!(long.instructions().all(|i| i.is_ok()));
        let claim = claim_marker(&peg, u32::MAX);
        assert!(claim.to_hex_string().starts_with("6a4c51"));
        assert!(claim.instructions().all(|i| i.is_ok()));
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
