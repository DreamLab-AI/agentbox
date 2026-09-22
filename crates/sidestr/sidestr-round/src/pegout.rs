//! Level 2's peg-out (`proposals/level-2.md` step 6; `siding/lib/pegoutround.mjs`):
//! a burn is paid from the k-of-n peg by a PSBT round.
//!
//! In Melvin Carvalho's words, adapted: the payer for a burn (its height
//! mod `n`, with the same fallback as blocks) funds and signs a PSBT from
//! its peg wallet and publishes it as kind 23512, `d` = the burn's
//! outpoint; each other signer checks the PSBT pays exactly that burn from
//! the peg, signs it with its wallet, and answers with kind 23513; the
//! payer combines, finalizes, broadcasts and records it.
//!
//! Upstream leans on Bitcoin Core's wallet for every PSBT step
//! (`walletcreatefundedpsbt`, `walletprocesspsbt`, `decodepsbt`,
//! `combinepsbt`, `finalizepsbt`). Here those are pure functions over
//! rust-bitcoin's [`Psbt`] — [`build_pegout_psbt`], [`sign_pegout_psbt`],
//! [`check_pegout_psbt`], [`combine_pegout_psbts`],
//! [`finalize_pegout_psbt`] — and the PSBT on the wire carries what Core
//! fills for a `tr(NUMS, multi_a(k, …))` descriptor (`witness_utxo`,
//! `tap_internal_key`, `tap_merkle_root`, the leaf with its control block,
//! key origins), so a Core-backed signer and this one co-sign the same
//! document. Broadcasting is the caller's: [`PegoutAction::Broadcast`].
//!
//! The rule of one signature per burn per signer is journalled like a
//! block signature ([`crate::journal`]) — **one durable guard for both
//! ways of authorising a burn**, co-signing another's PSBT and proposing
//! my own, keyed by the burn outpoint, written before the custody signer
//! is asked and honouring [`PegoutConfig::resign_after`] on both paths (the
//! reference gates its own proposals only on the `proposeAfter × n` retry
//! throttle, which stays as a throttle here). Two checks the reference does
//! not make are added without touching the wire: the fee is capped
//! ([`PegoutConfig::max_fee`]; a payer could otherwise propose a PSBT that
//! pays the burn and gives the rest of the peg to miners), and a co-signer's
//! 23513 is verified to be signatures over the proposed transaction before
//! it counts.
//!
//! ```
//! use sidestr_core::block::pubkey_of;
//! use sidestr_core::federation::Federation;
//! use sidestr_core::marker::Burn;
//! use sidestr_round::pegout::{build_pegout_psbt, check_pegout_psbt, finalize_pegout_psbt, prevouts_of, sign_pegout_psbt, verify_pegout_transaction, PegCoin};
//! use sidestr_round::signer::LocalKey;
//!
//! let keys: Vec<_> = (1u8..=3).map(|i| bitcoin::secp256k1::SecretKey::from_slice(&[i; 32]).unwrap()).collect();
//! let fed = Federation::new("sidestr:doc", keys.iter().map(pubkey_of).collect(), 2).unwrap();
//! let burn = Burn { txid: "ab".repeat(32), vout: 0, script: format!("5120{}", "e9".repeat(32)), value: 20_000, height: 7 };
//! let peg = PegCoin { outpoint: bitcoin::OutPoint { txid: "cd".repeat(32).parse().unwrap(), vout: 1 }, value: 100_000 };
//!
//! // the payer builds and signs; a co-signer checks and signs; anyone with k finalises
//! let mut psbt = build_pegout_psbt(&fed, "sidestr:doc", &burn, &[peg], 2).unwrap();
//! assert_eq!(check_pegout_psbt(&psbt, &fed, "sidestr:doc", &burn, 10_000), None);
//! sign_pegout_psbt(&mut psbt, &fed, "sidestr:doc", "ab…:0", &LocalKey::new(keys[0])).unwrap();
//! sign_pegout_psbt(&mut psbt, &fed, "sidestr:doc", "ab…:0", &LocalKey::new(keys[2])).unwrap();
//! let prevouts = prevouts_of(&psbt).unwrap();
//! let tx = finalize_pegout_psbt(&psbt, &fed).unwrap().expect("k signatures");
//! let spends = verify_pegout_transaction(&tx, &prevouts).unwrap();
//! assert_eq!(spends[0].signed, vec![true, false, true]);
//! ```

use std::collections::BTreeMap;
use std::str::FromStr;

use bitcoin::bip32::{DerivationPath, Fingerprint};
use bitcoin::hashes::Hash;
use bitcoin::psbt::Psbt;
use bitcoin::script::PushBytesBuf;
use bitcoin::secp256k1::XOnlyPublicKey;
use bitcoin::sighash::{Prevouts, SighashCache, TapSighashType};
use bitcoin::taproot::{ControlBlock, LeafVersion, TapNodeHash};
use bitcoin::{
    absolute::LockTime, transaction::Version, Address, Amount, Network, OutPoint, ScriptBuf,
    Sequence, Transaction, TxIn, TxOut, Witness,
};
use sidestr_core::federation::{verify_multi_a_input, Federation, MultiA, ScriptPathError};
use sidestr_core::marker::{pegout_marker_data, Burn};
use sidestr_nostr::event::{pubkey_from_hex, Event};
use sidestr_nostr::kinds::{KIND_PEGOUT_PSBT, KIND_PEGOUT_SIGNED};
use sidestr_nostr::relay::Follower;
use sidestr_nostr::round::{
    parse_pegout_psbt, parse_pegout_signed, sign_pegout_psbt as sign_psbt_event,
    sign_pegout_signed, PegoutPsbt, PegoutSigned,
};
use sidestr_nostr::tags::Outpoint;

