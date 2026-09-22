//! The signature hashes a spend on a sidestr chain is judged by, and the
//! taproot key-path verifier over them.
//!
//! On a stock chain a spend signs BIP 341's taproot sighash and nothing
//! else. Beside a BLAKE2b parent the chain inherits Bitcoin Knots' **unified
//! opt-in signature hash** (`doc/unified-sighash.md` in Knots
//! v29.4.1.knots20260508): one message layout for every script type,
//! selected per signature by bit `0x20` in the hash-type byte, active from
//! the chain's `unifiedSighashParam` height — which `siding/lib/overlay.mjs`
//! sets to `blake2bHeight: 0`, so on a sidestr chain beside `xbt` or
//! `txbt4` it applies from the genesis. Every spend on the live
//! `sidestr:txbt4-siding` chain carries hash type `0x21`
//! (`SIGHASH_ALL | SIGHASH_UNIFIED`); the message is ported from the
//! reference kernel's `codec/interpreter.js sighashUnified` (Melvin
//! Carvalho, AGPL-3.0) and proven by replaying that chain.
//!
//! A signature *without* the bit reads as plain BIP 341 on both families; a
//! signature *with* it on a stock chain is an invalid hash type, as BIP 341
//! says. Which reading applies is [`HeaderFamily::sighash_rules`]'s answer.
//!
//! [`HeaderFamily::sighash_rules`]: crate::block::HeaderFamily::sighash_rules

use bitcoin::consensus::encode::serialize;
use bitcoin::hashes::{sha256, Hash, HashEngine};
use bitcoin::sighash::{Annex, Prevouts, SighashCache, TapSighashType};
use bitcoin::{Transaction, TxOut};

use crate::block::{annex_of, schnorr_verify};

/// Knots' opt-in bit in the hash-type byte (`SIGHASH_UNIFIED` in the
/// reference interpreter).
pub const SIGHASH_UNIFIED: u8 = 0x20;

/// Which signature-hash rules a spend is judged by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SighashRules {
    /// BIP 341 only: the stock family, and any family before its fork height.
    #[default]
    Bip341,
    /// Knots' unified sighash is in force: a signature whose hash type carries
    /// [`SIGHASH_UNIFIED`] is verified over the unified message; one without
    /// it over BIP 341's, as before.
    KnotsUnified,
}

/// The taproot half of a unified message: which spend path, and for the
/// script path the leaf hash and code-separator position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnifiedTaproot<'a> {
    /// Script type 2: the key path.
    KeyPath,
    /// Script type 3: a tapscript leaf, key version 0.
    ScriptPath {
        /// The TapLeaf hash of the leaf being executed.
        leaf_hash: &'a [u8; 32],
        /// The position of the last executed `OP_CODESEPARATOR`, `0xffffffff` for none.
        codesep_pos: u32,
    },
}

fn sha(parts: &[&[u8]]) -> [u8; 32] {
    let mut e = sha256::Hash::engine();
    for p in parts {
        e.input(p);
    }
    sha256::Hash::from_engine(e).to_byte_array()
}

fn compact_size(n: usize) -> Vec<u8> {
    match n {
        0..=0xfc => vec![n as u8],
        0xfd..=0xffff => vec![0xfd, (n & 0xff) as u8, (n >> 8) as u8],
        _ => {
            let mut v = vec![0xfe];
            v.extend((n as u32).to_le_bytes());
            v
        }
    }
}

