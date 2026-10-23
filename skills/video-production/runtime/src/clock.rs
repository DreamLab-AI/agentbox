//! Exact frame-clock arithmetic for video production.
//!
//! Broadcast rates such as 30000/1001 do not divide whole seconds into whole
//! frames: 18 s is 539.46 frames. This module keeps every quantity rational
//! (integer arithmetic only, never `f64` accumulation) and makes the
//! duration-versus-frame-count decision an explicit, recorded policy instead of
//! an accident of rounding.
//!
//! * [`RationalRate`] is a reduced frames-per-second fraction.
//! * [`RationalSeconds`] is an exact duration.
//! * [`DurationPolicy`] decides which of duration or frame count is
//!   authoritative, how to round, and how much error is tolerated.
//! * [`FrameInterval`] is a half-open `[start, end)` range of frames.
//!
//! ```
//! use video_production_runtime::clock::{
//!     DurationPolicy, Priority, RationalRate, RationalSeconds, Rounding,
//! };
//!
//! // 18 s at 30000/1001 is not a whole number of frames (539.46).
//! let rate = RationalRate::new(30000, 1001).unwrap();
//! let eighteen = RationalSeconds::whole(18);
//! assert_eq!(rate.exact_frames(eighteen).unwrap(), (540_000, 1_001)); // 539.46
//!
//! // A strict policy refuses to guess.
//! let strict = DurationPolicy::strict();
//! assert!(strict.resolve(rate, Some(eighteen), None).is_err());
//!
//! // A permissive policy picks a rounding and a tolerance of one frame interval.
//! let policy = DurationPolicy {
//!     priority: Priority::Duration,
//!     rounding: Rounding::Ceil,
//!     allowed_error: rate.frame_interval(),
//! };
//! assert_eq!(policy.resolve(rate, Some(eighteen), None).unwrap().frames, 540);
//! ```
#![deny(missing_docs)]

use serde::{Deserialize, Serialize};
use std::{cmp::Ordering, fmt};

/// Errors raised by clock arithmetic and policy resolution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClockError {
    /// A rate or duration had a zero numerator or denominator where that is meaningless.
    Zero(&'static str),
    /// A rate string could not be parsed.
    Parse(String),
    /// An intermediate value overflowed 128-bit integer arithmetic.
    Overflow,
    /// The duration is not a whole number of frames and the rounding is [`Rounding::Exact`].
    NonIntegral {
        /// Exact frames as `(numerator, denominator)`.
        exact: (u128, u128),
    },
    /// The rounded frame count differs from the requested duration by more than allowed.
    ExceedsAllowedError {
        /// The frame count that rounding produced.
        frames: u64,
    },
    /// The policy needed an input (duration or frame count) that was not supplied.
    Missing(&'static str),
    /// Both a duration and a frame count were supplied and they disagree.
    Conflict {
        /// Frame count derived from the authoritative input.
        derived: u64,
        /// Frame count that was supplied.
        supplied: u64,
    },
    /// A frame interval had `end < start`.
    InvertedInterval,
}

impl fmt::Display for ClockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Zero(what) => write!(f, "{what} must be non-zero"),
            Self::Parse(text) => write!(f, "cannot parse rate {text:?}"),
            Self::Overflow => write!(f, "clock arithmetic overflow"),
            Self::NonIntegral { exact } => write!(
                f,
                "duration is {}/{} frames, which is not integral and rounding is exact",
                exact.0, exact.1
            ),
            Self::ExceedsAllowedError { frames } => write!(
                f,
                "{frames} frames differs from the requested duration by more than the allowed error"
            ),
            Self::Missing(what) => write!(f, "policy requires {what}"),
            Self::Conflict { derived, supplied } => write!(
                f,
                "authoritative input gives {derived} frames but {supplied} were supplied"
            ),
            Self::InvertedInterval => write!(f, "frame interval end precedes its start"),
        }
    }
}

