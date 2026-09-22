//! The rules (SPEC 4, 6, 7): Bitcoin's block rules as the reference kernel
//! runs them for a `btc:regtest`-derived network, with the sidestr overlay —
//! zero subsidy, the signature challenge, the claim rule and the burn rule.
//!
//! A port of the checks in `bitcoin-desktop/schema` `codec/blocks.js` and
//! `codec/headers.js` (Melvin Carvalho, AGPL-3.0) that a sidestr chain
//! exercises, and of `siding/lib/overlay.mjs`. Rule ids are the kernel's, so
//! a refusal names the same rule the reference names. Rule order within a
//! phase is `schema/validate.jsonld`'s.
//!
//! # Verdicts
//!
//! Every check answers `Some(true)` (pass), `Some(false)` (fail) or `None`
//! (skipped: the context to judge is absent, or the rule is not yet active at
//! this height). A phase passes when no check failed. This is the kernel's
//! three-valued convention; the one place this crate departs from it is
//! script verification, where an input this crate cannot verify *fails*
//! rather than skips (see [`crate::block::verify_key_path_input`]).
//!
//! # Phases
//!
//! | phase | function | checks |
//! |---|---|---|
//! | header | [`validate_header`] | prev link, proof of work, `bits` unchanged (no retarget), median time past, not too far in the future, version |
//! | transaction | [`validate_transaction`] | inputs and outputs non-empty, weight, values, unique inputs, coinbase shape, coinbase script 2–100 bytes |
//! | block | [`validate_block_structure`] | coinbase first and alone, merkle root, no duplicates, sigops, weight, every transaction; **`sidestr:rule-block-signature`** |
//! | block-context | [`validate_block_context`] | BIP 34 height, finality, BIP 68, inputs available, coinbase maturity, fees, **coinbase amount ≤ fees + claims**, witness commitment, scripts; **`sidestr:rule-pegouts`**, **`sidestr:rule-claims`** |
//!
//! Extension point: [`BlockRule`] adds a block-context rule (the assets and
//! pool rules of SPEC 12 are rules in that sense) without touching this file.

use std::collections::{BTreeMap, HashMap, HashSet};

use bitcoin::block::Header;
use bitcoin::hashes::Hash;
use bitcoin::{Block, BlockHash, OutPoint, Script, Target, Transaction, TxOut, Txid};

use crate::block::{verify_block_signature, verify_key_path_input, HeaderFamily};
use crate::marker::{looks_like_pegout, op_return_data, parse_claims, parse_pegout, Burn};

/// Network parameters a sidestr chain inherits (`btc:regtest` in
/// `schema/chain.jsonld`, as `sidestrGraph` extends it) — everything the
/// checks read. The subsidy is zero by construction (SPEC 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// 4,000,000 weight units.
    pub max_block_weight: u64,
    /// 21,000,000 BTC in sats.
    pub max_money: u64,
    /// 80,000: four times the legacy sigop count must stay under it.
    pub max_block_sigops_cost: u64,
    /// A coinbase output may be spent this many blocks later: 100.
    pub coinbase_maturity: u32,
    /// A header may be at most this far ahead of the clock: 7,200 s.
    pub max_future_block_time: u32,
    /// BIP 34 applies from this height: 1.
    pub bip34_height: u32,
    /// The witness commitment rule applies from this height: 0.
    pub segwit_height: u32,
    /// Header versions: ≥ 4 from `bip65_height`, ≥ 3 from `bip66_height`, ≥ 2 from `bip34_height`.
    pub bip65_height: u32,
    /// See `bip65_height`.
    pub bip66_height: u32,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            max_block_weight: 4_000_000,
            max_money: 2_100_000_000_000_000,
            max_block_sigops_cost: 80_000,
            coinbase_maturity: 100,
            max_future_block_time: 7_200,
            bip34_height: 1,
            segwit_height: 0,
            bip65_height: 1,
            bip66_height: 1,
        }
    }
}

/// One rule's outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleResult {
    /// The rule id, e.g. `btc:rule-block-merkle-root` or `sidestr:rule-claims`.
    pub rule: String,
    /// `Some(true)` pass, `Some(false)` fail, `None` skipped.
    pub ok: Option<bool>,
}

