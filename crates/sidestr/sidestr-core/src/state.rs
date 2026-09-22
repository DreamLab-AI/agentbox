//! The chain in memory (SPEC 4, 5, 11): headers and hashes from the genesis
//! up, the UTXO set, the overlay's records, a mempool with the producer's
//! policy, and block production. A port of `siding/lib/chain.mjs` `Siding`
//! and the state-machine half of `bitcoin-blake/blaketestnode`
//! `lib/node.mjs` `ChainNode`, for level 1: one signer, no reorgs.
//!
//! Nothing here touches a file or a clock: [`StateOf`] is fed blocks and told
//! the time. The file-backed [`crate::chain::ChainOf`] wraps it (feature `std`).
//!
//! The state is generic over the header family (SPEC 3.2): [`State`] is the
//! stock instantiation, `StateOf<Blake2bV2>` (from `sidestr-header`) the
//! BLAKE2b one; the document's parent must hand down the family the state is
//! instantiated for, or [`StateOf::from_genesis`] refuses it.
//!
//! A state always holds its genesis. [`StateOf::with_key`] builds and seals it
//! from the document and the signer's key (SPEC 5); [`StateOf::from_genesis`]
//! takes a sealed block 0, judges it under every rule that applies at height
//! 0 — the family's header rules, the solution against the challenge, a
//! coinbase minting exactly the pegs — and only then holds it to the
//! document's `genesisHash`, which is how a validator without the key starts.
//! The reference trusts block 0 by its hash alone; this crate does not (see
//! the crate docs, "Where this port departs").

use std::collections::HashSet;

use bitcoin::hashes::Hash;
use bitcoin::secp256k1::SecretKey;
use bitcoin::{
    Amount, BlockHash, CompactTarget, OutPoint, Script, ScriptBuf, Transaction, TxOut, Txid,
};

use crate::block::{
    block_data, block_height, build_block, sign_block, BlockTemplate, HeaderFamily, SidestrBlock,
    Stock, MARKER,
};
use crate::document::ChainDocument;
use crate::error::{Error, Result};
use crate::federation::Federation;
use crate::marker::{claim_marker, looks_like_pegout, parse_pegout, Burn};
use crate::rules::{
    apply_block, median_time_past, validate_block_context, validate_block_structure,
    validate_header, validate_transaction, BlockRule, Candidate, Coin, HeaderContext, Overlay,
    Params, Records, RuleResult, Utxo, Verdict,
};

/// The outputs' total, `None` on overflow. Amounts in an unvalidated
/// transaction are untrusted: nothing here assumes they are under max money.
fn checked_output_sum(tx: &Transaction) -> Option<u64> {
    tx.output
        .iter()
        .try_fold(0u64, |s, o| s.checked_add(o.value.to_sat()))
}

/// The rule [`StateOf::from_genesis`] adds to the kernel's at height 0: the
/// block is *the document's* genesis, sealed — its signed block data
/// (version, previous hash, time, and the coinbase stripped of its solution:
/// the pegs, the marker, the height push, no other transaction) equals that
/// of [`StateOf::build_genesis_for`], and its `bits` is the document's
/// `powLimit` in compact form (SPEC 5; the difficulty rule has no previous
/// header to hold it to at height 0).
pub const RULE_GENESIS_DOCUMENT: &str = "sidestr:rule-genesis-document";
use crate::sighash::verify_taproot_key_path;

/// The tip: height, hash and header time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tip {
    /// Height of the tip.
    pub height: u32,
    /// Its block hash.
    pub hash: BlockHash,
    /// Its header time.
    pub time: u32,
}

/// What applying a block reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    /// The block's height.
    pub height: u32,
    /// Its hash.
    pub hash: BlockHash,
    /// Transactions in it, coinbase included.
    pub txs: usize,
    /// Fees the coinbase collected (production only; 0 for a block from elsewhere).
    pub fees: u64,
    /// Claims the block made (production only).
    pub claims: usize,
}

/// What [`StateOf::submit`] reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submitted {
    /// The transaction's id.
    pub txid: Txid,
    /// Its fee in sats.
    pub fee: u64,
    /// Its virtual size.
    pub vsize: u64,
    /// It was already in the mempool; nothing changed.
    pub dup: bool,
}

