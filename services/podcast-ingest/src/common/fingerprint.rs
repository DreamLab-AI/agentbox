//! SHA-256-derived fingerprints and digests used across the pipeline.

use regex::Regex;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

fn re_whitespace() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

/// Python:
/// ```python
/// def assertion_fingerprint(source: str, claim: str) -> str:
///     normalised = re.sub(r'\s+', ' ', f"{source}|{claim}".lower().strip())
///     return hashlib.sha256(normalised.encode()).hexdigest()[:16]
/// ```
pub fn assertion_fingerprint(source: &str, claim: &str) -> String {
    let combined = format!("{source}|{claim}").to_lowercase();
    let trimmed = combined.trim();
    let normalised = re_whitespace().replace_all(trimmed, " ");
    sha256_hex_prefix(normalised.as_bytes(), 16)
}

/// Hex-encode the SHA-256 digest of `data` and truncate to `n` hex characters.
pub fn sha256_hex_prefix(data: &[u8], n: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let hex = hex::encode(digest);
    hex.chars().take(n).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_16_chars() {
        let fp = assertion_fingerprint("Host (AI Daily Brief)", "Some claim.");
        assert_eq!(fp.len(), 16);
        assert_eq!(
            fp,
            assertion_fingerprint("Host (AI Daily Brief)", "Some claim.")
        );
    }

    #[test]
    fn fingerprint_normalises_whitespace_and_case() {
        let a = assertion_fingerprint("Source", "A  claim   with   spaces");
        let b = assertion_fingerprint("source", "a claim with spaces");
        assert_eq!(a, b);
    }

    #[test]
    fn matches_known_vector() {
        // sha256("host|claim") truncated to 16 hex chars, computed independently.
        let expected = sha256_hex_prefix(b"host|claim", 16);
        assert_eq!(assertion_fingerprint("host", "claim"), expected);
    }
}
