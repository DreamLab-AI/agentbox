//! [`sidestr_core::HeaderFamily`] for both header types (feature `core`):
//! the seam through which `sidestr-core`'s rules, state and chain run over
//! this crate's headers without knowing their layout.
//!
//! [`Blake2bV2`] is the family of a chain beside `xbt` or `txbt4`:
//! `sidestr_core::StateOf<Blake2bV2>` and `ChainOf<Blake2bV2>` validate and
//! produce blocks with the 164-byte v2 header, the BLAKE2b proof of work, the
//! Knots overlay's header and block rules, and Knots' unified sighash on every
//! spend. [`Stock`] is this crate's own instantiation of the stock family
//! over [`StockHeader`]; `sidestr_core::Stock` (over `bitcoin::block::Header`)
//! is the one the estate's stock chains use, and the two are proven to seal
//! the same genesis byte for byte in `tests/core_family.rs`.
//!
//! The dependency edge points one way: `sidestr-core` never depends on this
//! crate (the colloquy pattern, ADR-2096 D2), which is why the BLAKE2b family
//! lives here and the trait there.
//!
//! ```
//! use sidestr_core::block::HeaderFamily;
//! use sidestr_core::parents::Family;
//! use sidestr_header::Blake2bV2;
//!
//! assert_eq!(Blake2bV2.family(), Family::Blake2b);
//! assert_eq!(Blake2bV2.header_len(), 164);
//! ```

use bitcoin::hashes::Hash;
use bitcoin::{BlockHash as CoreHash, CompactTarget, TxMerkleNode};
use sidestr_core::block::{FamilyBlock, HeaderFamily};
use sidestr_core::parents::Family;
use sidestr_core::rules::RuleResult;
use sidestr_core::sighash::SighashRules;
use sidestr_core::{Error, Result};

use crate::{Blake2bV2Header, BlockHash, StockHeader, VERSION_HEADER_V2_FLAG};

/// The version siding writes into every v2 header beside a BLAKE2b parent
/// (`siding/lib/block.mjs buildBlock`): bit 31 for the layout, bit 29 as
/// the stock family's `0x20000000`.
pub const BLAKE2B_V2_VERSION: u32 = 0xa000_0000;

fn to_core(h: BlockHash) -> CoreHash {
    CoreHash::from_byte_array(h.to_wire())
}

fn from_core(h: CoreHash) -> BlockHash {
    BlockHash::from_wire(h.to_byte_array())
}

/// Knots' 164-byte v2 header with BLAKE2b proof of work: the family of a
/// chain beside `xbt` or `txbt4` (SPEC 3.2, `family: 'blake2b'` in
/// `siding/lib/parents.mjs`). Its block is [`FamilyBlock<Blake2bV2>`].
///
/// Beside a BLAKE2b parent the sidestr overlay sets `blake2bHeight: 0`
/// (`siding/lib/overlay.mjs`), so from the genesis: every header is v2, the
/// header commits to the height and the transaction count, the reserved flag
/// bits must be clear, and Knots' unified opt-in sighash is in force for
/// every spend.
///
/// ```
/// use sidestr_core::document::ChainDocument;
/// use sidestr_core::StateOf;
/// use sidestr_header::Blake2bV2;
///
/// let key = bitcoin::secp256k1::SecretKey::from_slice(&[9u8; 32]).unwrap();
/// let me = sidestr_core::block::pubkey_of(&key);
/// let doc = ChainDocument::from_json(&format!(r#"{{
///   "id": "sidestr:doc", "name": "doc", "parent": "txbt4",
///   "challenge": "5120{me}", "signer": "{me}",
///   "powLimit": "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
///   "addressPrefix": "dc", "genesisTime": 1790000000, "pegs": []
/// }}"#)).unwrap();
/// let state = StateOf::<Blake2bV2>::with_key(doc.clone(), &key).unwrap();
/// let genesis = StateOf::<Blake2bV2>::genesis_block_for(&doc, &key).unwrap();
/// assert_eq!(genesis.header.height, 0);
/// assert_eq!(genesis.header.tx_count, 1);
/// assert_eq!(state.genesis_hash(), bitcoin::BlockHash::from_byte_array(genesis.header.hash().to_wire()));
/// // and the same document refuses a stock validator
/// assert!(sidestr_core::State::with_key(doc, &key).is_err());
/// # use bitcoin::hashes::Hash;
/// ```
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Blake2bV2;

