//! The stock 80-byte header, SHA-256d: the family of a chain beside `btc` or
//! `tbtc4` (SPEC 3.2).

use crate::hash::sha256d;
use crate::signet::{self, BLOCK_DATA_LEN};
use crate::{BlockHash, Error, HeaderFamily, Target, VERSION_HEADER_V2_FLAG};

/// The 80-byte Bitcoin block header (`btc:BlockHeader` in the kernel's
/// `schema/core.jsonld`).
///
/// Layout, all little-endian: `version` (4) ‖ `prev_block_hash` (32) ‖
/// `merkle_root` (32) ‖ `time` (4) ‖ `bits` (4) ‖ `nonce` (4). The block
/// hash is SHA-256d of these bytes, printed byte-reversed.
///
/// Beside a stock parent siding builds every header with
/// `version = 0x2000_0000` and bit 31 clear (`siding/lib/block.mjs`
/// `buildBlock`); the height lives only in the coinbase's BIP 34 push, so
/// this struct has no height field. `version` is held as `u32` rather than
/// Bitcoin's `i32`: the two agree for every header this crate accepts,
/// because a set bit 31 is rejected by [`StockHeader::decode`].
///
/// ```
/// use sidestr_header::{StockHeader, Target};
/// // sidestr:dreamlab block 0 (agentbox ADR-2103), beside tbtc4.
/// let bytes = hex::decode(
///     "0000002000000000000000000000000000000000000000000000000000000000000000003a87d59ecf60ab58ee75948cc39d1bb44ac4285747e64b5a1e7a960d37764cb40e67b26affff7f2002000000",
/// ).unwrap();
/// let h = StockHeader::decode(&bytes).unwrap();
/// assert_eq!(h.version, 0x2000_0000);
/// assert_eq!(h.time, 1_790_076_686);
/// assert_eq!(h.nonce, 2);
/// assert_eq!(h.hash().to_string(),
///            "4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0");
/// let pow_limit = Target::from_hex("7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff").unwrap();
/// assert!(h.check_pow(&pow_limit).is_ok());
/// assert_eq!(h.encode().as_slice(), bytes.as_slice());
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StockHeader {
    /// Block version. Bit 31 must be clear (see the struct docs).
    pub version: u32,
    /// The previous block's hash; all zeros for a genesis.
    pub prev_block_hash: BlockHash,
    /// The transaction merkle root in **wire (internal) order** — the bytes
    /// as serialised, not as an explorer prints them.
    pub merkle_root: [u8; 32],
    /// Block time, Unix seconds.
    pub time: u32,
    /// Compact proof-of-work target; on a sidestr chain always the compact
    /// form of `powLimit`.
    pub bits: u32,
    /// The proof-of-work nonce.
    pub nonce: u32,
}

impl StockHeader {
    /// Wire size in bytes.
    pub const WIRE_SIZE: usize = 80;

    /// Decodes exactly 80 bytes. Rejects any other length
    /// ([`Error::WrongLength`]) and a version with bit 31 set
    /// ([`Error::VersionBit31Set`]).
    pub fn decode(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() != Self::WIRE_SIZE {
            return Err(Error::WrongLength {
                family: HeaderFamily::Stock,
                expected: Self::WIRE_SIZE,
                actual: bytes.len(),
            });
        }
        let version = u32_at(bytes, 0);
        if version & VERSION_HEADER_V2_FLAG != 0 {
            return Err(Error::VersionBit31Set);
        }
        Ok(StockHeader {
            version,
            prev_block_hash: BlockHash::from_wire(arr32(bytes, 4)),
            merkle_root: arr32(bytes, 36),
            time: u32_at(bytes, 68),
            bits: u32_at(bytes, 72),
            nonce: u32_at(bytes, 76),
        })
    }

    /// The 80 wire bytes.
    pub fn encode(&self) -> [u8; 80] {
        let mut out = [0u8; 80];
        out[..72].copy_from_slice(&self.signet_preimage(self.merkle_root));
        out[72..76].copy_from_slice(&self.bits.to_le_bytes());
        out[76..].copy_from_slice(&self.nonce.to_le_bytes());
        out
    }

    /// The block hash: SHA-256d of the 80 bytes, in display order. It is also
    /// the proof-of-work hash (the kernel's `sha256d` `powHash`).
    pub fn hash(&self) -> BlockHash {
        BlockHash::from_wire(sha256d(&self.encode()))
    }

    /// The target `bits` encodes.
    pub fn target(&self) -> Result<Target, Error> {
        Target::from_compact(self.bits)
    }

    /// `hash ≤ target(bits)`: the kernel's `checkProofOfWork`. False when
    /// `bits` does not decode.
    pub fn meets_target(&self) -> bool {
        self.target().is_ok_and(|t| self.hash().meets(&t))
    }

    /// SPEC 4 step 1 as siding applies it: `bits` must be the compact form
    /// of `pow_limit` and the hash must meet it.
    pub fn check_pow(&self, pow_limit: &Target) -> Result<(), Error> {
        crate::check_pow(self.bits, self.hash(), pow_limit)
    }

    /// The first 72 header bytes — `version ‖ prev ‖ merkle_root ‖ time` —
    /// with `merkle_root` replaced by `stripped_merkle_root`, the root over
    /// the coinbase stripped of its solution. This is what BIP-325's block
    /// data hashes (`siding/lib/block.mjs` `blockData`).
    pub fn signet_preimage(&self, stripped_merkle_root: [u8; 32]) -> [u8; BLOCK_DATA_LEN] {
        let mut out = [0u8; BLOCK_DATA_LEN];
        out[..4].copy_from_slice(&self.version.to_le_bytes());
        out[4..36].copy_from_slice(&self.prev_block_hash.to_wire());
        out[36..68].copy_from_slice(&stripped_merkle_root);
        out[68..].copy_from_slice(&self.time.to_le_bytes());
        out
    }

    /// The BIP-325 block data, `SHA256(signet_preimage)`, which the block's
    /// signature commits to (SPEC 4 step 2).
    pub fn block_data(&self, stripped_merkle_root: [u8; 32]) -> [u8; 32] {
        signet::block_data(&self.signet_preimage(stripped_merkle_root))
    }
}

pub(crate) fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

pub(crate) fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

pub(crate) fn arr32(b: &[u8], at: usize) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&b[at..at + 32]);
    out
}

pub(crate) fn arr16(b: &[u8], at: usize) -> [u8; 16] {
    let mut out = [0u8; 16];
    out.copy_from_slice(&b[at..at + 16]);
    out
}