impl std::error::Error for ClockError {}

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn mul(a: u128, b: u128) -> Result<u128, ClockError> {
    a.checked_mul(b).ok_or(ClockError::Overflow)
}

/// A reduced, strictly positive frames-per-second fraction.
///
/// Deserialises from a bare integer (`25`), a string (`"30000/1001"`) or an
/// object (`{"num":30000,"den":1001}`), and always serialises as the object.
///
/// ```
/// use video_production_runtime::clock::RationalRate;
/// let rate: RationalRate = "50/2".parse().unwrap();
/// assert_eq!((rate.num(), rate.den()), (25, 1)); // reduced
/// assert!(rate.matches_probe("25/1"));
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "RateRepr", into = "RatePair")]
pub struct RationalRate {
    num: u32,
    den: u32,
}

#[derive(Serialize)]
struct RatePair {
    num: u32,
    den: u32,
}

impl From<RationalRate> for RatePair {
    fn from(rate: RationalRate) -> Self {
        Self {
            num: rate.num,
            den: rate.den,
        }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RateRepr {
    Integer(u32),
    Text(String),
    Pair { num: u32, den: u32 },
}

impl TryFrom<RateRepr> for RationalRate {
    type Error = ClockError;
    fn try_from(repr: RateRepr) -> Result<Self, ClockError> {
        match repr {
            RateRepr::Integer(n) => Self::new(n, 1),
            RateRepr::Text(s) => s.parse(),
            RateRepr::Pair { num, den } => Self::new(num, den),
        }
    }
}

impl RationalRate {
    /// Build a reduced rate; both terms must be non-zero.
    pub fn new(num: u32, den: u32) -> Result<Self, ClockError> {
        if num == 0 {
            return Err(ClockError::Zero("rate numerator"));
        }
        if den == 0 {
            return Err(ClockError::Zero("rate denominator"));
        }
        let g = gcd(num.into(), den.into()) as u32;
        Ok(Self {
            num: num / g,
            den: den / g,
        })
    }

    /// Reduced numerator (frames).
    pub fn num(self) -> u32 {
        self.num
    }

    /// Reduced denominator (seconds).
    pub fn den(self) -> u32 {
        self.den
    }

    /// Approximate rate as a float, for display only.
    pub fn as_f64(self) -> f64 {
        f64::from(self.num) / f64::from(self.den)
    }

    /// The exact duration of one frame.
    pub fn frame_interval(self) -> RationalSeconds {
        RationalSeconds {
            num: self.den.into(),
            den: self.num.into(),
        }
    }

    /// Whether an `ffprobe` `r_frame_rate` string (for example `"25/1"`) denotes
    /// this rate. Compared as a fraction, never as text.
    pub fn matches_probe(self, probe: &str) -> bool {
        probe.parse::<Self>().is_ok_and(|other| other == self)
    }

    /// FFmpeg rate argument, e.g. `30000/1001`.
    pub fn ffmpeg_rate(self) -> String {
        format!("{}/{}", self.num, self.den)
    }

    /// FFmpeg `setpts` expression that renumbers frames onto this clock.
    pub fn setpts_expr(self) -> String {
        format!("N*{}/({}*TB)", self.den, self.num)
    }

    /// Exact frame count of `duration` as an unreduced `(numerator, denominator)`.
    pub fn exact_frames(self, duration: RationalSeconds) -> Result<(u128, u128), ClockError> {
        let num = mul(duration.num.into(), self.num.into())?;
        let den = mul(duration.den.into(), self.den.into())?;
        let g = gcd(num, den).max(1);
        Ok((num / g, den / g))
    }

    /// Exact duration of `frames` frames.
    pub fn duration_of(self, frames: u64) -> Result<RationalSeconds, ClockError> {
        let num = mul(frames.into(), self.den.into())?;
        let den: u128 = self.num.into();
        let g = gcd(num, den).max(1);
        Ok(RationalSeconds {
            num: u64::try_from(num / g).map_err(|_| ClockError::Overflow)?,
            den: u64::try_from(den / g).map_err(|_| ClockError::Overflow)?,
        })
    }
}

impl std::str::FromStr for RationalRate {
    type Err = ClockError;
    fn from_str(s: &str) -> Result<Self, ClockError> {
        let bad = || ClockError::Parse(s.to_owned());
        match s.split_once('/') {
            Some((n, d)) => Self::new(
                n.trim().parse().map_err(|_| bad())?,
                d.trim().parse().map_err(|_| bad())?,
            ),
            None => Self::new(s.trim().parse().map_err(|_| bad())?, 1),
        }
    }
}

impl fmt::Display for RationalRate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.num, self.den)
    }
}