impl HeaderFamily for Blake2bV2 {
    type Header = Blake2bV2Header;
    type Block = FamilyBlock<Blake2bV2>;
    const FAMILY: Family = Family::Blake2b;
    const HEADER_LEN: usize = Blake2bV2Header::WIRE_SIZE;

    fn encode_header(&self, header: &Blake2bV2Header) -> Vec<u8> {
        header.encode().to_vec()
    }
    fn decode_header(&self, bytes: &[u8]) -> Result<Blake2bV2Header> {
        Blake2bV2Header::decode(bytes).map_err(|e| Error::Encoding(format!("v2 header: {e}")))
    }
    fn block_hash(&self, header: &Blake2bV2Header) -> CoreHash {
        to_core(header.hash())
    }
    fn signed_prefix(&self, header: &Blake2bV2Header) -> Vec<u8> {
        header.signet_preimage(header.merkle_root).to_vec()
    }
    fn header_height(&self, header: &Blake2bV2Header) -> Option<u32> {
        Some(header.height)
    }
    fn new_header(
        &self,
        prev: CoreHash,
        merkle_root: TxMerkleNode,
        time: u32,
        bits: CompactTarget,
        height: u32,
        tx_count: usize,
    ) -> Blake2bV2Header {
        Blake2bV2Header {
            version: BLAKE2B_V2_VERSION,
            prev_block_hash: from_core(prev),
            merkle_root: merkle_root.to_byte_array(),
            time_on_wire: time,
            bits: bits.to_consensus(),
            nonce: 0,
            nonce2: 0,
            nonce3: 0,
            extranonce: [0u8; 16],
            time_offset: 0,
            tx_count: u16::try_from(tx_count).unwrap_or(u16::MAX),
            flags: 0,
            xor_key_mask_clear_bits: 0,
            xor_key: [0u8; 16],
            height,
            mm_rhs: [0u8; 32],
        }
    }
    fn version(&self, header: &Blake2bV2Header) -> u32 {
        header.version
    }
    /// `u32le` (`schema/overlays/knots-blake2b.jsonld`): the mandatory bit 31
    /// does not read as a negative version.
    fn version_number(&self, header: &Blake2bV2Header) -> i64 {
        i64::from(header.version)
    }
    fn prev(&self, header: &Blake2bV2Header) -> CoreHash {
        to_core(header.prev_block_hash)
    }
    fn merkle_root(&self, header: &Blake2bV2Header) -> TxMerkleNode {
        TxMerkleNode::from_byte_array(header.merkle_root)
    }
    fn time(&self, header: &Blake2bV2Header) -> u32 {
        header.time()
    }
    fn bits(&self, header: &Blake2bV2Header) -> CompactTarget {
        CompactTarget::from_consensus(header.bits)
    }
    fn nonce(&self, header: &Blake2bV2Header) -> u32 {
        header.nonce
    }
    fn set_merkle_root(&self, header: &mut Blake2bV2Header, root: TxMerkleNode) {
        header.merkle_root = root.to_byte_array();
    }
    fn set_nonce(&self, header: &mut Blake2bV2Header, nonce: u32) {
        header.nonce = nonce;
    }
    /// The Knots overlay's header rules (`codec/overlays/knots-blake2b.js
    /// headerChecks`) with `blake2bHeight = 0`: a v2 header may commit to any
    /// height at or after the fork (every height), every header from the fork
    /// is v2 (the decoder already refused a stock one), the committed height
    /// is the chain height, and the reserved flag bits are clear.
    fn header_rules(&self, header: &Blake2bV2Header, height: u32) -> Vec<RuleResult> {
        vec![
            RuleResult::new("knots:rule-header-v1-until-fork", Some(true)),
            RuleResult::new(
                "knots:rule-header-v2-from-fork",
                Some(header.version & VERSION_HEADER_V2_FLAG != 0),
            ),
            RuleResult::new("knots:rule-header-height", Some(header.height == height)),
            RuleResult::new(
                "knots:rule-header-flags-reserved",
                Some(header.check_flags().is_ok()),
            ),
        ]
    }
    /// `knots:rule-block-txcount`: the committed count is the block's. The
    /// headline rule passes: a sidestr chain sets `blake2bHeadline: ''`.
    fn block_rules(&self, header: &Blake2bV2Header, tx_count: usize) -> Vec<RuleResult> {
        vec![
            RuleResult::new(
                "knots:rule-block-txcount",
                Some(usize::from(header.tx_count) == tx_count),
            ),
            RuleResult::new("knots:rule-block-headline", Some(true)),
        ]
    }
    /// Unified from height 0: `unifiedSighashParam: 'blake2bHeight'`, `blake2bHeight: 0`.
    fn sighash_rules(&self, _height: u32) -> SighashRules {
        SighashRules::KnotsUnified
    }
}