/// A phase's outcomes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Verdict {
    /// Every rule that ran, in order.
    pub results: Vec<RuleResult>,
}

impl Verdict {
    fn push(&mut self, rule: &str, ok: Option<bool>) {
        self.results.push(RuleResult {
            rule: rule.to_string(),
            ok,
        });
    }
    /// No rule failed.
    pub fn ok(&self) -> bool {
        self.results.iter().all(|r| r.ok != Some(false))
    }
    /// The ids of the rules that failed.
    pub fn failed(&self) -> Vec<String> {
        self.results
            .iter()
            .filter(|r| r.ok == Some(false))
            .map(|r| r.rule.clone())
            .collect()
    }
    /// Append another phase's results.
    pub fn extend(&mut self, other: Verdict) {
        self.results.extend(other.results);
    }
}

/// A coin in the UTXO set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coin {
    /// The output.
    pub output: TxOut,
    /// The height of the block that created it.
    pub height: u32,
    /// Whether the creating transaction was a coinbase (maturity applies).
    pub coinbase: bool,
}

/// The UTXO set: outpoint → coin. `OP_RETURN` outputs are never coins.
pub type Utxo = HashMap<OutPoint, Coin>;

/// What the sidestr overlay remembers across blocks (`siding/lib/overlay.mjs`):
/// outpoints claimed so far by the height that claimed them, and burns seen.
/// Validation is idempotent for one height (a block re-validated, or a
/// competing block at the same height, may claim the same outpoint); a
/// different height may not. Level 1: no reorgs, so nothing is unwound.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Records {
    /// Parent outpoint (`txid:vout`, txid display order) → height that claimed it.
    pub claims: HashMap<(String, u32), u32>,
    /// Sidechain outpoint → the burn.
    pub pegouts: BTreeMap<(String, u32), Burn>,
}

impl Records {
    /// Whether the parent outpoint has been claimed on this chain.
    pub fn claimed(&self, txid: &str, vout: u32) -> bool {
        self.claims.contains_key(&(txid.to_string(), vout))
    }
    /// Every burn the chain has validated, oldest first (SPEC 7).
    pub fn pegouts(&self) -> Vec<Burn> {
        let mut v: Vec<Burn> = self.pegouts.values().cloned().collect();
        v.sort_by_key(|b| b.height);
        v
    }
}

/// The chain-specific inputs to the sidestr rules.
#[derive(Debug, Clone)]
pub struct Overlay<'a> {
    /// The challenge every block's solution must satisfy.
    pub challenge: &'a Script,
    /// The least a burn may carry.
    pub pegout_min: u64,
}

// --- header phase (codec/headers.js) ------------------------------------------------

/// What [`validate_header`] needs beyond the header.
#[derive(Debug, Clone)]
pub struct HeaderContext<'a> {
    /// The header's height.
    pub height: u32,
    /// The previous header, when known.
    pub prev: Option<&'a Header>,
    /// The headers immediately before this one, up to 11, oldest first.
    pub mtp_window: &'a [Header],
    /// The clock, for the future-time rule; `None` skips it.
    pub now: Option<u32>,
}

/// Median of the last (up to) 11 block timestamps (`headers.js medianTimePast`).
pub fn median_time_past(window: &[Header]) -> u32 {
    let start = window.len().saturating_sub(11);
    let mut times: Vec<u32> = window[start..].iter().map(|h| h.time).collect();
    times.sort_unstable();
    times[times.len() >> 1]
}

