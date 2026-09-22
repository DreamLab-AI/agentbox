//! Level 2 (`proposals/level-2.md`), the pure parts: a chain with `n`
//! signers and a threshold `k`. The challenge is a taproot output whose
//! internal key is provably unspendable (BIP 341's NUMS point tweaked by the
//! chain id) and whose single leaf is `multi_a(k, pk_1 … pk_n)`. A block's
//! solution is the script-path witness: `n` signature slots in leaf order
//! (empty for a signer who did not sign), the leaf script, the control
//! block. A port of `siding/lib/federation.mjs` (Melvin Carvalho, AGPL-3.0).
//!
//! What is **not** here, on purpose: the co-signing round (`round.mjs`). The
//! independent review of ADR-2101 found its timeout re-signing produces
//! conflicting authorisations at one height; the round is a protocol above
//! the signature and lives in its own crate, `sidestr-round`, where that
//! re-signing is an option. This module gives that crate what it needs and
//! nothing that decides: derive the federation from the document, sign a
//! template partially, check a partial, assemble `k` signatures into a
//! witness, seal, and verify a sealed block.
//!
//! # Template versus sealed block
//!
//! [`crate::block::seal_block`] inserts the witness, recomputes the merkle
//! root and grinds a nonce, so **the unsigned template's identity is not the
//! sealed block's hash**, and two valid `k`-subsets of signatures seal the
//! same template to two different hashes. [`crate::block::template_id`] is the
//! identity signers authorise — it strips the solution and the nonce before
//! hashing, so it is the same before and after sealing — and the sealed hash
//! is a second identity that has to be agreed on separately (ADR-2101, review
//! §4). Nothing here chooses a `k`-subset before signatures exist:
//! [`assemble_witness`] takes what has arrived.
//!
//! ```
//! use bitcoin::hashes::Hash;
//! use sidestr_core::block::{build_block, pubkey_of, template_id, verify_block_solution, BlockTemplate, Stock, BlockSolution};
//! use sidestr_core::federation::{assemble_witness, partial_signature, seal_federated, Federation};
//! use std::collections::BTreeMap;
//!
//! let keys: Vec<_> = (1u8..=3).map(|i| bitcoin::secp256k1::SecretKey::from_slice(&[i; 32]).unwrap()).collect();
//! let pubs: Vec<_> = keys.iter().map(pubkey_of).collect();
//! let fed = Federation::new("sidestr:doc", pubs.clone(), 2).unwrap();
//! assert_eq!(fed.script.len(), 3 * 34 + 2);
//! assert_eq!(fed.challenge().len(), 34);
//!
//! let block = build_block(&Stock, &BlockTemplate { height: 0, prev: bitcoin::BlockHash::all_zeros(), time: 1_790_000_000,
//!     transactions: vec![], outputs: vec![], bits: bitcoin::CompactTarget::from_consensus(0x207f_ffff), marker: "sidestr genesis sidestr:doc".into() });
//! let mut sigs = BTreeMap::new();
//! for i in [0, 2] { sigs.insert(pubs[i], partial_signature(&Stock, &block, &fed, &keys[i], &[0u8; 32]).unwrap()); }
//! let witness = assemble_witness(&fed, &sigs).unwrap();
//! assert_eq!(witness.len(), 5); // three slots (one empty), the leaf, the control block
//! assert!(witness[1].is_empty()); // pk_2 did not sign; slots are in reverse leaf order
//! let sealed = seal_federated(&Stock, &block, &fed, &sigs).unwrap();
//! assert!(matches!(verify_block_solution(&Stock, &sealed, &fed.challenge()), Ok(BlockSolution::ScriptPath(m)) if m.signed == vec![true, false, true]));
//! // the template id survives sealing; the block hash does not
//! assert_eq!(template_id(&Stock, &block, "sidestr:doc", None).unwrap(), template_id(&Stock, &sealed, "sidestr:doc", None).unwrap());
//! ```

use std::collections::BTreeMap;