use crate::error::{Error, Result};
use crate::journal::{VoteEntry, VoteJournal, VoteRole, VoteScope, VoteStage};
use crate::signer::{BlockSigner, PegoutSignRequest, RoundSigner};

/// A coin on the parent paying the federation's challenge: what the peg
/// wallet's `listunspent` shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PegCoin {
    /// The outpoint.
    pub outpoint: OutPoint,
    /// Sats.
    pub value: u64,
}

/// The dust threshold for a taproot output (Core's policy): change under
/// it goes to the fee.
pub const DUST: u64 = 330;

/// `<txid>:<vout>`, the key every map in the round uses (`pegoutround.mjs key_`).
pub fn burn_key(b: &Burn) -> String {
    format!("{}:{}", b.txid, b.vout)
}

fn short(s: &str, n: usize) -> &str {
    &s[..s.len().min(n)]
}

/// The parent record of the payment: `OP_RETURN pegout:<chain id>:<32-byte
/// txid>` as one direct push, byte for byte what `pegoutround.mjs` expects
/// (`'6a' + len + data`).
pub fn pegout_marker_output(chain_id: &str, side_txid: &str) -> Result<TxOut> {
    let data = pegout_marker_data(chain_id, side_txid)?;
    let push = PushBytesBuf::try_from(data)
        .map_err(|_| Error::Pegout("the marker does not fit a push".into()))?;
    Ok(TxOut {
        value: Amount::ZERO,
        script_pubkey: ScriptBuf::new_op_return(&push),
    })
}

/// The witness a finalised input will carry, sized for the fee: `k`
/// 65-byte signatures (Core may add a hash type), `n − k` empty slots,
/// the leaf, the control block.
fn witness_size(fed: &Federation) -> usize {
    let items: Vec<Vec<u8>> = fed
        .signers
        .iter()
        .enumerate()
        .map(|(i, _)| {
            if i < usize::from(fed.threshold) {
                vec![0u8; 65]
            } else {
                Vec::new()
            }
        })
        .chain([fed.script.to_bytes(), fed.control_block.clone()])
        .collect();
    Witness::from_slice(&items).size()
}

fn vsize_with(fed: &Federation, tx: &Transaction) -> u64 {
    let base = tx.base_size() as u64;
    let witness = 2 + tx.input.len() as u64 * witness_size(fed) as u64;
    (base * 4 + witness).div_ceil(4)
}

/// Fund, shape and annotate the PSBT that pays `burn` from the peg
/// (`walletcreatefundedpsbt` with `fee_rate`, then the fields Core's
/// descriptor wallet adds): largest coins first until the burn and the fee
/// are covered; outputs the burn's script for its value, the marker, and
/// change back to the challenge when it clears dust. The fee is `fee_rate`
/// × the virtual size of the *finalised* transaction (upstream doubles the
/// chain's minimum because Core's estimate undercounts a script-path
/// witness; sizing the witness exactly needs no such margin, but the
/// default of 2 sat/vB is kept for the same headroom).
pub fn build_pegout_psbt(
    fed: &Federation,
    chain_id: &str,
    burn: &Burn,
    coins: &[PegCoin],
    fee_rate: u64,
) -> Result<Psbt> {
    let pay = TxOut {
        value: Amount::from_sat(burn.value),
        script_pubkey: ScriptBuf::from_bytes(
            hex::decode(&burn.script).map_err(|e| Error::Pegout(format!("burn script: {e}")))?,
        ),
    };
    let marker = pegout_marker_output(chain_id, &burn.txid)?;
    let challenge = fed.challenge();
    let mut sorted: Vec<&PegCoin> = coins.iter().collect();
    sorted.sort_by(|a, b| b.value.cmp(&a.value).then(a.outpoint.cmp(&b.outpoint)));
    let mut chosen: Vec<&PegCoin> = Vec::new();
    let mut total = 0u64;
    let shape = |chosen: &[&PegCoin], change: Option<u64>| Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: chosen
            .iter()
            .map(|c| TxIn {
                previous_output: c.outpoint,
                script_sig: ScriptBuf::new(),
                sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                witness: Witness::new(),
            })
            .collect(),
        output: [pay.clone(), marker.clone()]
            .into_iter()
            .chain(change.map(|v| TxOut {
                value: Amount::from_sat(v),
                script_pubkey: challenge.clone(),
            }))
            .collect(),
    };
    let mut tx = None;
    for c in sorted {
        chosen.push(c);
        total = total
            .checked_add(c.value)
            .ok_or_else(|| Error::Pegout("peg coins overflow".into()))?;
        let with_change = shape(&chosen, Some(0));
        let fee = fee_rate.saturating_mul(vsize_with(fed, &with_change));
        let Some(rest) = total.checked_sub(burn.value.saturating_add(fee)) else {
            continue;
        };
        tx = Some(if rest >= DUST {
            shape(&chosen, Some(rest))
        } else {
            shape(&chosen, None)
        });
        break;
    }
    let tx = tx.ok_or_else(|| {
        Error::Pegout(format!(
            "insufficient peg coins: {total} sats for a {} sat burn plus fees",
            burn.value
        ))
    })?;
    let mut psbt = Psbt::from_unsigned_tx(tx).map_err(|e| Error::Pegout(e.to_string()))?;
    let control = ControlBlock::decode(&fed.control_block)
        .map_err(|e| Error::Pegout(format!("control block: {e}")))?;
    for (i, input) in psbt.inputs.iter_mut().enumerate() {
        input.witness_utxo = Some(TxOut {
            value: Amount::from_sat(chosen[i].value),
            script_pubkey: challenge.clone(),
        });
        input.tap_internal_key = Some(fed.internal_key);
        input.tap_merkle_root = Some(TapNodeHash::from(fed.leaf_hash));
        input.tap_scripts.insert(
            control.clone(),
            (fed.script.clone(), LeafVersion::TapScript),
        );
        for pk in &fed.signers {
            input.tap_key_origins.insert(
                *pk,
                (
                    vec![fed.leaf_hash],
                    (fingerprint_of(pk), DerivationPath::master()),
                ),
            );
        }
    }
    Ok(psbt)
}