/// The header phase: `btc:rule-header-*` as the kernel runs them for a chain
/// with `powNoRetargeting` and no timewarp fix.
pub fn validate_header(
    family: &dyn HeaderFamily,
    params: &Params,
    header: &Header,
    ctx: &HeaderContext,
) -> Verdict {
    let mut v = Verdict::default();
    v.push(
        "btc:rule-header-prev-link",
        ctx.prev
            .map(|p| header.prev_blockhash == family.block_hash(p)),
    );
    v.push(
        "btc:rule-header-pow",
        Some(Target::from_compact(header.bits).is_met_by(family.block_hash(header))),
    );
    // powNoRetargeting: the bits required of the block following prev are prev's
    v.push(
        "btc:rule-header-difficulty",
        ctx.prev.map(|p| header.bits == p.bits),
    );
    let need = 11.min(ctx.height as usize);
    v.push(
        "btc:rule-header-mtp",
        (ctx.mtp_window.len() >= need && !ctx.mtp_window.is_empty())
            .then(|| header.time > median_time_past(ctx.mtp_window)),
    );
    v.push(
        "btc:rule-header-time-future",
        ctx.now.map(|now| {
            u64::from(header.time) <= u64::from(now) + u64::from(params.max_future_block_time)
        }),
    );
    let min_version = if ctx.height >= params.bip65_height {
        4
    } else if ctx.height >= params.bip66_height {
        3
    } else if ctx.height >= params.bip34_height {
        2
    } else {
        1
    };
    v.push(
        "btc:rule-header-version",
        Some(header.version.to_consensus() >= min_version),
    );
    v.push("btc:rule-header-timewarp", None); // no timewarpFix on a regtest-derived network
    v
}

// --- transaction phase (codec/blocks.js txChecks) ------------------------------------

fn is_coinbase(tx: &Transaction) -> bool {
    tx.input.len() == 1 && tx.input[0].previous_output == OutPoint::null()
}

fn sum_out(tx: &Transaction) -> Option<u64> {
    tx.output
        .iter()
        .try_fold(0u64, |s, o| s.checked_add(o.value.to_sat()))
}

/// The transaction phase: `btc:rule-tx-*`. `coinbase` says whether the
/// transaction is the block's first.
pub fn validate_transaction(params: &Params, tx: &Transaction, coinbase: bool) -> Verdict {
    let mut v = Verdict::default();
    v.push("btc:rule-tx-inputs-nonempty", Some(!tx.input.is_empty()));
    v.push("btc:rule-tx-outputs-nonempty", Some(!tx.output.is_empty()));
    v.push(
        "btc:rule-tx-size",
        Some(tx.weight().to_wu() <= params.max_block_weight),
    );
    v.push(
        "btc:rule-tx-output-values",
        Some(
            tx.output
                .iter()
                .all(|o| o.value.to_sat() <= params.max_money)
                && sum_out(tx).is_some_and(|s| s <= params.max_money),
        ),
    );
    v.push(
        "btc:rule-tx-inputs-unique",
        Some(
            tx.input
                .iter()
                .map(|i| i.previous_output)
                .collect::<HashSet<_>>()
                .len()
                == tx.input.len(),
        ),
    );
    v.push(
        "btc:rule-tx-prevouts",
        Some(if coinbase {
            is_coinbase(tx)
        } else {
            tx.input
                .iter()
                .all(|i| i.previous_output.txid != Txid::all_zeros())
        }),
    );
    v.push(
        "btc:rule-tx-coinbase-script",
        coinbase.then(|| {
            tx.input
                .first()
                .is_some_and(|i| (2..=100).contains(&i.script_sig.len()))
        }),
    );
    v
}

// --- block phase (codec/blocks.js blockChecks + the signature rule) ---------------------

/// Legacy signature-operation count (Core's `GetSigOpCount` with
/// `fAccurate=false`): `CHECKSIG(VERIFY)` counts 1, `CHECKMULTISIG(VERIFY)` 20.
fn legacy_sigops(block: &Block) -> u64 {
    block
        .txdata
        .iter()
        .map(|tx| {
            tx.input
                .iter()
                .map(|i| i.script_sig.count_sigops_legacy() as u64)
                .sum::<u64>()
                + tx.output
                    .iter()
                    .map(|o| o.script_pubkey.count_sigops_legacy() as u64)
                    .sum::<u64>()
        })
        .sum()
}

