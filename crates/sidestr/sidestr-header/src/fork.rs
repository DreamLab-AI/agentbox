//! The two BLAKE2b forks' activation points, from SPEC 3.2's parents table.
//!
//! A fork shares its origin's genesis, so the block that fixes which chain an
//! alias means is the first block on the fork's side. A validator beside
//! `xbt` or `txbt4` asserts at boot that the parent's block at the fork
//! height has the fork hash (ADR-2103 D3a: the fork keeps mainnet's network
//! magic and port, so a wrong-chain parent looks healthy). Sources:
//! `siding/lib/parents.mjs` and the kernel's
//! `schema/overlays/knots-blake2b.jsonld` (`blake2bHeight`, `forkBlockHash`).

use crate::hash::hex32_const;
use crate::BlockHash;

/// `xbt`, BLAKE2b mainnet (Knots): the height of the first v2 / BLAKE2b
/// header. Bitcoin's history is shared through 961,631; eight Knots-only
/// SHA-256d blocks 961,632–961,639 precede it.
pub const XBT_FORK_HEIGHT: u32 = 961_640;

/// `xbt`: the hash of block 961,640.
pub const XBT_FORK_HASH: BlockHash = BlockHash(hex32_const(
    "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
));

/// `txbt4`, BLAKE2b testnet4 (Knots): the height of the first v2 / BLAKE2b
/// header. Testnet4's history is shared through 150,307.
pub const TXBT4_FORK_HEIGHT: u32 = 150_308;

/// `txbt4`: the hash of block 150,308.
pub const TXBT4_FORK_HASH: BlockHash = BlockHash(hex32_const(
    "000000000000b9d1b7e1bb0e77215ee92c6ef7ec8f4473e23908380649e779b6",
));

/// `btc` / `xbt`: Bitcoin's genesis block hash (shared by the fork).
pub const BTC_GENESIS_HASH: BlockHash = BlockHash(hex32_const(
    "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
));

/// `tbtc4` / `txbt4`: testnet4's genesis block hash (shared by the fork).
pub const TBTC4_GENESIS_HASH: BlockHash = BlockHash(hex32_const(
    "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043",
));
