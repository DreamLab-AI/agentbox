//! The chain in memory (SPEC 4, 5, 11): headers and hashes from the genesis
//! up, the UTXO set, the overlay's records, a mempool with the producer's
//! policy, and block production. A port of `siding/lib/chain.mjs` `Siding`
//! and the state-machine half of `bitcoin-blake/blaketestnode`
//! `lib/node.mjs` `ChainNode`, for level 1: one signer, no reorgs.
//!
//! Nothing here touches a file or a clock: [`State`] is fed blocks and told
//! the time. The file-backed [`crate::chain::Chain`] wraps it (feature `std`).
//!
//! A state always holds its genesis. [`State::with_key`] builds and seals it
//! from the document and the signer's key (SPEC 5); [`State::from_genesis`]
//! takes a sealed block 0 and checks it against the document's `genesisHash`,
//! which is how a validator without the key starts.

use std::collections::HashSet;

use bitcoin::block::Header;
use bitcoin::consensus::encode::deserialize;
use bitcoin::hashes::Hash;
use bitcoin::secp256k1::SecretKey;
use bitcoin::{
    Amount, Block, BlockHash, CompactTarget, OutPoint, Script, ScriptBuf, Transaction, TxOut, Txid,
};

use crate::block::{
    block_height, build_block, family_for, sign_block, verify_key_path_input, BlockTemplate,
    HeaderFamily, MARKER,
};
use crate::document::ChainDocument;
use crate::error::{Error, Result};
use crate::marker::{claim_marker, looks_like_pegout, parse_pegout, Burn};
use crate::rules::{
    apply_block, median_time_past, validate_block_context, validate_block_structure,
    validate_header, validate_transaction, BlockRule, Candidate, Coin, HeaderContext, Overlay,
    Params, Records, Utxo, Verdict,
};

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

/// What [`State::submit`] reports.
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

/// A coin as [`State::coins`] lists it.
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

/// The chain in memory.
#[derive(Debug)]
pub struct State {
    doc: ChainDocument,
    family: Box<dyn HeaderFamily>,
    params: Params,
    bits: CompactTarget,
    challenge: ScriptBuf,
    headers: Vec<Header>,
    hashes: Vec<BlockHash>,
    utxo: Utxo,
    records: Records,
    mempool: Vec<(Txid, Transaction)>,
    mempool_spent: HashSet<OutPoint>,
    extra_rules: Vec<Box<dyn BlockRule>>,
}