/// The fingerprint Core records for a key with no known origin: the first
/// four bytes of `hash160` of the key with even Y.
fn fingerprint_of(pk: &XOnlyPublicKey) -> Fingerprint {
    let full = [&[0x02u8][..], &pk.serialize()[..]].concat();
    let h = bitcoin::hashes::hash160::Hash::hash(&full);
    let mut fp = [0u8; 4];
    fp.copy_from_slice(&h.to_byte_array()[..4]);
    Fingerprint::from(fp)
}

/// The prevouts of every input, for a sighash or a verification;
/// [`Error::Pegout`] when an input lacks its `witness_utxo`.
pub fn prevouts_of(psbt: &Psbt) -> Result<Vec<TxOut>> {
    psbt.inputs
        .iter()
        .enumerate()
        .map(|(i, inp)| {
            inp.witness_utxo
                .clone()
                .ok_or_else(|| Error::Pegout(format!("input {i} has no witness_utxo")))
        })
        .collect()
}

/// `pegoutround.mjs psbtPaysBurn`: the PSBT pays this burn and nothing
/// else — one output to its script for its value, the marker, every other
/// output back to the peg, every input from the peg — with the fee capped
/// at `max_fee` sats (not in upstream). `None` when it does; otherwise the
/// refusal, worded as upstream words it.
pub fn check_pegout_psbt(
    psbt: &Psbt,
    fed: &Federation,
    chain_id: &str,
    burn: &Burn,
    max_fee: u64,
) -> Option<String> {
    let outs = &psbt.unsigned_tx.output;
    let Ok(marker) = pegout_marker_output(chain_id, &burn.txid) else {
        return Some("does not pay the burn with its marker".into());
    };
    let Ok(script) = hex::decode(&burn.script) else {
        return Some("does not pay the burn with its marker".into());
    };
    let pay = outs.iter().position(|o| {
        o.script_pubkey.as_bytes() == script.as_slice() && o.value.to_sat() == burn.value
    });
    let mark = outs
        .iter()
        .position(|o| o.script_pubkey == marker.script_pubkey);
    let (Some(pay), Some(mark)) = (pay, mark) else {
        return Some("does not pay the burn with its marker".into());
    };
    let challenge = fed.challenge();
    if outs
        .iter()
        .enumerate()
        .any(|(i, o)| i != pay && i != mark && o.script_pubkey != challenge)
    {
        return Some("pays something besides the burn and change to the peg".into());
    }
    if psbt.inputs.is_empty() || psbt.inputs.len() != psbt.unsigned_tx.input.len() {
        return Some("spends something that is not the peg".into());
    }
    let mut in_sum = 0u64;
    for i in &psbt.inputs {
        match &i.witness_utxo {
            Some(u) if u.script_pubkey == challenge => {
                in_sum = in_sum.saturating_add(u.value.to_sat())
            }
            _ => return Some("spends something that is not the peg".into()),
        }
    }
    let out_sum = outs
        .iter()
        .fold(0u64, |s, o| s.saturating_add(o.value.to_sat()));
    let Some(fee) = in_sum.checked_sub(out_sum) else {
        return Some("pays out more than it spends".into());
    };
    if fee > max_fee {
        return Some(format!(
            "fee {fee} sats is over this signer's cap of {max_fee}"
        ));
    }
    None
}

fn leaf_digest(
    psbt: &Psbt,
    prevouts: &[TxOut],
    index: usize,
    fed: &Federation,
) -> Result<[u8; 32]> {
    Ok(SighashCache::new(&psbt.unsigned_tx)
        .taproot_script_spend_signature_hash(
            index,
            &Prevouts::All(prevouts),
            fed.leaf_hash,
            TapSighashType::Default,
        )
        .map_err(|e| Error::Pegout(format!("sighash: {e}")))?
        .to_byte_array())
}

/// Sign every input for the federation's leaf with this signer's key
/// (`walletprocesspsbt`): a `SIGHASH_DEFAULT` tapscript signature into
/// `tap_script_sigs` under `(key, leaf hash)`, which is where Core puts
/// its own. Returns how many inputs were signed.
pub fn sign_pegout_psbt(
    psbt: &mut Psbt,
    fed: &Federation,
    chain_id: &str,
    burn: &str,
    signer: &dyn BlockSigner,
) -> Result<usize> {
    let me = signer.pubkey();
    if !fed.signers.contains(&me) {
        return Err(Error::Key("this key is not one of the signers".into()));
    }
    let prevouts = prevouts_of(psbt)?;
    let txid = psbt.unsigned_tx.compute_txid();
    let mut n = 0;
    for i in 0..psbt.inputs.len() {
        let digest = leaf_digest(psbt, &prevouts, i, fed)?;
        let sig =
            signer.sign_pegout_input(&PegoutSignRequest::new(chain_id, burn, txid, i, digest))?;
        psbt.inputs[i].tap_script_sigs.insert(
            (me, fed.leaf_hash),
            bitcoin::taproot::Signature {
                signature: sig,
                sighash_type: TapSighashType::Default,
            },
        );
        n += 1;
    }
    Ok(n)
}

