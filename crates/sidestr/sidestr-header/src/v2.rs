//! Bitcoin Knots' 164-byte v2 header and its BLAKE2b proof of work: the
//! family of a chain beside `xbt` or `txbt4` (SPEC 3.2).
//!
//! Ported from the kernel's `codec/pow/knots-header-v2.js` (the pipeline) and
//! `schema/overlays/knots-blake2b.jsonld` (the layout), which follow Knots
//! v29.4.1 `src/primitives/block.cpp` `CBlockHeader::GetHash`.

use crate::hash::{blake2b_256, tagged_hash, Digest32};
use crate::signet::{self, BLOCK_DATA_LEN};
use crate::stock::{arr16, arr32, u16_at, u32_at};
use crate::{BlockHash, Error, HeaderFamily, Target, VERSION_HEADER_V2_FLAG};

/// `flags` bit 2: the consensus time is `time_on_wire + time_offset`
/// (`FLAG_USE_TIME_OFFSET` in `codec/pow/knots-header-v2.js`).
pub const FLAG_USE_TIME_OFFSET: u8 = 4;

/// `flags` bits 0–1 select the ASIC input layout of the second BLAKE2b round.
pub const FLAG_ASIC_PROFILE_MASK: u8 = 0x03;

/// `flags` bits 6–7 are reserved for future hardforks and must be zero
/// (`knots:rule-header-flags-reserved`).
pub const FLAG_RESERVED_MASK: u8 = 0xc0;

/// The kernel's name for this proof-of-work hash (`POW_HASH_NAME`).
pub const POW_HASH_NAME: &str = "knots:blake2b-v2";

/// The 164-byte header used from the BLAKE2b fork height — on a sidestr chain
/// beside a BLAKE2b parent, from height 0 (`siding/lib/overlay.mjs`:
/// `blake2bHeight: 0`).
///
/// The layout below is the kernel's `knots:BlockHeaderV2` struct with its
/// field comments adapted. The first 80 bytes keep the classic layout
/// (version with bit 31 set; the wire time may be offset); proof of work is
/// the BLAKE2b construction over a commitment tree of these fields, not
/// SHA-256d of the bytes.
///
/// | offset | size | field | wire |
/// |---|---|---|---|
/// | 0 | 4 | `version` | u32le, bit 31 set |
/// | 4 | 32 | `prev_block_hash` | hash256 |
/// | 36 | 32 | `merkle_root` | hash256 |
/// | 68 | 4 | `time_on_wire` | u32le |
/// | 72 | 4 | `bits` | u32le |
/// | 76 | 4 | `nonce` | u32le |
/// | 80 | 4 | `nonce2` | u32le |
/// | 84 | 4 | `nonce3` | u32le |
/// | 88 | 16 | `extranonce` | bytes, wire order |
/// | 104 | 4 | `time_offset` | u32le |
/// | 108 | 2 | `tx_count` | u16le |
/// | 110 | 1 | `flags` | u8 |
/// | 111 | 1 | `xor_key_mask_clear_bits` | u8 |
/// | 112 | 16 | `xor_key` | bytes, wire order |
/// | 128 | 4 | `height` | i32le |
/// | 132 | 32 | `mm_rhs` | hash256 |
///
/// Beside a BLAKE2b parent siding's `buildBlock` sets `version =
/// 0xa000_0000`, every nonce, the extranonce, the XOR key and `mm_rhs` to
/// zero, `flags = 0`, `tx_count` to the block's transaction count and
/// `height` to the block's height; only `nonce` moves while the block is
/// sealed against `powLimit`.
///
/// ```
/// use sidestr_header::{Blake2bV2Header, fork};
/// // txbt4 block 150,308, the fork block: the first v2 / BLAKE2b header.
/// // Captured from a Knots 29.4.1 node (bitcoin-desktop/schema test vectors).
/// let bytes = hex::decode(
///     "000000a0ccb157caa788400a667f6c19858ee913c701a42c8d1cd85122ec17000000000043d2e57990429ae581621ce01aa5fbf5e4c2723996be18660a4930b91e96d6c871b4946affff001dce0ac801d123881f71b4946a00000000b10cf00d0100000000000000000000008e00000000000000000000000000000000000000244b02000000000000000000000000000000000000000000000000000000000000000000",
/// ).unwrap();
/// let h = Blake2bV2Header::decode(&bytes).unwrap();
/// assert_eq!(h.height, fork::TXBT4_FORK_HEIGHT);
/// assert_eq!(h.hash(), fork::TXBT4_FORK_HASH);
/// assert_eq!(h.tx_count, 142);
/// assert_eq!(h.flags, 0); // ASIC profile 0, no time offset
/// assert_eq!(h.encode().as_slice(), bytes.as_slice());
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Blake2bV2Header {
    /// Raw wire version: bit 31 set marks a v2 header; the low bits carry the
    /// usual version.
    pub version: u32,
    /// The previous block's hash.
    pub prev_block_hash: BlockHash,
    /// The transaction merkle root in **wire (internal) order**.
    pub merkle_root: [u8; 32],
    /// Block time as serialised. The consensus time is `time_on_wire +
    /// time_offset` when `flags` bit 2 is set; see [`Self::time`].
    pub time_on_wire: u32,
    /// Compact proof-of-work target.
    pub bits: u32,
    /// The first nonce.
    pub nonce: u32,
    /// The second nonce.
    pub nonce2: u32,
    /// The third nonce.
    pub nonce3: u32,
    /// 128-bit extranonce, wire order (bitcoind's RPC shows it
    /// byte-reversed).
    pub extranonce: [u8; 16],
    /// The offset added to `time_on_wire` when `flags` bit 2 is set; also a
    /// nonce input to the second BLAKE2b round.
    pub time_offset: u32,
    /// Committed transaction count; must equal the block's transaction count
    /// (`knots:rule-block-txcount`).
    pub tx_count: u16,
    /// Bits 0–1: ASIC layout profile; bit 2: time offset in use; bits 6–7
    /// reserved for future hardforks (must be 0).
    pub flags: u8,
    /// How many leading bits of the PoW XOR mask are cleared.
    pub xor_key_mask_clear_bits: u8,
    /// 128-bit PoW XOR key, wire order.
    pub xor_key: [u8; 16],
    /// Committed height; must equal the previous header's height + 1
    /// (`knots:rule-header-height`). Serialised `i32le`; held unsigned.
    pub height: u32,
    /// Merge-mining hook right-hand side, wire order (reserved; all zeros so
    /// far).
    pub mm_rhs: [u8; 32],
}