/// Parse a JSON frame-rate field written as an integer, string or `{num,den}`.
///
/// Returns `None` when the field is absent or not a valid rate, so a receipt
/// check can compare with `rate_from_json(v) == Some(expected)`.
pub fn rate_from_json(value: &serde_json::Value) -> Option<RationalRate> {
    serde_json::from_value(value.clone()).ok()
}

/// The frame rate of a render or scene receipt: its `rate` field, else the
/// legacy `fps` field that existing producers write.
pub fn rate_from_receipt(receipt: &serde_json::Value) -> Option<RationalRate> {
    rate_from_json(&receipt["rate"]).or_else(|| rate_from_json(&receipt["fps"]))
}

/// An exact non-negative duration in seconds, as a fraction.
///
/// Deserialises from a bare number of whole seconds, or `{"num":..,"den":..}`.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(try_from = "SecondsRepr")]
pub struct RationalSeconds {
    num: u64,
    den: u64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SecondsRepr {
    Whole(u64),
    Pair { num: u64, den: u64 },
}

impl TryFrom<SecondsRepr> for RationalSeconds {
    type Error = ClockError;
    fn try_from(repr: SecondsRepr) -> Result<Self, ClockError> {
        match repr {
            SecondsRepr::Whole(n) => Ok(Self::whole(n)),
            SecondsRepr::Pair { num, den } => Self::new(num, den),
        }
    }
}

impl RationalSeconds {
    /// `num / den` seconds; the denominator must be non-zero.
    pub fn new(num: u64, den: u64) -> Result<Self, ClockError> {
        if den == 0 {
            return Err(ClockError::Zero("duration denominator"));
        }
        let g = gcd(num.into(), den.into()).max(1) as u64;
        Ok(Self {
            num: num / g,
            den: den / g,
        })
    }

    /// A whole number of seconds.
    pub fn whole(seconds: u64) -> Self {
        Self {
            num: seconds,
            den: 1,
        }
    }

    /// Milliseconds as an exact fraction of a second.
    pub fn from_millis(ms: u64) -> Self {
        Self::new(ms, 1000).expect("denominator is constant and non-zero")
    }

    /// Approximate value in seconds, for display only.
    pub fn as_f64(self) -> f64 {
        self.num as f64 / self.den as f64
    }

    fn cmp_exact(self, other: Self) -> Result<Ordering, ClockError> {
        Ok(mul(self.num.into(), other.den.into())?.cmp(&mul(other.num.into(), self.den.into())?))
    }
}

impl PartialEq for RationalSeconds {
    fn eq(&self, other: &Self) -> bool {
        self.cmp_exact(*other) == Ok(Ordering::Equal)
    }
}

impl Eq for RationalSeconds {}

/// How a non-integral frame count is turned into a whole number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rounding {
    /// Refuse: the duration must be a whole number of frames.
    Exact,
    /// Round down.
    Floor,
    /// Round up.
    Ceil,
    /// Round to nearest; halves round up.
    Nearest,
}

/// Which input is authoritative when both a duration and a frame count exist.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    /// The duration is the contract; the frame count is derived from it.
    Duration,
    /// The frame count is the contract; a duration, if given, is only checked.
    FrameCount,
}