/// Every tapscript signature the PSBT carries for the federation's leaf,
/// checked against its key and this transaction. Signatures for keys
/// outside the federation or other leaves are ignored. Returns, per
/// input, the signers whose signatures verify; an invalid one is an error.
pub fn verify_pegout_signatures(psbt: &Psbt, fed: &Federation) -> Result<Vec<Vec<XOnlyPublicKey>>> {
    let prevouts = prevouts_of(psbt)?;
    let mut out = Vec::with_capacity(psbt.inputs.len());
    for (i, input) in psbt.inputs.iter().enumerate() {
        let mut ok = Vec::new();
        for ((pk, leaf), sig) in &input.tap_script_sigs {
            if *leaf != fed.leaf_hash || !fed.signers.contains(pk) {
                continue;
            }
            let digest = SighashCache::new(&psbt.unsigned_tx)
                .taproot_script_spend_signature_hash(
                    i,
                    &Prevouts::All(&prevouts),
                    fed.leaf_hash,
                    sig.sighash_type,
                )
                .map_err(|e| Error::Pegout(format!("sighash: {e}")))?
                .to_byte_array();
            if sidestr_core::block::secp()
                .verify_schnorr(
                    &sig.signature,
                    &bitcoin::secp256k1::Message::from_digest(digest),
                    pk,
                )
                .is_err()
            {
                return Err(Error::Pegout(format!(
                    "input {i}: signature by {}… does not verify",
                    short(&pk.to_string(), 8)
                )));
            }
            ok.push(*pk);
        }
        out.push(ok);
    }
    Ok(out)
}

/// `combinepsbt`: the same unsigned transaction with everyone's signatures.
pub fn combine_pegout_psbts(psbts: &[Psbt]) -> Result<Psbt> {
    let mut it = psbts.iter();
    let mut acc = it
        .next()
        .cloned()
        .ok_or_else(|| Error::Pegout("nothing to combine".into()))?;
    for p in it {
        acc.combine(p.clone())
            .map_err(|e| Error::Pegout(format!("combine: {e}")))?;
    }
    Ok(acc)
}

/// `finalizepsbt`: the script-path witness for every input from `k`
/// signatures in leaf order — slots reversed, `pk_1`'s on top, exactly `k`
/// filled, then the leaf, then the control block
/// (`federation.mjs assembleWitness`) — and the transaction extracted.
/// `Ok(None)` when an input has fewer than `k`: "does not finalize".
pub fn finalize_pegout_psbt(psbt: &Psbt, fed: &Federation) -> Result<Option<Transaction>> {
    let mut done = psbt.clone();
    let k = usize::from(fed.threshold);
    for input in &mut done.inputs {
        let sigs: BTreeMap<XOnlyPublicKey, Vec<u8>> = input
            .tap_script_sigs
            .iter()
            .filter(|((pk, leaf), _)| *leaf == fed.leaf_hash && fed.signers.contains(pk))
            .map(|((pk, _), sig)| (*pk, sig.to_vec()))
            .collect();
        let have: Vec<&XOnlyPublicKey> = fed
            .signers
            .iter()
            .filter(|pk| sigs.contains_key(pk))
            .collect();
        if have.len() < k {
            return Ok(None);
        }
        let chosen = &have[..k];
        let mut items: Vec<Vec<u8>> = fed
            .signers
            .iter()
            .map(|pk| {
                if chosen.contains(&pk) {
                    sigs[pk].clone()
                } else {
                    Vec::new()
                }
            })
            .collect();
        items.reverse();
        items.push(fed.script.to_bytes());
        items.push(fed.control_block.clone());
        input.final_script_witness = Some(Witness::from_slice(&items));
    }
    Ok(Some(done.extract_tx_unchecked_fee_rate()))
}

/// Every input verified as a script-path spend of the `multi_a` leaf under
/// BIP 341/342 ([`verify_multi_a_input`]), for the caller that holds the
/// prevouts: what a parent node would check, minus the parent's own
/// context (confirmations, fee policy).
pub fn verify_pegout_transaction(
    tx: &Transaction,
    prevouts: &[TxOut],
) -> core::result::Result<Vec<MultiA>, ScriptPathError> {
    (0..tx.input.len())
        .map(|i| verify_multi_a_input(tx, i, prevouts))
        .collect()
}

/// A PSBT from its base64 (an event's content).
pub fn psbt_from_base64(s: &str) -> Result<Psbt> {
    Psbt::from_str(s.trim()).map_err(|e| Error::Pegout(format!("not a PSBT: {e}")))
}

// --- the round --------------------------------------------------------------------

/// The peg-out round's options.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PegoutConfig {
    /// Seconds before the next signer in the ring may pay a burn instead
    /// (`--propose-after`, upstream default 30).
    pub propose_after: u64,
    /// After how many seconds a burn I authorised a payment for — by
    /// co-signing or by proposing — may be signed again for another
    /// proposal (this many or more, to the millisecond, as
    /// `pegoutround.mjs onProposal`). `Some(propose_after)` is upstream's
    /// rule; `None` never re-signs a burn, on either path.
    pub resign_after: Option<u64>,
    /// Sat/vB for a payment I propose (upstream: 2).
    pub fee_rate: u64,
    /// The most a proposed payment may spend in fees before I refuse to
    /// co-sign it (not in upstream).
    pub max_fee: u64,
    /// The parent network, for the address in the record and the log.
    pub network: Option<Network>,
}

