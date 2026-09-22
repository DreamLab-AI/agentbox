//! The hash primitives both families are built from, as thin wrappers over
//! RustCrypto: SHA-256, SHA-256d, the BIP-340 tagged hash and BLAKE2b-256.
//!
//! Nothing here is hand-rolled. The upstream kernel carries its own pure-JS
//! SHA-256 and BLAKE2b (`codec/hash.js`, `codec/pow/blake2b.js`) so that it
//! runs in a browser without dependencies; this crate takes the same
//! functions from [`sha2`] and [`blake2`] instead.
//!
//! One detail the kernel's `blake2b.js` header comment makes explicit is worth
//! repeating here: Knots hashes with `blake2b_nokey(out, 32, in, len)`, and a
//! **32-byte BLAKE2b digest is not a truncated BLAKE2b-512** — the output
//! length is mixed into the parameter block, so the IV differs.
//! [`blake2::Blake2b`] parameterised with `U32` does exactly that, which the
//! Knots vectors in this crate's tests confirm stage for stage.

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest as _};
use sha2::Sha256;

/// BLAKE2b with a 32-byte digest length in its parameter block (RFC 7693
/// `blake2b(…, outlen = 32)`), the function Knots' v2 proof of work uses.
pub type Blake2b256 = Blake2b<U32>;

/// The 32-byte digest every stage of both pipelines produces.
pub type Digest32 = [u8; 32];

/// SHA-256 of `data`.
///
/// ```
/// let d = sidestr_header::hash::sha256(b"abc");
/// assert_eq!(hex::encode(d), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
/// ```
pub fn sha256(data: &[u8]) -> Digest32 {
    Sha256::digest(data).into()
}

/// Bitcoin's hash function, SHA-256 applied twice (`dsha256` in the kernel's
/// `codec/hash.js`). The stock family's block hash is this over the 80 bytes.
pub fn sha256d(data: &[u8]) -> Digest32 {
    sha256(&sha256(data))
}

/// The BIP-340 tagged hash `SHA256(SHA256(tag) ‖ SHA256(tag) ‖ chunks…)`, as
/// `taggedHash` in the kernel's `codec/hash.js`. Every SHA-256 round of the
/// Knots v2 pipeline is one of these; `chunks` are concatenated in order.
///
/// ```
/// use sidestr_header::hash::tagged_hash;
/// // The same message in one chunk or two hashes identically.
/// assert_eq!(tagged_hash(b"BIP0340/challenge", &[b"ab", b"c"]),
///            tagged_hash(b"BIP0340/challenge", &[b"abc"]));
/// ```
pub fn tagged_hash(tag: &[u8], chunks: &[&[u8]]) -> Digest32 {
    let tag_hash = sha256(tag);
    let mut h = Sha256::new();
    h.update(tag_hash);
    h.update(tag_hash);
    for c in chunks {
        h.update(c);
    }
    h.finalize().into()
}

/// BLAKE2b-256 over the concatenation of `chunks` (`blake2b(input, 32)` in the
/// kernel's `codec/pow/blake2b.js`; unkeyed, no salt, no personalisation).
///
/// ```
/// use sidestr_header::hash::blake2b_256;
/// // RFC 7693 does not publish a 256-bit unkeyed vector; the Knots vectors in
/// // this crate's tests pin the function. Here: determinism and chunking.
/// assert_eq!(blake2b_256(&[b"hello ", b"world"]), blake2b_256(&[b"hello world"]));
/// ```
pub fn blake2b_256(chunks: &[&[u8]]) -> Digest32 {
    let mut h = Blake2b256::new();
    for c in chunks {
        h.update(c);
    }
    h.finalize().into()
}

/// Parses exactly 32 bytes of hex (64 characters, either case) without
/// allocating. Returns `None` for any other length or a non-hex character.
pub(crate) fn hex32(s: &str) -> Option<[u8; 32]> {
    let b = s.as_bytes();
    if b.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        let hi = nibble(b[2 * i])?;
        let lo = nibble(b[2 * i + 1])?;
        out[i] = (hi << 4) | lo;
        i += 1;
    }
    Some(out)
}

const fn nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// `hex32` usable in `const` context, for the fork constants. Panics at
/// compile time on malformed input, which is the point: a typo in a constant
/// is a build failure, not a wrong chain.
pub(crate) const fn hex32_const(s: &str) -> [u8; 32] {
    let b = s.as_bytes();
    assert!(b.len() == 64, "a block hash is 64 hex characters");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        let hi = match nibble(b[2 * i]) {
            Some(v) => v,
            None => panic!("not hex"),
        };
        let lo = match nibble(b[2 * i + 1]) {
            Some(v) => v,
            None => panic!("not hex"),
        };
        out[i] = (hi << 4) | lo;
        i += 1;
    }
    out
}

/// Writes `bytes` as lowercase hex to a formatter without allocating.
pub(crate) fn fmt_hex(f: &mut core::fmt::Formatter<'_>, bytes: &[u8]) -> core::fmt::Result {
    for b in bytes {
        write!(f, "{b:02x}")?;
    }
    Ok(())
}