/// A recorded decision about reconciling duration with an integral frame count.
///
/// `allowed_error` bounds the gap between the requested duration and the
/// duration of the resolved frame count. The default (see [`strict`](Self::strict))
/// allows none, so only exactly representable durations pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DurationPolicy {
    /// Which input wins.
    pub priority: Priority,
    /// How a fractional frame count is rounded.
    pub rounding: Rounding,
    /// Largest permitted difference between requested and resolved duration.
    pub allowed_error: RationalSeconds,
}

/// The outcome of [`DurationPolicy::resolve`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Resolved {
    /// The integral frame count to produce.
    pub frames: u64,
    /// The exact duration of those frames at the given rate.
    pub duration: RationalSeconds,
}

impl DurationPolicy {
    /// Duration is authoritative, rounding is exact and no error is tolerated.
    pub fn strict() -> Self {
        Self {
            priority: Priority::Duration,
            rounding: Rounding::Exact,
            allowed_error: RationalSeconds::whole(0),
        }
    }

    /// Resolve an integral frame count at `rate`.
    ///
    /// With [`Priority::Duration`] a duration is required and the frame count is
    /// derived by `rounding`; a supplied `frames` must equal the derived count.
    /// With [`Priority::FrameCount`] `frames` is required; a supplied duration is
    /// only checked against `allowed_error`.
    pub fn resolve(
        &self,
        rate: RationalRate,
        duration: Option<RationalSeconds>,
        frames: Option<u64>,
    ) -> Result<Resolved, ClockError> {
        let resolved = match self.priority {
            Priority::Duration => {
                let duration = duration.ok_or(ClockError::Missing("a duration"))?;
                let derived = self.round(rate, duration)?;
                if let Some(supplied) = frames
                    && supplied != derived
                {
                    return Err(ClockError::Conflict { derived, supplied });
                }
                derived
            }
            Priority::FrameCount => frames.ok_or(ClockError::Missing("a frame count"))?,
        };
        let actual = rate.duration_of(resolved)?;
        if let Some(requested) = duration {
            let (low, high) = if actual.cmp_exact(requested)? == Ordering::Less {
                (actual, requested)
            } else {
                (requested, actual)
            };
            // gap = high - low, compared with allowed_error without division.
            let gap_num = mul(high.num.into(), low.den.into())?
                .checked_sub(mul(low.num.into(), high.den.into())?)
                .ok_or(ClockError::Overflow)?;
            let gap_den = mul(high.den.into(), low.den.into())?;
            let lhs = mul(gap_num, self.allowed_error.den.into())?;
            let rhs = mul(self.allowed_error.num.into(), gap_den)?;
            if lhs > rhs {
                return Err(ClockError::ExceedsAllowedError { frames: resolved });
            }
        }
        Ok(Resolved {
            frames: resolved,
            duration: actual,
        })
    }

    fn round(&self, rate: RationalRate, duration: RationalSeconds) -> Result<u64, ClockError> {
        let (n, d) = rate.exact_frames(duration)?;
        let floor = n / d;
        let remainder = n % d;
        let value = match (self.rounding, remainder) {
            (_, 0) => floor,
            (Rounding::Exact, _) => return Err(ClockError::NonIntegral { exact: (n, d) }),
            (Rounding::Floor, _) => floor,
            (Rounding::Ceil, _) => floor + 1,
            (Rounding::Nearest, r) => floor + u128::from(mul(r, 2)? >= d),
        };
        u64::try_from(value).map_err(|_| ClockError::Overflow)
    }
}

/// A half-open range of frames, `[start, end)`.
///
/// Matches the convention used throughout the production receipts: a start is
/// inclusive and an end exclusive, so adjacent intervals share a boundary and
/// never a frame.
///
/// ```
/// use video_production_runtime::clock::FrameInterval;
/// let a = FrameInterval::new(0, 10).unwrap();
/// let b = FrameInterval::new(10, 25).unwrap();
/// assert!(a.abuts(b) && !a.overlaps(b));
/// assert_eq!(a.join(b).unwrap().len(), 25);
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "[u64; 2]", into = "[u64; 2]")]
pub struct FrameInterval {
    start: u64,
    end: u64,
}