use bitcoin::hashes::{sha256, Hash};
use bitcoin::key::{TapTweak, TweakedPublicKey};
use bitcoin::secp256k1::{
    schnorr::Signature, Keypair, Message, Parity, PublicKey, Scalar, SecretKey, XOnlyPublicKey,
};
use bitcoin::sighash::{Annex, Prevouts, SighashCache, TapSighashType};
use bitcoin::taproot::{ControlBlock, LeafVersion, TapLeafHash, TapNodeHash};
use bitcoin::{Script, ScriptBuf, Transaction, TxOut};

use crate::block::{
    block_sighash_for, challenge_for_output_key, schnorr_verify, seal_block, secp, HeaderFamily,
    SpendPath,
};
use crate::document::ChainDocument;
use crate::error::{Error, Result};

/// BIP 341's `H`, the x coordinate of the point with no known discrete log:
/// `lift_x(0x50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0)`.
pub const NUMS_X: [u8; 32] = [
    0x50, 0x92, 0x9b, 0x74, 0xc1, 0xa0, 0x49, 0x54, 0xb7, 0x8b, 0x4b, 0x60, 0x35, 0xe9, 0x7a, 0x5e,
    0x07, 0x8a, 0x5a, 0x0f, 0x28, 0xec, 0x96, 0xd5, 0x47, 0xbf, 0xee, 0x9a, 0xce, 0x80, 0x3a, 0xc0,
];

/// The most signers a federation may have: `multi_a` counts with `OP_1`..`OP_16`.
pub const MAX_SIGNERS: usize = 16;

fn tagged(tag: &[u8], msg: &[u8]) -> [u8; 32] {
    let t = sha256::Hash::hash(tag).to_byte_array();
    let mut e = sha256::Hash::engine();
    use bitcoin::hashes::HashEngine;
    e.input(&t);
    e.input(&t);
    e.input(msg);
    sha256::Hash::from_engine(e).to_byte_array()
}

/// The internal key for a chain (`federation.mjs numsKey`): `H +
/// int(tagged("sidestr/nums", chain id))·G`, so it is unspendable and per
/// chain. Nobody holds this key, which is what makes the script path the only
/// way to satisfy the challenge.
pub fn nums_key(chain_id: &str) -> Result<XOnlyPublicKey> {
    let t = tagged(b"sidestr/nums", chain_id.as_bytes());
    let h = PublicKey::from_slice(&[&[0x02][..], &NUMS_X[..]].concat())?;
    let scalar = Scalar::from_be_bytes(t)
        .map_err(|_| Error::Federation("nums derivation failed: tweak out of range".into()))?;
    Ok(h.add_exp_tweak(secp(), &scalar)?.x_only_public_key().0)
}

/// The leaf (`federation.mjs leafScript`): `<pk_1> CHECKSIG <pk_2> CHECKSIGADD
/// … <pk_n> CHECKSIGADD <k> NUMEQUAL`. 1 to 16 signers, `1 ≤ k ≤ n`.
pub fn leaf_script(signers: &[XOnlyPublicKey], threshold: u8) -> Result<ScriptBuf> {
    if signers.is_empty() || signers.len() > MAX_SIGNERS {
        return Err(Error::Federation("1 to 16 signers".into()));
    }
    if threshold == 0 || usize::from(threshold) > signers.len() {
        return Err(Error::Federation(
            "threshold between 1 and the number of signers".into(),
        ));
    }
    let mut s = Vec::with_capacity(signers.len() * 34 + 2);
    for (i, pk) in signers.iter().enumerate() {
        s.push(0x20);
        s.extend_from_slice(&pk.serialize());
        s.push(if i == 0 { 0xac } else { 0xba });
    }
    s.push(0x50 + threshold);
    s.push(0x9c);
    Ok(ScriptBuf::from_bytes(s))
}