/// The block phase: `btc:rule-block-*`, then `sidestr:rule-block-signature`.
pub fn validate_block_structure(
    family: &dyn HeaderFamily,
    params: &Params,
    overlay: &Overlay,
    block: &Block,
) -> Verdict {
    let mut v = Verdict::default();
    let txids: Vec<Txid> = block.txdata.iter().map(Transaction::compute_txid).collect();
    v.push(
        "btc:rule-block-coinbase-first",
        Some(block.txdata.first().is_some_and(is_coinbase)),
    );
    v.push(
        "btc:rule-block-coinbase-single",
        Some(block.txdata.iter().skip(1).all(|tx| !is_coinbase(tx))),
    );
    v.push(
        "btc:rule-block-merkle-root",
        Some(block.compute_merkle_root() == Some(block.header.merkle_root)),
    );
    v.push(
        "btc:rule-block-tx-duplicates",
        Some(txids.iter().collect::<HashSet<_>>().len() == txids.len()),
    );
    v.push(
        "btc:rule-block-sigops",
        Some(4 * legacy_sigops(block) <= params.max_block_sigops_cost),
    );
    v.push(
        "btc:rule-block-weight",
        Some(block.weight().to_wu() <= params.max_block_weight),
    );
    v.push(
        "btc:rule-block-transactions",
        Some(
            block
                .txdata
                .iter()
                .enumerate()
                .all(|(i, tx)| validate_transaction(params, tx, i == 0).ok()),
        ),
    );
    v.push(
        "sidestr:rule-block-signature",
        Some(verify_block_signature(family, block, overlay.challenge)),
    );
    v
}

// --- block-context phase (codec/blocks.js contextChecks + the overlay) ------------------

/// The block's spending, resolved against the UTXO set and the block itself
/// (`blocks.js #resolveSpending`). With a full UTXO set nothing is
/// "unresolved": a missing coin is a definite violation.
#[derive(Debug, Clone, Default)]
pub struct Spending {
    /// Total fees of the non-coinbase transactions.
    pub fees: u64,
    /// Inputs spending a coin that does not exist or was spent earlier in the block.
    pub missing: Vec<OutPoint>,
    /// Transactions whose outputs exceed their inputs.
    pub deficits: Vec<Txid>,
    /// Inputs spending an immature coinbase.
    pub premature: Vec<OutPoint>,
    /// BIP 68 violations.
    pub seqlock_violations: Vec<OutPoint>,
    /// BIP 68 locks this context cannot judge (time-based).
    pub seqlock_unknown: usize,
    /// Every resolved input: (transaction index, input index, its prevout).
    pub resolved: Vec<(usize, usize, TxOut)>,
}

/// Resolve the block's inputs against `utxo` and the block's own earlier
/// outputs, in order; does not mutate the set.
pub fn resolve_spending(params: &Params, block: &Block, utxo: &Utxo, height: u32) -> Spending {
    const SEQ_DISABLE: u32 = 0x8000_0000;
    const SEQ_TYPE: u32 = 0x0040_0000;
    const SEQ_MASK: u32 = 0x0000_ffff;
    let mut s = Spending::default();
    let mut spent_here: HashSet<OutPoint> = HashSet::new();
    let mut created_here: HashMap<OutPoint, Coin> = HashMap::new();
    for (ti, tx) in block.txdata.iter().enumerate() {
        let txid = tx.compute_txid();
        if ti > 0 {
            let mut in_sum = 0u64;
            let mut values_ok = true;
            for (ii, inp) in tx.input.iter().enumerate() {
                let key = inp.previous_output;
                if spent_here.contains(&key) {
                    s.missing.push(key);
                    values_ok = false;
                } else {
                    let coin = created_here.get(&key).or_else(|| utxo.get(&key));
                    let mut coin_height = None;
                    match coin {
                        Some(c) => {
                            in_sum = in_sum.saturating_add(c.output.value.to_sat());
                            s.resolved.push((ti, ii, c.output.clone()));
                            coin_height = Some(c.height);
                            if c.coinbase
                                && height.saturating_sub(c.height) < params.coinbase_maturity
                            {
                                s.premature.push(key);
                            }
                        }
                        None => {
                            s.missing.push(key);
                            values_ok = false;
                        }
                    }
                    let seq = inp.sequence.0;
                    if tx.version.0 >= 2 && seq & SEQ_DISABLE == 0 {
                        let value = seq & SEQ_MASK;
                        if value > 0 {
                            if seq & SEQ_TYPE != 0 {
                                s.seqlock_unknown += 1;
                            } else if let Some(ch) = coin_height {
                                if u64::from(height) < u64::from(ch) + u64::from(value) {
                                    s.seqlock_violations.push(key);
                                }
                            } else {
                                s.seqlock_unknown += 1;
                            }
                        }
                    }
                }
                spent_here.insert(key);
            }
            if values_ok {
                match sum_out(tx) {
                    Some(out_sum) if in_sum >= out_sum => {
                        s.fees = s.fees.saturating_add(in_sum - out_sum)
                    }
                    _ => s.deficits.push(txid),
                }
            }
        }
        for (vout, o) in tx.output.iter().enumerate() {
            if !o.script_pubkey.is_op_return() {
                created_here.insert(
                    OutPoint {
                        txid,
                        vout: vout as u32,
                    },
                    Coin {
                        output: o.clone(),
                        height,
                        coinbase: ti == 0,
                    },
                );
            }
        }
    }
    s
}