/// Every intermediate of the v2 pipeline, for tests and debugging — the
/// kernel's `hashHeaderV2Detailed`. Digests are in the byte order the
/// pipeline feeds them onward; `hash` is the display-order block hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct V2HashStages {
    /// `tagged("Bitcoin block hash PoW XOR key", xor_key)`.
    pub xor_key_hash: Digest32,
    /// Round one: the tagged hash over the committed fields.
    pub h1: Digest32,
    /// Round two: the merge-mining hook over `h1`.
    pub h2: Digest32,
    /// The first BLAKE2b-256, over `0 ‖ h2 ‖ extranonce`.
    pub blake2b_1: Digest32,
    /// The second BLAKE2b-256, over the profile-dependent ASIC input.
    pub blake2b_2: Digest32,
    /// The XOR mask applied to `blake2b_2` (zero when the key is zero).
    pub mask: Digest32,
    /// `flags & 3`.
    pub asic_profile: u8,
    /// `blake2b_2 XOR mask`: the block hash.
    pub hash: BlockHash,
}

impl Blake2bV2Header {
    /// Wire size in bytes.
    pub const WIRE_SIZE: usize = 164;

    /// Decodes exactly 164 bytes. Rejects any other length
    /// ([`Error::WrongLength`]) and a version with bit 31 clear
    /// ([`Error::VersionBit31Clear`]). Reserved flag bits are not checked
    /// here — the kernel decodes them and its rule rejects them — see
    /// [`Self::check_flags`].
    pub fn decode(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() != Self::WIRE_SIZE {
            return Err(Error::WrongLength {
                family: HeaderFamily::Blake2bV2,
                expected: Self::WIRE_SIZE,
                actual: bytes.len(),
            });
        }
        let version = u32_at(bytes, 0);
        if version & VERSION_HEADER_V2_FLAG == 0 {
            return Err(Error::VersionBit31Clear);
        }
        Ok(Blake2bV2Header {
            version,
            prev_block_hash: BlockHash::from_wire(arr32(bytes, 4)),
            merkle_root: arr32(bytes, 36),
            time_on_wire: u32_at(bytes, 68),
            bits: u32_at(bytes, 72),
            nonce: u32_at(bytes, 76),
            nonce2: u32_at(bytes, 80),
            nonce3: u32_at(bytes, 84),
            extranonce: arr16(bytes, 88),
            time_offset: u32_at(bytes, 104),
            tx_count: u16_at(bytes, 108),
            flags: bytes[110],
            xor_key_mask_clear_bits: bytes[111],
            xor_key: arr16(bytes, 112),
            height: u32_at(bytes, 128),
            mm_rhs: arr32(bytes, 132),
        })
    }