impl TryFrom<[u64; 2]> for FrameInterval {
    type Error = ClockError;
    fn try_from(pair: [u64; 2]) -> Result<Self, ClockError> {
        Self::new(pair[0], pair[1])
    }
}

impl From<FrameInterval> for [u64; 2] {
    fn from(interval: FrameInterval) -> Self {
        [interval.start, interval.end]
    }
}

impl FrameInterval {
    /// `[start, end)`; `end` may equal `start` (empty) but not precede it.
    pub fn new(start: u64, end: u64) -> Result<Self, ClockError> {
        if end < start {
            return Err(ClockError::InvertedInterval);
        }
        Ok(Self { start, end })
    }

    /// First frame, inclusive.
    pub fn start(self) -> u64 {
        self.start
    }

    /// One past the last frame.
    pub fn end(self) -> u64 {
        self.end
    }

    /// Number of frames.
    pub fn len(self) -> u64 {
        self.end - self.start
    }

    /// Whether the interval holds no frames.
    pub fn is_empty(self) -> bool {
        self.start == self.end
    }

    /// Whether `frame` lies in `[start, end)`.
    pub fn contains(self, frame: u64) -> bool {
        self.start <= frame && frame < self.end
    }

    /// Whether the two intervals share at least one frame.
    pub fn overlaps(self, other: Self) -> bool {
        self.start < other.end && other.start < self.end && !self.is_empty() && !other.is_empty()
    }

    /// The shared frames, if any.
    pub fn intersect(self, other: Self) -> Option<Self> {
        self.overlaps(other).then(|| Self {
            start: self.start.max(other.start),
            end: self.end.min(other.end),
        })
    }

    /// Whether `other` begins exactly where `self` ends, or the reverse.
    pub fn abuts(self, other: Self) -> bool {
        self.end == other.start || other.end == self.start
    }

    /// The union, when the intervals overlap or abut.
    pub fn join(self, other: Self) -> Option<Self> {
        (self.overlaps(other) || self.abuts(other)).then(|| Self {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        })
    }

    /// Start and end times of the interval at `rate`.
    pub fn seconds(
        self,
        rate: RationalRate,
    ) -> Result<(RationalSeconds, RationalSeconds), ClockError> {
        Ok((rate.duration_of(self.start)?, rate.duration_of(self.end)?))
    }

