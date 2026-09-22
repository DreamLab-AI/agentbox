//! `sidestr-header` — block headers for sidestr sidechains, in both families
//! the parent table allows.
//!
//! A [sidestr](https://github.com/sidestr/spec) chain is an overlay on a
//! Bitcoin-family parent, and SPEC 3 is explicit that the overlay names no
//! header format and no hash: "everything the overlay does not set is
//! inherited from the parent: header format and proof-of-work hash …
//! Nothing in the document names a header format or a hash; the parent
//! decides both." SPEC 3.2's parents table then fixes two families:
//!
//! | parent alias | chain | headers, proof of work | this crate |
//! |---|---|---|---|
//! | `btc`, `tbtc4` | Bitcoin mainnet, testnet4 | stock 80 bytes, SHA-256d | [`StockHeader`] |
//! | `xbt`, `txbt4` | Bitcoin Knots' BLAKE2b fork of each | 164-byte v2, BLAKE2b | [`Blake2bV2Header`] |
//!
//! `ltc` and `vtc` are reserved upstream and absent here. The crate is a port
//! of the reference JavaScript — the bitcoin-desktop/schema kernel's header
//! codec, Knots proof of work and Knots overlay rules, and Melvin Carvalho's
//! `siding` for how a sidestr block shapes its header and what its signature
//! covers — under the same AGPL-3.0 licence (agentbox ADR-2106). Without the
//! `core` feature it is `#![no_std]`, allocates nothing, and takes every
//! primitive from RustCrypto ([`sha2`], [`blake2`]) with no `bitcoin` crate
//! dependency (ADR-2096 D2): the header and its proof of work are the part of
//! consensus that the parent's serialisation library does not own.
//!
//! With `core` (default) the [`family`] module implements
//! `sidestr_core::HeaderFamily` for both header types, so
//! `sidestr_core::StateOf<Blake2bV2>` and `ChainOf<Blake2bV2>` validate and
//! produce a chain beside `xbt` or `txbt4` end to end — the v2 header, the
//! BLAKE2b proof of work, the Knots overlay's rules and Knots' unified sighash
//! on every spend — proven by replaying the live `sidestr:txbt4-siding` chain.
//! The edge points from this crate to `sidestr-core`, never back.
//!
//! # What it gives a validator
//!
//! Per family, through [`HeaderFamily`] and the enum [`Header`] or the two
//! structs directly:
//!
//! - the wire size and a strict `decode` / `encode` pair;
//! - `hash()`, the block id, which in both families **is** the proof-of-work
//!   hash (SHA-256d of the 80 bytes; the v2 pipeline for Knots) — so there is
//!   no separate `pow_hash`;
//! - [`Target`] with compact `bits` decoding, and [`check_pow`] with the
//!   `powLimit` semantics siding uses — `bits` is pinned to `powLimit`'s
//!   compact form and never retargets (SPEC 3, SPEC 4 step 1);
//! - the BIP-325 block-data preimage over that family's serialisation
//!   ([`signet`]), so `sidestr-core` signs and verifies blocks without knowing
//!   the layout;
//! - the version-bit-31 rule: bit 31 selects the family, so a stock header
//!   with it set and a v2 header without it are both refused at decode;
//! - the fork activation constants of SPEC 3.2 ([`fork`]);
//! - with `core`, the two families as `sidestr-core` sees them
//!   ([`Blake2bV2`], [`family::Stock`]).
//!
//! # Where this port departs from the reference
//!
//! - **The genesis is judged under the family's rules.** The reference
//!   applies block 0 on its hash; through `sidestr-core`'s
//!   `StateOf::from_genesis` a typed v2 genesis is held to
//!   `knots:rule-header-v2-from-fork`, `-height` and `-flags-reserved`, the
//!   proof of work and the signature before its hash is compared to the
//!   document, so a header the decoder would refuse cannot enter as a struct
//!   either (`tests/audit_regressions.rs`).
//! - **Version bit 31 is refused on every stock path.** [`StockHeader::decode`]
//!   refuses the bytes; [`family::Stock`] reports the version as the kernel
//!   types it (`i32le`, so bit 31 is negative) and `btc:rule-header-version`
//!   refuses a typed header, as the kernel does on the same block.
//! - **Compact targets Bitcoin Core rejects** (negative, overflow) are
//!   rejected by [`Target::from_compact`] where the kernel is lenient —
//!   unreachable on a valid sidestr chain, where `bits` is pinned to
//!   `powLimit`.
//! - **A mirror's record framing is checked** on replay (`sidestr-core`'s
//!   `blockfile::read_block`): the `[u32 height][u32 size]` prefix of every
//!   record must agree with the index entry, and the entry must lie within
//!   the file.
//!
//! # The v2 header, field by field
//!
//! The 164-byte Knots v2 header keeps the classic 80-byte prefix (version with
//! bit 31 set, previous hash, merkle root, time on wire, bits, nonce) and
//! appends 84 bytes: two more nonces, a 128-bit extranonce, a time offset, the
//! committed transaction count, a flags byte (ASIC profile in bits 0–1, time
//! offset in bit 2, bits 6–7 reserved), the XOR-mask clear count, a 128-bit XOR
//! key, the committed height, and a 32-byte merge-mining hook. The table with
//! offsets is on [`Blake2bV2Header`]. Its hash is not a hash of the bytes but a
//! commitment tree: two BIP-340 tagged-hash rounds over the fields, then two
//! BLAKE2b-256 rounds whose second input layout the ASIC profile selects, then
//! an XOR mask derived from the key (see [`Blake2bV2Header::hash`]).
//!
//! # The signet preimage
//!
//! Siding's `blockData` hashes the first 72 header bytes — version, previous
//! hash, merkle root, time on wire — with the merkle root recomputed over the
//! coinbase stripped of its solution. Those 72 bytes have the same layout in
//! both families, so [`Header::block_data`] is one function.
//!
//! # Example
//!
//! ```
//! use sidestr_header::{Header, HeaderFamily, Target};
//!
//! // sidestr:dreamlab block 0, beside tbtc4: stock family.
//! let bytes = hex::decode(
//!     "0000002000000000000000000000000000000000000000000000000000000000000000003a87d59ecf60ab58ee75948cc39d1bb44ac4285747e64b5a1e7a960d37764cb40e67b26affff7f2002000000",
//! ).unwrap();
//! let header = HeaderFamily::Stock.decode(&bytes).unwrap();
//! assert_eq!(header.hash().to_string(),
//!            "4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0");
//!
//! // SPEC 4 step 1 against the chain document's powLimit.
//! let pow_limit = Target::from_hex(
//!     "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff").unwrap();
//! assert!(header.check_pow(&pow_limit).is_ok());
//!
//! // The same 80 bytes are not a v2 header, and 81 bytes are not a header.
//! assert!(HeaderFamily::Blake2bV2.decode(&bytes).is_err());
//! assert!(HeaderFamily::Stock.decode(&bytes[..79]).is_err());
//!
//! // Re-encoding is the identity.
//! assert_eq!(header.encode().as_ref(), bytes.as_slice());
//! # let _: Header = header;
//! ```
//!
//! # Provenance
//!
//! - `codec/pow/knots-header-v2.js`, `codec/pow/blake2b.js`, `codec/hash.js`,
//!   `codec/codec.js`, `codec/headers.js`, `codec/overlays/knots-blake2b.js`
//!   (the overlay's header and block checks), `schema/overlays/knots-blake2b.jsonld`
//!   of [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema)
//!   (AGPL-3.0), at commit `b8cbf6337c7450fe14ddc5bce00c7280059aab5d`.
//! - `siding/lib/block.mjs`, `siding/lib/parents.mjs`, `siding/lib/chain.mjs`,
//!   `siding/lib/overlay.mjs` (`blake2bHeight: 0`, `unifiedSighashParam`),
//!   `SPEC.md` §3, §3.2, §4 of [sidestr/spec](https://github.com/sidestr/spec)
//!   (AGPL-3.0, Melvin Carvalho), at commit
//!   `2de40bdac4cba01be0864156a553d8287c22e279`.
//! - Test vectors: Knots' own `block_header_v2.json` and real fork headers
//!   captured from a Knots 29.4.1 node on 2026-09-05, both carried by the
//!   schema kernel; siding's `blockData` on the live `sidestr:dreamlab` block 0
//!   and on kernel-hashed v2 headers, computed with the JavaScript engine as
//!   the oracle; and the live `sidestr:txbt4-siding` chain (229 blocks as of
//!   2026-09-22) as the oracle for the whole BLAKE2b family through
//!   `sidestr-core` (`tests/core_family.rs`).

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod error;
#[cfg(feature = "core")]
pub mod family;
pub mod fork;
pub mod hash;
pub mod signet;
mod stock;
mod target;
mod v2;

