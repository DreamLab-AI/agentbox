//! Blocks on a sidestr chain (SPEC 4): building, the block data that is
//! signed, the virtual transactions the challenge is evaluated against, the
//! solution's place in the coinbase, and the height a stock header does not
//! carry. A port of `siding/lib/block.mjs`.
//!
//! A block is a header of the parent's family followed by Bitcoin
//! transactions: Bitcoin's transaction rules are the parent's, so
//! [`bitcoin::Transaction`] serves for every family, and what differs — the
//! header's layout, its proof-of-work hash, whether it carries the height —
//! is behind [`HeaderFamily`]. Beside a stock parent the block *is*
//! [`bitcoin::Block`] ([`Stock`]); beside a BLAKE2b parent it is
//! [`FamilyBlock`] over the 164-byte v2 header that `sidestr-header`
//! implements. Every function here is generic over the family and never asks
//! which one it has.
//!
//! What sidestr adds is in the coinbase: after the witness commitment output's
//! commitment, one push of `ecc7daa2` followed by a serialised script witness
//! that satisfies the chain's `challenge` for the block's *signet hash*,
//! computed as BIP 325 computes it over this chain's header serialisation.
//!
//! ```
//! use sidestr_core::block::{coinbase_height, height_push};
//! use bitcoin::{Transaction, TxIn, ScriptBuf, OutPoint, Sequence, Witness, transaction::Version, absolute::LockTime};
//!
//! let coinbase = |sig: Vec<u8>| Transaction { version: Version::TWO, lock_time: LockTime::ZERO,
//!     input: vec![TxIn { previous_output: OutPoint::null(), script_sig: ScriptBuf::from_bytes(sig), sequence: Sequence::MAX, witness: Witness::new() }],
//!     output: vec![] };
//!
//! // the height push is BIP 34's: little-endian, a padding byte only after a high bit
//! assert_eq!(height_push(0), vec![0x00]);
//! assert_eq!(height_push(128), vec![0x02, 0x80, 0x00]);
//! assert_eq!(coinbase_height(&coinbase([height_push(70_000), vec![0xff]].concat())).unwrap(), 70_000);
//! // and anything that is not a height push is refused, never read as height 0
//! assert!(coinbase_height(&coinbase(vec![])).is_err());
//! assert!(coinbase_height(&coinbase(vec![0x02, 0x05, 0x00])).unwrap_err().to_string().contains("not minimal"));
//! ```

use std::sync::OnceLock;

use bitcoin::block::{Header, Version as HeaderVersion};
use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::hashes::{sha256, sha256d, Hash, HashEngine};
use bitcoin::key::TweakedPublicKey;
use bitcoin::secp256k1::{
    schnorr::Signature, All, Keypair, Message, Secp256k1, SecretKey, XOnlyPublicKey,
};
use bitcoin::sighash::{Annex, Prevouts, SighashCache, TapSighashType};
use bitcoin::taproot::TapLeafHash;
use bitcoin::transaction::Version as TxVersion;
use bitcoin::{
    absolute::LockTime, merkle_tree, Amount, BlockHash, CompactTarget, OutPoint, Script, ScriptBuf,
    Sequence, Target, Transaction, TxIn, TxMerkleNode, TxOut, Txid, Witness, Wtxid,
};

use crate::error::{Error, Result};
use crate::federation::{verify_multi_a_input, MultiA, ScriptPathError};
use crate::parents::Family;
use crate::rules::RuleResult;
use crate::sighash::{verify_taproot_key_path, SighashRules};

/// The four bytes that open the solution push: BIP 325's signet header.
pub const SIGNET_HEADER: [u8; 4] = [0xec, 0xc7, 0xda, 0xa2];
/// The tag every non-genesis coinbase pushes after its height.
pub const MARKER: &str = "sidestr";
/// The six bytes that open a witness commitment output.
const COMMITMENT_PREFIX: [u8; 6] = [0x6a, 0x24, 0xaa, 0x21, 0xa9, 0xed];
/// `OP_RETURN 0x24 aa21a9ed <32-byte commitment>`: the part of the
/// commitment output that is not the solution.
const COMMITMENT_LEN: usize = 38;
/// The most witness items a solution may carry: BIP 341's control block
/// allows 128 branches, so no honest witness comes near this.
const MAX_WITNESS_ITEMS: usize = 256;

/// One shared secp256k1 context for signing and verification.
pub fn secp() -> &'static Secp256k1<All> {
    static SECP: OnceLock<Secp256k1<All>> = OnceLock::new();
    SECP.get_or_init(Secp256k1::new)
}

// --- the header family boundary (SPEC 3, 3.2) ------------------------------------