/// A coin as [`StateOf::coins`] lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoinRef {
    /// The outpoint.
    pub outpoint: OutPoint,
    /// Sats.
    pub value: u64,
    /// The creating block's height.
    pub height: u32,
    /// Whether it is a coinbase output (maturity applies).
    pub coinbase: bool,
}

/// A peg-in the producer claims in the next block (SPEC 6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimRequest {
    /// Parent txid, display order.
    pub txid: String,
    /// Parent vout.
    pub vout: u32,
    /// The peg's amount in sats.
    pub amount: u64,
    /// The sidechain script the peg-in named.
    pub script: ScriptBuf,
}

/// What the next block is built from.
#[derive(Debug, Clone, Default)]
pub struct NextBlock {
    /// The header time wanted; at least the tip's time plus one is used.
    pub time: u32,
    /// Peg-ins to claim.
    pub claims: Vec<ClaimRequest>,
}

/// The chain in memory, for header family `F`.
#[derive(Debug)]
pub struct StateOf<F: HeaderFamily> {
    doc: ChainDocument,
    family: F,
    params: Params,
    bits: CompactTarget,
    challenge: ScriptBuf,
    federation: Option<Federation>,
    headers: Vec<F::Header>,
    hashes: Vec<BlockHash>,
    utxo: Utxo,
    records: Records,
    mempool: Vec<(Txid, Transaction)>,
    mempool_spent: HashSet<OutPoint>,
    extra_rules: Vec<Box<dyn BlockRule<F>>>,
}

/// The chain in memory beside a stock parent: [`StateOf`] over [`Stock`].
pub type State = StateOf<Stock>;

impl<F: HeaderFamily> StateOf<F> {
    /// The family marker, if the document's parent hands down the family this
    /// state is instantiated for; [`Error::UnsupportedFamily`] otherwise. The
    /// first thing every constructor checks, before a block is decoded.
    pub fn family_of(doc: &ChainDocument) -> Result<F> {
        let family = doc.family()?;
        if family != F::FAMILY {
            return Err(Error::UnsupportedFamily(family));
        }
        Ok(F::default())
    }

    fn empty(doc: ChainDocument) -> Result<Self> {
        doc.validate()?;
        let family = Self::family_of(&doc)?;
        let bits = doc.bits()?;
        let challenge = doc.challenge_script()?;
        let federation = Federation::for_document(&doc)?;
        Ok(Self {
            doc,
            family,
            params: Params::default(),
            bits,
            challenge,
            federation,
            headers: Vec::new(),
            hashes: Vec::new(),
            utxo: Utxo::new(),
            records: Records::default(),
            mempool: Vec::new(),
            mempool_spent: HashSet::new(),
            extra_rules: Vec::new(),
        })
    }