/// Knots' unified sighash for a taproot spend (`interpreter.js
/// sighashUnified`, script types 2 and 3): BIP 341's layout with a script-type
/// byte in place of the spend type, single SHA-256 aggregates, under
/// `TaggedHash("UnifiedSighash")`. `hash_type` must carry
/// [`SIGHASH_UNIFIED`], no undefined bits, and an output type of 1 to 3;
/// `prevouts` is every input's, in order, since the message commits to all
/// spent amounts and scripts.
///
/// ```text
/// 0x00 ‖ hash_type ‖ version ‖ lock_time ‖ 0x00
/// [sha_prevouts ‖ sha_amounts ‖ sha_scriptpubkeys ‖ sha_sequences]   unless ANYONECANPAY
/// [sha_outputs]                                                      unless NONE or SINGLE
/// script_type
/// ANYONECANPAY ? outpoint ‖ prevout ‖ sequence : input index
/// annex present ‖ [sha(compact(annex) ‖ annex)]
/// [sha(this output)]                                                 SINGLE
/// [leaf_hash ‖ 0x00 ‖ codesep_pos]                                   script path
/// ```
pub fn unified_taproot_sighash(
    tx: &Transaction,
    index: usize,
    prevouts: &[TxOut],
    hash_type: u8,
    annex: Option<&[u8]>,
    path: UnifiedTaproot,
) -> Result<[u8; 32], &'static str> {
    if hash_type & SIGHASH_UNIFIED == 0 {
        return Err("unified sighash without SIGHASH_UNIFIED");
    }
    if hash_type & !(0x1f | 0x80 | SIGHASH_UNIFIED) != 0 {
        return Err("invalid taproot sighash type");
    }
    let output_type = hash_type & 0x1f;
    if !(1..=3).contains(&output_type) {
        return Err("invalid taproot sighash type");
    }
    if prevouts.len() != tx.input.len() {
        return Err("unified sighash needs every input prevout");
    }
    let input = tx.input.get(index).ok_or("no such input")?;
    let anyone = hash_type & 0x80 != 0;
    let outpoint = |i: &bitcoin::TxIn| serialize(&i.previous_output);
    let mut msg: Vec<u8> = vec![0x00, hash_type];
    msg.extend((tx.version.0 as u32).to_le_bytes());
    msg.extend(tx.lock_time.to_consensus_u32().to_le_bytes());
    msg.push(0x00);
    if !anyone {
        let prev: Vec<u8> = tx.input.iter().flat_map(outpoint).collect();
        let amounts: Vec<u8> = prevouts
            .iter()
            .flat_map(|p| p.value.to_sat().to_le_bytes())
            .collect();
        let spks: Vec<u8> = prevouts
            .iter()
            .flat_map(|p| serialize(&p.script_pubkey))
            .collect();
        let seqs: Vec<u8> = tx
            .input
            .iter()
            .flat_map(|i| i.sequence.0.to_le_bytes())
            .collect();
        msg.extend(sha(&[&prev]));
        msg.extend(sha(&[&amounts]));
        msg.extend(sha(&[&spks]));
        msg.extend(sha(&[&seqs]));
    }
    if output_type != 2 && output_type != 3 {
        let outs: Vec<u8> = tx.output.iter().flat_map(serialize).collect();
        msg.extend(sha(&[&outs]));
    }
    msg.push(match path {
        UnifiedTaproot::KeyPath => 2,
        UnifiedTaproot::ScriptPath { .. } => 3,
    });
    if anyone {
        msg.extend(outpoint(input));
        msg.extend(serialize(&prevouts[index]));
        msg.extend(input.sequence.0.to_le_bytes());
    } else {
        msg.extend((index as u32).to_le_bytes());
    }
    match annex {
        Some(a) => {
            msg.push(1);
            msg.extend(sha(&[&compact_size(a.len()), a]));
        }
        None => msg.push(0),
    }
    if output_type == 3 {
        let out = tx
            .output
            .get(index)
            .ok_or("sighash single without matching output")?;
        msg.extend(sha(&[&serialize(out)]));
    }
    if let UnifiedTaproot::ScriptPath {
        leaf_hash,
        codesep_pos,
    } = path
    {
        msg.extend(leaf_hash);
        msg.push(0x00);
        msg.extend(codesep_pos.to_le_bytes());
    }
    let tag = sha256::Hash::hash(b"UnifiedSighash").to_byte_array();
    Ok(sha(&[&tag, &tag, &msg]))
}