/// What differs between header families, and nothing else: the header type
/// and its wire codec, the proof-of-work hash, the bytes the block signature
/// commits to, whether the header carries the height, what an unsigned
/// header looks like, the rules the parent's fork adds, and whether Knots'
/// unified sighash applies. The rules, the state and the chain are generic
/// over `F: HeaderFamily` and never ask which one they have.
///
/// `sidestr-core` ships [`Stock`] (parents `btc`, `tbtc4`), whose header is
/// [`bitcoin::block::Header`] and whose block is [`bitcoin::Block`].
/// `sidestr-header` implements this trait for Knots' 164-byte v2 header
/// (parents `xbt`, `txbt4`) with [`FamilyBlock`] as its block; this crate
/// keeps no edge to it.
pub trait HeaderFamily:
    core::fmt::Debug + Copy + Default + PartialEq + Eq + Send + Sync + 'static
{
    /// The header: the parent's layout, decoded.
    type Header: Clone + core::fmt::Debug + PartialEq + Eq + Send + Sync + 'static;
    /// The block: this header followed by the transactions. [`bitcoin::Block`]
    /// for the stock family; [`FamilyBlock`] otherwise.
    type Block: SidestrBlock<Header = Self::Header>;
    /// Which family this is.
    const FAMILY: Family;
    /// The serialised header length: 80 or 164.
    const HEADER_LEN: usize;

    /// Which family this is.
    fn family(&self) -> Family {
        Self::FAMILY
    }
    /// The serialised header length.
    fn header_len(&self) -> usize {
        Self::HEADER_LEN
    }
    /// The header's wire bytes.
    fn encode_header(&self, header: &Self::Header) -> Vec<u8>;
    /// A header from exactly [`Self::HEADER_LEN`] wire bytes.
    fn decode_header(&self, bytes: &[u8]) -> Result<Self::Header>;
    /// The block hash: the parent's proof-of-work hash over the header.
    fn block_hash(&self, header: &Self::Header) -> BlockHash;
    /// The bytes the block signature commits to (SPEC 4): the header's first
    /// 72 bytes, version, prev, merkle root and time on wire — never the nonce,
    /// which is found after signing.
    fn signed_prefix(&self, header: &Self::Header) -> Vec<u8>;
    /// The height the header itself carries, when the family writes it there.
    fn header_height(&self, header: &Self::Header) -> Option<u32>;
    /// An unsigned header on `prev` with this family's version and zero nonce
    /// (`siding/lib/block.mjs buildBlock`). `height` and `tx_count` are for
    /// the families whose header commits to them; the stock header ignores both.
    fn new_header(
        &self,
        prev: BlockHash,
        merkle_root: TxMerkleNode,
        time: u32,
        bits: CompactTarget,
        height: u32,
        tx_count: usize,
    ) -> Self::Header;
    /// The raw wire version word, unsigned.
    fn version(&self, header: &Self::Header) -> u32;
    /// The version as the reference kernel's codec *types* it, which is what
    /// `btc:rule-header-version` compares against the minimum: a stock header's
    /// `version` is `i32le` (`btc:BlockHeader` in `schema/core.jsonld`), so a
    /// word with bit 31 set is negative and fails `version >= 1`; a Knots v2
    /// header's is `u32le` (`schema/overlays/knots-blake2b.jsonld`), so its
    /// mandatory bit 31 does not. Every family states this itself — there is
    /// no default — so a typed header cannot reach the rule with the wrong
    /// sign.
    fn version_number(&self, header: &Self::Header) -> i64;
    /// The previous block's hash.
    fn prev(&self, header: &Self::Header) -> BlockHash;
    /// The merkle root.
    fn merkle_root(&self, header: &Self::Header) -> TxMerkleNode;
    /// The consensus time: for a v2 header, the wire time with its offset applied.
    fn time(&self, header: &Self::Header) -> u32;
    /// The compact target.
    fn bits(&self, header: &Self::Header) -> CompactTarget;
    /// The (first) nonce.
    fn nonce(&self, header: &Self::Header) -> u32;
    /// Replace the merkle root; [`seal_block`] does so once the solution is in.
    fn set_merkle_root(&self, header: &mut Self::Header, root: TxMerkleNode);
    /// Replace the nonce; [`seal_block`] grinds it.
    fn set_nonce(&self, header: &mut Self::Header, nonce: u32);
    /// The header rules the parent's fork adds beyond Bitcoin's (the Knots
    /// overlay's `knots:rule-header-*`), judged for a header at `height`. None
    /// for the stock family.
    fn header_rules(&self, header: &Self::Header, height: u32) -> Vec<RuleResult> {
        let _ = (header, height);
        Vec::new()
    }
    /// The block rules the parent's fork adds (`knots:rule-block-txcount`),
    /// given the header and the block's transaction count.
    fn block_rules(&self, header: &Self::Header, tx_count: usize) -> Vec<RuleResult> {
        let _ = (header, tx_count);
        Vec::new()
    }
    /// The signature-hash rules a spend at `height` is judged by: BIP 341 on a
    /// stock chain; Knots' unified opt-in sighash from the fork height on a
    /// BLAKE2b chain, which for a sidestr chain is height 0
    /// (`siding/lib/overlay.mjs`: `unifiedSighashParam: 'blake2bHeight'`,
    /// `blake2bHeight: 0`).
    fn sighash_rules(&self, height: u32) -> SighashRules {
        let _ = height;
        SighashRules::Bip341
    }
}

/// What the rules need of a block, whatever its header: the header, the
/// transactions and the wire codec. Implemented by [`bitcoin::Block`] for the
/// stock family and by [`FamilyBlock`] for any other. The functions that do
/// not touch the header — the solution, the commitment output — are generic
/// over this trait alone, so `&bitcoin::Block` needs no annotation.
pub trait SidestrBlock:
    Clone + core::fmt::Debug + PartialEq + Eq + Send + Sync + Sized + 'static
{
    /// The header type.
    type Header;
    /// A block from its parts.
    fn from_parts(header: Self::Header, txdata: Vec<Transaction>) -> Self;
    /// The header.
    fn header(&self) -> &Self::Header;
    /// The header, to seal.
    fn header_mut(&mut self) -> &mut Self::Header;
    /// The transactions, coinbase first.
    fn txdata(&self) -> &[Transaction];
    /// The transactions, to build.
    fn txdata_mut(&mut self) -> &mut Vec<Transaction>;
    /// The consensus bytes: header, then the transaction vector.
    fn encode(&self) -> Vec<u8>;
    /// A block from its consensus bytes, all of them.
    fn decode(bytes: &[u8]) -> Result<Self>;
}

/// Version bit 31: the kernel's `VERSION_HEADER_V2_FLAG`
/// (`codec/pow/knots-header-v2.js`), set on every Knots v2 header and never
/// on a stock one. A stock header carrying it is not a stock header:
/// [`Stock::decode_header`] refuses it, and on the typed path
/// `btc:rule-header-version` does, because the kernel reads a stock version
/// as `i32le` and the word is negative.
pub const VERSION_HEADER_V2_FLAG: u32 = 0x8000_0000;

/// The stock 80-byte Bitcoin header, hashed with double SHA-256 (parents
/// `btc` and `tbtc4`). Version `0x20000000`, bit 31 clear, so a Knots node
/// never mistakes it for a v2 header. The stock header does not carry the
/// height, so beside a stock parent the coinbase is the only place the
/// height is written ([`coinbase_height`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stock;

/// [`Error::Encoding`] for a stock header whose version has bit 31 set.
fn stock_bit31(header: &Header) -> Result<()> {
    if header.version.to_consensus() as u32 & VERSION_HEADER_V2_FLAG != 0 {
        return Err(Error::Encoding(format!(
            "stock header: version {:#010x} has bit 31 set (VERSION_HEADER_V2_FLAG): not a stock header",
            header.version.to_consensus() as u32
        )));
    }
    Ok(())
}

impl HeaderFamily for Stock {
    type Header = Header;
    type Block = bitcoin::Block;
    const FAMILY: Family = Family::Stock;
    const HEADER_LEN: usize = 80;