/// What a block-context rule sees.
#[derive(Debug)]
pub struct BlockContext<'a> {
    /// The block.
    pub block: &'a Block,
    /// Its height.
    pub height: u32,
    /// The resolved spending.
    pub spending: &'a Spending,
    /// Median time past of the previous 11 headers, when known.
    pub mtp: Option<u32>,
    /// The overlay's records before this block.
    pub records: &'a Records,
}

/// An additional block-context rule: the extension point for rules a chain
/// document may name beyond the core (SPEC 12). It sees the same context
/// the built-in rules see and answers the same three ways.
pub trait BlockRule: core::fmt::Debug {
    /// The rule id reported in the verdict.
    fn id(&self) -> &str;
    /// The check.
    fn check(&self, ctx: &BlockContext) -> Option<bool>;
}

/// The kernel's lenient BIP 34 read (`blocks.js bip34Height`): `OP_1`..`OP_16`
/// or a 1–5 byte little-endian push, no minimality check. What
/// `btc:rule-blockctx-bip34-height` compares against the height; the strict
/// reading is [`crate::block::coinbase_height`], which decides which height a
/// block *claims* before the rules run.
fn bip34_height_lenient(coinbase: &Transaction) -> Option<u32> {
    let script = coinbase.input.first()?.script_sig.as_bytes();
    let op = *script.first()?;
    if (0x51..=0x60).contains(&op) {
        return Some(u32::from(op - 0x50));
    }
    let len = usize::from(op);
    if !(1..=5).contains(&len) || script.len() < 1 + len {
        return None;
    }
    let n = (1..=len)
        .rev()
        .fold(0u64, |n, i| n * 256 + u64::from(script[i]));
    u32::try_from(n).ok()
}

/// The witness commitment carried in a coinbase output (`blocks.js
/// witnessCommitment`): the last output starting `OP_RETURN 0x24 aa21a9ed`.
fn witness_commitment_in(coinbase: &Transaction) -> Option<[u8; 32]> {
    coinbase
        .output
        .iter()
        .rev()
        .find(|o| {
            o.script_pubkey.len() >= 38
                && o.script_pubkey
                    .as_bytes()
                    .starts_with(&[0x6a, 0x24, 0xaa, 0x21, 0xa9, 0xed])
        })
        .and_then(|o| o.script_pubkey.as_bytes()[6..38].try_into().ok())
}

/// `dsha256(witness merkle root || witness reserved value)`: the coinbase
/// wtxid is all zeros; the reserved value is the coinbase witness's first
/// item (32 zero bytes when absent).
fn witness_commitment_hash(block: &Block) -> [u8; 32] {
    let root = block
        .witness_root()
        .map(|r| r.to_byte_array())
        .unwrap_or([0u8; 32]);
    let mut cat = [0u8; 64];
    cat[..32].copy_from_slice(&root);
    if let Some(reserved) = block.txdata[0]
        .input
        .first()
        .and_then(|i| i.witness.iter().next())
    {
        let n = reserved.len().min(32);
        cat[32..32 + n].copy_from_slice(&reserved[..n]);
    }
    bitcoin::hashes::sha256d::Hash::hash(&cat).to_byte_array()
}