    /// The 164 wire bytes.
    pub fn encode(&self) -> [u8; 164] {
        let mut out = [0u8; 164];
        out[..72].copy_from_slice(&self.signet_preimage(self.merkle_root));
        out[72..76].copy_from_slice(&self.bits.to_le_bytes());
        out[76..80].copy_from_slice(&self.nonce.to_le_bytes());
        out[80..84].copy_from_slice(&self.nonce2.to_le_bytes());
        out[84..88].copy_from_slice(&self.nonce3.to_le_bytes());
        out[88..104].copy_from_slice(&self.extranonce);
        out[104..108].copy_from_slice(&self.time_offset.to_le_bytes());
        out[108..110].copy_from_slice(&self.tx_count.to_le_bytes());
        out[110] = self.flags;
        out[111] = self.xor_key_mask_clear_bits;
        out[112..128].copy_from_slice(&self.xor_key);
        out[128..132].copy_from_slice(&self.height.to_le_bytes());
        out[132..].copy_from_slice(&self.mm_rhs);
        out
    }

    /// The consensus block time: `time_on_wire + time_offset` (wrapping)
    /// when `flags` bit 2 is set, else `time_on_wire` (`headerTime` in the
    /// kernel).
    pub fn time(&self) -> u32 {
        if self.uses_time_offset() {
            self.time_on_wire.wrapping_add(self.time_offset)
        } else {
            self.time_on_wire
        }
    }

    /// Whether `flags` bit 2 is set.
    pub fn uses_time_offset(&self) -> bool {
        self.flags & FLAG_USE_TIME_OFFSET != 0
    }

    /// `flags & 3`: which ASIC input layout the second BLAKE2b round uses.
    pub fn asic_profile(&self) -> u8 {
        self.flags & FLAG_ASIC_PROFILE_MASK
    }

    /// `knots:rule-header-flags-reserved`: bits 6–7 of `flags` must be zero.
    pub fn check_flags(&self) -> Result<(), Error> {
        if self.flags & FLAG_RESERVED_MASK != 0 {
            Err(Error::ReservedFlags(self.flags))
        } else {
            Ok(())
        }
    }

    /// The block hash, which is the proof-of-work hash (`hashHeaderV2`):
    ///
    /// ```text
    /// h1   = tagged("Bitcoin block header 1",
    ///               version ‖ prev(display) ‖ height ‖ merkle(wire) ‖ time_on_wire ‖ 0x00
    ///               ‖ bits ‖ tx_count as u32 ‖ flags ‖ clear_bits ‖ tagged("…XOR key", xor_key))
    /// h2   = tagged("Merge-mining hook", h1 ‖ 0¹⁶ ‖ 0¹⁶ ‖ mm_rhs(wire))
    /// b1   = blake2b-256(0u32 ‖ h2 ‖ extranonce)
    /// b2   = blake2b-256(profile-dependent layout of prev_hidden / h2, nonces, b1)
    /// hash = b2 XOR mask(xor_key, clear_bits)          (display-order bytes)
    /// ```
    ///
    /// Note the two byte orders inside round one: `prev_block_hash` enters
    /// in display order (Knots' `hashPrevBlock.ReversedBytes()`) while the
    /// merkle root enters in wire order.
    pub fn hash(&self) -> BlockHash {
        self.hash_stages().hash
    }