    fn encode_header(&self, header: &Header) -> Vec<u8> {
        serialize(header)
    }
    /// Exactly 80 bytes with bit 31 of the version clear; a set bit 31 is
    /// refused as the kernel's `structVariants` would select the v2 layout
    /// for it (and as `sidestr-header`'s `StockHeader::decode` refuses it).
    fn decode_header(&self, bytes: &[u8]) -> Result<Header> {
        let header: Header =
            deserialize(bytes).map_err(|e| Error::Encoding(format!("stock header: {e}")))?;
        stock_bit31(&header)?;
        Ok(header)
    }
    fn block_hash(&self, header: &Header) -> BlockHash {
        header.block_hash()
    }
    fn signed_prefix(&self, header: &Header) -> Vec<u8> {
        serialize(header)[..72].to_vec()
    }
    fn header_height(&self, _header: &Header) -> Option<u32> {
        None
    }
    fn new_header(
        &self,
        prev: BlockHash,
        merkle_root: TxMerkleNode,
        time: u32,
        bits: CompactTarget,
        _height: u32,
        _tx_count: usize,
    ) -> Header {
        Header {
            version: HeaderVersion::from_consensus(0x2000_0000),
            prev_blockhash: prev,
            merkle_root,
            time,
            bits,
            nonce: 0,
        }
    }
    fn version(&self, header: &Header) -> u32 {
        header.version.to_consensus() as u32
    }
    /// `i32le`: bit 31 set reads as a negative version.
    fn version_number(&self, header: &Header) -> i64 {
        i64::from(header.version.to_consensus())
    }
    fn prev(&self, header: &Header) -> BlockHash {
        header.prev_blockhash
    }
    fn merkle_root(&self, header: &Header) -> TxMerkleNode {
        header.merkle_root
    }
    fn time(&self, header: &Header) -> u32 {
        header.time
    }
    fn bits(&self, header: &Header) -> CompactTarget {
        header.bits
    }
    fn nonce(&self, header: &Header) -> u32 {
        header.nonce
    }
    fn set_merkle_root(&self, header: &mut Header, root: TxMerkleNode) {
        header.merkle_root = root;
    }
    fn set_nonce(&self, header: &mut Header, nonce: u32) {
        header.nonce = nonce;
    }
}

impl SidestrBlock for bitcoin::Block {
    type Header = Header;
    fn from_parts(header: Header, txdata: Vec<Transaction>) -> Self {
        bitcoin::Block { header, txdata }
    }
    fn header(&self) -> &Header {
        &self.header
    }
    fn header_mut(&mut self) -> &mut Header {
        &mut self.header
    }
    fn txdata(&self) -> &[Transaction] {
        &self.txdata
    }
    fn txdata_mut(&mut self) -> &mut Vec<Transaction> {
        &mut self.txdata
    }
    fn encode(&self) -> Vec<u8> {
        serialize(self)
    }
    /// The consensus bytes of a stock block; a header with bit 31 set is
    /// refused here as [`Stock::decode_header`] refuses it.
    fn decode(bytes: &[u8]) -> Result<Self> {
        let block: bitcoin::Block =
            deserialize(bytes).map_err(|e| Error::Encoding(e.to_string()))?;
        stock_bit31(&block.header)?;
        Ok(block)
    }
}

/// The stock block: [`bitcoin::Block`].
pub type Block = <Stock as HeaderFamily>::Block;

/// A block of any family: its header followed by the transactions, on the
/// wire as `header ‖ CompactSize(n) ‖ tx…`, exactly as a Bitcoin block is
/// laid out with the family's header in place of the 80-byte one. The block
/// type of every family but [`Stock`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FamilyBlock<F: HeaderFamily> {
    /// The header.
    pub header: F::Header,
    /// The transactions, coinbase first.
    pub txdata: Vec<Transaction>,
    /// The family marker, so the derives bound `F` and not only `F::Header`.
    family: F,
}

impl<F: HeaderFamily> SidestrBlock for FamilyBlock<F> {
    type Header = F::Header;
    fn from_parts(header: F::Header, txdata: Vec<Transaction>) -> Self {
        FamilyBlock {
            header,
            txdata,
            family: F::default(),
        }
    }
    fn header(&self) -> &F::Header {
        &self.header
    }
    fn header_mut(&mut self) -> &mut F::Header {
        &mut self.header
    }
    fn txdata(&self) -> &[Transaction] {
        &self.txdata
    }
    fn txdata_mut(&mut self) -> &mut Vec<Transaction> {
        &mut self.txdata
    }
    fn encode(&self) -> Vec<u8> {
        let mut out = F::default().encode_header(&self.header);
        out.extend(serialize(&self.txdata));
        out
    }
    fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < F::HEADER_LEN {
            return Err(Error::Encoding(format!(
                "block of {} bytes is shorter than a {} header",
                bytes.len(),
                F::HEADER_LEN
            )));
        }
        let header = F::default().decode_header(&bytes[..F::HEADER_LEN])?;
        let txdata: Vec<Transaction> =
            deserialize(&bytes[F::HEADER_LEN..]).map_err(|e| Error::Encoding(e.to_string()))?;
        Ok(FamilyBlock {
            header,
            txdata,
            family: F::default(),
        })
    }
}

/// The block's weight as the reference kernel computes it (`blocks.js
/// blockWeight`): three times the legacy size plus the total size, the
/// family's header length counted in both. Equals [`bitcoin::Block::weight`]
/// for the stock family.
pub fn block_weight<F: HeaderFamily>(family: &F, block: &F::Block) -> u64 {
    let n = block.txdata().len();
    let varint = match n {
        0..=0xfc => 1,
        0xfd..=0xffff => 3,
        _ => 5,
    };
    let fixed = (family.header_len() as u64).saturating_add(varint);
    let legacy = block
        .txdata()
        .iter()
        .fold(fixed, |n, tx| n.saturating_add(tx.base_size() as u64));
    let total = block
        .txdata()
        .iter()
        .fold(fixed, |n, tx| n.saturating_add(tx.total_size() as u64));
    legacy.saturating_mul(3).saturating_add(total)
}

/// The merkle root over these transactions' txids; all zeros for none.
pub fn merkle_root_of_txs(txdata: &[Transaction]) -> TxMerkleNode {
    merkle_root_of(txdata.iter().map(Transaction::compute_txid))
}

/// The witness merkle root: the coinbase's wtxid taken as all zeros, then
/// every other transaction's wtxid. What the witness commitment hashes.
pub fn witness_root_of_txs(txdata: &[Transaction]) -> [u8; 32] {
    merkle_tree::calculate_root(
        std::iter::once(Wtxid::all_zeros())
            .chain(txdata.iter().skip(1).map(Transaction::compute_wtxid)),
    )
    .map(|h| h.to_byte_array())
    .unwrap_or([0u8; 32])
}

// --- the witness carried in the solution --------------------------------------

fn compact_size(n: usize) -> Vec<u8> {
    match n {
        0..=0xfc => vec![n as u8],
        0xfd..=0xffff => vec![0xfd, (n & 0xff) as u8, (n >> 8) as u8],
        _ => vec![
            0xfe,
            (n & 0xff) as u8,
            ((n >> 8) & 0xff) as u8,
            ((n >> 16) & 0xff) as u8,
            ((n >> 24) & 0xff) as u8,
        ],
    }
}

