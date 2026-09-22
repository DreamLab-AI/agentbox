//! The 256-bit proof-of-work target and its compact `bits` encoding.
//!
//! Ported from the kernel's `expandCompact` (`codec/codec.js`) and
//! `compactFromTarget` (`codec/headers.js`), which in turn follow Bitcoin
//! Core's `arith_uint256::SetCompact` / `GetCompact`. The target is held as
//! 32 big-endian bytes so that a [`BlockHash`](crate::BlockHash) (display
//! order, also big-endian as a number) compares against it byte-wise.
//!
//! **Where this crate is stricter than the JS kernel.** `expandCompact`
//! masks the sign bit away and lets an oversized exponent produce a number
//! wider than 256 bits (which every hash would then "meet"). Core rejects
//! both. This crate rejects both too ([`Error::CompactNegative`],
//! [`Error::CompactOverflow`]). On a sidestr chain the difference is
//! unreachable: SPEC 4 step 1 and siding's `chain.mjs` fix every block's
//! `bits` to `compactFromTarget(powLimit)`, and a `powLimit` is at most
//! 2²⁵⁶ − 1, so a valid block never carries an exponent that overflows.

use crate::Error;
use core::fmt;

/// A 256-bit proof-of-work target, big-endian.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Target([u8; 32]);

impl Target {
    /// The largest target, 2²⁵⁶ − 1: every hash meets it.
    pub const MAX: Target = Target([0xff; 32]);

    /// A target from its 32 big-endian bytes.
    pub const fn from_be_bytes(bytes: [u8; 32]) -> Self {
        Target(bytes)
    }

    /// The 32 big-endian bytes.
    pub const fn to_be_bytes(self) -> [u8; 32] {
        self.0
    }

    /// A target from 64 hex characters, most significant first — the form a
    /// chain document's `powLimit` takes (SPEC 3).
    ///
    /// ```
    /// use sidestr_header::Target;
    /// let lim = Target::from_hex("7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff").unwrap();
    /// assert_eq!(lim.to_compact(), 0x207f_ffff);
    /// ```
    pub fn from_hex(s: &str) -> Result<Self, Error> {
        crate::hash::hex32(s).map(Target).ok_or(Error::InvalidHex)
    }

    /// Expands compact `bits` (Core's `SetCompact`): the low 23 bits are the
    /// mantissa, the top byte the size in bytes of the big-endian number the
    /// mantissa is the leading three bytes of.
    ///
    /// ```
    /// use sidestr_header::Target;
    /// // Bitcoin's genesis bits.
    /// let t = Target::from_compact(0x1d00_ffff).unwrap();
    /// assert_eq!(hex::encode(t.to_be_bytes()),
    ///            "00000000ffff0000000000000000000000000000000000000000000000000000");
    /// // A well-known Core example: 0x1b0404cb.
    /// let t = Target::from_compact(0x1b04_04cb).unwrap();
    /// assert_eq!(hex::encode(t.to_be_bytes()),
    ///            "00000000000404cb000000000000000000000000000000000000000000000000");
    /// ```
    pub fn from_compact(bits: u32) -> Result<Self, Error> {
        let exponent = (bits >> 24) as usize;
        let mantissa = bits & 0x007f_ffff;
        if mantissa != 0 && bits & 0x0080_0000 != 0 {
            return Err(Error::CompactNegative(bits));
        }
        let mut out = [0u8; 32];
        if exponent <= 3 {
            // The mantissa is shifted right into fewer than three bytes.
            let word = mantissa >> (8 * (3 - exponent));
            out[29..].copy_from_slice(&word.to_be_bytes()[1..]);
            return Ok(Target(out));
        }
        // Byte i of the mantissa (little-endian index) lands `exponent - 3 + i`
        // bytes from the least significant end.
        let shift = exponent - 3;
        for i in 0..3 {
            let byte = ((mantissa >> (8 * i)) & 0xff) as u8;
            let pos = shift + i;
            if pos > 31 {
                if byte != 0 {
                    return Err(Error::CompactOverflow(bits));
                }
            } else {
                out[31 - pos] = byte;
            }
        }
        Ok(Target(out))
    }

    /// Compact-encodes the target (Core's `GetCompact`, the kernel's
    /// `compactFromTarget`), including the mantissa truncation that makes the
    /// encoding lossy: `from_compact(t.to_compact())` keeps only the three
    /// most significant bytes of `t`.
    ///
    /// ```
    /// use sidestr_header::Target;
    /// assert_eq!(Target::from_compact(0x1d00_ffff).unwrap().to_compact(), 0x1d00_ffff);
    /// assert_eq!(Target::MAX.to_compact(), 0x2100_ffff); // top byte 0xff would read as a sign bit
    /// ```
    pub fn to_compact(self) -> u32 {
        let first = match self.0.iter().position(|&b| b != 0) {
            Some(i) => i,
            None => return 0,
        };
        let mut size = 32 - first;
        let mut compact: u32 = if size <= 3 {
            let mut w = 0u32;
            for &b in &self.0[first..] {
                w = (w << 8) | u32::from(b);
            }
            w << (8 * (3 - size))
        } else {
            (u32::from(self.0[first]) << 16)
                | (u32::from(self.0[first + 1]) << 8)
                | u32::from(self.0[first + 2])
        };
        // The sign bit of the mantissa must stay clear: shift and grow instead.
        if compact & 0x0080_0000 != 0 {
            compact >>= 8;
            size += 1;
        }
        compact | ((size as u32) << 24)
    }

    /// Whether the target is zero, which no hash but zero can meet.
    pub fn is_zero(self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }
}

impl fmt::Debug for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Target(")?;
        crate::hash::fmt_hex(f, &self.0)?;
        f.write_str(")")
    }
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::hash::fmt_hex(f, &self.0)
    }
}