/// The inverse of [`leaf_script`]: the keys and threshold of a script that is
/// exactly the `multi_a` template, `None` for any other script.
pub fn parse_multi_a(script: &Script) -> Option<(Vec<XOnlyPublicKey>, u8)> {
    let b = script.as_bytes();
    let mut keys = Vec::new();
    let mut i = 0;
    while i + 34 <= b.len() && b[i] == 0x20 {
        let pk = XOnlyPublicKey::from_slice(&b[i + 1..i + 33]).ok()?;
        let op = b[i + 33];
        if (keys.is_empty() && op != 0xac) || (!keys.is_empty() && op != 0xba) {
            return None;
        }
        keys.push(pk);
        i += 34;
        if keys.len() > MAX_SIGNERS {
            return None;
        }
    }
    if keys.is_empty() || b.len() != i + 2 || !(0x51..=0x60).contains(&b[i]) || b[i + 1] != 0x9c {
        return None;
    }
    let k = b[i] - 0x50;
    (usize::from(k) <= keys.len()).then_some((keys, k))
}

/// Everything a document with `signers` and `threshold` implies
/// (`federation.mjs federation`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Federation {
    /// The signers, in leaf order.
    pub signers: Vec<XOnlyPublicKey>,
    /// How many must sign.
    pub threshold: u8,
    /// The leaf: `multi_a(k, signers)`.
    pub script: ScriptBuf,
    /// The TapLeaf hash of the leaf.
    pub leaf_hash: TapLeafHash,
    /// The NUMS internal key for this chain.
    pub internal_key: XOnlyPublicKey,
    /// The output key: the internal key tweaked by the leaf.
    pub output_key: TweakedPublicKey,
    /// The parity of the output key's Y, which the control block carries.
    pub parity: Parity,
    /// The control block: `0xc0 | parity` then the internal key; no merkle
    /// path, since the tree has one leaf.
    pub control_block: Vec<u8>,
}

impl Federation {
    /// Derive the federation for a chain id, its signers and threshold.
    /// Refuses fewer than 1 or more than 16 signers, a threshold outside
    /// `1..=n`, and a **duplicate signer**: two positions for one key would
    /// let one custody authority count twice (review §9).
    pub fn new(chain_id: &str, signers: Vec<XOnlyPublicKey>, threshold: u8) -> Result<Self> {
        let script = leaf_script(&signers, threshold)?;
        for (i, a) in signers.iter().enumerate() {
            if signers[..i].contains(a) {
                return Err(Error::Federation(format!("signer {a} is listed twice")));
            }
        }
        let leaf_hash = TapLeafHash::from_script(&script, LeafVersion::TapScript);
        let internal_key = nums_key(chain_id)?;
        let (output_key, parity) =
            internal_key.tap_tweak(secp(), Some(TapNodeHash::from(leaf_hash)));
        let mut control_block = vec![0xc0 | u8::from(parity)];
        control_block.extend_from_slice(&internal_key.serialize());
        Ok(Self {
            signers,
            threshold,
            script,
            leaf_hash,
            internal_key,
            output_key,
            parity,
            control_block,
        })
    }

    /// The federation a document names through `signers` and `threshold`,
    /// `None` for a level-1 document (`overlay.mjs checkFederation`). A
    /// document with only one of the two fields, a malformed signer, or a
    /// `challenge` that is not the derived one is a broken document.
    pub fn for_document(doc: &ChainDocument) -> Result<Option<Self>> {
        let (signers, threshold) = match (&doc.signers, doc.threshold) {
            (None, None) => return Ok(None),
            (Some(s), Some(t)) => (s, t),
            _ => {
                return Err(Error::Document(format!(
                    "chain {}: a level 2 document has both signers and threshold",
                    doc.id
                )))
            }
        };
        let keys = signers
            .iter()
            .map(|s| {
                let bytes = hex::decode(s)
                    .map_err(|_| Error::Document(format!("signer {s} is not an x-only key")))?;
                XOnlyPublicKey::from_slice(&bytes)
                    .map_err(|_| Error::Document(format!("signer {s} is not an x-only key")))
            })
            .collect::<Result<Vec<_>>>()?;
        let k = u8::try_from(threshold).map_err(|_| {
            Error::Federation("threshold between 1 and the number of signers".into())
        })?;
        let fed = Self::new(&doc.id, keys, k)?;
        let derived = fed.challenge().to_hex_string();
        if !doc.challenge.is_empty() && doc.challenge.to_ascii_lowercase() != derived {
            return Err(Error::Document(format!(
                "{}: challenge {}… is not the one {} signers with threshold {} derive ({}…)",
                doc.id,
                &doc.challenge[..doc.challenge.len().min(12)],
                signers.len(),
                threshold,
                &derived[..12]
            )));
        }
        Ok(Some(fed))
    }