/// A CompactSize at `i`, minimal: `0xfd` must encode at least 0xfd, `0xfe` at
/// least 0x10000. `None` when the bytes run out, are not minimal, or use the
/// 8-byte form no witness item needs.
fn read_compact(b: &[u8], i: usize) -> Option<(usize, usize)> {
    let first = *b.get(i)?;
    match first {
        0..=0xfc => Some((usize::from(first), i + 1)),
        0xfd => {
            let n = usize::from(*b.get(i + 1)?) | usize::from(*b.get(i + 2)?) << 8;
            (n >= 0xfd).then_some((n, i + 3))
        }
        0xfe => {
            let n = usize::from(*b.get(i + 1)?)
                | usize::from(*b.get(i + 2)?) << 8
                | usize::from(*b.get(i + 3)?) << 16
                | usize::from(*b.get(i + 4)?) << 24;
            (n >= 0x1_0000).then_some((n, i + 5))
        }
        _ => None,
    }
}

/// A serialised script witness: the item count, then each item length-prefixed
/// (`siding/lib/block.mjs encodeWitness`).
pub fn encode_witness(items: &[Vec<u8>]) -> Vec<u8> {
    let mut out = compact_size(items.len());
    for it in items {
        out.extend(compact_size(it.len()));
        out.extend_from_slice(it);
    }
    out
}

/// The inverse of [`encode_witness`], strictly: `None` when the bytes run
/// out, when a CompactSize is not minimal, when more than 256 items are
/// announced, or when bytes remain after the last item. The reference
/// decoder is lenient on all four; a solution is consensus data, so this
/// one is not.
pub fn decode_witness(bytes: &[u8]) -> Option<Vec<Vec<u8>>> {
    let (n, mut i) = read_compact(bytes, 0)?;
    if n > MAX_WITNESS_ITEMS {
        return None;
    }
    let mut items = Vec::with_capacity(n);
    for _ in 0..n {
        let (len, at) = read_compact(bytes, i)?;
        let end = at.checked_add(len)?;
        items.push(bytes.get(at..end)?.to_vec());
        i = end;
    }
    (i == bytes.len()).then_some(items)
}

/// The coinbase output carrying the witness commitment: the last one whose
/// script starts `OP_RETURN 0x24 aa21a9ed` and is at least 38 bytes
/// (`siding/lib/block.mjs commitmentOutput`). The solution push follows it.
pub fn commitment_output<B: SidestrBlock>(block: &B) -> Option<(usize, &Script)> {
    commitment_output_of(block.txdata().first()?)
}

fn commitment_output_of(cb: &Transaction) -> Option<(usize, &Script)> {
    cb.output
        .iter()
        .enumerate()
        .rev()
        .find(|(_, o)| {
            o.script_pubkey.len() >= COMMITMENT_LEN
                && o.script_pubkey.as_bytes().starts_with(&COMMITMENT_PREFIX)
        })
        .map(|(i, o)| (i, o.script_pubkey.as_script()))
}

/// The solution a block carries: the witness items after `ecc7daa2`, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Solution {
    /// The script witness that must satisfy the challenge.
    pub witness: Vec<Vec<u8>>,
    /// Index of the commitment output in the coinbase.
    pub index: usize,
}

/// The block's solution, or `None` when the commitment output carries no
/// well-formed one (`siding/lib/block.mjs solutionOf`). One push, direct
/// (≤ 75 bytes), `OP_PUSHDATA1` (≤ 255) or `OP_PUSHDATA2` (≤ 65535) as the
/// size needs (SPEC 4); it must start with the signet header.
pub fn solution_of<B: SidestrBlock>(block: &B) -> Option<Solution> {
    let (index, spk) = commitment_output(block)?;
    let rest = &spk.as_bytes()[COMMITMENT_LEN..];
    if rest.is_empty() {
        return None;
    }
    let (n, at) = match rest[0] {
        1..=75 => (usize::from(rest[0]), 1),
        0x4c if rest.len() >= 2 => (usize::from(rest[1]), 2),
        0x4d if rest.len() >= 3 => (usize::from(rest[1]) | usize::from(rest[2]) << 8, 3),
        _ => return None,
    };
    if n == 0 || rest.len() != at + n {
        return None;
    }
    let push = &rest[at..];
    let body = push.strip_prefix(&SIGNET_HEADER)?;
    Some(Solution {
        witness: decode_witness(body)?,
        index,
    })
}

/// The block with this witness as its solution (`siding/lib/block.mjs
/// withSolution`): the commitment output's script becomes the 38-byte
/// commitment, then one push of `ecc7daa2` and the serialised witness. The
/// merkle root is not recomputed here; [`seal_block`] does that.
pub fn with_solution<B: SidestrBlock>(block: &B, witness_items: &[Vec<u8>]) -> Result<B> {
    let (index, spk) = commitment_output(block)
        .ok_or_else(|| Error::Block("no witness commitment output to carry the solution".into()))?;
    let mut push = SIGNET_HEADER.to_vec();
    push.extend(encode_witness(witness_items));
    let len = push.len();
    let op: Vec<u8> = match len {
        0..=75 => vec![len as u8],
        76..=255 => vec![0x4c, len as u8],
        256..=65535 => vec![0x4d, (len & 0xff) as u8, (len >> 8) as u8],
        _ => return Err(Error::Block("solution too long for one push".into())),
    };
    let mut script = spk.as_bytes()[..COMMITMENT_LEN].to_vec();
    script.extend(op);
    script.extend(push);
    let mut out = block.clone();
    out.txdata_mut()[0].output[index].script_pubkey = ScriptBuf::from_bytes(script);
    Ok(out)
}

/// The coinbase with the solution stripped: the commitment output cut back
/// to its 38 bytes. What the merkle root is computed over for signing.
fn stripped_coinbase(txdata: &[Transaction]) -> Transaction {
    let mut cb = txdata[0].clone();
    if let Some((i, spk)) = commitment_output_of(&txdata[0]) {
        cb.output[i].script_pubkey =
            ScriptBuf::from_bytes(spk.as_bytes()[..COMMITMENT_LEN].to_vec());
    }
    cb
}

fn merkle_root_of(txids: impl Iterator<Item = Txid>) -> TxMerkleNode {
    merkle_tree::calculate_root(txids)
        .map(TxMerkleNode::from)
        .unwrap_or_else(TxMerkleNode::all_zeros)
}