impl PegoutConfig {
    /// Upstream's behaviour for a given `propose_after`, with the fee cap
    /// at 100 000 sats.
    pub fn upstream(propose_after: u64, network: Option<Network>) -> Self {
        Self {
            propose_after,
            resign_after: Some(propose_after),
            fee_rate: 2,
            max_fee: 100_000,
            network,
        }
    }
}

impl Default for PegoutConfig {
    fn default() -> Self {
        Self::upstream(30, None)
    }
}

/// A paid burn as `pegouts.json` records it (`pegoutround.mjs maybeFinish`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaidPegout {
    /// The parent transaction.
    pub parent_txid: String,
    /// The burn's script as an address, when the network is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    /// Sats paid.
    pub value: u64,
    /// The burn's script, hex.
    pub script: String,
    /// The sidechain height of the burn.
    pub height: u32,
    /// When, unix seconds.
    pub at: u64,
    /// Who signed.
    #[serde(default)]
    pub signers: Vec<String>,
    /// Set by upstream's reconcile when the payment was found in the
    /// wallet history rather than made here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reconciled: Option<bool>,
}

/// `pegouts.json`: what has been paid, by burn.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PegoutLedger {
    /// Burn key → record.
    pub paid: BTreeMap<String, PaidPegout>,
}

/// A payment with `k` signatures, ready for the parent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalisedPegout {
    /// The burn, `<txid>:<vout>`.
    pub burn: String,
    /// The transaction to broadcast.
    pub tx: Transaction,
    /// The record to keep once the parent has it.
    pub record: PaidPegout,
}

/// What the caller does after a [`PegoutRound::tick`] or
/// [`PegoutRound::on_event`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PegoutAction {
    /// Send this event to every relay.
    Publish(Event),
    /// `sendrawtransaction`, then [`PegoutRound::mark_paid`] on success.
    Broadcast(FinalisedPegout),
    /// A line for the log, worded as `pegoutround.mjs` words it.
    Log(String),
}

/// My payment in flight (`pegoutround.mjs pending`).
#[derive(Debug, Clone)]
pub struct PendingPegout {
    /// The 23512's id.
    pub id: String,
    /// The PSBT with my signatures.
    pub psbt: Psbt,
    /// Co-signed PSBTs by signer, mine included.
    pub sigs: BTreeMap<String, Psbt>,
    /// When it was proposed, unix milliseconds.
    pub at: u64,
    /// The burn.
    pub burn: Burn,
}

/// The peg-out round for one signer of one chain.
pub struct PegoutRound {
    cfg: PegoutConfig,
    chain_id: String,
    fed: Federation,
    me: XOnlyPublicKey,
    me_hex: String,
    signer: Box<dyn RoundSigner>,
    journal: Box<dyn VoteJournal>,
    pending: BTreeMap<String, PendingPegout>,
    /// The burn-authorisation guard: burn → when I last authorised a
    /// payment for it (milliseconds), loaded from the journal, shared by
    /// the co-signer and the proposer paths.
    authorised: BTreeMap<String, u64>,
    /// Burns whose last proposal of mine failed before anything was
    /// signed (no coins, say): the `propose_after × n` retry throttle
    /// upstream applies, in memory as upstream keeps it.
    backoff: BTreeMap<String, u64>,
    seen: BTreeMap<u32, u64>,
    ledger: PegoutLedger,
    psbts: Follower,
    signed: Follower,
}

impl core::fmt::Debug for PegoutRound {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("PegoutRound")
            .field("chain_id", &self.chain_id)
            .field("me", &self.me_hex)
            .field("pending", &self.pending.keys().collect::<Vec<_>>())
            .field("paid", &self.ledger.paid.len())
            .finish_non_exhaustive()
    }
}

impl PegoutRound {
    /// A round for `fed` on `chain_id` as `signer`, with the journal loaded
    /// and the ledger of what is already paid.
    pub fn new(
        fed: Federation,
        chain_id: &str,
        signer: Box<dyn RoundSigner>,
        journal: Box<dyn VoteJournal>,
        cfg: PegoutConfig,
        ledger: PegoutLedger,
    ) -> Result<Self> {
        let me = signer.pubkey();
        if !fed.signers.contains(&me) {
            return Err(Error::Key("this key is not one of the signers".into()));
        }
        let mut authorised = BTreeMap::new();
        for e in journal.entries()? {
            if let VoteScope::Burn(b) = e.scope {
                // an intent without its signature counts: the signature may exist
                let at = authorised.entry(b).or_insert(e.at);
                *at = (*at).max(e.at);
            }
        }
        Ok(Self {
            cfg,
            chain_id: chain_id.to_string(),
            fed,
            me,
            me_hex: hex::encode(me.serialize()),
            signer,
            journal,
            pending: BTreeMap::new(),
            authorised,
            backoff: BTreeMap::new(),
            seen: BTreeMap::new(),
            ledger,
            psbts: Follower::new(KIND_PEGOUT_PSBT, chain_id),
            signed: Follower::new(KIND_PEGOUT_SIGNED, chain_id),
        })
    }