pub use error::Error;
#[cfg(feature = "core")]
pub use family::Blake2bV2;
pub use stock::StockHeader;
pub use target::Target;
pub use v2::{
    Blake2bV2Header, V2HashStages, FLAG_ASIC_PROFILE_MASK, FLAG_RESERVED_MASK,
    FLAG_USE_TIME_OFFSET, POW_HASH_NAME as BLAKE2B_V2_POW_HASH_NAME,
};

use core::fmt;

/// Version bit 31: set on every v2 header, clear on every stock header
/// (`VERSION_HEADER_V2_FLAG` in `codec/pow/knots-header-v2.js`; the kernel's
/// `structVariants` selects the v2 struct on it).
pub const VERSION_HEADER_V2_FLAG: u32 = 0x8000_0000;

/// The kernel's name for the stock family's proof-of-work hash.
pub const SHA256D_POW_HASH_NAME: &str = "sha256d";

/// A block hash in **display order** — the byte order bitcoind prints and a
/// chain document's `genesisHash` uses; read as a big-endian number it
/// compares directly against a [`Target`].
///
/// ```
/// use sidestr_header::BlockHash;
/// let h = BlockHash::from_hex("000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f").unwrap();
/// assert_eq!(h.to_string(), "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f");
/// assert_eq!(h.to_wire()[0], 0x6f); // wire order is the reverse
/// assert_eq!(BlockHash::from_wire(h.to_wire()), h);
/// ```
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BlockHash(pub [u8; 32]);