/// SPEC 4: the block data is SHA-256 of the header's first 72 bytes (version,
/// prev, merkle root, time on wire) with the merkle root recomputed over the
/// coinbase stripped of its solution (`siding/lib/block.mjs blockData`).
///
/// This is what a block signature commits to, and so what sealing may not
/// change: [`seal_block`] rewrites the coinbase's solution push (stripped
/// here), the merkle root (recomputed here) and the nonce (outside the
/// first 72 bytes). Every other header field — and on a v2 header the
/// committed height, transaction count and the rest of the 164 bytes — is
/// fixed before signing and only reachable through the merkle root.
pub fn block_data<F: HeaderFamily>(family: &F, block: &F::Block) -> [u8; 32] {
    let txdata = block.txdata();
    let cb = stripped_coinbase(txdata);
    let root = merkle_root_of(
        std::iter::once(cb.compute_txid())
            .chain(txdata.iter().skip(1).map(Transaction::compute_txid)),
    );
    let mut header = block.header().clone();
    family.set_merkle_root(&mut header, root);
    sha256::Hash::hash(&family.signed_prefix(&header)).to_byte_array()
}

/// BIP 325's shape (`siding/lib/block.mjs virtualTxs`): a virtual output
/// paying the challenge, spent by a virtual transaction whose input carries
/// the solution; the block data sits in `to_spend`'s scriptSig.
#[derive(Debug, Clone)]
pub struct VirtualTxs {
    /// Version 0, one null input whose scriptSig is `OP_0 <block data>`, one output paying the challenge.
    pub to_spend: Transaction,
    /// Version 0, spends `to_spend:0` with the solution as its witness, one `OP_RETURN` output.
    pub to_sign: Transaction,
    /// The output `to_sign` spends: value 0, the challenge.
    pub prevout: TxOut,
}

/// The virtual transactions for block data `data`, with `witness` as the
/// solution (empty for signing).
pub fn virtual_txs(data: &[u8; 32], challenge: &Script, witness: &[Vec<u8>]) -> VirtualTxs {
    let mut script_sig = vec![0x00, 0x20];
    script_sig.extend_from_slice(data);
    let to_spend = Transaction {
        version: TxVersion(0),
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint::null(),
            script_sig: ScriptBuf::from_bytes(script_sig),
            sequence: Sequence::ZERO,
            witness: Witness::new(),
        }],
        output: vec![TxOut {
            value: Amount::ZERO,
            script_pubkey: challenge.to_owned(),
        }],
    };
    let prevout = TxOut {
        value: Amount::ZERO,
        script_pubkey: challenge.to_owned(),
    };
    let to_sign = Transaction {
        version: TxVersion(0),
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid: to_spend.compute_txid(),
                vout: 0,
            },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::ZERO,
            witness: Witness::from_slice(witness),
        }],
        output: vec![TxOut {
            value: Amount::ZERO,
            script_pubkey: ScriptBuf::from_bytes(vec![0x6a]),
        }],
    };
    VirtualTxs {
        to_spend,
        to_sign,
        prevout,
    }
}

// --- height -------------------------------------------------------------------

/// The BIP 34 height push for a coinbase (`siding/lib/block.mjs heightPush`):
/// the height little-endian with a padding byte only after a high bit, as one
/// length-prefixed push; `OP_0` for height 0.
pub fn height_push(height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut n = height;
    while n > 0 {
        out.push((n & 0xff) as u8);
        n >>= 8;
    }
    if out.last().is_some_and(|b| b & 0x80 != 0) {
        out.push(0);
    }
    if out.is_empty() {
        return vec![0x00];
    }
    let mut push = vec![out.len() as u8];
    push.extend(out);
    push
}

/// The height a coinbase scriptSig pushes first (BIP 34): the inverse of
/// [`height_push`] (`siding/lib/block.mjs coinbaseHeight`). A scriptSig that
/// does not start with a height push is refused, never read as height 0:
/// beside a stock parent the coinbase is the only place the height is
/// written. `OP_0` and `OP_1`..`OP_16` are read as 0 and 1..16; a
/// length-prefixed push must be minimal and non-negative.
pub fn coinbase_height(coinbase: &Transaction) -> Result<u32> {
    let sig = coinbase
        .input
        .first()
        .map(|i| i.script_sig.as_bytes())
        .unwrap_or(&[]);
    let bad = |m: &str| Err(Error::CoinbaseHeight(m.into()));
    if sig.is_empty() {
        return bad("coinbase scriptSig is not a hex script");
    }
    let n = usize::from(sig[0]);
    if n == 0 {
        return Ok(0);
    }
    if (0x51..=0x60).contains(&n) {
        return Ok((n - 0x50) as u32);
    }
    if n > 75 || sig.len() < 1 + n {
        return bad("coinbase scriptSig does not start with a height push");
    }
    if n > 1 && sig[n] == 0 && sig[n - 1] & 0x80 == 0 {
        return bad("coinbase height push is not minimal");
    }
    if sig[n] & 0x80 != 0 {
        return bad("coinbase height push is negative");
    }
    if n > 5 {
        return bad("coinbase height push is too long for a height");
    }
    let h = (1..=n).rev().fold(0u64, |h, i| h * 256 + u64::from(sig[i]));
    u32::try_from(h)
        .map_err(|_| Error::CoinbaseHeight("coinbase height push is too long for a height".into()))
}

/// A block's height: the v2 header carries it; the stock header does not, so
/// the coinbase says (`siding/lib/block.mjs blockHeight`).
pub fn block_height<F: HeaderFamily>(family: &F, block: &F::Block) -> Result<u32> {
    match family.header_height(block.header()) {
        Some(h) => Ok(h),
        None => coinbase_height(
            block
                .txdata()
                .first()
                .ok_or_else(|| Error::CoinbaseHeight("block has no coinbase".into()))?,
        ),
    }
}

// --- building ---------------------------------------------------------------------

/// What [`build_block`] needs: the unsigned block's inputs.
#[derive(Debug, Clone)]
pub struct BlockTemplate {
    /// The block's height; the coinbase pushes it, and a v2 header commits to it.
    pub height: u32,
    /// The previous block's hash (all zeros for the genesis).
    pub prev: BlockHash,
    /// The header time.
    pub time: u32,
    /// The transactions after the coinbase, in order.
    pub transactions: Vec<Transaction>,
    /// The coinbase's outputs before the witness commitment: fees, claims, pegs.
    pub outputs: Vec<TxOut>,
    /// The compact target every block carries (`powLimit`, SPEC 3).
    pub bits: CompactTarget,
    /// The tag pushed after the height: [`MARKER`], or `sidestr genesis <id>` for block 0.
    pub marker: String,
}

/// The witness commitment for these non-coinbase transactions: SHA256d of
/// the witness merkle root (coinbase wtxid all zeros) and a 32-zero reserved
/// value. The coinbase output carrying it is `OP_RETURN 0x24 aa21a9ed` + this.
pub fn witness_commitment(transactions: &[Transaction]) -> [u8; 32] {
    let root = merkle_tree::calculate_root(
        std::iter::once(Wtxid::all_zeros())
            .chain(transactions.iter().map(Transaction::compute_wtxid)),
    )
    .map(|h| h.to_byte_array())
    .unwrap_or([0u8; 32]);
    let mut cat = [0u8; 64];
    cat[..32].copy_from_slice(&root);
    sha256d::Hash::hash(&cat).to_byte_array()
}