    /// Whether `intervals`, in order, tile `[0, total)` with no gap or overlap.
    pub fn tiles(intervals: &[Self], total: u64) -> bool {
        let mut end = 0;
        for interval in intervals {
            if interval.is_empty() || interval.start != end {
                return false;
            }
            end = interval.end;
        }
        end == total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATES: [(u32, u32); 7] = [
        (24, 1),
        (25, 1),
        (30, 1),
        (60, 1),
        (24000, 1001),
        (30000, 1001),
        (60000, 1001),
    ];

    fn rate(n: u32, d: u32) -> RationalRate {
        RationalRate::new(n, d).unwrap()
    }

    #[test]
    fn eighteen_seconds_at_ntsc_is_539_or_540_and_never_exact() {
        let r = rate(30000, 1001);
        let d = RationalSeconds::whole(18);
        assert_eq!(r.exact_frames(d).unwrap(), (540_000, 1001));
        let with = |rounding| DurationPolicy {
            priority: Priority::Duration,
            rounding,
            allowed_error: r.frame_interval(),
        };
        assert_eq!(
            with(Rounding::Floor)
                .resolve(r, Some(d), None)
                .unwrap()
                .frames,
            539
        );
        assert_eq!(
            with(Rounding::Ceil)
                .resolve(r, Some(d), None)
                .unwrap()
                .frames,
            540
        );
        assert_eq!(
            with(Rounding::Nearest)
                .resolve(r, Some(d), None)
                .unwrap()
                .frames,
            539
        );
        assert!(matches!(
            with(Rounding::Exact).resolve(r, Some(d), None),
            Err(ClockError::NonIntegral { .. })
        ));
        assert!(matches!(
            DurationPolicy::strict().resolve(r, Some(d), None),
            Err(ClockError::NonIntegral { .. })
        ));
        // With zero tolerance even a rounding policy refuses a fractional result.
        let zero = DurationPolicy {
            allowed_error: RationalSeconds::whole(0),
            ..with(Rounding::Nearest)
        };
        assert!(matches!(
            zero.resolve(r, Some(d), None),
            Err(ClockError::ExceedsAllowedError { frames: 539 })
        ));
    }

    #[test]
    fn eighteen_seconds_at_thirty_is_integral() {
        let got = DurationPolicy::strict()
            .resolve(rate(30, 1), Some(RationalSeconds::whole(18)), None)
            .unwrap();
        assert_eq!(got.frames, 540);
        assert_eq!(got.duration, RationalSeconds::whole(18));
    }

    #[test]
    fn exact_roundtrip_for_every_frame_count_and_rate() {
        for (n, d) in RATES {
            let r = rate(n, d);
            for frames in 0..=2400u64 {
                let secs = r.duration_of(frames).unwrap();
                let back = DurationPolicy::strict()
                    .resolve(r, Some(secs), None)
                    .unwrap();
                assert_eq!(back.frames, frames, "{r} {frames}");
            }
        }
    }

    #[test]
    fn rounding_invariants_hold_for_all_durations() {
        for (n, d) in RATES {
            let r = rate(n, d);
            let half =
                RationalSeconds::new(r.frame_interval().num, r.frame_interval().den * 2).unwrap();
            // Millisecond-grid durations up to two minutes, stepped irregularly.
            let mut ms = 1u64;
            while ms < 120_000 {
                let secs = RationalSeconds::from_millis(ms);
                let get = |rounding, allowed| {
                    DurationPolicy {
                        priority: Priority::Duration,
                        rounding,
                        allowed_error: allowed,
                    }
                    .resolve(r, Some(secs), None)
                    .unwrap()
                    .frames
                };
                let one = r.frame_interval();
                let (floor, ceil, near) = (
                    get(Rounding::Floor, one),
                    get(Rounding::Ceil, one),
                    get(Rounding::Nearest, half),
                );
                assert!(floor <= near && near <= ceil, "{r} {ms}");
                assert!(ceil - floor <= 1, "{r} {ms}");
                // Nearest honours a half-frame tolerance by construction.
                ms += 997;
            }
        }
    }

    #[test]
    fn frame_count_priority_checks_duration_and_conflicts_are_reported() {
        let r = rate(25, 1);
        let policy = DurationPolicy {
            priority: Priority::FrameCount,
            rounding: Rounding::Exact,
            allowed_error: RationalSeconds::from_millis(20),
        };
        let ok = policy
            .resolve(r, Some(RationalSeconds::from_millis(10_020)), Some(250))
            .unwrap();
        assert_eq!(ok.frames, 250);
        assert!(
            policy
                .resolve(r, Some(RationalSeconds::from_millis(10_041)), Some(250))
                .is_err()
        );
        assert!(matches!(
            policy.resolve(r, None, None),
            Err(ClockError::Missing(_))
        ));
        let by_duration = DurationPolicy::strict();
        assert!(matches!(
            by_duration.resolve(r, Some(RationalSeconds::whole(10)), Some(251)),
            Err(ClockError::Conflict {
                derived: 250,
                supplied: 251
            })
        ));
    }

    #[test]
    fn rates_reduce_parse_and_reject_zero() {
        assert_eq!(rate(50, 2), rate(25, 1));
        assert_eq!(
            "30000/1001".parse::<RationalRate>().unwrap(),
            rate(30000, 1001)
        );
        assert_eq!("25".parse::<RationalRate>().unwrap(), rate(25, 1));
        assert!(RationalRate::new(0, 1).is_err());
        assert!(RationalRate::new(25, 0).is_err());
        assert!("a/b".parse::<RationalRate>().is_err());
        assert!(rate(25, 1).matches_probe("25/1"));
        assert!(rate(25, 1).matches_probe("50/2"));
        assert!(!rate(25, 1).matches_probe("30000/1001"));
        assert!(!rate(25, 1).matches_probe("garbage"));
        assert_eq!(rate(30000, 1001).setpts_expr(), "N*1001/(30000*TB)");
    }

    #[test]
    fn rates_deserialise_from_integer_string_and_object() {
        let int: RationalRate = serde_json::from_str("25").unwrap();
        let text: RationalRate = serde_json::from_str("\"25/1\"").unwrap();
        let obj: RationalRate = serde_json::from_str(r#"{"num":50,"den":2}"#).unwrap();
        assert_eq!(int, text);
        assert_eq!(int, obj);
        assert!(serde_json::from_str::<RationalRate>(r#"{"num":25,"den":0}"#).is_err());
        assert_eq!(
            serde_json::to_string(&int).unwrap(),
            r#"{"num":25,"den":1}"#
        );
    }

    #[test]
    fn intervals_are_half_open_and_tile_exactly() {
        let a = FrameInterval::new(0, 10).unwrap();
        let b = FrameInterval::new(10, 25).unwrap();
        assert!(a.contains(9) && !a.contains(10) && b.contains(10));
        assert!(!a.overlaps(b) && a.abuts(b) && b.abuts(a));
        assert_eq!(a.intersect(b), None);
        assert_eq!(a.join(b), Some(FrameInterval::new(0, 25).unwrap()));
        assert!(FrameInterval::tiles(&[a, b], 25));
        assert!(!FrameInterval::tiles(&[a, b], 26));
        assert!(!FrameInterval::tiles(&[b, a], 25));
        let gap = FrameInterval::new(11, 25).unwrap();
        assert!(!FrameInterval::tiles(&[a, gap], 25));
        assert!(FrameInterval::new(5, 4).is_err());
        assert!(serde_json::from_str::<FrameInterval>("[5,4]").is_err());
        assert_eq!(serde_json::to_string(&a).unwrap(), "[0,10]");
        let empty = FrameInterval::new(3, 3).unwrap();
        assert!(empty.is_empty() && !empty.overlaps(a) && !FrameInterval::tiles(&[empty], 0));
    }

    #[test]
    fn interval_set_algebra_is_symmetric_and_consistent() {
        let mut state = 0x2545F4914F6CDD1Du64;
        let mut next = move |bound: u64| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state % bound
        };
        for _ in 0..2000 {
            let (s1, s2) = (next(60), next(60));
            let a = FrameInterval::new(s1, s1 + next(30)).unwrap();
            let b = FrameInterval::new(s2, s2 + next(30)).unwrap();
            assert_eq!(a.overlaps(b), b.overlaps(a));
            assert_eq!(a.intersect(b), b.intersect(a));
            let brute = (0..100).any(|f| a.contains(f) && b.contains(f));
            assert_eq!(a.overlaps(b), brute);
            if let Some(shared) = a.intersect(b) {
                assert_eq!(
                    shared.len(),
                    (0..100).filter(|&f| a.contains(f) && b.contains(f)).count() as u64
                );
            }
            if let Some(joined) = a.join(b) {
                assert!(joined.len() >= a.len().max(b.len()));
            }
        }
    }

    #[test]
    fn interval_times_are_exact_at_ntsc() {
        let r = rate(30000, 1001);
        let (start, end) = FrameInterval::new(0, 30000).unwrap().seconds(r).unwrap();
        assert_eq!(start, RationalSeconds::whole(0));
        assert_eq!(end, RationalSeconds::whole(1001));
    }
}