/// A candidate block with the chain state it is judged against.
#[derive(Debug)]
pub struct Candidate<'a> {
    /// The block.
    pub block: &'a Block,
    /// The height it claims.
    pub height: u32,
    /// The UTXO set before it.
    pub utxo: &'a Utxo,
    /// Median time past of the headers before it, when known.
    pub mtp: Option<u32>,
    /// The overlay's records before it.
    pub records: &'a Records,
    /// Rules the document names beyond the core.
    pub extra: &'a [Box<dyn BlockRule>],
}

/// The block-context phase for a candidate. Returns the verdict, the resolved
/// spending, and the records the block *would* leave — claims and burns keyed
/// by its height — which the caller commits when the block is applied.
pub fn validate_block_context(
    params: &Params,
    overlay: &Overlay,
    c: &Candidate,
) -> (Verdict, Spending, Records) {
    let Candidate {
        block,
        height,
        utxo,
        mtp,
        records,
        extra,
    } = *c;
    let spending = resolve_spending(params, block, utxo, height);
    let mut v = Verdict::default();
    let cb = &block.txdata[0];
    let mut next = Records::default();

    v.push(
        "btc:rule-blockctx-bip34-height",
        (height >= params.bip34_height).then(|| bip34_height_lenient(cb) == Some(height)),
    );
    // lockTime 0 and the all-final-sequences escape need no context; a time-based lockTime needs median-time-past
    let mut unknown = false;
    let mut final_ok = true;
    for tx in &block.txdata {
        let lt = tx.lock_time.to_consensus_u32();
        if lt == 0 || tx.input.iter().all(|i| i.sequence.0 == 0xffff_ffff) {
            continue;
        }
        if lt < 500_000_000 {
            if lt >= height {
                final_ok = false;
            }
        } else if let Some(m) = mtp {
            if lt >= m {
                final_ok = false;
            }
        } else {
            unknown = true;
        }
    }
    v.push(
        "btc:rule-blockctx-finality",
        if !final_ok {
            Some(false)
        } else if unknown {
            None
        } else {
            Some(true)
        },
    );
    v.push(
        "btc:rule-blockctx-sequence-locks",
        if !spending.seqlock_violations.is_empty() {
            Some(false)
        } else if spending.seqlock_unknown > 0 {
            None
        } else {
            Some(true)
        },
    );
    v.push(
        "btc:rule-blockctx-inputs-available",
        Some(spending.missing.is_empty()),
    );
    v.push(
        "btc:rule-blockctx-coinbase-maturity",
        Some(spending.premature.is_empty()),
    );
    v.push("btc:rule-blockctx-fees", Some(spending.deficits.is_empty()));
    // the kernel's rule, plus the paid claims: coinbase value <= subsidy (0) + fees + claims (siding/lib/overlay.mjs)
    let (claims, claim_errors) = parse_claims(cb);
    let paid: u64 = claims.iter().map(|c| c.payout.value).sum();
    v.push(
        "btc:rule-blockctx-coinbase-amount",
        Some(
            claim_errors.is_empty()
                && sum_out(cb).is_some_and(|s| s <= spending.fees.saturating_add(paid)),
        ),
    );
    let has_witness = block
        .txdata
        .iter()
        .any(|tx| tx.input.iter().any(|i| !i.witness.is_empty()));
    v.push(
        "btc:rule-blockctx-witness-commitment",
        (height >= params.segwit_height && has_witness)
            .then(|| witness_commitment_in(cb) == Some(witness_commitment_hash(block))),
    );
    // real script + signature verification of every input; anything this crate cannot verify fails
    let mut scripts_ok = true;
    let mut by_tx: BTreeMap<usize, BTreeMap<usize, TxOut>> = BTreeMap::new();
    for (ti, ii, prevout) in &spending.resolved {
        by_tx.entry(*ti).or_default().insert(*ii, prevout.clone());
    }
    for (ti, resolved) in &by_tx {
        let tx = &block.txdata[*ti];
        if resolved.len() != tx.input.len() {
            scripts_ok = false;
            continue;
        }
        let prevouts: Vec<TxOut> = (0..tx.input.len()).map(|i| resolved[&i].clone()).collect();
        for ii in 0..tx.input.len() {
            if verify_key_path_input(tx, ii, &prevouts).is_err() {
                scripts_ok = false;
            }
        }
    }
    v.push("btc:rule-blockctx-scripts", Some(scripts_ok));

    // sidestr:rule-pegouts (SPEC 7): a pegout:<script> OP_RETURN names a parent output script of 2 to 40
    // bytes and carries at least pegoutMin sats; the coinbase carries none. The value leaves the supply.
    let pegouts_ok = (|| {
        if cb
            .output
            .iter()
            .any(|o| parse_pegout(&o.script_pubkey).is_some())
        {
            return false;
        }
        for tx in block.txdata.iter().skip(1) {
            let txid = tx.compute_txid().to_string();
            for (vout, o) in tx.output.iter().enumerate() {
                if op_return_data(&o.script_pubkey).is_none() || !looks_like_pegout(o) {
                    continue;
                }
                let Some(script) = parse_pegout(&o.script_pubkey) else {
                    return false;
                };
                if o.value.to_sat() < overlay.pegout_min {
                    return false;
                }
                let key = (txid.clone(), vout as u32);
                if records
                    .pegouts
                    .get(&key)
                    .is_some_and(|b| b.height != height)
                {
                    return false;
                }
                next.pegouts.insert(
                    key,
                    Burn {
                        txid: txid.clone(),
                        vout: vout as u32,
                        script,
                        value: o.value.to_sat(),
                        height,
                    },
                );
            }
        }
        true
    })();
    v.push("sidestr:rule-pegouts", Some(pegouts_ok));
    // sidestr:rule-claims (SPEC 6): each claim marker is immediately preceded by its payout; no outpoint is
    // claimed twice in the block or on the chain. A level-1 validator accepts what the signers claim.
    let claims_ok = (|| {
        if !claim_errors.is_empty() {
            return false;
        }
        let mut in_block = HashSet::new();
        for c in &claims {
            let op = (c.txid.clone(), c.vout);
            if !in_block.insert(op.clone()) {
                return false;
            }
            if records.claims.get(&op).is_some_and(|&at| at != height) {
                return false;
            }
        }
        for op in in_block {
            next.claims.insert(op, height);
        }
        true
    })();
    v.push("sidestr:rule-claims", Some(claims_ok));
    let ctx = BlockContext {
        block,
        height,
        spending: &spending,
        mtp,
        records,
    };
    for rule in extra {
        let ok = rule.check(&ctx);
        v.push(rule.id(), ok);
    }
    (v, spending, next)
}