impl BlockHash {
    /// All zeros: a genesis header's `prev_block_hash`.
    pub const ZERO: BlockHash = BlockHash([0u8; 32]);

    /// From the 32 bytes as they sit in a header (wire / internal order).
    pub fn from_wire(mut wire: [u8; 32]) -> Self {
        wire.reverse();
        BlockHash(wire)
    }

    /// The 32 bytes as they sit in a header (wire / internal order).
    pub fn to_wire(self) -> [u8; 32] {
        let mut b = self.0;
        b.reverse();
        b
    }

    /// From 64 hex characters in display order.
    pub fn from_hex(s: &str) -> Result<Self, Error> {
        hash::hex32(s).map(BlockHash).ok_or(Error::InvalidHex)
    }

    /// `hash ≤ target`, both read as big-endian 256-bit numbers
    /// (`BigInt('0x' + blockHash) <= expandCompact(bits)` in the kernel).
    pub fn meets(&self, target: &Target) -> bool {
        self.0 <= target.to_be_bytes()
    }
}

impl fmt::Debug for BlockHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BlockHash(")?;
        hash::fmt_hex(f, &self.0)?;
        f.write_str(")")
    }
}

impl fmt::Display for BlockHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        hash::fmt_hex(f, &self.0)
    }
}

/// The two header families of SPEC 3.2, named after the header they carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HeaderFamily {
    /// Stock 80-byte header, SHA-256d: beside `btc` or `tbtc4`
    /// (`family: 'stock'` in `siding/lib/parents.mjs`).
    Stock,
    /// Knots 164-byte v2 header, BLAKE2b: beside `xbt` or `txbt4`
    /// (`family: 'blake2b'`).
    Blake2bV2,
}

impl HeaderFamily {
    /// The family's header size in bytes: 80 or 164.
    pub const fn wire_size(self) -> usize {
        match self {
            HeaderFamily::Stock => StockHeader::WIRE_SIZE,
            HeaderFamily::Blake2bV2 => Blake2bV2Header::WIRE_SIZE,
        }
    }