    /// The pipeline with every intermediate exposed.
    pub fn hash_stages(&self) -> V2HashStages {
        let prev_display = self.prev_block_hash.0;
        let xor_key_hash = tagged_hash(b"Bitcoin block hash PoW XOR key", &[&self.xor_key]);

        let mut mask = [0u8; 32];
        if self.xor_key.iter().any(|&b| b != 0) {
            mask = tagged_hash(b"Bitcoin block hash PoW XOR mask", &[&self.xor_key]);
            let clear_bytes = usize::from(self.xor_key_mask_clear_bits >> 3);
            let n = clear_bytes.min(32);
            mask[..n].fill(0);
            if clear_bytes < 32 {
                mask[clear_bytes] &= 0xff >> (self.xor_key_mask_clear_bits & 7);
            }
        }

        let prev_hidden = tagged_hash(b"Bitcoin prevblock header, hashed", &[&prev_display]);
        let h1 = tagged_hash(
            b"Bitcoin block header 1",
            &[
                &self.version.to_le_bytes(),
                &prev_display,
                &self.height.to_le_bytes(),
                &self.merkle_root,
                &self.time_on_wire.to_le_bytes(),
                &[0u8],
                &self.bits.to_le_bytes(),
                &u32::from(self.tx_count).to_le_bytes(),
                &[self.flags, self.xor_key_mask_clear_bits],
                &xor_key_hash,
            ],
        );
        let zeros16 = [0u8; 16];
        let h2 = tagged_hash(
            b"Merge-mining hook",
            &[&h1, &zeros16, &zeros16, &self.mm_rhs],
        );
        let b1 = blake2b_256(&[&0u32.to_le_bytes(), &h2, &self.extranonce]);

        let nonce = self.nonce.to_le_bytes();
        let nonce2 = self.nonce2.to_le_bytes();
        let nonce3 = self.nonce3.to_le_bytes();
        let offset = self.time_offset.to_le_bytes();
        let asic_profile = self.asic_profile();
        let b2 = match asic_profile {
            0 => {
                let mut p = prev_hidden;
                p[..6].fill(0);
                blake2b_256(&[&p, &nonce, &nonce2, &offset, &nonce3, &b1])
            }
            1 => blake2b_256(&[&nonce, &nonce2, &nonce3, &offset, &b1, &h2]),
            2 => blake2b_256(&[&[0u8; 48], &h2, &nonce, &nonce2, &offset, &nonce3, &b1]),
            _ => blake2b_256(&[&[0u8; 80], &h2, &nonce, &nonce2, &offset, &nonce3, &b1]),
        };

        let mut hash = [0u8; 32];
        for i in 0..32 {
            hash[i] = b2[i] ^ mask[i];
        }
        V2HashStages {
            xor_key_hash,
            h1,
            h2,
            blake2b_1: b1,
            blake2b_2: b2,
            mask,
            asic_profile,
            hash: BlockHash(hash),
        }
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

    /// The first 72 header bytes — `version ‖ prev ‖ merkle_root ‖
    /// time_on_wire` — with `merkle_root` replaced by `stripped_merkle_root`.
    /// Same shape as the stock family's, which is what makes the BIP-325
    /// block data family-agnostic (`siding/lib/block.mjs` `blockData`).
    pub fn signet_preimage(&self, stripped_merkle_root: [u8; 32]) -> [u8; BLOCK_DATA_LEN] {
        let mut out = [0u8; BLOCK_DATA_LEN];
        out[..4].copy_from_slice(&self.version.to_le_bytes());
        out[4..36].copy_from_slice(&self.prev_block_hash.to_wire());
        out[36..68].copy_from_slice(&stripped_merkle_root);
        out[68..].copy_from_slice(&self.time_on_wire.to_le_bytes());
        out
    }

    /// The BIP-325 block data, `SHA256(signet_preimage)` (SPEC 4 step 2).
    pub fn block_data(&self, stripped_merkle_root: [u8; 32]) -> [u8; 32] {
        signet::block_data(&self.signet_preimage(stripped_merkle_root))
    }
}
