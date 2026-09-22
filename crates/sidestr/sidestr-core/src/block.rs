//! Blocks on a sidestr chain (SPEC 4): building, the block data that is
//! signed, the virtual transactions the challenge is evaluated against, the
//! solution's place in the coinbase, and the height a stock header does not
//! carry. A port of `siding/lib/block.mjs`.
//!
//! A block here is [`bitcoin::Block`]: Bitcoin's transaction rules are the
//! parent's, so the parent's types serve. What sidestr adds is in the
//! coinbase: after the witness commitment output's commitment, one push of
//! `ecc7daa2` followed by a serialised script witness that satisfies the
//! chain's `challenge` for the block's *signet hash*, computed as BIP 325
//! computes it over this chain's header serialisation. The header family
//! (SPEC 3.2) is behind [`HeaderFamily`]; the stock 80-byte header is
//! [`Stock`], and the BLAKE2b v2 header arrives as another implementation
//! without touching the rules.
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
use bitcoin::consensus::encode::serialize;
use bitcoin::hashes::{sha256, sha256d, Hash};
use bitcoin::secp256k1::{
    schnorr::Signature, All, Keypair, Message, Secp256k1, SecretKey, XOnlyPublicKey,
};
use bitcoin::sighash::{Annex, Prevouts, SighashCache, TapSighashType};
use bitcoin::transaction::Version as TxVersion;
use bitcoin::{
    absolute::LockTime, merkle_tree, Amount, Block, BlockHash, CompactTarget, OutPoint, Script,
    ScriptBuf, Sequence, Target, Transaction, TxIn, TxMerkleNode, TxOut, Txid, Witness, Wtxid,
};

use crate::error::{Error, Result};
use crate::parents::Family;

/// The four bytes that open the solution push: BIP 325's signet header.
pub const SIGNET_HEADER: [u8; 4] = [0xec, 0xc7, 0xda, 0xa2];
/// The tag every non-genesis coinbase pushes after its height.
pub const MARKER: &str = "sidestr";
/// The six bytes that open a witness commitment output.
const COMMITMENT_PREFIX: [u8; 6] = [0x6a, 0x24, 0xaa, 0x21, 0xa9, 0xed];
/// `OP_RETURN 0x24 aa21a9ed <32-byte commitment>`: the part of the
/// commitment output that is not the solution.
const COMMITMENT_LEN: usize = 38;

/// One shared secp256k1 context for signing and verification.
pub fn secp() -> &'static Secp256k1<All> {
    static SECP: OnceLock<Secp256k1<All>> = OnceLock::new();
    SECP.get_or_init(Secp256k1::new)
}

// --- the header family boundary (SPEC 3, 3.2) ------------------------------------

/// What differs between header families: the proof-of-work hash, the bytes
/// the block signature commits to, whether the header carries the height,
/// and what an unsigned header looks like. The rules take a `&dyn
/// HeaderFamily` and never ask which one they have.
///
/// `sidestr-core` 0.1 ships [`Stock`]. Knots' 164-byte v2 header (BLAKE2b
/// parents `xbt`, `txbt4`) is `sidestr-header`'s: when it lands, this trait
/// gains an associated header type so the v2 fields have somewhere to live;
/// the rules are written against the trait and stay as they are.
pub trait HeaderFamily: core::fmt::Debug {
    /// Which family this is.
    fn family(&self) -> Family;
    /// The block hash: the parent's proof-of-work hash over the serialised header.
    fn block_hash(&self, header: &Header) -> BlockHash;
    /// The bytes the block signature commits to (SPEC 4): the header's first
    /// 72 bytes, version, prev, merkle root and time on wire — never the nonce,
    /// which is found after signing.
    fn signed_prefix(&self, header: &Header) -> Vec<u8>;
    /// The height the header itself carries, when the family writes it there.
    fn header_height(&self, header: &Header) -> Option<u32>;
    /// An unsigned header on `prev` with this family's version and zero nonce.
    fn new_header(
        &self,
        prev: BlockHash,
        merkle_root: TxMerkleNode,
        time: u32,
        bits: CompactTarget,
    ) -> Header;
    /// The serialised header length.
    fn header_len(&self) -> usize;
}

/// The stock 80-byte Bitcoin header, hashed with double SHA-256 (parents
/// `btc` and `tbtc4`). Version `0x20000000`, bit 31 clear, so a Knots node
/// never mistakes it for a v2 header. The stock header does not carry the
/// height, so beside a stock parent the coinbase is the only place the
/// height is written ([`coinbase_height`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stock;