    /// The kernel's name for the family's proof-of-work hash: `sha256d` or
    /// `knots:blake2b-v2`.
    pub const fn pow_hash_name(self) -> &'static str {
        match self {
            HeaderFamily::Stock => SHA256D_POW_HASH_NAME,
            HeaderFamily::Blake2bV2 => v2::POW_HASH_NAME,
        }
    }

    /// The family a version word claims: bit 31 set means v2. This is the
    /// kernel's `structVariants` selector, useful when the bytes' provenance
    /// is unknown; a validator knows its family from the chain document's
    /// parent and should use [`HeaderFamily::decode`] with that.
    pub const fn from_version(version: u32) -> HeaderFamily {
        if version & VERSION_HEADER_V2_FLAG != 0 {
            HeaderFamily::Blake2bV2
        } else {
            HeaderFamily::Stock
        }
    }

    /// Decodes `bytes` as this family's header.
    pub fn decode(self, bytes: &[u8]) -> Result<Header, Error> {
        match self {
            HeaderFamily::Stock => StockHeader::decode(bytes).map(Header::Stock),
            HeaderFamily::Blake2bV2 => Blake2bV2Header::decode(bytes).map(Header::Blake2bV2),
        }
    }
}

impl fmt::Display for HeaderFamily {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            HeaderFamily::Stock => "stock",
            HeaderFamily::Blake2bV2 => "blake2b-v2",
        })
    }
}

/// A header of either family, with the operations a sidestr validator needs
/// dispatched to the right one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Header {
    /// An 80-byte stock header.
    Stock(StockHeader),
    /// A 164-byte Knots v2 header.
    Blake2bV2(Blake2bV2Header),
}

/// A header's wire bytes, sized for the larger family; `as_ref()` yields
/// exactly the family's bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodedHeader {
    buf: [u8; 164],
    len: usize,
}

impl AsRef<[u8]> for EncodedHeader {
    fn as_ref(&self) -> &[u8] {
        &self.buf[..self.len]
    }
}

impl core::ops::Deref for EncodedHeader {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        self.as_ref()
    }
}

impl Header {
    /// Which family this header belongs to.
    pub const fn family(&self) -> HeaderFamily {
        match self {
            Header::Stock(_) => HeaderFamily::Stock,
            Header::Blake2bV2(_) => HeaderFamily::Blake2bV2,
        }
    }

    /// The raw wire version.
    pub const fn version(&self) -> u32 {
        match self {
            Header::Stock(h) => h.version,
            Header::Blake2bV2(h) => h.version,
        }
    }

    /// The previous block's hash.
    pub const fn prev_block_hash(&self) -> BlockHash {
        match self {
            Header::Stock(h) => h.prev_block_hash,
            Header::Blake2bV2(h) => h.prev_block_hash,
        }
    }

    /// The merkle root, wire order.
    pub const fn merkle_root(&self) -> [u8; 32] {
        match self {
            Header::Stock(h) => h.merkle_root,
            Header::Blake2bV2(h) => h.merkle_root,
        }
    }

    /// The consensus block time (for v2, with the offset applied when
    /// flagged).
    pub fn time(&self) -> u32 {
        match self {
            Header::Stock(h) => h.time,
            Header::Blake2bV2(h) => h.time(),
        }
    }

    /// Compact target.
    pub const fn bits(&self) -> u32 {
        match self {
            Header::Stock(h) => h.bits,
            Header::Blake2bV2(h) => h.bits,
        }
    }

    /// The (first) nonce.
    pub const fn nonce(&self) -> u32 {
        match self {
            Header::Stock(h) => h.nonce,
            Header::Blake2bV2(h) => h.nonce,
        }
    }

    /// The committed height: a v2 header carries it, a stock header does not
    /// (siding's `blockHeight` then reads the coinbase's BIP 34 push, which
    /// is `sidestr-core`'s job).
    pub const fn height(&self) -> Option<u32> {
        match self {
            Header::Stock(_) => None,
            Header::Blake2bV2(h) => Some(h.height),
        }
    }