/// An unsigned block on `prev` with these transactions (`siding/lib/block.mjs
/// buildBlock`). Outputs: the template's, then the witness commitment; the
/// solution is appended by [`sign_block`] or [`seal_block`]. The header's
/// shape follows the parent's family (SPEC 3.2): the stock 80-byte header,
/// version with bit 31 clear, beside stock Bitcoin; the 164-byte v2 header
/// with its height and transaction count beside a BLAKE2b parent.
pub fn build_block<F: HeaderFamily>(family: &F, t: &BlockTemplate) -> F::Block {
    let commitment = witness_commitment(&t.transactions);
    let mut commitment_spk = COMMITMENT_PREFIX.to_vec();
    commitment_spk.extend_from_slice(&commitment);
    let tag = t.marker.as_bytes();
    let mut script_sig = height_push(t.height);
    script_sig.push(tag.len() as u8);
    script_sig.extend_from_slice(tag);
    let mut outputs = t.outputs.clone();
    outputs.push(TxOut {
        value: Amount::ZERO,
        script_pubkey: ScriptBuf::from_bytes(commitment_spk),
    });
    let coinbase = Transaction {
        version: TxVersion::TWO,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint::null(),
            script_sig: ScriptBuf::from_bytes(script_sig),
            sequence: Sequence::MAX,
            witness: Witness::from_slice(&[[0u8; 32]]),
        }],
        output: outputs,
    };
    let mut txdata = Vec::with_capacity(t.transactions.len() + 1);
    txdata.push(coinbase);
    txdata.extend(t.transactions.iter().cloned());
    let merkle_root = merkle_root_of_txs(&txdata);
    let header = family.new_header(t.prev, merkle_root, t.time, t.bits, t.height, txdata.len());
    F::Block::from_parts(header, txdata)
}

// --- signing and sealing ----------------------------------------------------------

/// Which taproot path a block signature is for: the key path (level 1, one
/// signer whose key *is* the output key) or a leaf of the challenge (level 2,
/// the federation's `multi_a` leaf). The review of ADR-2101 asked for this to
/// be typed rather than an optional leaf hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpendPath<'a> {
    /// BIP 341 key path: no leaf, no annex.
    KeyPath,
    /// BIP 342 script path: the leaf being executed, the annex if any, and
    /// the position of the last executed `OP_CODESEPARATOR` (`0xffffffff`
    /// for none).
    ScriptPath {
        /// The TapLeaf hash.
        leaf_hash: TapLeafHash,
        /// The annex, without its `0x50` prefix stripped: the whole item.
        annex: Option<&'a [u8]>,
        /// The code-separator position.
        codesep_pos: u32,
    },
}

/// What a block signature signs (`siding/lib/block.mjs blockSigHash`): the
/// taproot sighash of the virtual transaction, `SIGHASH_DEFAULT`, for the
/// key path (level 1) or for a leaf of the challenge (level 2).
pub fn block_sighash_for<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    challenge: &Script,
    path: &SpendPath,
) -> Result<[u8; 32]> {
    let data = block_data(family, block);
    let v = virtual_txs(&data, challenge, &[]);
    let mut cache = SighashCache::new(&v.to_sign);
    let prevouts = [v.prevout];
    let msg = match *path {
        SpendPath::KeyPath => cache
            .taproot_key_spend_signature_hash(0, &Prevouts::All(&prevouts), TapSighashType::Default)
            .map_err(|e| Error::Block(e.to_string()))?,
        SpendPath::ScriptPath {
            leaf_hash,
            annex,
            codesep_pos,
        } => {
            let annex = annex
                .map(Annex::new)
                .transpose()
                .map_err(|_| Error::Block("bad annex".into()))?;
            cache
                .taproot_signature_hash(
                    0,
                    &Prevouts::All(&prevouts),
                    annex,
                    Some((leaf_hash, codesep_pos)),
                    TapSighashType::Default,
                )
                .map_err(|e| Error::Block(e.to_string()))?
        }
    };
    Ok(msg.to_byte_array())
}

/// [`block_sighash_for`] on the key path: what a level-1 signer signs.
pub fn block_sighash<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    challenge: &Script,
) -> Result<[u8; 32]> {
    block_sighash_for(family, block, challenge, &SpendPath::KeyPath)
}

/// The identity of a block *template* — what a federation's signers
/// authorise — as distinct from the sealed block's hash. A tagged hash
/// (`sidestr/template-id`) over the chain scope (id and genesis hash), the
/// height, the previous hash and SHA-256 of the block encoded **with its
/// solution stripped and its nonce zeroed**, so the same value comes out
/// before and after sealing.
///
/// Why the two identities differ: [`seal_block`] rewrites the coinbase's
/// solution push, recomputes the merkle root and grinds the nonce, so the
/// sealed hash depends on *which* `k` signatures went in and on the nonce
/// found; the same template sealed by two valid subsets has two hashes.
/// Consensus above the signature therefore decides the template first (this
/// id) and the exact sealed hash second (ADR-2101, review §4).
pub fn template_id<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    chain_id: &str,
    genesis_hash: Option<BlockHash>,
) -> Result<[u8; 32]> {
    let mut t = block.clone();
    if let Some((i, spk)) = commitment_output(&t).map(|(i, s)| (i, s.to_owned())) {
        t.txdata_mut()[0].output[i].script_pubkey =
            ScriptBuf::from_bytes(spk.as_bytes()[..COMMITMENT_LEN].to_vec());
    }
    let root = merkle_root_of_txs(t.txdata());
    family.set_merkle_root(t.header_mut(), root);
    family.set_nonce(t.header_mut(), 0);
    let height = block_height(family, block)?;
    let tag = sha256::Hash::hash(b"sidestr/template-id").to_byte_array();
    let mut e = sha256::Hash::engine();
    e.input(&tag);
    e.input(&tag);
    e.input(&compact_size(chain_id.len()));
    e.input(chain_id.as_bytes());
    e.input(
        &genesis_hash
            .unwrap_or_else(BlockHash::all_zeros)
            .to_byte_array(),
    );
    e.input(&height.to_le_bytes());
    e.input(&family.prev(block.header()).to_byte_array());
    e.input(&sha256::Hash::hash(&t.encode()).to_byte_array());
    Ok(sha256::Hash::from_engine(e).to_byte_array())
}