impl State {
    fn empty(doc: ChainDocument) -> Result<Self> {
        doc.validate()?;
        let family = family_for(doc.family()?)?;
        let bits = doc.bits()?;
        let challenge = doc.challenge_script()?;
        Ok(Self {
            doc,
            family,
            params: Params::default(),
            bits,
            challenge,
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
    pub fn build_genesis_for(doc: &ChainDocument) -> Result<Block> {
        let family = family_for(doc.family()?)?;
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
            family.as_ref(),
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
    pub fn genesis_block_for(doc: &ChainDocument, key: &SecretKey) -> Result<Block> {
        let family = family_for(doc.family()?)?;
        sign_block(
            family.as_ref(),
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

    /// A state at a sealed genesis. The block's hash must be `expect` when
    /// given, and the document's `genesisHash` when the document has one:
    /// this is what a validator refuses to proceed past.
    pub fn from_genesis(
        doc: ChainDocument,
        genesis: &Block,
        expect: Option<BlockHash>,
    ) -> Result<Self> {
        let mut s = Self::empty(doc)?;
        let hash = s.family.block_hash(&genesis.header);
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
        if genesis.txdata.is_empty() {
            return Err(Error::Chain("genesis has no coinbase".into()));
        }
        apply_block(&mut s.utxo, genesis, 0);
        s.headers.push(genesis.header);
        s.hashes.push(hash);
        Ok(s)
    }

    /// Add a block-context rule beyond the core (SPEC 12).
    pub fn add_rule(&mut self, rule: Box<dyn BlockRule>) {
        self.extra_rules.push(rule);
    }

    /// The document.
    pub fn document(&self) -> &ChainDocument {
        &self.doc
    }
    /// The header family.
    pub fn family(&self) -> &dyn HeaderFamily {
        self.family.as_ref()
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
            time: self.headers[h].time,
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
    pub fn header_at(&self, height: u32) -> Option<&Header> {
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
        !coin.coinbase || self.height() + 1 - coin.height >= self.params.coinbase_maturity
    }
    /// A transaction's virtual size: weight over four, rounded up.
    pub fn vsize(tx: &Transaction) -> u64 {
        tx.weight().to_wu().div_ceil(4)
    }
    /// The fee a transaction pays, from the UTXO set; `None` if an input is not a coin.
    pub fn fees(&self, tx: &Transaction) -> Option<u64> {
        let ins = tx
            .input
            .iter()
            .map(|i| {
                self.utxo
                    .get(&i.previous_output)
                    .map(|c| c.output.value.to_sat())
            })
            .sum::<Option<u64>>()?;
        let outs: u64 = tx.output.iter().map(|o| o.value.to_sat()).sum();
        ins.checked_sub(outs)
    }

    /// Validate and apply block `height` (must be the tip plus one)
    /// (`node.mjs applyNext` + `siding/lib/chain.mjs #apply`). `expect` is the
    /// hash a mirror's index promised; `now` is the clock for the future-time
    /// rule (`None` skips it). Every failed rule is named in the error.
    pub fn apply(
        &mut self,
        height: u32,
        block: &Block,
        expect: Option<BlockHash>,
        now: Option<u32>,
    ) -> Result<Applied> {
        let tip = self.tip();
        if height != tip.height + 1 {
            return Err(Error::Chain(format!(
                "apply {height} at height {}",
                tip.height
            )));
        }
        let hash = self.family.block_hash(&block.header);
        if block.header.prev_blockhash != tip.hash {
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
        apply_block(&mut self.utxo, block, height);
        self.records.claims.extend(next.claims);
        self.records.pegouts.extend(next.pegouts);
        self.headers.push(block.header);
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
            txs: block.txdata.len(),
            fees: 0,
            claims: 0,
        })
    }

    /// Every phase's verdict on a candidate for `height`, and the records it
    /// would leave, without applying anything.
    pub fn judge(&self, height: u32, block: &Block, now: Option<u32>) -> (Verdict, Records) {
        let h = height as usize;
        let window = &self.headers[h.saturating_sub(11)..h.min(self.headers.len())];
        let mut verdict = validate_header(
            self.family.as_ref(),
            &self.params,
            &block.header,
            &HeaderContext {
                height,
                prev: self.headers.get(h - 1),
                mtp_window: window,
                now: now.map(|n| n.saturating_add(7_200)),
            },
        );
        let overlay = Overlay {
            challenge: &self.challenge,
            pegout_min: self.doc.pegout_min,
        };
        verdict.extend(validate_block_structure(
            self.family.as_ref(),
            &self.params,
            &overlay,
            block,
        ));
        let mtp = (!window.is_empty()).then(|| median_time_past(window));
        let candidate = Candidate {
            block,
            height,
            utxo: &self.utxo,
            mtp,
            records: &self.records,
            extra: &self.extra_rules,
        };
        let (ctx, _, next) = validate_block_context(&self.params, &overlay, &candidate);
        verdict.extend(ctx);
        (verdict, next)
    }

    /// Accept a block from elsewhere (a mirror): its height read from it,
    /// validated, applied (`siding/lib/chain.mjs addBlock`).
    pub fn add_block(
        &mut self,
        block: &Block,
        expect: Option<BlockHash>,
        now: Option<u32>,
    ) -> Result<Applied> {
        let h = block_height(self.family.as_ref(), block)?;
        self.apply(h, block, expect, now)
    }

    /// [`State::add_block`] from consensus bytes.
    pub fn add_block_bytes(
        &mut self,
        bytes: &[u8],
        expect: Option<BlockHash>,
        now: Option<u32>,
    ) -> Result<Applied> {
        let block: Block = deserialize(bytes).map_err(|e| Error::Encoding(e.to_string()))?;
        self.add_block(&block, expect, now)
    }

    /// SPEC 11: a transaction reaches the producer; it is included when it
    /// validates (`siding/lib/chain.mjs submit`). The mempool's policy, in
    /// order: the transaction rules; every input an unspent, unreserved,
    /// mature coin; outputs at most inputs; a burn well-formed and at least
    /// `pegoutMin` (SPEC 7); the fee at least `minFeeRate` sat/vB; every
    /// input's signature.
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
        let out_sum: u64 = tx.output.iter().map(|o| o.value.to_sat()).sum();
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
        let min_fee = vsize * self.min_fee_rate();
        let fee = in_sum - out_sum;
        if fee < min_fee {
            return refuse(format!(
                "fee {fee} is below the minimum {min_fee} sats ({vsize} vB at {} sat/vB)",
                self.min_fee_rate()
            ));
        }
        for i in 0..tx.input.len() {
            if let Err(e) = verify_key_path_input(&tx, i, &prevouts) {
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
    pub fn build_next(&self, next: &NextBlock) -> Result<(Block, u64, usize)> {
        let tip = self.tip();
        let time = next.time.max(tip.time + 1);
        let txs: Vec<Transaction> = self.mempool.iter().map(|(_, tx)| tx.clone()).collect();
        let fees: u64 = txs.iter().map(|tx| self.fees(tx).unwrap_or(0)).sum();
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
            self.family.as_ref(),
            &BlockTemplate {
                height: tip.height + 1,
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
    /// the report and the sealed block, for the caller to write down.
    pub fn produce(
        &mut self,
        key: &SecretKey,
        next: &NextBlock,
        now: Option<u32>,
    ) -> Result<(Applied, Block)> {
        let (block, fees, claims) = self.build_next(next)?;
        let signed = sign_block(
            self.family.as_ref(),
            &block,
            &self.challenge,
            key,
            &[0u8; 32],
        )?;
        let mut r = self.add_block(&signed, None, now)?;
        r.fees = fees;
        r.claims = claims;
        Ok((r, signed))
    }
}