    /// The ledger.
    pub fn ledger(&self) -> &PegoutLedger {
        &self.ledger
    }
    /// My payments in flight.
    pub fn pending(&self) -> &BTreeMap<String, PendingPegout> {
        &self.pending
    }
    /// The burns I have authorised a payment for, with when (unix
    /// milliseconds) — the journal's view after this run's additions.
    pub fn authorised(&self) -> impl Iterator<Item = (&str, u64)> {
        self.authorised.iter().map(|(k, at)| (k.as_str(), *at))
    }
    /// The parent took the transaction: record it (`outState.paid[key_] = …`).
    pub fn mark_paid(&mut self, burn: &str, record: PaidPegout) {
        self.ledger.paid.insert(burn.to_string(), record);
    }

    fn n(&self) -> u64 {
        self.fed.signers.len() as u64
    }

    fn first_seen(&mut self, height: u32, now_ms: u64) -> u64 {
        *self.seen.entry(height).or_insert(now_ms)
    }

    /// `propose_after × n`, in milliseconds.
    fn ring_ms(&self) -> u64 {
        self.cfg.propose_after * 1000 * self.n()
    }

    /// `pegoutround.mjs entitled`: the payer is `height mod n`; every
    /// `propose_after` seconds since I first saw the burn lets the next
    /// signer pay instead. Never negative (upstream's block round says why;
    /// its peg-out round forgot to). Milliseconds throughout.
    fn entitled(&mut self, signer: &XOnlyPublicKey, height: u32, at_ms: u64, now_ms: u64) -> bool {
        let Some(slot) = self.fed.signers.iter().position(|k| k == signer) else {
            return false;
        };
        let n = self.n();
        let base = self.first_seen(height, now_ms);
        let late = at_ms.saturating_sub(base) / (self.cfg.propose_after.max(1) * 1000);
        (slot as u64 + n - u64::from(height) % n) % n <= late
    }