/// The block with its witness in place (`siding/lib/block.mjs sealBlock`):
/// the solution appended, the merkle root recomputed, the header nonce found
/// for the block's `bits`. Any path that produced the witness — one key, a
/// federation's round — ends here.
pub fn seal_block<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    witness_items: &[Vec<u8>],
) -> Result<F::Block> {
    let mut sealed = with_solution(block, witness_items)?;
    let root = merkle_root_of_txs(sealed.txdata());
    family.set_merkle_root(sealed.header_mut(), root);
    let target = Target::from_compact(family.bits(sealed.header()));
    for nonce in 0..=u32::MAX {
        family.set_nonce(sealed.header_mut(), nonce);
        if target.is_met_by(family.block_hash(sealed.header())) {
            return Ok(sealed);
        }
    }
    Err(Error::Block("no nonce meets the target".into()))
}

/// Sign with the challenge key (`siding/lib/block.mjs signBlock`): key path,
/// no tweak, the challenge is `5120‖pubkey`; then satisfy the proof of work.
/// `aux` is BIP 340's auxiliary randomness: siding passes 32 zero bytes for
/// the genesis so it is reproducible from the document, and this crate
/// passes zeros everywhere, so a block is a pure function of its inputs and
/// the key. The key must be the one the challenge names.
pub fn sign_block<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    challenge: &Script,
    key: &SecretKey,
    aux: &[u8; 32],
) -> Result<F::Block> {
    let keypair = Keypair::from_secret_key(secp(), key);
    let (xonly, _) = keypair.x_only_public_key();
    let expected = [&[0x51, 0x20][..], &xonly.serialize()].concat();
    if challenge.as_bytes() != expected.as_slice() {
        return Err(Error::Block(
            "the key is not the chain's signer: the challenge names another key".into(),
        ));
    }
    let msg = block_sighash(family, block, challenge)?;
    let sig = secp().sign_schnorr_with_aux_rand(&Message::from_digest(msg), &keypair, aux);
    seal_block(family, block, &[sig.serialize().to_vec()])
}

/// How a block's solution satisfied the challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockSolution {
    /// One key-path signature: level 1.
    KeyPath,
    /// The federation's `multi_a` leaf, with which slots signed: level 2.
    ScriptPath(MultiA),
}

/// Why a block's solution was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SolutionError {
    /// No well-formed solution push in the commitment output.
    #[error("no solution")]
    NoSolution,
    /// One witness item: judged as a key-path spend, and refused.
    #[error("key path: {0}")]
    KeyPath(&'static str),
    /// Several witness items: judged as the `multi_a` script path, and refused.
    #[error("script path: {0}")]
    ScriptPath(#[from] ScriptPathError),
}

/// The block's solution judged against the challenge for its block data
/// (SPEC 4, `sidestr:rule-block-signature` in `siding/lib/overlay.mjs`): the
/// solution is read, the virtual transaction built with it as witness, and
/// its one input verified as a taproot spend — the key path when the witness
/// is one signature (plus an annex), the `multi_a` script path when it is
/// slots, a leaf and a control block ([`crate::federation::verify_multi_a_input`]).
/// Any other shape is refused by name; there is no general interpreter. The
/// block signature is judged under BIP 341 on every family: the reference's
/// rule verifies it without the unified-sighash option.
pub fn verify_block_solution<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    challenge: &Script,
) -> core::result::Result<BlockSolution, SolutionError> {
    let sol = solution_of(block).ok_or(SolutionError::NoSolution)?;
    let data = block_data(family, block);
    let v = virtual_txs(&data, challenge, &sol.witness);
    let prevouts = [v.prevout];
    let items = sol.witness.len();
    let has_annex = items >= 2 && sol.witness[items - 1].first() == Some(&0x50);
    if items - usize::from(has_annex) <= 1 {
        verify_key_path_input(&v.to_sign, 0, &prevouts)
            .map(|()| BlockSolution::KeyPath)
            .map_err(SolutionError::KeyPath)
    } else {
        verify_multi_a_input(&v.to_sign, 0, &prevouts)
            .map(BlockSolution::ScriptPath)
            .map_err(SolutionError::ScriptPath)
    }
}

/// Whether the block's solution satisfies the challenge: [`verify_block_solution`] as a bool.
pub fn verify_block_signature<F: HeaderFamily>(
    family: &F,
    block: &F::Block,
    challenge: &Script,
) -> bool {
    verify_block_solution(family, block, challenge).is_ok()
}

/// Verify one input as a BIP 341 taproot key-path spend: one Schnorr
/// signature over the taproot sighash, 64 bytes for `SIGHASH_DEFAULT` or 65
/// with an explicit type, an annex allowed. Any other script type, and the
/// taproot script path, is refused rather than skipped — where the reference
/// kernel reports "unverifiable" and lets the block through, this crate fails
/// closed. This is the stock-chain reading; a spend on a BLAKE2b chain goes
/// through [`verify_taproot_key_path`] with [`SighashRules::KnotsUnified`].
pub fn verify_key_path_input(
    tx: &Transaction,
    index: usize,
    prevouts: &[TxOut],
) -> core::result::Result<(), &'static str> {
    verify_taproot_key_path(tx, index, prevouts, SighashRules::Bip341)
}

/// The x-only public key of a secret key, as the document's `signer` field
/// and the challenge `5120‖pubkey` carry it.
pub fn pubkey_of(key: &SecretKey) -> XOnlyPublicKey {
    Keypair::from_secret_key(secp(), key).x_only_public_key().0
}

/// The single-key challenge for a signer: `OP_1 <32-byte x-only key>`, the
/// signer's key used **untweaked** as the output key (level 1, SPEC 4:
/// "key path, no tweak"). This is not BIP 86: the key here is not a
/// descriptor's internal key, and no script path exists. For a challenge
/// whose output key is a tweaked internal key — a federation's — use
/// [`challenge_for_output_key`] with the tweaked key, never this with the
/// internal one.
pub fn challenge_for(pubkey: &XOnlyPublicKey) -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x51, 0x20][..], &pubkey.serialize()].concat())
}

/// The challenge for an already-tweaked output key: `OP_1 <output key>`.
/// The type says the tweak has been applied, which is what distinguishes it
/// from [`challenge_for`]'s raw signer key (review §9).
pub fn challenge_for_output_key(output_key: &TweakedPublicKey) -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x51, 0x20][..], &output_key.serialize()].concat())
}

/// A secret key from the 32-byte hex a siding key file holds (`~/.sidestr/<name>.key`,
/// `siding/lib/sign.mjs`). Keys are files, never arguments: this takes the
/// file's *text*, trimmed, so the caller reads the file and nothing logs it.
pub fn key_from_hex(text: &str) -> Result<SecretKey> {
    let bytes = hex::decode(text.trim()).map_err(|e| Error::Encoding(e.to_string()))?;
    Ok(SecretKey::from_slice(&bytes)?)
}