    /// The block hash — the family's proof-of-work hash, display order.
    pub fn hash(&self) -> BlockHash {
        match self {
            Header::Stock(h) => h.hash(),
            Header::Blake2bV2(h) => h.hash(),
        }
    }

    /// The wire bytes.
    pub fn encode(&self) -> EncodedHeader {
        let mut buf = [0u8; 164];
        let len = match self {
            Header::Stock(h) => {
                buf[..80].copy_from_slice(&h.encode());
                80
            }
            Header::Blake2bV2(h) => {
                buf.copy_from_slice(&h.encode());
                164
            }
        };
        EncodedHeader { buf, len }
    }

    /// The target `bits` encodes.
    pub fn target(&self) -> Result<Target, Error> {
        Target::from_compact(self.bits())
    }

    /// `hash ≤ target(bits)`.
    pub fn meets_target(&self) -> bool {
        match self {
            Header::Stock(h) => h.meets_target(),
            Header::Blake2bV2(h) => h.meets_target(),
        }
    }

    /// SPEC 4 step 1 against the chain document's `powLimit`; see
    /// [`check_pow`].
    pub fn check_pow(&self, pow_limit: &Target) -> Result<(), Error> {
        check_pow(self.bits(), self.hash(), pow_limit)
    }

    /// The 72-byte BIP-325 preimage with the stripped merkle root in place.
    pub fn signet_preimage(&self, stripped_merkle_root: [u8; 32]) -> [u8; signet::BLOCK_DATA_LEN] {
        match self {
            Header::Stock(h) => h.signet_preimage(stripped_merkle_root),
            Header::Blake2bV2(h) => h.signet_preimage(stripped_merkle_root),
        }
    }

    /// The BIP-325 block data the block signature commits to (SPEC 4 step 2).
    pub fn block_data(&self, stripped_merkle_root: [u8; 32]) -> [u8; 32] {
        signet::block_data(&self.signet_preimage(stripped_merkle_root))
    }
}

/// SPEC 4 step 1, "the header meets `powLimit`. No difficulty adjustment, no
/// minimum-difficulty window", as siding and the kernel enforce it together:
///
/// 1. `bits` equals `pow_limit.to_compact()` — siding writes that value into
///    every block (`siding/lib/chain.mjs`) and the kernel's difficulty rule
///    under `powNoRetargeting` requires each block's bits to equal the
///    previous block's, so the value never moves from genesis;
/// 2. `hash ≤ Target::from_compact(bits)` (`btc:rule-header-pow`).
///
/// Compact encoding keeps only three significant bytes, so the target a
/// block is actually checked against is `powLimit` truncated to its compact
/// form — for the usual `7fff…ff` limit that is `7fffff00…00`, exactly as
/// the kernel's `expandCompact(bits)` computes it.
///
/// Errors are [`Error::BitsNotPowLimit`] and [`Error::TargetNotMet`] in that
/// order; a `bits` that does not decode is reported by [`Target::from_compact`].
///
/// ```
/// use sidestr_header::{check_pow, BlockHash, Target};
/// let lim = Target::from_hex("7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff").unwrap();
/// let easy = BlockHash::from_hex("4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0").unwrap();
/// assert!(check_pow(0x207f_ffff, easy, &lim).is_ok());
/// // Wrong bits, even an easier target, is refused before the hash is looked at.
/// assert!(check_pow(0x2100_ffff, easy, &lim).is_err());
/// // A hash above the limit is refused.
/// let high = BlockHash::from_hex("8000000000000000000000000000000000000000000000000000000000000000").unwrap();
/// assert!(check_pow(0x207f_ffff, high, &lim).is_err());
/// ```
pub fn check_pow(bits: u32, hash: BlockHash, pow_limit: &Target) -> Result<(), Error> {
    let expected = pow_limit.to_compact();
    if bits != expected {
        return Err(Error::BitsNotPowLimit { bits, expected });
    }
    let target = Target::from_compact(bits)?;
    if hash.meets(&target) {
        Ok(())
    } else {
        Err(Error::TargetNotMet)
    }
}