impl HeaderFamily for Stock {
    fn family(&self) -> Family {
        Family::Stock
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
    fn header_len(&self) -> usize {
        80
    }
}

/// The implementation for a family, or [`Error::UnsupportedFamily`].
pub fn family_for(family: Family) -> Result<Box<dyn HeaderFamily>> {
    match family {
        Family::Stock => Ok(Box::new(Stock)),
        Family::Blake2b => Err(Error::UnsupportedFamily(family)),
    }
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

fn read_compact(b: &[u8], i: usize) -> Option<(usize, usize)> {
    let first = *b.get(i)?;
    match first {
        0..=0xfc => Some((usize::from(first), i + 1)),
        0xfd => Some((
            usize::from(*b.get(i + 1)?) | usize::from(*b.get(i + 2)?) << 8,
            i + 3,
        )),
        0xfe => Some((
            usize::from(*b.get(i + 1)?)
                | usize::from(*b.get(i + 2)?) << 8
                | usize::from(*b.get(i + 3)?) << 16
                | usize::from(*b.get(i + 4)?) << 24,
            i + 5,
        )),
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

/// The inverse of [`encode_witness`]; `None` when the bytes run out.
pub fn decode_witness(bytes: &[u8]) -> Option<Vec<Vec<u8>>> {
    let (n, mut i) = read_compact(bytes, 0)?;
    let mut items = Vec::with_capacity(n.min(64));
    for _ in 0..n {
        let (len, at) = read_compact(bytes, i)?;
        items.push(bytes.get(at..at + len)?.to_vec());
        i = at + len;
    }
    Some(items)
}

/// The coinbase output carrying the witness commitment: the last one whose
/// script starts `OP_RETURN 0x24 aa21a9ed` and is at least 38 bytes
/// (`siding/lib/block.mjs commitmentOutput`). The solution push follows it.
pub fn commitment_output(block: &Block) -> Option<(usize, &Script)> {
    let cb = block.txdata.first()?;
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
pub fn solution_of(block: &Block) -> Option<Solution> {
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
pub fn with_solution(block: &Block, witness_items: &[Vec<u8>]) -> Result<Block> {
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
    out.txdata[0].output[index].script_pubkey = ScriptBuf::from_bytes(script);
    Ok(out)
}

/// The coinbase with the solution stripped: the commitment output cut back
/// to its 38 bytes. What the merkle root is computed over for signing.
fn stripped_coinbase(block: &Block) -> Transaction {
    let mut cb = block.txdata[0].clone();
    if let Some((i, spk)) = commitment_output(block) {
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
pub fn block_data(family: &dyn HeaderFamily, block: &Block) -> [u8; 32] {
    let cb = stripped_coinbase(block);
    let root = merkle_root_of(
        std::iter::once(cb.compute_txid())
            .chain(block.txdata.iter().skip(1).map(Transaction::compute_txid)),
    );
    let header = Header {
        merkle_root: root,
        ..block.header
    };
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
pub fn block_height(family: &dyn HeaderFamily, block: &Block) -> Result<u32> {
    match family.header_height(&block.header) {
        Some(h) => Ok(h),
        None => coinbase_height(
            block
                .txdata
                .first()
                .ok_or_else(|| Error::CoinbaseHeight("block has no coinbase".into()))?,
        ),
    }
}

// --- building ---------------------------------------------------------------------

/// What [`build_block`] needs: the unsigned block's inputs.
#[derive(Debug, Clone)]
pub struct BlockTemplate {
    /// The block's height; the coinbase pushes it.
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
/// version with bit 31 clear, beside stock Bitcoin.
pub fn build_block(family: &dyn HeaderFamily, t: &BlockTemplate) -> Block {
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
    let merkle_root = merkle_root_of(txdata.iter().map(Transaction::compute_txid));
    Block {
        header: family.new_header(t.prev, merkle_root, t.time, t.bits),
        txdata,
    }
}

// --- signing and sealing ----------------------------------------------------------

/// What a block signature signs (`siding/lib/block.mjs blockSigHash`): the
/// taproot key-path sighash of the virtual transaction, `SIGHASH_DEFAULT`.
pub fn block_sighash(
    family: &dyn HeaderFamily,
    block: &Block,
    challenge: &Script,
) -> Result<[u8; 32]> {
    let data = block_data(family, block);
    let v = virtual_txs(&data, challenge, &[]);
    let msg = SighashCache::new(&v.to_sign)
        .taproot_key_spend_signature_hash(0, &Prevouts::All(&[v.prevout]), TapSighashType::Default)
        .map_err(|e| Error::Block(e.to_string()))?;
    Ok(msg.to_byte_array())
}

/// The block with its witness in place (`siding/lib/block.mjs sealBlock`):
/// the solution appended, the merkle root recomputed, the header nonce found
/// for the block's `bits`. Any path that produced the witness — one key, a
/// federation's round — ends here.
pub fn seal_block(
    family: &dyn HeaderFamily,
    block: &Block,
    witness_items: &[Vec<u8>],
) -> Result<Block> {
    let mut sealed = with_solution(block, witness_items)?;
    sealed.header.merkle_root = merkle_root_of(sealed.txdata.iter().map(Transaction::compute_txid));
    let target = Target::from_compact(sealed.header.bits);
    for nonce in 0..=u32::MAX {
        sealed.header.nonce = nonce;
        if target.is_met_by(family.block_hash(&sealed.header)) {
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
pub fn sign_block(
    family: &dyn HeaderFamily,
    block: &Block,
    challenge: &Script,
    key: &SecretKey,
    aux: &[u8; 32],
) -> Result<Block> {
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

/// Whether the block's solution satisfies the challenge for its block data
/// (SPEC 4, `sidestr:rule-block-signature` in `siding/lib/overlay.mjs`): the
/// solution is read, the virtual transaction built with it as witness, and
/// its one input verified against the challenge as a taproot key-path spend.
pub fn verify_block_signature(
    family: &dyn HeaderFamily,
    block: &Block,
    challenge: &Script,
) -> bool {
    let Some(sol) = solution_of(block) else {
        return false;
    };
    let data = block_data(family, block);
    let v = virtual_txs(&data, challenge, &sol.witness);
    verify_key_path_input(&v.to_sign, 0, std::slice::from_ref(&v.prevout)).is_ok()
}

/// Verify one input as a BIP 341 taproot key-path spend: one Schnorr
/// signature over the taproot sighash, 64 bytes for `SIGHASH_DEFAULT` or 65
/// with an explicit type, an annex allowed. This is the whole of the script
/// verification `sidestr-core` 0.1 carries: the estate's chains pay `5120…`
/// scripts and nothing else. Any other script type, and the taproot script
/// path, is refused rather than skipped — where the reference kernel reports
/// "unverifiable" and lets the block through, this crate fails closed.
pub fn verify_key_path_input(
    tx: &Transaction,
    index: usize,
    prevouts: &[TxOut],
) -> core::result::Result<(), &'static str> {
    let prevout = prevouts.get(index).ok_or("no prevout for the input")?;
    let input = tx.input.get(index).ok_or("no such input")?;
    if !prevout.script_pubkey.is_p2tr() {
        return Err(
            "unsupported script type: sidestr-core 0.1 verifies taproot key-path spends only",
        );
    }
    if !input.script_sig.is_empty() {
        return Err("WITNESS_MALLEATED");
    }
    let mut items: Vec<&[u8]> = input.witness.iter().collect();
    if items.is_empty() {
        return Err("empty taproot witness");
    }
    let annex = if items.len() >= 2 && items.last().is_some_and(|a| a.first() == Some(&0x50)) {
        items.pop()
    } else {
        None
    };
    if items.len() != 1 {
        return Err("taproot script path is not supported by sidestr-core 0.1");
    }
    let raw = items[0];
    let (sig, hash_type) = match raw.len() {
        64 => (raw, TapSighashType::Default),
        65 => {
            if raw[64] == 0 {
                return Err("explicit SIGHASH_DEFAULT in 65-byte signature");
            }
            (
                &raw[..64],
                TapSighashType::from_consensus_u8(raw[64])
                    .map_err(|_| "invalid taproot sighash type")?,
            )
        }
        _ => return Err("bad key-path signature size"),
    };
    let annex = annex.map(Annex::new).transpose().map_err(|_| "bad annex")?;
    let msg = SighashCache::new(tx)
        .taproot_signature_hash(index, &Prevouts::All(prevouts), annex, None, hash_type)
        .map_err(|_| "sighash failed")?;
    let pk = XOnlyPublicKey::from_slice(&prevout.script_pubkey.as_bytes()[2..34])
        .map_err(|_| "bad output key")?;
    let sig = Signature::from_slice(sig).map_err(|_| "bad signature")?;
    secp()
        .verify_schnorr(&sig, &Message::from_digest(msg.to_byte_array()), &pk)
        .map_err(|_| "invalid key-path schnorr signature")
}

/// The x-only public key of a secret key, as the document's `signer` field
/// and the challenge `5120‖pubkey` carry it.
pub fn pubkey_of(key: &SecretKey) -> XOnlyPublicKey {
    Keypair::from_secret_key(secp(), key).x_only_public_key().0
}

/// The single-key challenge for a signer: `OP_1 <32-byte x-only key>`.
pub fn challenge_for(pubkey: &XOnlyPublicKey) -> ScriptBuf {
    ScriptBuf::from_bytes([&[0x51, 0x20][..], &pubkey.serialize()].concat())
}

/// A secret key from the 32-byte hex a siding key file holds (`~/.sidestr/<name>.key`,
/// `siding/lib/sign.mjs`). Keys are files, never arguments: this takes the
/// file's *text*, trimmed, so the caller reads the file and nothing logs it.
pub fn key_from_hex(text: &str) -> Result<SecretKey> {
    let bytes = hex::decode(text.trim()).map_err(|e| Error::Encoding(e.to_string()))?;
    Ok(SecretKey::from_slice(&bytes)?)
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
        }
        assert!(with_solution(&block, &[vec![0u8; 70_000]]).is_err());
    }
}