/// Apply a fully validated block to the UTXO set (`blocks.js applyBlock`):
/// spend its inputs, create its non-`OP_RETURN` outputs. Returns
/// `(created, spent)`.
pub fn apply_block(utxo: &mut Utxo, block: &Block, height: u32) -> (usize, usize) {
    let mut created = 0;
    let mut spent = 0;
    for (i, tx) in block.txdata.iter().enumerate() {
        if i > 0 {
            for inp in &tx.input {
                if utxo.remove(&inp.previous_output).is_some() {
                    spent += 1;
                }
            }
        }
        let txid = tx.compute_txid();
        for (vout, o) in tx.output.iter().enumerate() {
            if !o.script_pubkey.is_op_return() {
                utxo.insert(
                    OutPoint {
                        txid,
                        vout: vout as u32,
                    },
                    Coin {
                        output: o.clone(),
                        height,
                        coinbase: i == 0,
                    },
                );
                created += 1;
            }
        }
    }
    (created, spent)
}

/// The genesis of a chain is applied without validation, as the reference
/// does: its hash is checked against the document instead. Exposed so a
/// caller can apply block 0 and be sure of the base hash.
pub fn genesis_hash(family: &dyn HeaderFamily, block: &Block) -> BlockHash {
    family.block_hash(&block.header)
}