    /// SPEC 5: the genesis block, unsigned, minting the document's pegs at the
    /// document's time, marker `sidestr genesis <chain id>`
    /// (`siding/lib/chain.mjs buildGenesis`). A pure function of the document.
    pub fn build_genesis_for(doc: &ChainDocument) -> Result<F::Block> {
        let family = Self::family_of(doc)?;
        let outputs = doc
            .pegs
            .iter()
            .map(|p| {
                Ok(TxOut {
                    value: Amount::from_sat(p.amount),
                    script_pubkey: ScriptBuf::from_bytes(
                        hex::decode(&p.script).map_err(|e| Error::Encoding(e.to_string()))?,
                    ),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(build_block(
            &family,
            &BlockTemplate {
                height: 0,
                prev: BlockHash::all_zeros(),
                time: doc.genesis_time,
                transactions: vec![],
                outputs,
                bits: doc.bits()?,
                marker: format!("sidestr genesis {}", doc.id),
            },
        ))
    }

    /// The genesis sealed by the signer's key, deterministically (zero aux),
    /// so it is reproducible from document and key (`siding/lib/chain.mjs genesisBlock`).
    pub fn genesis_block_for(doc: &ChainDocument, key: &SecretKey) -> Result<F::Block> {
        let family = Self::family_of(doc)?;
        sign_block(
            &family,
            &Self::build_genesis_for(doc)?,
            &doc.challenge_script()?,
            key,
            &[0u8; 32],
        )
    }

    /// A state at its genesis, sealed with the signer's key.
    pub fn with_key(doc: ChainDocument, key: &SecretKey) -> Result<Self> {
        let genesis = Self::genesis_block_for(&doc, key)?;
        Self::from_genesis(doc, &genesis, None)
    }

    /// A state at a sealed genesis. Block 0 is judged first, under every rule
    /// that applies at height 0 — the header rules with no previous header
    /// (proof of work against `bits`, the version, the family's own:
    /// `knots:rule-header-v2-from-fork`, `-height`, `-flags-reserved`), the
    /// block rules (`sidestr:rule-block-signature`: the solution against the
    /// challenge, or the federation's leaf), the block-context rules with the
    /// pegs as the one subsidy, and [`RULE_GENESIS_DOCUMENT`]. A failure is
    /// [`Error::Rejected`] at height 0 naming the rules. Only then is the hash
    /// held to `expect` when given, and to the document's `genesisHash` when
    /// the document has one ([`Error::GenesisMismatch`]).
    ///
    /// **Departure**: `siding/lib/chain.mjs #apply` at `h === 0` applies the
    /// genesis on the hash alone. A hash pin says which block 0 you hold, not
    /// that it is well-formed; here an unsigned genesis whose hash the
    /// document happens to name is still refused. There is no trusted import.
    pub fn from_genesis(
        doc: ChainDocument,
        genesis: &F::Block,
        expect: Option<BlockHash>,
    ) -> Result<Self> {
        let mut s = Self::empty(doc)?;
        if genesis.txdata().is_empty() {
            return Err(Error::Chain("genesis has no coinbase".into()));
        }
        let (mut verdict, _) = s.judge(0, genesis, None);
        let expected = Self::build_genesis_for(&s.doc)?;
        verdict.results.push(RuleResult::new(
            RULE_GENESIS_DOCUMENT,
            Some(
                block_data(&s.family, genesis) == block_data(&s.family, &expected)
                    && s.family.bits(genesis.header()) == s.bits,
            ),
        ));
        if !verdict.ok() {
            return Err(Error::Rejected {
                height: 0,
                rules: verdict.failed(),
            });
        }
        let hash = s.family.block_hash(genesis.header());
        if expect.is_some_and(|e| e != hash) {
            return Err(Error::Chain("genesis hash mismatch".into()));
        }
        if let Some(want) = &s.doc.genesis_hash {
            if *want != hash.to_string() {
                return Err(Error::GenesisMismatch {
                    found: hash.to_string(),
                    expected: want.clone(),
                });
            }
        }
        apply_block(&mut s.utxo, genesis.txdata(), 0);
        s.headers.push(genesis.header().clone());
        s.hashes.push(hash);
        Ok(s)
    }

    /// Add a block-context rule beyond the core (SPEC 12).
    pub fn add_rule(&mut self, rule: Box<dyn BlockRule<F>>) {
        self.extra_rules.push(rule);
    }

    /// The document.
    pub fn document(&self) -> &ChainDocument {
        &self.doc
    }
    /// The header family.
    pub fn family(&self) -> &F {
        &self.family
    }
    /// The network parameters.
    pub fn params(&self) -> &Params {
        &self.params
    }
    /// The compact target every block carries.
    pub fn bits(&self) -> CompactTarget {
        self.bits
    }
    /// The challenge.
    pub fn challenge(&self) -> &Script {
        &self.challenge
    }
    /// The federation the document names (level 2), or `None` for one signer.
    pub fn federation(&self) -> Option<&Federation> {
        self.federation.as_ref()
    }
    /// The genesis hash.
    pub fn genesis_hash(&self) -> BlockHash {
        self.hashes[0]
    }
    /// The tip.
    pub fn tip(&self) -> Tip {
        let h = self.hashes.len() - 1;
        Tip {
            height: h as u32,
            hash: self.hashes[h],
            time: self.family.time(&self.headers[h]),
        }
    }
    /// The tip's height.
    pub fn height(&self) -> u32 {
        self.tip().height
    }
    /// The hash at a height.
    pub fn hash_at(&self, height: u32) -> Option<BlockHash> {
        self.hashes.get(height as usize).copied()
    }
    /// The header at a height.
    pub fn header_at(&self, height: u32) -> Option<&F::Header> {
        self.headers.get(height as usize)
    }
    /// The UTXO set.
    pub fn utxo(&self) -> &Utxo {
        &self.utxo
    }
    /// The overlay's records: claims and burns.
    pub fn records(&self) -> &Records {
        &self.records
    }
    /// Transactions waiting for a block, in arrival order.
    pub fn mempool(&self) -> impl Iterator<Item = &Transaction> {
        self.mempool.iter().map(|(_, tx)| tx)
    }
    /// Whether a parent outpoint is claimed on this chain (SPEC 6).
    pub fn claimed(&self, txid: &str, vout: u32) -> bool {
        self.records.claimed(txid, vout)
    }
    /// Every burn the chain has validated, oldest first (SPEC 7).
    pub fn pegouts(&self) -> Vec<Burn> {
        self.records.pegouts()
    }
    /// The least a burn may carry (`siding/lib/chain.mjs pegoutMin`).
    pub fn pegout_min(&self) -> u64 {
        self.doc.pegout_min
    }
    /// The producer's fee floor, sat/vB (`siding/lib/chain.mjs minFeeRate`).
    pub fn min_fee_rate(&self) -> u64 {
        self.doc.min_fee_rate
    }
    /// The coins paying a script, in no particular order (`siding/lib/chain.mjs coins`).
    pub fn coins(&self, script_pubkey: &Script) -> Vec<CoinRef> {
        let mut out: Vec<CoinRef> = self
            .utxo
            .iter()
            .filter(|(_, c)| c.output.script_pubkey.as_script() == script_pubkey)
            .map(|(op, c)| CoinRef {
                outpoint: *op,
                value: c.output.value.to_sat(),
                height: c.height,
                coinbase: c.coinbase,
            })
            .collect();
        out.sort_by_key(|c| (c.height, c.outpoint.txid, c.outpoint.vout));
        out
    }
    /// Whether a coin may be spent in the next block: not a coinbase, or a mature one.
    pub fn spendable(&self, coin: &Coin) -> bool {
        !coin.coinbase
            || (u64::from(self.height()) + 1).saturating_sub(u64::from(coin.height))
                >= u64::from(self.params.coinbase_maturity)
    }
    /// A transaction's virtual size: weight over four, rounded up.
    pub fn vsize(tx: &Transaction) -> u64 {
        tx.weight().to_wu().div_ceil(4)
    }
    /// The fee a transaction pays, from the UTXO set. `None` if an input is
    /// not an unspent coin, if the outputs exceed the inputs, or if either
    /// total overflows — the transaction is untrusted, so every sum is
    /// checked and no amount is assumed to be under max money.
    pub fn fees(&self, tx: &Transaction) -> Option<u64> {
        let ins = tx.input.iter().try_fold(0u64, |s, i| {
            let c = self.utxo.get(&i.previous_output)?;
            s.checked_add(c.output.value.to_sat())
        })?;
        let outs = checked_output_sum(tx)?;
        ins.checked_sub(outs)
    }

    /// Validate and apply block `height` (must be the tip plus one)
    /// (`node.mjs applyNext` + `siding/lib/chain.mjs #apply`). `expect` is the
    /// hash a mirror's index promised; `now` is the clock for the future-time
    /// rule (`None` skips it). Every failed rule is named in the error.
    pub fn apply(
        &mut self,
        height: u32,
        block: &F::Block,
        expect: Option<BlockHash>,
        now: Option<u32>,
    ) -> Result<Applied> {
        let tip = self.tip();
        if u64::from(height) != u64::from(tip.height) + 1 {
            return Err(Error::Chain(format!(
                "apply {height} at height {}",
                tip.height
            )));
        }
        let hash = self.family.block_hash(block.header());
        if self.family.prev(block.header()) != tip.hash {
            return Err(Error::Chain(format!(
                "block {height} does not link to {}",
                tip.hash
            )));
        }
        let (verdict, next) = self.judge(height, block, now);
        if !verdict.ok() {
            return Err(Error::Rejected {
                height,
                rules: verdict.failed(),
            });
        }
        if expect.is_some_and(|e| e != hash) {
            return Err(Error::Chain(format!(
                "block {height} hash {hash} is not {}",
                expect.unwrap()
            )));
        }
        apply_block(&mut self.utxo, block.txdata(), height);
        self.records.claims.extend(next.claims);
        self.records.pegouts.extend(next.pegouts);
        self.headers.push(block.header().clone());
        self.hashes.push(hash);
        self.mempool.retain(|(_, tx)| {
            tx.input
                .iter()
                .all(|i| self.utxo.contains_key(&i.previous_output))
        });
        self.mempool_spent = self
            .mempool
            .iter()
            .flat_map(|(_, tx)| tx.input.iter().map(|i| i.previous_output))
            .collect();
        Ok(Applied {
            height,
            hash,
            txs: block.txdata().len(),
            fees: 0,
            claims: 0,
        })
    }

    /// Every phase's verdict on a candidate for `height`, and the records it
    /// would leave, without applying anything. At height 0 there is no
    /// previous header, so the rules that need one are skipped; a `height`
    /// beyond the tip sees whatever headers exist below it.
    pub fn judge(&self, height: u32, block: &F::Block, now: Option<u32>) -> (Verdict, Records) {
        let h = height as usize;
        let end = h.min(self.headers.len());
        let window = &self.headers[end.saturating_sub(11)..end];
        let mut verdict = validate_header(
            &self.family,
            &self.params,
            block.header(),
            &HeaderContext {
                height,
                prev: h.checked_sub(1).and_then(|i| self.headers.get(i)),
                mtp_window: window,
                now: now.map(|n| n.saturating_add(7_200)),
            },
        );
        let overlay = Overlay {
            challenge: &self.challenge,
            pegout_min: self.doc.pegout_min,
            genesis_subsidy: self
                .doc
                .pegs
                .iter()
                .fold(0u64, |s, p| s.saturating_add(p.amount)),
        };
        verdict.extend(validate_block_structure(
            &self.family,
            &self.params,
            &overlay,
            block,
        ));
        let mtp = (!window.is_empty()).then(|| median_time_past(&self.family, window));
        let candidate = Candidate {
            block,
            height,
            utxo: &self.utxo,
            mtp,
            records: &self.records,
            extra: &self.extra_rules,
        };
        let (ctx, _, next) =
            validate_block_context(&self.family, &self.params, &overlay, &candidate);
        verdict.extend(ctx);
        (verdict, next)
    }

    /// Accept a block from elsewhere (a mirror): its height read from it,
    /// validated, applied (`siding/lib/chain.mjs addBlock`).
    pub fn add_block(
        &mut self,
        block: &F::Block,
        expect: Option<BlockHash>,
        now: Option<u32>,
    ) -> Result<Applied> {
        let h = block_height(&self.family, block)?;
        self.apply(h, block, expect, now)
    }

    /// [`StateOf::add_block`] from consensus bytes.
    pub fn add_block_bytes(
        &mut self,
        bytes: &[u8],
        expect: Option<BlockHash>,
        now: Option<u32>,
    ) -> Result<Applied> {
        let block = F::Block::decode(bytes)?;
        self.add_block(&block, expect, now)
    }

    /// SPEC 11: a transaction reaches the producer; it is included when it
    /// validates (`siding/lib/chain.mjs submit`). The mempool's policy, in
    /// order: the transaction rules; every input an unspent, unreserved,
    /// mature coin; outputs at most inputs; a burn well-formed and at least
    /// `pegoutMin` (SPEC 7); the fee at least `minFeeRate` sat/vB; every
    /// input's signature under the sighash rules the next block is judged by.
    pub fn submit(&mut self, tx: Transaction) -> Result<Submitted> {
        let txid = tx.compute_txid();
        if self.mempool.iter().any(|(id, _)| *id == txid) {
            return Ok(Submitted {
                txid,
                fee: 0,
                vsize: Self::vsize(&tx),
                dup: true,
            });
        }
        let refuse = |m: String| Err(Error::Transaction(m));
        let v = validate_transaction(&self.params, &tx, false);
        if !v.ok() {
            return refuse(format!("transaction: {}", v.failed().join(", ")));
        }
        let mut prevouts = Vec::with_capacity(tx.input.len());
        let mut in_sum = 0u64;
        for i in &tx.input {
            let key = i.previous_output;
            if self.mempool_spent.contains(&key) {
                return refuse(format!("input {key} already spent in the mempool"));
            }
            let Some(c) = self.utxo.get(&key) else {
                return refuse(format!("input {key} is not an unspent coin"));
            };
            if !self.spendable(c) {
                return refuse(format!("input {key} is an immature coinbase"));
            }
            prevouts.push(c.output.clone());
            in_sum = in_sum.saturating_add(c.output.value.to_sat());
        }
        let Some(out_sum) = checked_output_sum(&tx) else {
            return refuse("outputs overflow".into());
        };
        if out_sum > in_sum {
            return refuse("outputs exceed inputs".into());
        }
        // SPEC 7: a burn names a parent script and carries at least pegoutMin, as the block rule will demand
        for o in &tx.output {
            if !o.script_pubkey.is_op_return() {
                continue;
            }
            let script = parse_pegout(&o.script_pubkey);
            if looks_like_pegout(o) && script.is_none() {
                return refuse(
                    "a peg-out names a parent output script of 2 to 40 bytes as hex".into(),
                );
            }
            if script.is_some() && o.value.to_sat() < self.pegout_min() {
                return refuse(format!(
                    "a peg-out burns at least {} sats",
                    self.pegout_min()
                ));
            }
        }
        // producer policy, published in chain.json so a wallet can compute it: at least minFeeRate sat/vB
        let vsize = Self::vsize(&tx);
        let min_fee = vsize.saturating_mul(self.min_fee_rate());
        let fee = in_sum - out_sum;
        if fee < min_fee {
            return refuse(format!(
                "fee {fee} is below the minimum {min_fee} sats ({vsize} vB at {} sat/vB)",
                self.min_fee_rate()
            ));
        }
        let sighash = self.family.sighash_rules(self.height().saturating_add(1));
        for i in 0..tx.input.len() {
            if let Err(e) = verify_taproot_key_path(&tx, i, &prevouts, sighash) {
                return refuse(format!("input {i}: {e}"));
            }
        }
        for i in &tx.input {
            self.mempool_spent.insert(i.previous_output);
        }
        self.mempool.push((txid, tx));
        Ok(Submitted {
            txid,
            fee,
            vsize,
            dup: false,
        })
    }

    /// The next block, unsigned: the mempool in order, fees to the challenge,
    /// the claims (SPEC 4, 6) (`siding/lib/chain.mjs buildNext`). A claim pays
    /// the peg's amount to the script the peg-in named, followed by its marker.
    pub fn build_next(&self, next: &NextBlock) -> Result<(F::Block, u64, usize)> {
        let tip = self.tip();
        let height = tip
            .height
            .checked_add(1)
            .ok_or_else(|| Error::Chain("the chain is at the last height".into()))?;
        let time = next.time.max(tip.time.saturating_add(1));
        let txs: Vec<Transaction> = self.mempool.iter().map(|(_, tx)| tx.clone()).collect();
        let fees = txs
            .iter()
            .try_fold(0u64, |s, tx| s.checked_add(self.fees(tx).unwrap_or(0)))
            .ok_or_else(|| Error::Transaction("the mempool's fees overflow".into()))?;
        let mut outputs = Vec::new();
        if fees > 0 {
            outputs.push(TxOut {
                value: Amount::from_sat(fees),
                script_pubkey: self.challenge.clone(),
            });
        }
        for c in &next.claims {
            if self.claimed(&c.txid, c.vout) {
                return Err(Error::Transaction(format!(
                    "{}:{} is already claimed",
                    c.txid, c.vout
                )));
            }
            outputs.push(TxOut {
                value: Amount::from_sat(c.amount),
                script_pubkey: c.script.clone(),
            });
            outputs.push(TxOut {
                value: Amount::ZERO,
                script_pubkey: claim_marker(&c.txid, c.vout),
            });
        }
        let block = build_block(
            &self.family,
            &BlockTemplate {
                height,
                prev: tip.hash,
                time,
                transactions: txs,
                outputs,
                bits: self.bits,
                marker: MARKER.to_string(),
            },
        );
        Ok((block, fees, next.claims.len()))
    }

    /// One signer: build, sign, add (`siding/lib/chain.mjs produce`). Returns
    /// the report and the sealed block, for the caller to write down. A
    /// federated chain is refused: its blocks are sealed by `k` signatures
    /// gathered above this crate and enter through [`StateOf::add_block`].
    pub fn produce(
        &mut self,
        key: &SecretKey,
        next: &NextBlock,
        now: Option<u32>,
    ) -> Result<(Applied, F::Block)> {
        if self.federation.is_some() {
            return Err(Error::Federation(
                "a federated chain makes blocks through the round (proposals/level-2.md), not produce()".into(),
            ));
        }
        let (block, fees, claims) = self.build_next(next)?;
        let signed = sign_block(&self.family, &block, &self.challenge, key, &[0u8; 32])?;
        let mut r = self.add_block(&signed, None, now)?;
        r.fees = fees;
        r.claims = claims;
        Ok((r, signed))
    }
}
