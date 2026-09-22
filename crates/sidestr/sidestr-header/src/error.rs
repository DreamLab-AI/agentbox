//! The one error type, for decoding and proof-of-work checks.

use crate::HeaderFamily;
use core::fmt;

/// Why a header could not be decoded or does not satisfy a rule.
///
/// Each variant names the upstream rule it stands in for, so a rejection can
/// be traced to the reference: the codec's length check
/// (`codec/codec.js` `decode`, "trailing bytes after BlockHeader"), the
/// header-family selection on version bit 31 (`siding/lib/parents.mjs`,
/// SPEC 3.2), Bitcoin Core's `arith_uint256::SetCompact` overflow and negative
/// cases, and siding's `pow` rule (SPEC 4 step 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Error {
    /// The byte slice is not the family's wire size (80 or 164).
    WrongLength {
        /// The family the bytes were decoded as.
        family: HeaderFamily,
        /// That family's wire size.
        expected: usize,
        /// The length actually supplied.
        actual: usize,
    },
    /// A stock header's version has bit 31 set. Beside a stock parent the
    /// producer keeps it clear (`siding/lib/block.mjs` `buildBlock`,
    /// `test/stock-header-test.mjs` "version keeps bit 31 clear"); on a
    /// BLAKE2b-family chain the same bit would select the v2 layout, so a
    /// stock header carrying it is not a header of either family.
    VersionBit31Set,
    /// A v2 header's version has bit 31 clear: the bytes are not a v2 header
    /// (`isHeaderV2` in `codec/pow/knots-header-v2.js`).
    VersionBit31Clear,
    /// A v2 header's `flags` has a reserved bit (6 or 7) set
    /// (`knots:rule-header-flags-reserved`, error code `bad-flags-highbits`).
    ReservedFlags(u8),
    /// A hex string was not 64 hex characters.
    InvalidHex,
    /// Compact `bits` with the sign bit set and a non-zero mantissa
    /// (Core's `fNegative`).
    CompactNegative(u32),
    /// Compact `bits` whose mantissa would not fit in 256 bits
    /// (Core's `fOverflow`).
    CompactOverflow(u32),
    /// The header's `bits` is not the compact encoding of the chain's
    /// `powLimit`. Siding sets every block's bits to that value
    /// (`siding/lib/chain.mjs`: `compactFromTarget(powLimit)`) and the
    /// kernel's difficulty rule holds it there (`powNoRetargeting`).
    BitsNotPowLimit {
        /// The header's `bits`.
        bits: u32,
        /// `powLimit` in compact form.
        expected: u32,
    },
    /// The block hash, read as a 256-bit number, exceeds the target `bits`
    /// encodes (`btc:rule-header-pow`; SPEC 4 step 1).
    TargetNotMet,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::WrongLength {
                family,
                expected,
                actual,
            } => write!(f, "a {family} header is {expected} bytes, got {actual}"),
            Error::VersionBit31Set => f.write_str("stock header version has bit 31 set"),
            Error::VersionBit31Clear => f.write_str("v2 header version has bit 31 clear"),
            Error::ReservedFlags(flags) => {
                write!(
                    f,
                    "v2 header flags {flags:#04x} set a reserved bit (6 or 7)"
                )
            }
            Error::InvalidHex => f.write_str("expected 64 hex characters"),
            Error::CompactNegative(bits) => write!(f, "compact target {bits:#010x} is negative"),
            Error::CompactOverflow(bits) => {
                write!(f, "compact target {bits:#010x} overflows 256 bits")
            }
            Error::BitsNotPowLimit { bits, expected } => write!(
                f,
                "header bits {bits:#010x} are not the chain's powLimit {expected:#010x}"
            ),
            Error::TargetNotMet => f.write_str("block hash does not meet the target"),
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for Error {}
