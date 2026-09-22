//! BIP-325's block data over a sidestr header, family-agnostic.
//!
//! SPEC 4 step 2 says the signature covers the block's signet hash "computed
//! as BIP 325 computes it over this chain's header serialization". Siding's
//! `blockData` (`siding/lib/block.mjs`) is the concrete rule:
//!
//! > the block data is sha256 of the first 72 header bytes (version, prev,
//! > merkle root, time on wire) with the merkle root recomputed over the
//! > coinbase stripped of its solution
//!
//! The first 72 bytes have the same layout in both families — the v2 header
//! keeps the classic prefix and its `timeOnWire` sits where `time` does — so
//! one function serves both, and `sidestr-core` can sign or verify a block
//! without knowing which family it holds: each header type builds its own
//! [`signet_preimage`](crate::StockHeader::signet_preimage) and this module
//! hashes it. The 32 bytes go into BIP-325's `to_spend` scriptSig as
//! `OP_0 PUSH32 <data>` and the taproot sighash over the virtual
//! transaction is what the challenge key signs; that half lives in
//! `sidestr-core`.

use crate::hash::sha256;

/// The number of header bytes the block data covers.
pub const BLOCK_DATA_LEN: usize = 72;

/// The four bytes that open the solution push in the coinbase's witness
/// commitment output (`SIGNET_HEADER` in `siding/lib/block.mjs`; BIP 325).
pub const SIGNET_HEADER: [u8; 4] = [0xec, 0xc7, 0xda, 0xa2];

/// `SHA256` of a 72-byte signet preimage.
///
/// ```
/// use sidestr_header::{signet, StockHeader};
/// let h = StockHeader::decode(&hex::decode(
///     "0000002000000000000000000000000000000000000000000000000000000000000000003a87d59ecf60ab58ee75948cc39d1bb44ac4285747e64b5a1e7a960d37764cb40e67b26affff7f2002000000",
/// ).unwrap()).unwrap();
/// // The merkle root over dreamlab block 0's coinbase with its solution stripped,
/// // as siding computes it (wire order).
/// let mut stripped = [0u8; 32];
/// stripped.copy_from_slice(&hex::decode(
///     "7541559158594debf1ca0c8fb5f62eb69f779b846e5ba44c1290bfcf19fcb14a").unwrap());
/// assert_eq!(signet::block_data(&h.signet_preimage(stripped)), h.block_data(stripped));
/// assert_eq!(hex::encode(h.block_data(stripped)),
///            "91c7e7089472097c141a3fd5ae5c2d57a4436402b19a884c393217bbb1624c00");
/// ```
pub fn block_data(preimage: &[u8; BLOCK_DATA_LEN]) -> [u8; 32] {
    sha256(preimage)
}