/// This crate's stock family over [`StockHeader`]: the 80-byte SHA-256d
/// header beside `btc` or `tbtc4`, with [`FamilyBlock<Stock>`] as its block.
/// `sidestr_core::Stock` is the instantiation over `bitcoin::block::Header`
/// that `sidestr_core::State` uses; this one exists so the two header codecs
/// can be checked against each other and so a consumer that already holds
/// [`StockHeader`]s can run the core rules over them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stock;

impl HeaderFamily for Stock {
    type Header = StockHeader;
    type Block = FamilyBlock<Stock>;
    const FAMILY: Family = Family::Stock;
    const HEADER_LEN: usize = StockHeader::WIRE_SIZE;

    fn encode_header(&self, header: &StockHeader) -> Vec<u8> {
        header.encode().to_vec()
    }
    fn decode_header(&self, bytes: &[u8]) -> Result<StockHeader> {
        StockHeader::decode(bytes).map_err(|e| Error::Encoding(format!("stock header: {e}")))
    }
    fn block_hash(&self, header: &StockHeader) -> CoreHash {
        to_core(header.hash())
    }
    fn signed_prefix(&self, header: &StockHeader) -> Vec<u8> {
        header.signet_preimage(header.merkle_root).to_vec()
    }
    fn header_height(&self, _header: &StockHeader) -> Option<u32> {
        None
    }
    fn new_header(
        &self,
        prev: CoreHash,
        merkle_root: TxMerkleNode,
        time: u32,
        bits: CompactTarget,
        _height: u32,
        _tx_count: usize,
    ) -> StockHeader {
        StockHeader {
            version: 0x2000_0000,
            prev_block_hash: from_core(prev),
            merkle_root: merkle_root.to_byte_array(),
            time,
            bits: bits.to_consensus(),
            nonce: 0,
        }
    }
    fn version(&self, header: &StockHeader) -> u32 {
        header.version
    }
    /// `i32le` (`btc:BlockHeader` in `schema/core.jsonld`): a set bit 31 reads
    /// as a negative version and fails `btc:rule-header-version`, as it does
    /// in `sidestr_core::Stock` and in the kernel — [`StockHeader::decode`]
    /// refuses such a header before it gets this far, but a typed one built
    /// by hand still cannot pass the rule.
    fn version_number(&self, header: &StockHeader) -> i64 {
        i64::from(header.version as i32)
    }
    fn prev(&self, header: &StockHeader) -> CoreHash {
        to_core(header.prev_block_hash)
    }
    fn merkle_root(&self, header: &StockHeader) -> TxMerkleNode {
        TxMerkleNode::from_byte_array(header.merkle_root)
    }
    fn time(&self, header: &StockHeader) -> u32 {
        header.time
    }
    fn bits(&self, header: &StockHeader) -> CompactTarget {
        CompactTarget::from_consensus(header.bits)
    }
    fn nonce(&self, header: &StockHeader) -> u32 {
        header.nonce
    }
    fn set_merkle_root(&self, header: &mut StockHeader, root: TxMerkleNode) {
        header.merkle_root = root.to_byte_array();
    }
    fn set_nonce(&self, header: &mut StockHeader, nonce: u32) {
        header.nonce = nonce;
    }
}