/// Verify one input as a taproot key-path spend under `rules`: one Schnorr
/// signature, 64 bytes for `SIGHASH_DEFAULT` or 65 with an explicit type, an
/// annex allowed, over BIP 341's sighash — or, under
/// [`SighashRules::KnotsUnified`] with the [`SIGHASH_UNIFIED`] bit set,
/// over the unified message. Any other script type and the script path are
/// refused, never skipped (`interpreter.js #verifyTaproot`, key path).
pub fn verify_taproot_key_path(
    tx: &Transaction,
    index: usize,
    prevouts: &[TxOut],
    rules: SighashRules,
) -> Result<(), &'static str> {
    let prevout = prevouts.get(index).ok_or("no prevout for the input")?;
    let input = tx.input.get(index).ok_or("no such input")?;
    if !prevout.script_pubkey.is_p2tr() {
        return Err("unsupported script type: sidestr-core verifies taproot spends only");
    }
    if !input.script_sig.is_empty() {
        return Err("WITNESS_MALLEATED");
    }
    let mut items: Vec<&[u8]> = input.witness.iter().collect();
    if items.is_empty() {
        return Err("empty taproot witness");
    }
    let annex = annex_of(&mut items)?;
    if items.len() != 1 {
        return Err("taproot script path: not a key-path spend");
    }
    let raw = items[0];
    let (sig, hash_type) = match raw.len() {
        64 => (raw, 0u8),
        65 => {
            if raw[64] == 0 {
                return Err("explicit SIGHASH_DEFAULT in 65-byte signature");
            }
            (&raw[..64], raw[64])
        }
        _ => return Err("bad key-path signature size"),
    };
    let msg = if rules == SighashRules::KnotsUnified && hash_type & SIGHASH_UNIFIED != 0 {
        unified_taproot_sighash(
            tx,
            index,
            prevouts,
            hash_type,
            annex.as_ref().map(Annex::as_bytes),
            UnifiedTaproot::KeyPath,
        )?
    } else {
        let ty = TapSighashType::from_consensus_u8(hash_type)
            .map_err(|_| "invalid taproot sighash type")?;
        if prevouts.len() != tx.input.len() {
            return Err("taproot sighash needs every input prevout");
        }
        SighashCache::new(tx)
            .taproot_signature_hash(index, &Prevouts::All(prevouts), annex, None, ty)
            .map_err(|_| "sighash failed")?
            .to_byte_array()
    };
    if schnorr_verify(&msg, sig, &prevout.script_pubkey.as_bytes()[2..34]) {
        Ok(())
    } else {
        Err("invalid key-path schnorr signature")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::secp256k1::{Keypair, Message, SecretKey};
    use bitcoin::transaction::Version;
    use bitcoin::{absolute::LockTime, Amount, OutPoint, ScriptBuf, Sequence, TxIn, Witness};

    fn spend(hash_type: u8, rules: SighashRules) -> (Transaction, Vec<TxOut>) {
        let key = SecretKey::from_slice(&[3u8; 32]).unwrap();
        let kp = Keypair::from_secret_key(crate::block::secp(), &key);
        let me = crate::block::challenge_for(&kp.x_only_public_key().0);
        let prevouts = vec![TxOut {
            value: Amount::from_sat(10_000),
            script_pubkey: me.clone(),
        }];
        let mut tx = Transaction {
            version: Version::TWO,
            lock_time: LockTime::ZERO,
            input: vec![TxIn {
                previous_output: OutPoint {
                    txid: bitcoin::Txid::all_zeros(),
                    vout: 1,
                },
                script_sig: ScriptBuf::new(),
                sequence: Sequence(0xffff_fffd),
                witness: Witness::new(),
            }],
            output: vec![TxOut {
                value: Amount::from_sat(9_000),
                script_pubkey: me,
            }],
        };
        let msg = match rules {
            SighashRules::KnotsUnified if hash_type & SIGHASH_UNIFIED != 0 => {
                unified_taproot_sighash(&tx, 0, &prevouts, hash_type, None, UnifiedTaproot::KeyPath)
                    .unwrap()
            }
            _ => SighashCache::new(&tx)
                .taproot_key_spend_signature_hash(
                    0,
                    &Prevouts::All(&prevouts),
                    TapSighashType::from_consensus_u8(hash_type & !SIGHASH_UNIFIED).unwrap(),
                )
                .unwrap()
                .to_byte_array(),
        };
        let sig = crate::block::secp()
            .sign_schnorr_with_aux_rand(&Message::from_digest(msg), &kp, &[0u8; 32])
            .serialize()
            .to_vec();
        let item = if hash_type == 0 {
            sig
        } else {
            [sig, vec![hash_type]].concat()
        };
        tx.input[0].witness = Witness::from_slice(&[item]);
        (tx, prevouts)
    }

    #[test]
    fn unified_bit_is_read_only_where_the_rules_say() {
        let (tx, p) = spend(0x21, SighashRules::KnotsUnified);
        assert!(verify_taproot_key_path(&tx, 0, &p, SighashRules::KnotsUnified).is_ok());
        assert_eq!(
            verify_taproot_key_path(&tx, 0, &p, SighashRules::Bip341),
            Err("invalid taproot sighash type")
        );
        let (tx, p) = spend(0x00, SighashRules::KnotsUnified);
        assert!(verify_taproot_key_path(&tx, 0, &p, SighashRules::KnotsUnified).is_ok());
        assert!(verify_taproot_key_path(&tx, 0, &p, SighashRules::Bip341).is_ok());
        let (tx, p) = spend(0x01, SighashRules::Bip341);
        assert!(verify_taproot_key_path(&tx, 0, &p, SighashRules::KnotsUnified).is_ok());
        // a unified message is not a BIP 341 message
        let (tx, p) = spend(0x21, SighashRules::Bip341);
        assert!(verify_taproot_key_path(&tx, 0, &p, SighashRules::KnotsUnified).is_err());
    }

    #[test]
    fn unified_message_refuses_undefined_types() {
        let (tx, p) = spend(0x00, SighashRules::Bip341);
        for bad in [0x20u8, 0x24, 0x60, 0xa0] {
            assert!(
                unified_taproot_sighash(&tx, 0, &p, bad, None, UnifiedTaproot::KeyPath).is_err(),
                "{bad:#x}"
            );
        }
        assert!(unified_taproot_sighash(&tx, 0, &p, 0x01, None, UnifiedTaproot::KeyPath).is_err());
        assert!(unified_taproot_sighash(&tx, 0, &[], 0x21, None, UnifiedTaproot::KeyPath).is_err());
        let a = unified_taproot_sighash(&tx, 0, &p, 0x21, None, UnifiedTaproot::KeyPath).unwrap();
        let b = unified_taproot_sighash(&tx, 0, &p, 0x21, Some(&[0x50]), UnifiedTaproot::KeyPath)
            .unwrap();
        let c = unified_taproot_sighash(
            &tx,
            0,
            &p,
            0x21,
            None,
            UnifiedTaproot::ScriptPath {
                leaf_hash: &[9u8; 32],
                codesep_pos: 0xffff_ffff,
            },
        )
        .unwrap();
        let d = unified_taproot_sighash(&tx, 0, &p, 0xa1, None, UnifiedTaproot::KeyPath).unwrap();
        assert!(a != b && a != c && a != d && b != c);
    }
}