pub(crate) fn schnorr_verify(msg: &[u8; 32], sig: &[u8], pk: &[u8]) -> bool {
    let (Ok(sig), Ok(pk)) = (Signature::from_slice(sig), XOnlyPublicKey::from_slice(pk)) else {
        return false;
    };
    secp()
        .verify_schnorr(&sig, &Message::from_digest(*msg), &pk)
        .is_ok()
}

pub(crate) fn annex_of<'a>(
    items: &mut Vec<&'a [u8]>,
) -> core::result::Result<Option<Annex<'a>>, &'static str> {
    if items.len() >= 2 && items.last().is_some_and(|a| a.first() == Some(&0x50)) {
        let raw = items.pop().expect("checked");
        return Annex::new(raw).map(Some).map_err(|_| "bad annex");
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cb(bytes: Vec<u8>) -> Transaction {
        Transaction {
            version: TxVersion::TWO,
            lock_time: LockTime::ZERO,
            input: vec![TxIn {
                previous_output: OutPoint::null(),
                script_sig: ScriptBuf::from_bytes(bytes),
                sequence: Sequence::MAX,
                witness: Witness::new(),
            }],
            output: vec![],
        }
    }

    // siding/test/stock-header-test.mjs: coinbaseHeight is the inverse of the height push
    #[test]
    fn coinbase_height_inverts_the_push() {
        for h in [
            0u32,
            1,
            16,
            17,
            127,
            128,
            255,
            256,
            65535,
            70000,
            8_388_608,
            u32::MAX,
        ] {
            assert_eq!(
                coinbase_height(&cb([height_push(h), vec![0xff]].concat())).unwrap(),
                h,
                "height {h}"
            );
        }
        let err = |b: Vec<u8>| coinbase_height(&cb(b)).unwrap_err().to_string();
        assert!(err(vec![]).contains("not a hex script"));
        assert!(coinbase_height(&Transaction {
            input: vec![],
            ..cb(vec![])
        })
        .unwrap_err()
        .to_string()
        .contains("not a hex script"));
        assert!(err(vec![0x4c, 0x01, 0x05]).contains("height push"));
        assert!(err(vec![0x03, 0x01]).contains("height push"));
        assert!(err(vec![0x01, 0x80]).contains("negative"));
        assert!(err(vec![0x04, 0x00, 0x00, 0x00, 0x80]).contains("negative"));
        assert_eq!(
            coinbase_height(&cb(vec![0x03, 0xff, 0xff, 0x7f])).unwrap(),
            8_388_607
        );
        assert!(err(vec![0x02, 0x05, 0x00]).contains("not minimal"));
        assert_eq!(coinbase_height(&cb(vec![0x02, 0x80, 0x00])).unwrap(), 128);
        assert_eq!(coinbase_height(&cb(vec![0x51])).unwrap(), 1);
        assert_eq!(coinbase_height(&cb(vec![0x60])).unwrap(), 16);
        assert!(err(vec![0x06, 1, 1, 1, 1, 1, 1]).contains("too long"));
    }

    #[test]
    fn witness_round_trip_and_solution_push_sizes() {
        let items = vec![vec![1u8; 64], vec![], vec![7u8; 300]];
        assert_eq!(decode_witness(&encode_witness(&items)).unwrap(), items);
        assert_eq!(decode_witness(&[2, 1, 9]), None);
        let empty = witness_commitment(&[]);
        assert_eq!(
            hex::encode(empty),
            "e2f61c3f71d1defd3fa999dfa36953755c690689799962b48bebd836974e8cf9"
        );
        let block = build_block(
            &Stock,
            &BlockTemplate {
                height: 3,
                prev: BlockHash::all_zeros(),
                time: 1,
                transactions: vec![],
                outputs: vec![],
                bits: CompactTarget::from_consensus(0x207f_ffff),
                marker: MARKER.into(),
            },
        );
        assert!(solution_of(&block).is_none());
        for n in [64usize, 80, 300] {
            let sealed = seal_block(&Stock, &block, &[vec![0xabu8; n]]).unwrap();
            let sol = solution_of(&sealed).unwrap();
            assert_eq!(sol.witness, vec![vec![0xabu8; n]]);
            assert!(Target::from_compact(sealed.header.bits).is_met_by(sealed.header.block_hash()));
            assert_eq!(coinbase_height(&sealed.txdata[0]).unwrap(), 3);
            assert_eq!(
                sealed.compute_merkle_root(),
                Some(sealed.header.merkle_root)
            );
            assert_eq!(block_weight(&Stock, &sealed), sealed.weight().to_wu());
        }
        assert!(with_solution(&block, &[vec![0u8; 70_000]]).is_err());
    }

    // the review's witness-decoder bounds: truncation, trailing bytes, non-minimal sizes, counts
    #[test]
    fn witness_decoder_is_strict() {
        let one = encode_witness(&[vec![9u8; 3]]);
        assert!(decode_witness(&one).is_some());
        assert_eq!(decode_witness(&[&one[..], &[0u8][..]].concat()), None); // trailing byte
        assert_eq!(decode_witness(&one[..one.len() - 1]), None); // truncated item
        assert_eq!(
            decode_witness(&[0xfd, 0x03, 0x00, 0x01, 0x09, 0x01, 0x09, 0x01, 0x09]),
            None
        ); // non-minimal count
        assert_eq!(decode_witness(&[0xfd, 0xff, 0xff]), None); // 65535 items announced, none present
        assert_eq!(decode_witness(&[0xff, 0, 0, 0, 0, 0, 0, 0, 0]), None); // 8-byte form refused
        assert_eq!(decode_witness(&[]), None);
        assert_eq!(decode_witness(&[0]), Some(vec![]));
        let big = encode_witness(&[vec![0u8; 300]]);
        assert_eq!(decode_witness(&big).unwrap()[0].len(), 300);
    }

    #[test]
    fn a_family_block_round_trips_and_weighs_like_bitcoins() {
        // FamilyBlock<Stock> is not Stock's block type, but the codec is the same shape
        let b = build_block(
            &Stock,
            &BlockTemplate {
                height: 1,
                prev: BlockHash::all_zeros(),
                time: 7,
                transactions: vec![],
                outputs: vec![],
                bits: CompactTarget::from_consensus(0x207f_ffff),
                marker: MARKER.into(),
            },
        );
        let fb = FamilyBlock::<Stock>::from_parts(b.header, b.txdata.clone());
        assert_eq!(fb.encode(), serialize(&b));
        assert_eq!(FamilyBlock::<Stock>::decode(&serialize(&b)).unwrap(), fb);
        assert!(FamilyBlock::<Stock>::decode(&serialize(&b)[..90]).is_err());
        assert!(FamilyBlock::<Stock>::decode(&[serialize(&b), vec![0]].concat()).is_err());
        assert_eq!(hex::encode(witness_root_of_txs(&b.txdata)), "00".repeat(32));
    }
}