    /// The one guard both paths consult: no payment authorised for this
    /// burn, or the one there is has had its window (`resign_after`
    /// seconds or more, as `pegoutround.mjs onProposal` compares) and the
    /// policy allows another.
    fn may_sign_burn(&self, key: &str, now_ms: u64) -> bool {
        match (self.authorised.get(key), self.cfg.resign_after) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(at), Some(w)) => now_ms.saturating_sub(*at) >= w * 1000,
        }
    }

    /// One journal record: the intent before the custody signer, the
    /// signatures after.
    fn journal(
        &mut self,
        key: &str,
        role: VoteRole,
        subject: &str,
        psbt: &Psbt,
        at_ms: u64,
        signatures: Option<String>,
    ) -> Result<()> {
        self.journal.record(&VoteEntry {
            scope: VoteScope::Burn(key.to_string()),
            role,
            subject: subject.to_string(),
            digest: psbt.unsigned_tx.compute_txid().to_string(),
            at: at_ms,
            stage: if signatures.is_some() {
                VoteStage::Signed
            } else {
                VoteStage::Intent
            },
            signature: signatures,
        })
    }

    /// My signatures in `psbt`, one per input, comma-separated hex.
    fn my_signatures(&self, psbt: &Psbt) -> String {
        psbt.inputs
            .iter()
            .filter_map(|i| i.tap_script_sigs.get(&(self.me, self.fed.leaf_hash)))
            .map(|s| hex::encode(s.to_vec()))
            .collect::<Vec<_>>()
            .join(",")
    }

    /// The intent record, before the custody signer is asked. From here
    /// the burn counts as authorised whatever happens next.
    fn intent(
        &mut self,
        key: &str,
        role: VoteRole,
        subject: &str,
        psbt: &Psbt,
        now_ms: u64,
    ) -> Result<()> {
        self.journal(key, role, subject, psbt, now_ms, None)?;
        self.authorised.insert(key.to_string(), now_ms);
        Ok(())
    }

    /// Intent, then the custody signer over every input, then the
    /// signature record: the order the journal guarantees. `Err(false, _)`
    /// means the signer was never asked; `Err(true, _)` that signatures
    /// exist, the intent is journalled, and nothing is to be published.
    fn authorise(
        &mut self,
        key: &str,
        role: VoteRole,
        subject: &str,
        psbt: &mut Psbt,
        now_ms: u64,
    ) -> core::result::Result<(), (bool, Error)> {
        self.intent(key, role, subject, psbt, now_ms)
            .map_err(|e| (false, e))?;
        sign_pegout_psbt(psbt, &self.fed, &self.chain_id, key, self.signer.as_ref())
            .map_err(|e| (true, e))?;
        let sigs = self.my_signatures(psbt);
        self.journal(key, role, subject, psbt, now_ms, Some(sigs))
            .map_err(|e| (true, e))?;
        Ok(())
    }

    fn address_of(&self, script_hex: &str) -> Option<String> {
        let net = self.cfg.network?;
        let s = ScriptBuf::from_bytes(hex::decode(script_hex).ok()?);
        Address::from_script(&s, net).ok().map(|a| a.to_string())
    }

    /// The producer's poll (`pegoutRound.tick`): for every burn nobody has
    /// paid, propose when I am the payer (or late enough to stand in) and
    /// the burn guard allows it, funding from `coins`; drop proposals
    /// nobody co-signed in time. `now_ms` is unix milliseconds.
    pub fn tick(&mut self, now_ms: u64, burns: &[Burn], coins: &[PegCoin]) -> Vec<PegoutAction> {
        let now = now_ms;
        let mut out = Vec::new();
        for b in burns {
            let key = burn_key(b);
            if self.ledger.paid.contains_key(&key) || self.pending.contains_key(&key) {
                continue;
            }
            // the guard first: what I authorised, on either path, under the policy
            if !self.may_sign_burn(&key, now) {
                continue;
            }
            // then upstream's retry throttle: not within propose_after × n of my last attempt
            let last = self
                .authorised
                .get(&key)
                .copied()
                .max(self.backoff.get(&key).copied());
            if last.is_some_and(|at| now.saturating_sub(at) < self.ring_ms()) {
                continue;
            }
            let me = self.me;
            if self.entitled(&me, b.height, now, now) {
                if let Err(e) = self.propose(now, b, coins, &mut out) {
                    out.push(PegoutAction::Log(format!("peg-out round: {e}")));
                    self.backoff.insert(key, now);
                }
            }
        }
        let stale: Vec<String> = self
            .pending
            .iter()
            .filter(|(_, p)| now.saturating_sub(p.at) > self.ring_ms())
            .map(|(k, _)| k.clone())
            .collect();
        for k in stale {
            let p = self.pending.remove(&k).expect("listed");
            out.push(PegoutAction::Log(format!(
                "peg-out round: dropping my proposal for {}… ({} signature(s))",
                short(&k, 16),
                p.sigs.len()
            )));
        }
        out
    }

    /// `pegoutround.mjs propose`. `now` is milliseconds. Two records, as on
    /// the co-signer path: the intent before the key is asked — its
    /// `subject` empty, because the 23512's id exists only once the signed
    /// PSBT is its content — then the signature record carrying the id,
    /// before the `Publish` action is returned. A failure between the two
    /// leaves the intent standing, which counts on reload.
    fn propose(
        &mut self,
        now: u64,
        b: &Burn,
        coins: &[PegCoin],
        out: &mut Vec<PegoutAction>,
    ) -> Result<()> {
        let key = burn_key(b);
        let mut psbt = build_pegout_psbt(&self.fed, &self.chain_id, b, coins, self.cfg.fee_rate)?;
        self.intent(&key, VoteRole::Proposed, "", &psbt, now)?;
        sign_pegout_psbt(
            &mut psbt,
            &self.fed,
            &self.chain_id,
            &key,
            self.signer.as_ref(),
        )?;
        let ev = sign_psbt_event(
            self.signer.as_ref(),
            &PegoutPsbt {
                chain_id: self.chain_id.clone(),
                burn: Outpoint {
                    txid: b.txid.clone(),
                    vout: b.vout,
                },
                height: b.height,
                psbt: psbt.to_string(),
            },
            now / 1000,
        )?;
        let sigs_hex = self.my_signatures(&psbt);
        self.journal(&key, VoteRole::Proposed, &ev.id, &psbt, now, Some(sigs_hex))?;
        let mut sigs = BTreeMap::new();
        sigs.insert(self.me_hex.clone(), psbt.clone());
        self.pending.insert(
            key.clone(),
            PendingPegout {
                id: ev.id.clone(),
                psbt,
                sigs,
                at: now,
                burn: b.clone(),
            },
        );
        out.push(PegoutAction::Publish(ev));
        out.push(PegoutAction::Log(format!(
            "peg-out round: proposed payment of {}… ({} sats)",
            short(&key, 16),
            b.value
        )));
        self.maybe_finish(now, &key, out);
        Ok(())
    }

    /// An event from a relay: a 23512 to check and co-sign, or a 23513 for
    /// one of my proposals. The on-receipt checks are applied here.
    /// `now_ms` is unix milliseconds.
    pub fn on_event(&mut self, now_ms: u64, ev: &Event, burns: &[Burn]) -> Vec<PegoutAction> {
        let now = now_ms;
        let mut out = Vec::new();
        match ev.kind {
            KIND_PEGOUT_PSBT => {
                if self.psbts.accept(ev).is_some() {
                    self.on_proposal(now, ev, burns, &mut out);
                }
            }
            KIND_PEGOUT_SIGNED if self.signed.accept(ev).is_some() => {
                self.on_signed(now, ev, &mut out);
            }
            _ => {}
        }
        out
    }

    /// `pegoutround.mjs onProposal`.
    fn on_proposal(&mut self, now: u64, ev: &Event, burns: &[Burn], out: &mut Vec<PegoutAction>) {
        let Ok(p) = parse_pegout_psbt(ev, Some(&self.chain_id)) else {
            return;
        };
        let key = p.burn.to_string();
        let Ok(from) = pubkey_from_hex(&ev.pubkey) else {
            return;
        };
        if ev.pubkey == self.me_hex || !self.fed.signers.contains(&from) {
            return;
        }
        let log = |s: String| PegoutAction::Log(s);
        let Some(b) = burns.iter().find(|x| burn_key(x) == key).cloned() else {
            out.push(log(format!(
                "peg-out round: proposal for {}… ignored: not a burn I know",
                short(&key, 16)
            )));
            return;
        };
        if self.ledger.paid.contains_key(&key) {
            return;
        }
        if !self.may_sign_burn(&key, now) {
            return;
        }
        if !self.entitled(&from, b.height, ev.created_at.saturating_mul(1000), now) {
            out.push(log(format!(
                "peg-out round: {}… is not the payer for {}… yet",
                short(&ev.pubkey, 8),
                short(&key, 16)
            )));
            return;
        }
        let mut psbt = match psbt_from_base64(&p.psbt) {
            Ok(x) => x,
            Err(e) => {
                out.push(log(format!("peg-out round: {e}")));
                return;
            }
        };
        if let Some(why) = check_pegout_psbt(&psbt, &self.fed, &self.chain_id, &b, self.cfg.max_fee)
        {
            out.push(log(format!(
                "peg-out round: proposal for {}… refused: {why}",
                short(&key, 16)
            )));
            return;
        }
        match self.authorise(&key, VoteRole::Signed, &ev.id, &mut psbt, now) {
            Ok(()) => {}
            Err((false, e)) => {
                out.push(log(format!(
                    "peg-out round: proposal for {}… not signed: {e}",
                    short(&key, 16)
                )));
                return;
            }
            Err((true, e)) => {
                out.push(log(format!(
                    "peg-out round: proposal for {}… signed but not published: {e}",
                    short(&key, 16)
                )));
                return;
            }
        }
        match sign_pegout_signed(
            self.signer.as_ref(),
            &PegoutSigned {
                chain_id: self.chain_id.clone(),
                burn: p.burn.clone(),
                request: ev.id.clone(),
                psbt: psbt.to_string(),
            },
            now / 1000,
        ) {
            Ok(pev) => out.push(PegoutAction::Publish(pev)),
            Err(e) => {
                out.push(log(format!("peg-out round: {e}")));
                return;
            }
        }
        out.push(log(format!(
            "peg-out round: signed payment of {}… proposed by {}…",
            short(&key, 16),
            short(&ev.pubkey, 8)
        )));
    }

    /// `pegoutround.mjs onSigned`, with the co-signer's signatures verified
    /// before they count.
    fn on_signed(&mut self, now: u64, ev: &Event, out: &mut Vec<PegoutAction>) {
        let Ok(p) = parse_pegout_signed(ev, Some(&self.chain_id)) else {
            return;
        };
        let key = p.burn.to_string();
        let Some(pending) = self.pending.get(&key) else {
            return;
        };
        let Ok(from) = pubkey_from_hex(&ev.pubkey) else {
            return;
        };
        if p.request != pending.id || ev.pubkey == self.me_hex || !self.fed.signers.contains(&from)
        {
            return;
        }
        let theirs = match psbt_from_base64(&p.psbt) {
            Ok(x) => x,
            Err(e) => {
                out.push(PegoutAction::Log(format!(
                    "peg-out round: bad signature from {}… for {}…: {e}",
                    short(&ev.pubkey, 8),
                    short(&key, 16)
                )));
                return;
            }
        };
        let verified = if theirs.unsigned_tx != pending.psbt.unsigned_tx {
            Err(Error::Pegout("a different transaction".into()))
        } else {
            verify_pegout_signatures(&theirs, &self.fed).and_then(|per_input| {
                if per_input.iter().all(|v| v.contains(&from)) {
                    Ok(())
                } else {
                    Err(Error::Pegout("no signature by its author".into()))
                }
            })
        };
        if let Err(e) = verified {
            out.push(PegoutAction::Log(format!(
                "peg-out round: bad signature from {}… for {}…: {e}",
                short(&ev.pubkey, 8),
                short(&key, 16)
            )));
            return;
        }
        let pending = self.pending.get_mut(&key).expect("checked");
        pending.sigs.insert(ev.pubkey.clone(), theirs);
        out.push(PegoutAction::Log(format!(
            "peg-out round: {}/{} signatures for {}…",
            pending.sigs.len(),
            self.fed.threshold,
            short(&key, 16)
        )));
        self.maybe_finish(now, &key, out);
    }

    /// `pegoutround.mjs maybeFinish`: with `k`, combine, finalise, hand the
    /// transaction to the caller for the parent. `now` is milliseconds; the
    /// record keeps seconds, as `pegouts.json` does.
    fn maybe_finish(&mut self, now: u64, key: &str, out: &mut Vec<PegoutAction>) {
        let Some(p) = self.pending.get(key) else {
            return;
        };
        if p.sigs.len() < usize::from(self.fed.threshold) {
            return;
        }
        let psbts: Vec<Psbt> = p.sigs.values().cloned().collect();
        let tx =
            match combine_pegout_psbts(&psbts).and_then(|c| finalize_pegout_psbt(&c, &self.fed)) {
                Ok(Some(tx)) => tx,
                Ok(None) => {
                    out.push(PegoutAction::Log(format!(
                        "peg-out round: {}… has {} signatures but does not finalize",
                        short(key, 16),
                        p.sigs.len()
                    )));
                    return;
                }
                Err(e) => {
                    out.push(PegoutAction::Log(format!("peg-out round: {e}")));
                    return;
                }
            };
        let p = self.pending.remove(key).expect("checked");
        let b = &p.burn;
        let address = self.address_of(&b.script);
        let txid = tx.compute_txid().to_string();
        let record = PaidPegout {
            parent_txid: txid.clone(),
            address: address.clone(),
            value: b.value,
            script: b.script.clone(),
            height: b.height,
            at: now / 1000,
            signers: p.sigs.keys().cloned().collect(),
            reconciled: None,
        };
        out.push(PegoutAction::Log(format!(
            "peg-out {}…: paid {} sats to {} on the parent by {} of {}, txid {}…",
            short(key, 16),
            b.value,
            address.unwrap_or_else(|| b.script.clone()),
            p.sigs.len(),
            self.n(),
            short(&txid, 16)
        )));
        out.push(PegoutAction::Broadcast(FinalisedPegout {
            burn: key.to_string(),
            tx,
            record,
        }));
    }
}
