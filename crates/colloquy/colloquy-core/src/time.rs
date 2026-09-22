//! UTC timestamps with RFC 3339 wire form, and no dependency on a clock.
//!
//! The cq knowledge-unit schema records instants as RFC 3339 strings
//! (`"2026-02-28T14:17:00Z"`). This module carries just enough calendar
//! arithmetic to read and write that form, so the crate stays free of a date
//! library and builds unchanged for `wasm32`.
//!
//! [`Timestamp`] is *data*, never a reading of the current time: every
//! time-dependent function in this crate takes `now: Timestamp` as an argument.
//! That is what makes decay and staleness testable and identical on both sides
//! of an edge deployment.
//!
//! ```
//! use colloquy_core::time::Timestamp;
//!
//! let t = Timestamp::parse_rfc3339("2026-02-28T14:17:00Z").unwrap();
//! assert_eq!(t.as_secs(), 1_772_288_220);
//! assert_eq!(t.to_rfc3339(), "2026-02-28T14:17:00Z");
//! ```

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Seconds in a day, the only unit conversion this module needs beyond the
/// civil-calendar algorithms.
const SECS_PER_DAY: i64 = 86_400;

/// A UTC instant, stored as seconds since the Unix epoch.
///
/// Serialises as an RFC 3339 string with a `Z` offset so a unit round-trips
/// through cq's own JSON without a translation layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Timestamp(i64);

/// A timestamp that could not be read from its wire form.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not an RFC 3339 UTC timestamp: {0}")]
pub struct TimestampParseError(pub String);

impl Timestamp {
    /// Build a timestamp from seconds since the Unix epoch.
    pub const fn from_secs(secs: i64) -> Self {
        Self(secs)
    }

    /// Seconds since the Unix epoch.
    pub const fn as_secs(self) -> i64 {
        self.0
    }

    /// Seconds elapsed from `self` to `later`, saturating at zero when `later`
    /// precedes `self`.
    ///
    /// Ages are never negative in this crate: a unit confirmed in the future
    /// relative to `now` (clock skew across a federation) is treated as fresh,
    /// not as having decayed by a negative amount.
    pub const fn elapsed_to(self, later: Timestamp) -> u64 {
        let d = later.0 - self.0;
        if d < 0 {
            0
        } else {
            d as u64
        }
    }

    /// Advance by a whole number of seconds.
    pub const fn plus_secs(self, secs: i64) -> Self {
        Self(self.0 + secs)
    }

    /// Render as RFC 3339 with a `Z` offset and second precision.
    pub fn to_rfc3339(self) -> String {
        let days = self.0.div_euclid(SECS_PER_DAY);
        let rem = self.0.rem_euclid(SECS_PER_DAY);
        let (y, m, d) = civil_from_days(days);
        let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
        format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
    }

    /// Read an RFC 3339 UTC timestamp.
    ///
    /// Accepts the `Z` offset and an optional fractional-second part, which is
    /// truncated: the schema's instants are recorded to the second and nothing
    /// in the crate reasons at finer resolution. A numeric offset (`+01:00`) is
    /// rejected rather than silently misread — cq writes `Z`.
    pub fn parse_rfc3339(s: &str) -> Result<Self, TimestampParseError> {
        let err = || TimestampParseError(s.to_string());
        let b = s.as_bytes();
        // `YYYY-MM-DDTHH:MM:SS` is 19 bytes before any fraction or offset.
        if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
            return Err(err());
        }
        if b[13] != b':' || b[16] != b':' {
            return Err(err());
        }
        let tail = &s[19..];
        let tail = tail.strip_prefix('.').map_or(tail, |frac| {
            let n = frac.bytes().take_while(u8::is_ascii_digit).count();
            &frac[n..]
        });
        if tail != "Z" && tail != "z" {
            return Err(err());
        }
        let num = |r: std::ops::Range<usize>| s[r].parse::<i64>().map_err(|_| err());
        let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
        let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
        if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 60 {
            return Err(err());
        }
        Ok(Self(
            days_from_civil(y, mo as u32, d as u32) * SECS_PER_DAY + hh * 3600 + mm * 60 + ss,
        ))
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_rfc3339())
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_rfc3339())
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Timestamp::parse_rfc3339(&s).map_err(serde::de::Error::custom)
    }
}

/// Days since 1970-01-01 for a proleptic-Gregorian civil date.
///
/// Howard Hinnant's `days_from_civil`, which is exact for the whole range the
/// `i64` second count can express and needs no lookup tables.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = ((m + 9) % 12) as i64; // March = 0
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// The inverse of [`days_from_civil`].
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11], March = 0
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_the_schema_example_instants() {
        // Both instants are taken verbatim from the cq knowledge-unit example.
        for s in [
            "2025-01-15T09:32:00Z",
            "2026-02-28T14:17:00Z",
            "2026-03-10T08:00:00Z",
            "2025-01-20T11:00:00Z",
        ] {
            let t = Timestamp::parse_rfc3339(s).unwrap();
            assert_eq!(t.to_rfc3339(), s, "round trip of {s}");
        }
    }

    #[test]
    fn epoch_and_leap_days_are_exact() {
        assert_eq!(Timestamp::from_secs(0).to_rfc3339(), "1970-01-01T00:00:00Z");
        // 2024 is a leap year; 2100 is not.
        assert_eq!(
            Timestamp::parse_rfc3339("2024-02-29T00:00:00Z")
                .unwrap()
                .to_rfc3339(),
            "2024-02-29T00:00:00Z"
        );
        assert!(Timestamp::parse_rfc3339("2100-02-29T00:00:00Z").is_ok_and(
            // 2100-02-29 does not exist; civil_from_days normalises it to 03-01,
            // which is the documented behaviour of the algorithm pair.
            |t| t.to_rfc3339() == "2100-03-01T00:00:00Z"
        ));
    }

    #[test]
    fn truncates_fractional_seconds_and_rejects_offsets() {
        assert_eq!(
            Timestamp::parse_rfc3339("2026-02-28T14:17:00.482Z")
                .unwrap()
                .to_rfc3339(),
            "2026-02-28T14:17:00Z"
        );
        assert!(Timestamp::parse_rfc3339("2026-02-28T14:17:00+01:00").is_err());
        assert!(Timestamp::parse_rfc3339("not a date").is_err());
        assert!(Timestamp::parse_rfc3339("2026-13-01T00:00:00Z").is_err());
    }

    #[test]
    fn elapsed_saturates_rather_than_going_negative() {
        let a = Timestamp::from_secs(1000);
        let b = Timestamp::from_secs(400);
        assert_eq!(
            a.elapsed_to(b),
            0,
            "clock skew must not read as negative age"
        );
        assert_eq!(b.elapsed_to(a), 600);
    }
}
