//! Content-addressed unit identifiers.
//!
//! cq writes unit ids as `ku_` followed by twelve hex characters. Rather than
//! allocate those at random, [`UnitId::mint`] derives them from the unit's own
//! substance — proposer, domain, and the three parts of the insight — so the
//! same learning proposed twice lands on the same id and dedup is a primary-key
//! collision instead of a similarity search.
//!
//! Twelve hex characters is 48 bits. That is deliberate and matches the
//! estate's `sha256-12-<12hex>` convention: enough that a collision inside one
//! store is not a practical concern, short enough to read aloud in a thread.
//!
//! ```
//! use colloquy_core::id::UnitId;
//!
//! let a = UnitId::mint("did:nostr:abc", &["api", "payments"], "Retries double-charge", "…", "…");
//! let b = UnitId::mint("did:nostr:abc", &["payments", "api"], "Retries double-charge", "…", "…");
//! assert_eq!(a, b, "domain order is not part of the identity");
//! assert!(a.as_str().starts_with("ku_"));
//! ```

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

/// The `ku_` prefix every unit id carries, as cq writes it.
pub const UNIT_ID_PREFIX: &str = "ku_";

/// How many hex characters of the digest form the id.
pub const UNIT_ID_HEX_LEN: usize = 12;

/// A knowledge-unit identifier: `ku_` plus twelve lowercase hex characters.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UnitId(String);

/// An identifier that does not have the `ku_` + 12-hex shape.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not a knowledge-unit id (expected `ku_` and {UNIT_ID_HEX_LEN} lowercase hex chars): {0}")]
pub struct UnitIdError(pub String);

impl UnitId {
    /// Derive an id from the substance of a unit.
    ///
    /// The digest covers the proposer, the *sorted, deduplicated* domain tags,
    /// and the three insight fields, joined with a separator that cannot occur
    /// in any of them. Sorting the domain means two agents that tag the same
    /// learning in a different order agree on its identity; including the
    /// proposer means two agents that genuinely learned it independently do
    /// not, so both proposals survive to confirm each other.
    pub fn mint(
        proposer: &str,
        domain: &[impl AsRef<str>],
        summary: &str,
        detail: &str,
        action: &str,
    ) -> Self {
        let mut tags: Vec<&str> = domain.iter().map(AsRef::as_ref).collect();
        tags.sort_unstable();
        tags.dedup();

        let mut h = Sha256::new();
        // 0x1f (unit separator) cannot appear in JSON string content that has
        // been through serde, so the concatenation is unambiguous.
        h.update(proposer.as_bytes());
        for t in tags {
            h.update([0x1f]);
            h.update(t.as_bytes());
        }
        for field in [summary, detail, action] {
            h.update([0x1e]); // record separator between the fixed fields
            h.update(field.as_bytes());
        }
        let digest = hex::encode(h.finalize());
        Self(format!("{UNIT_ID_PREFIX}{}", &digest[..UNIT_ID_HEX_LEN]))
    }

    /// Accept an existing id, checking its shape.
    ///
    /// Ids arriving from a peer are validated rather than trusted: a store keyed
    /// on this type should never hold a row whose key it could not have minted.
    pub fn parse(s: &str) -> Result<Self, UnitIdError> {
        let err = || UnitIdError(s.to_string());
        let hexpart = s.strip_prefix(UNIT_ID_PREFIX).ok_or_else(err)?;
        if hexpart.len() != UNIT_ID_HEX_LEN
            || !hexpart
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(err());
        }
        Ok(Self(s.to_string()))
    }

    /// Borrow the full id, prefix included.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The hex portion, without the `ku_` prefix. This is what a Nostr `d` tag
    /// carries when the unit is published as an addressable event.
    pub fn hex(&self) -> &str {
        &self.0[UNIT_ID_PREFIX.len()..]
    }
}

impl fmt::Display for UnitId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minting_is_deterministic_and_shape_correct() {
        let id = UnitId::mint("did:nostr:a", &["api"], "s", "d", "a");
        assert_eq!(id, UnitId::mint("did:nostr:a", &["api"], "s", "d", "a"));
        assert_eq!(id.as_str().len(), UNIT_ID_PREFIX.len() + UNIT_ID_HEX_LEN);
        assert_eq!(UnitId::parse(id.as_str()).unwrap(), id);
        assert_eq!(id.hex().len(), UNIT_ID_HEX_LEN);
    }

    #[test]
    fn domain_order_and_duplicates_do_not_change_identity() {
        let a = UnitId::mint("p", &["b", "a", "b"], "s", "d", "x");
        let b = UnitId::mint("p", &["a", "b"], "s", "d", "x");
        assert_eq!(a, b);
    }

    #[test]
    fn independent_proposers_of_the_same_insight_get_distinct_ids() {
        // Two agents under different principals learning the same thing must
        // produce two units, so one can confirm the other rather than silently
        // overwriting it.
        let a = UnitId::mint("did:nostr:a", &["api"], "s", "d", "x");
        let b = UnitId::mint("did:nostr:b", &["api"], "s", "d", "x");
        assert_ne!(a, b);
    }

    #[test]
    fn field_boundaries_cannot_be_forged_by_concatenation() {
        // "ab" + "" must not hash the same as "a" + "b".
        let a = UnitId::mint("p", &["d"], "ab", "", "x");
        let b = UnitId::mint("p", &["d"], "a", "b", "x");
        assert_ne!(a, b);
    }

    #[test]
    fn malformed_ids_are_refused() {
        for bad in [
            "a1b2c3d4e5f6",
            "ku_",
            "ku_TOOSHORT",
            "ku_a1b2c3d4e5f",
            "ku_a1b2c3d4e5f66",
            "ku_A1B2C3D4E5F6",
            "ku_a1b2c3d4e5fg",
        ] {
            assert!(UnitId::parse(bad).is_err(), "{bad} should be refused");
        }
    }
}
