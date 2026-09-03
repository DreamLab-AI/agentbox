//! The exit-code contract, shared by every binary in the workspace.
//!
//! Twelve tools that each invent their own exit code cannot be composed. A CI
//! step cannot tell "the scan found three things" from "the scan crashed", and
//! `set -e` treats both the same way. One contract fixes that:
//!
//! | Code | Meaning |
//! |---|---|
//! | [`CLEAN`] (0) | Ran to completion and found nothing at or above the gate |
//! | [`FINDINGS`] (1) | Ran to completion and found something |
//! | [`ERROR`] (2) | Could not run: bad arguments, unreadable input, failed write |
//!
//! This is the shellcheck and Vale convention. `typos` inverts it, using 2 for
//! findings, which is the less common idiom and is not followed here.
//!
//! # A deliberate change
//!
//! `slop-scan` previously exited with *the number of high-severity findings*
//! and `slop-detect` with the number of findings capped at 250. Both are now
//! [`FINDINGS`]. A count in `$?` cannot be distinguished from an error code,
//! saturates at 255, and reports zero for a file full of medium-severity hits.
//! Anything that needs the count should read `--format json` or `--format
//! jsonl`, where it is a number rather than a byte.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser::exit;
//!
//! assert_eq!(exit::from_findings(0), exit::CLEAN);
//! assert_eq!(exit::from_findings(7), exit::FINDINGS);
//! assert_eq!(exit::from_flag(true), exit::FINDINGS);
//! ```

/// Ran to completion; nothing to report.
pub const CLEAN: i32 = 0;

/// Ran to completion; findings at or above the gate severity.
pub const FINDINGS: i32 = 1;

/// Could not run: bad arguments, unreadable input, failed write.
pub const ERROR: i32 = 2;

/// [`FINDINGS`] when `count` is non-zero, otherwise [`CLEAN`].
pub fn from_findings(count: usize) -> i32 {
    if count == 0 {
        CLEAN
    } else {
        FINDINGS
    }
}

/// [`FINDINGS`] when `found` is true, otherwise [`CLEAN`].
pub fn from_flag(found: bool) -> i32 {
    if found {
        FINDINGS
    } else {
        CLEAN
    }
}

/// The human-readable meaning of an exit code, for `--help` epilogues.
pub fn describe(code: i32) -> &'static str {
    match code {
        CLEAN => "clean: nothing found",
        FINDINGS => "findings reported",
        ERROR => "tool error",
        _ => "unspecified",
    }
}

/// The epilogue every binary prints under `--help`.
pub const HELP_EPILOGUE: &str =
    "Exit codes: 0 clean, 1 findings reported, 2 tool error (bad arguments, unreadable input, failed write).";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_codes_are_distinct_and_ordered() {
        assert_eq!(CLEAN, 0);
        assert_eq!(FINDINGS, 1);
        assert_eq!(ERROR, 2);
    }

    #[test]
    fn a_count_collapses_to_a_flag() {
        assert_eq!(from_findings(0), CLEAN);
        assert_eq!(from_findings(1), FINDINGS);
        assert_eq!(from_findings(9_999), FINDINGS);
    }

    #[test]
    fn a_flag_maps_directly() {
        assert_eq!(from_flag(false), CLEAN);
        assert_eq!(from_flag(true), FINDINGS);
    }

    #[test]
    fn every_code_describes_itself() {
        assert_eq!(describe(CLEAN), "clean: nothing found");
        assert_eq!(describe(FINDINGS), "findings reported");
        assert_eq!(describe(ERROR), "tool error");
        assert_eq!(describe(3), "unspecified");
    }
}
