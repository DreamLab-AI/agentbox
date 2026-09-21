//! The tag grammar, and the rule that keeps it honest.
//!
//! **Content is authoritative; tags are an index.** Every fact a consumer acts
//! on is read from the event's JSON content, which is covered by the signature
//! as a whole. Tags exist so a relay can filter without parsing, and a
//! disagreement between a tag and the content is resolved in favour of the
//! content — see [`crate::decode`], which re-derives rather than trusting.
//!
//! Single-letter tags are the ones Nostr relays index, so the facts worth
//! filtering on take those: `d` for the addressable identifier, `t` for each
//! domain tag, `e`/`a`/`p` for the standard references. Everything else is
//! spelled out.

/// Addressable identifier (NIP-33). Carries a unit id's hex portion.
pub const TAG_D: &str = "d";
/// Event reference (NIP-01).
pub const TAG_E: &str = "e";
/// Addressable event reference, `<kind>:<pubkey>:<d>` (NIP-33).
pub const TAG_A: &str = "a";
/// Pubkey reference (NIP-01).
pub const TAG_P: &str = "p";
/// One domain-taxonomy tag. Repeated, and relay-indexed, so a subscription can
/// follow a subject rather than an author.
pub const TAG_T: &str = "t";
/// Ladder classification, e.g. `workaround`.
pub const TAG_LADDER: &str = "ladder";
/// Tier the unit currently sits in.
pub const TAG_TIER: &str = "tier";
/// Schema version of the content.
pub const TAG_VERSION: &str = "v";
/// Tier a graduation promoted from.
pub const TAG_FROM: &str = "from";
/// Tier a graduation promoted to.
pub const TAG_TO: &str = "to";
/// Event id of the signed `31403` decision that authorised a graduation.
pub const TAG_DECISION: &str = "decision";
/// Marker on the `e` tag of the unit a supersession replaces.
pub const MARKER_SUPERSEDED: &str = "superseded";
/// Marker on the `e` tag of the unit a supersession installs.
pub const MARKER_SUPERSEDES: &str = "supersedes";

/// First value of the first tag with this name.
pub fn first<'a>(tags: &'a [Vec<String>], name: &str) -> Option<&'a str> {
    tags.iter()
        .find(|t| t.len() >= 2 && t[0] == name)
        .map(|t| t[1].as_str())
}

/// Every value carried by tags with this name, in order.
pub fn all(tags: &[Vec<String>], name: &str) -> Vec<String> {
    tags.iter()
        .filter(|t| t.len() >= 2 && t[0] == name)
        .map(|t| t[1].clone())
        .collect()
}

/// The value of an `e` tag carrying a given NIP-10 marker.
pub fn e_with_marker<'a>(tags: &'a [Vec<String>], marker: &str) -> Option<&'a str> {
    tags.iter()
        .find(|t| t.len() >= 4 && t[0] == TAG_E && t[3] == marker)
        .map(|t| t[1].as_str())
}

/// Build a NIP-33 address, `<kind>:<pubkey>:<d>`.
pub fn address(kind: u64, pubkey: &str, d: &str) -> String {
    format!("{kind}:{pubkey}:{d}")
}

/// Split a NIP-33 address back into its parts.
///
/// The `d` value may itself contain colons under NIP-33, so only the first two
/// separators are significant — splitting on every colon is the classic bug.
pub fn parse_address(a: &str) -> Option<(u64, &str, &str)> {
    let (kind, rest) = a.split_once(':')?;
    let (pubkey, d) = rest.split_once(':')?;
    Some((kind.parse().ok()?, pubkey, d))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags() -> Vec<Vec<String>> {
        vec![
            vec!["d".into(), "a1b2c3d4e5f6".into()],
            vec!["t".into(), "api".into()],
            vec!["t".into(), "payments".into()],
            vec!["e".into(), "old".into(), "".into(), "superseded".into()],
            vec!["e".into(), "new".into(), "".into(), "supersedes".into()],
            vec!["malformed".into()],
        ]
    }

    #[test]
    fn extractors_read_what_is_there_and_ignore_malformed_tags() {
        let t = tags();
        assert_eq!(first(&t, "d"), Some("a1b2c3d4e5f6"));
        assert_eq!(all(&t, "t"), vec!["api", "payments"]);
        assert_eq!(first(&t, "absent"), None);
        assert_eq!(all(&t, "malformed"), Vec::<String>::new());
    }

    #[test]
    fn markers_disambiguate_the_two_e_tags_of_a_supersession() {
        let t = tags();
        assert_eq!(e_with_marker(&t, MARKER_SUPERSEDED), Some("old"));
        assert_eq!(e_with_marker(&t, MARKER_SUPERSEDES), Some("new"));
    }

    #[test]
    fn addresses_round_trip_and_tolerate_colons_in_the_identifier() {
        let a = address(38_210, "ab".repeat(32).as_str(), "id:with:colons");
        let (kind, pk, d) = parse_address(&a).unwrap();
        assert_eq!(kind, 38_210);
        assert_eq!(pk.len(), 64);
        assert_eq!(d, "id:with:colons");
    }

    #[test]
    fn a_malformed_address_is_refused_rather_than_half_read() {
        assert_eq!(parse_address("38210"), None);
        assert_eq!(parse_address("38210:onlypubkey"), None);
        assert_eq!(parse_address("notakind:pk:d"), None);
    }
}
