//! Evidence-chain witnesses.
//!
//! Every accepted experiment is bound to the exact report that justified it and
//! the exact commit it was evaluated against. The binding is a double SHA-256:
//!
//! ```text
//! witness = sha256_hex( sha256_hex(report) ++ commit )
//! ```
//!
//! where `++` is ASCII string concatenation of the 64-char lowercase report
//! hash and the normalised commit hash. This makes the ledger tamper-evident: a
//! single changed byte in either the report or the commit yields a different
//! witness.

use sha2::{Digest, Sha256};
use thiserror::Error;

/// Errors produced when computing a [`witness`].
#[derive(Debug, Error)]
pub enum WitnessError {
    #[error("bad commit hash: {0:?}")]
    BadCommit(String),
}

/// Lowercase hex SHA-256 of the report bytes (64 characters).
pub fn hash_report(report: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(report.as_bytes());
    hex::encode(hasher.finalize())
}

/// Trim, lowercase, and validate a commit hash: 7–64 lowercase hex characters.
fn normalise_commit(commit: &str) -> Result<String, WitnessError> {
    let normalised = commit.trim().to_lowercase();
    let valid = (7..=64).contains(&normalised.len())
        && normalised.chars().all(|c| c.is_ascii_hexdigit());
    if valid {
        Ok(normalised)
    } else {
        Err(WitnessError::BadCommit(commit.to_string()))
    }
}

/// Compute the witness binding a report to a commit.
///
/// The commit is trimmed and lowercased before use and must be 7–64 hex
/// characters, otherwise [`WitnessError::BadCommit`] is returned.
pub fn witness(report: &str, commit: &str) -> Result<String, WitnessError> {
    let commit = normalise_commit(commit)?;
    let report_hash = hash_report(report);
    let mut hasher = Sha256::new();
    hasher.update(report_hash.as_bytes());
    hasher.update(commit.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

/// The first 12 characters of a witness, for compact display in the ledger.
pub fn short(witness_hex: &str) -> &str {
    let end = witness_hex.len().min(12);
    &witness_hex[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_hash_is_64_char_lowercase_hex() {
        let h = hash_report("hello world");
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        // Well-known SHA-256 of "hello world".
        assert_eq!(
            h,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    /// Reference vector computed independently via `sha256sum`:
    ///   report_hash = sha256("hello world")
    ///   witness     = sha256(report_hash ++ "abc1234")
    #[test]
    fn matches_reference_vector() {
        let w = witness("hello world", "abc1234").unwrap();
        assert_eq!(
            w,
            "8522806be1fdb1e0fd56368992a558a35d2700e8e7bb5843c07bf1c9a6d46822"
        );
        assert_eq!(short(&w), "8522806be1fd");
    }

    #[test]
    fn is_deterministic() {
        let a = witness("some report body", "deadbeef").unwrap();
        let b = witness("some report body", "deadbeef").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn single_byte_report_change_changes_witness() {
        let a = witness("report body", "deadbeef").unwrap();
        let b = witness("report bodz", "deadbeef").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn different_commit_changes_witness() {
        let a = witness("report body", "deadbeef").unwrap();
        let b = witness("report body", "deadbee0").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn commit_is_trimmed_and_lowercased() {
        let a = witness("report", "  DEADBEEF  ").unwrap();
        let b = witness("report", "deadbeef").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn rejects_bad_commits() {
        assert!(matches!(
            witness("report", "not-hex"),
            Err(WitnessError::BadCommit(_))
        ));
        assert!(matches!(
            witness("report", ""),
            Err(WitnessError::BadCommit(_))
        ));
        assert!(matches!(
            witness("report", "xyz"),
            Err(WitnessError::BadCommit(_))
        ));
        // Too short (6 chars) and too long (65 chars).
        assert!(witness("report", "abc123").is_err());
        assert!(witness("report", &"a".repeat(65)).is_err());
    }

    #[test]
    fn accepts_boundary_lengths() {
        assert!(witness("report", "abc1234").is_ok()); // 7 chars
        assert!(witness("report", &"a".repeat(64)).is_ok()); // 64 chars
    }

    #[test]
    fn short_handles_undersized_input() {
        assert_eq!(short("abcd"), "abcd");
    }
}