    /// The challenge: `OP_1 <output key>`.
    pub fn challenge(&self) -> ScriptBuf {
        challenge_for_output_key(&self.output_key)
    }

    /// The parent's peg output is the chain's challenge, literally: this
    /// descriptor derives the same address in a node's wallet
    /// (`federation.mjs pegDescriptor`, public keys only).
    pub fn descriptor(&self) -> String {
        format!(
            "tr({},multi_a({},{}))",
            self.internal_key,
            self.threshold,
            self.signers
                .iter()
                .map(|k| k.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

/// One signer's partial signature over a block (`federation.mjs
/// partialSignature`): the tapscript sighash of the virtual transaction for
/// the federation's leaf, `SIGHASH_DEFAULT`, with BIP 340 auxiliary
/// randomness `aux` (zeros for a reproducible genesis). `key` must be one of
/// the signers.
pub fn partial_signature<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    fed: &Federation,
    key: &SecretKey,
    aux: &[u8; 32],
) -> Result<Signature> {
    let keypair = Keypair::from_secret_key(secp(), key);
    let pk = keypair.x_only_public_key().0;
    if !fed.signers.contains(&pk) {
        return Err(Error::Federation(format!(
            "this key ({pk}) is not one of the signers"
        )));
    }
    let msg = block_sighash_for(
        family,
        block,
        &fed.challenge(),
        &SpendPath::ScriptPath {
            leaf_hash: fed.leaf_hash,
            annex: None,
            codesep_pos: 0xffff_ffff,
        },
    )?;
    Ok(secp().sign_schnorr_with_aux_rand(&Message::from_digest(msg), &keypair, aux))
}

/// Whether `sig` is `pubkey`'s partial signature over `block` for this
/// federation (`federation.mjs verifyPartial`).
pub fn verify_partial<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    fed: &Federation,
    pubkey: &XOnlyPublicKey,
    sig: &Signature,
) -> bool {
    let Ok(msg) = block_sighash_for(
        family,
        block,
        &fed.challenge(),
        &SpendPath::ScriptPath {
            leaf_hash: fed.leaf_hash,
            annex: None,
            codesep_pos: 0xffff_ffff,
        },
    ) else {
        return false;
    };
    schnorr_verify(&msg, sig.as_ref(), &pubkey.serialize())
}

/// The witness from the signatures that have arrived (`federation.mjs
/// assembleWitness`): slots in reverse leaf order (`pk_1`'s on top), then
/// the leaf, then the control block. Exactly `k` slots are filled — the
/// first `k` signers, in leaf order, whose signatures are present — because
/// one more would make `NUMEQUAL` fail; fewer than `k` present is an error.
/// Signatures for keys outside the federation are ignored.
pub fn assemble_witness(
    fed: &Federation,
    sigs: &BTreeMap<XOnlyPublicKey, Signature>,
) -> Result<Vec<Vec<u8>>> {
    let have: Vec<&XOnlyPublicKey> = fed
        .signers
        .iter()
        .filter(|pk| sigs.contains_key(pk))
        .collect();
    if have.len() < usize::from(fed.threshold) {
        return Err(Error::Federation(format!(
            "{} of {} signatures",
            have.len(),
            fed.threshold
        )));
    }
    let chosen: Vec<&XOnlyPublicKey> = have[..usize::from(fed.threshold)].to_vec();
    let mut slots: Vec<Vec<u8>> = fed
        .signers
        .iter()
        .map(|pk| {
            if chosen.contains(&pk) {
                sigs[pk].as_ref().to_vec()
            } else {
                Vec::new()
            }
        })
        .collect();
    slots.reverse();
    slots.push(fed.script.to_bytes());
    slots.push(fed.control_block.clone());
    Ok(slots)
}

/// A block sealed with `k` of `n` signatures (`federation.mjs sealFederated`).
/// The sealed block's hash is a new identity (see the module notes).
pub fn seal_federated<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    fed: &Federation,
    sigs: &BTreeMap<XOnlyPublicKey, Signature>,
) -> Result<F::Block> {
    seal_block(family, block, &assemble_witness(fed, sigs)?)
}

// --- the verifier for exactly this template -------------------------------------------

/// Why a taproot script-path spend was refused. Every variant names what was
/// checked, so a refusal is never "script failed": this verifier covers
/// exactly the `multi_a(k, …)` leaf and says so when it meets anything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ScriptPathError {
    /// The prevout is not a taproot output.
    #[error("unsupported script type: not a taproot output")]
    ScriptType,
    /// A taproot input's scriptSig must be empty.
    #[error("WITNESS_MALLEATED: taproot scriptSig is not empty")]
    ScriptSig,
    /// Fewer than two items after the annex: not a script-path spend.
    #[error("a script-path witness has at least a script and a control block")]
    TooFewItems,
    /// The annex is not one starting `0x50`.
    #[error("bad annex")]
    Annex,
    /// The control block is not `1 + 32 + 32·m` bytes with a valid internal key.
    #[error("bad control block")]
    ControlBlock,
    /// The control block does not commit the leaf to the output key with this parity.
    #[error("control block commitment mismatch")]
    Commitment,
    /// A leaf version other than `0xc0`. The reference kernel skips such a
    /// leaf as unverifiable; this verifier refuses it.
    #[error("unknown tapleaf version {0:#04x}: not verified, refused")]
    LeafVersion(u8),
    /// The leaf is a valid tapscript, but not `<pk> CHECKSIG <pk> CHECKSIGADD … <k> NUMEQUAL`.
    #[error(
        "the leaf is not the multi_a(k, pk_1 … pk_n) template; only that template is verified here"
    )]
    NotMultiA,
    /// The witness does not carry exactly one slot per signer.
    #[error("{have} signature slots for {need} signers")]
    SlotCount {
        /// Items before the script.
        have: usize,
        /// Keys in the leaf.
        need: usize,
    },
    /// A non-empty slot that is not a 64-byte or a 65-byte signature with a
    /// defined, non-zero hash type (BIP 342).
    #[error("slot {slot}: bad tapscript signature encoding")]
    BadSignatureEncoding {
        /// The slot, in leaf order.
        slot: usize,
    },
    /// The BIP 342 signature-operations budget (50 + witness size, 50 per
    /// non-empty signature) ran out.
    #[error("tapscript sigops budget exceeded")]
    Budget,
    /// A non-empty slot whose signature does not verify for its key: the
    /// whole script fails (BIP 342).
    #[error("slot {slot}: invalid schnorr signature")]
    InvalidSignature {
        /// The slot, in leaf order.
        slot: usize,
    },
    /// `NUMEQUAL` false: the count of valid signatures is not `k`.
    #[error("{have} valid signatures, the leaf needs exactly {need}")]
    SignatureCount {
        /// Non-empty, valid signatures.
        have: usize,
        /// `k`.
        need: u8,
    },
}

/// What a verified `multi_a` spend showed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MultiA {
    /// The leaf's keys, in order.
    pub signers: Vec<XOnlyPublicKey>,
    /// `k`.
    pub threshold: u8,
    /// Which slots carried a signature, in leaf order.
    pub signed: Vec<bool>,
}

/// Verify input `index` as a taproot script-path spend of exactly the
/// `multi_a(k, pk_1 … pk_n)` leaf, under BIP 341/342: annex, control block
/// decoded and its commitment to the output key checked (with the merkle
/// path and parity it carries), leaf version `0xc0`, the TapLeaf hash, then
/// the tapscript executed for this template — each slot empty or a 64/65-byte
/// signature over the tapscript sighash for its key, the sigops budget,
/// `NUMEQUAL` exact. Anything else is refused with a [`ScriptPathError`]
/// that says which check; this is not a script interpreter and claims no
/// general sidestr script compatibility.
pub fn verify_multi_a_input(
    tx: &Transaction,
    index: usize,
    prevouts: &[TxOut],
) -> core::result::Result<MultiA, ScriptPathError> {
    let prevout = prevouts.get(index).ok_or(ScriptPathError::ScriptType)?;
    let input = tx.input.get(index).ok_or(ScriptPathError::ScriptType)?;
    if !prevout.script_pubkey.is_p2tr() {
        return Err(ScriptPathError::ScriptType);
    }
    if !input.script_sig.is_empty() {
        return Err(ScriptPathError::ScriptSig);
    }
    let mut items: Vec<&[u8]> = input.witness.iter().collect();
    // BIP 342: the budget counts the whole serialised witness, annex included
    let witness_size: i64 = items
        .iter()
        .map(|w| {
            w.len() as i64
                + match w.len() {
                    0..=0xfc => 1,
                    0xfd..=0xffff => 3,
                    _ => 5,
                }
        })
        .sum::<i64>()
        + 1;
    let annex: Option<&[u8]> =
        if items.len() >= 2 && items.last().is_some_and(|a| a.first() == Some(&0x50)) {
            let raw = items.pop().expect("checked");
            Annex::new(raw).map_err(|_| ScriptPathError::Annex)?;
            Some(raw)
        } else {
            None
        };
    if items.len() < 2 {
        return Err(ScriptPathError::TooFewItems);
    }
    let control = items.pop().expect("checked");
    let script = Script::from_bytes(items.pop().expect("checked"));
    let cb = ControlBlock::decode(control).map_err(|_| ScriptPathError::ControlBlock)?;
    let output_key = XOnlyPublicKey::from_slice(&prevout.script_pubkey.as_bytes()[2..34])
        .map_err(|_| ScriptPathError::ScriptType)?;
    if !cb.verify_taproot_commitment(secp(), output_key, script) {
        return Err(ScriptPathError::Commitment);
    }
    if cb.leaf_version != LeafVersion::TapScript {
        return Err(ScriptPathError::LeafVersion(cb.leaf_version.to_consensus()));
    }
    let (signers, threshold) = parse_multi_a(script).ok_or(ScriptPathError::NotMultiA)?;
    if items.len() != signers.len() {
        return Err(ScriptPathError::SlotCount {
            have: items.len(),
            need: signers.len(),
        });
    }
    let leaf_hash = TapLeafHash::from_script(script, LeafVersion::TapScript);
    let mut budget = 50 + witness_size;
    let mut signed = Vec::with_capacity(signers.len());
    let mut count = 0usize;
    // pk_1 consumes the top of the stack, which is the last remaining item
    for (slot, pk) in signers.iter().enumerate() {
        let raw = items[items.len() - 1 - slot];
        if raw.is_empty() {
            signed.push(false);
            continue;
        }
        let (sig, hash_type) = match raw.len() {
            64 => (raw, TapSighashType::Default),
            65 if raw[64] != 0 => (
                &raw[..64],
                TapSighashType::from_consensus_u8(raw[64])
                    .map_err(|_| ScriptPathError::BadSignatureEncoding { slot })?,
            ),
            _ => return Err(ScriptPathError::BadSignatureEncoding { slot }),
        };
        budget -= 50;
        if budget < 0 {
            return Err(ScriptPathError::Budget);
        }
        let msg = SighashCache::new(tx)
            .taproot_signature_hash(
                index,
                &Prevouts::All(prevouts),
                annex.map(|a| Annex::new(a).expect("checked above")),
                Some((leaf_hash, 0xffff_ffff)),
                hash_type,
            )
            .map_err(|_| ScriptPathError::BadSignatureEncoding { slot })?;
        if !schnorr_verify(&msg.to_byte_array(), sig, &pk.serialize()) {
            return Err(ScriptPathError::InvalidSignature { slot });
        }
        signed.push(true);
        count += 1;
    }
    if count != usize::from(threshold) {
        return Err(ScriptPathError::SignatureCount {
            have: count,
            need: threshold,
        });
    }
    Ok(MultiA {
        signers,
        threshold,
        signed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::pubkey_of;

    fn keys(n: u8) -> (Vec<SecretKey>, Vec<XOnlyPublicKey>) {
        let ks: Vec<SecretKey> = (1..=n)
            .map(|i| SecretKey::from_slice(&[i; 32]).unwrap())
            .collect();
        let ps = ks.iter().map(pubkey_of).collect();
        (ks, ps)
    }

    #[test]
    fn leaf_round_trips_and_bounds_hold() {
        let (_, pubs) = keys(5);
        for k in 1..=5u8 {
            let s = leaf_script(&pubs, k).unwrap();
            assert_eq!(parse_multi_a(&s), Some((pubs.clone(), k)));
        }
        assert!(leaf_script(&pubs, 0).is_err());
        assert!(leaf_script(&pubs, 6).is_err());
        assert!(leaf_script(&[], 1).is_err());
        let (_, many) = keys(17);
        assert!(leaf_script(&many, 1).is_err());
        assert_eq!(parse_multi_a(Script::from_bytes(&[0x51])), None);
        let mut s = leaf_script(&pubs, 2).unwrap().to_bytes();
        s.push(0x00);
        assert_eq!(parse_multi_a(Script::from_bytes(&s)), None);
        let mut swapped = leaf_script(&pubs, 2).unwrap().to_bytes();
        swapped[33] = 0xba;
        assert_eq!(parse_multi_a(Script::from_bytes(&swapped)), None);
        // k > n is a script that can never be satisfied; not the template
        let mut over = leaf_script(&pubs[..2], 2).unwrap().to_bytes();
        let last = over.len() - 2;
        over[last] = 0x53;
        assert_eq!(parse_multi_a(Script::from_bytes(&over)), None);
    }

    #[test]
    fn federation_refuses_duplicates_and_derives_per_chain() {
        let (_, pubs) = keys(3);
        let a = Federation::new("sidestr:a", pubs.clone(), 2).unwrap();
        let b = Federation::new("sidestr:b", pubs.clone(), 2).unwrap();
        assert_ne!(a.internal_key, b.internal_key);
        assert_ne!(a.challenge(), b.challenge());
        assert_eq!(a.script, b.script);
        assert_eq!(a.control_block.len(), 33);
        assert_eq!(a.control_block[0] & 0xfe, 0xc0);
        assert_eq!(a.control_block[0] & 1, u8::from(a.parity));
        let e = Federation::new("sidestr:a", vec![pubs[0], pubs[1], pubs[0]], 2)
            .unwrap_err()
            .to_string();
        assert!(e.contains("listed twice"), "{e}");
        assert!(a
            .descriptor()
            .starts_with(&format!("tr({},multi_a(2,", a.internal_key)));
    }

    #[test]
    fn nums_matches_the_reference_derivation() {
        // the oracle fixture's chain: federation.mjs numsKey('sidestr:fedtest')
        assert_eq!(
            nums_key("sidestr:fedtest").unwrap().to_string(),
            "d137cd79e4cf8765ff03016f140425d760d96b8bcd574cc7d3ebc3b99f1f666d"
        );
    }
}
