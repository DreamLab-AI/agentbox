//! One place the colloquy publish path lives, with its kind discipline explicit.
//!
//! An agent composes an *unsigned* colloquy event and hands it over; this
//! binary signs it under the sovereign identity and pushes it to the relay. The
//! relay admits it as `SelfAuthored` — the pod owner's own key is locally
//! authored egress, not a remote publisher, so it passes even under a deny-all
//! allowlist (see `admission`).
//!
//! # What this is not
//!
//! **It is not a security boundary in this container, and must not be described
//! as one.** The signing key lives at `/run/secrets/nostr.key`, mode 0400 and
//! owned by `devuser`, because the daemon runs as `devuser` and has to read it.
//! Every agent in the container runs as the same user, so any of them could read
//! that file and sign whatever they liked without coming through here. The kind
//! allowlist below is **discipline, not enforcement**: it stops an honest caller
//! doing the wrong thing by accident, and it documents what colloquy is allowed
//! to emit. It stops nobody determined.
//!
//! (The root-owned `/run/agentbox/identity.env` is a different file — the
//! bootstrap record, not the signing key. Conflating the two is easy and leads
//! to believing this door is load-bearing when it is not.)
//!
//! Where it *would* become a boundary is a deployment whose agents cannot read
//! the key: a profile-isolated signer, or a remote one. Writing the path this
//! way now means that change is a configuration move rather than a rewrite.
//!
//! # Why an allowlist, and why it is short
//!
//! Even as discipline, the shape matters. The container identity is a governance
//! participant: it appears in ACSP flows, in NIP-59 wraps, and in kind-0
//! metadata. A `publish` that signed arbitrary kinds would invite callers to
//! route *anything* through it and would read, to someone skimming, like a
//! sanctioned way to author under that key.
//!
//! So: an allowlist, never a denylist — a denylist admits every kind invented
//! after it was written. Five kinds are admitted, and two exclusions carry the
//! reasoning:
//!
//! - **`38104` Graduation is refused.** A graduation is the *record of a human
//!   decision*. Routing it through the container's signature puts the wrong key
//!   behind a human's judgement. It can be admitted once a reader verifies the
//!   `31403` it cites rather than trusting the record's own signature; until
//!   then, refusing costs nothing — the flow is not wired.
//! - **Governance kinds `31402`/`31403` are excluded by construction.** An
//!   agent routing a `31403` ActionResponse through here would be approving its
//!   own unit's promotion, which is what the human gate in ADR-2086 exists to
//!   prevent. That this door refuses them does not *stop* a determined agent —
//!   see above — but it means nothing in the estate offers it as a service.
//!
//! # What the caller may not choose
//!
//! The author. A request carries a kind, tags and content — never a pubkey. The
//! signing identity is whatever this binary holds, so there is no field through
//! which a caller can ask to be somebody else.

use anyhow::Context;
use serde::Deserialize;

/// The colloquy kinds this door will sign. See the module docs for the two
/// deliberate exclusions.
pub const SIGNABLE_KINDS: &[u64] = &[
    38_100, // KnowledgeUnit
    38_101, // Confirmation
    38_102, // Flag
    38_103, // Supersession
    38_105, // ToolGapSignal
];

/// Graduation. Refused on purpose — see the module docs.
pub const KIND_GRADUATION: u64 = 38_104;

/// An unsigned colloquy event, as an agent hands it over on stdin.
///
/// Deliberately *not* `UnsignedEvent`: that type carries a `pubkey`, and
/// accepting one here would invite a caller to name an author. The author is
/// never the caller's to choose.
#[derive(Debug, Clone, Deserialize)]
pub struct PublishRequest {
    /// Event kind. Must be in [`SIGNABLE_KINDS`].
    pub kind: u64,
    /// Event tags.
    #[serde(default)]
    pub tags: Vec<Vec<String>>,
    /// Event content.
    #[serde(default)]
    pub content: String,
    /// Optional creation time; defaults to now. Present so a caller can publish
    /// a unit with the timestamp it was authored at rather than the moment it
    /// reached this door.
    #[serde(default)]
    pub created_at: Option<u64>,
}

/// Why a publish request was refused before any signing happened.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    /// A graduation records a human decision and must not carry this key.
    #[error(
        "kind 38104 (Graduation) is refused: it records a human decision, and signing it with the \
         container identity would put the wrong key behind that judgement. Publish it from the \
         approver's own key, or cite the signed 31403 and let the reader verify that instead."
    )]
    Graduation,
    /// Any other kind outside the allowlist.
    #[error(
        "kind {kind} is not published here. This path carries colloquy events only ({allowed:?}) \
         — an allowlist, not a denylist, so a kind invented later is refused by default rather \
         than admitted by omission."
    )]
    NotColloquy {
        /// The kind that was asked for.
        kind: u64,
        /// What is admitted.
        allowed: &'static [u64],
    },
}

/// Decide whether a kind may be signed on an agent's behalf.
pub fn admit(kind: u64) -> Result<(), Refusal> {
    if kind == KIND_GRADUATION {
        return Err(Refusal::Graduation);
    }
    if !SIGNABLE_KINDS.contains(&kind) {
        return Err(Refusal::NotColloquy {
            kind,
            allowed: SIGNABLE_KINDS,
        });
    }
    Ok(())
}

/// Parse a request from the JSON an agent wrote to stdin.
///
/// A `pubkey` field in the input is **ignored**, not honoured and not an error:
/// a caller that sends one is using an event-shaped struct, which is a natural
/// mistake, and the safe response is to sign as ourselves regardless.
pub fn parse_request(raw: &str) -> anyhow::Result<PublishRequest> {
    serde_json::from_str(raw).context("parsing the colloquy publish request from stdin")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_colloquy_kind_except_graduation_is_admitted() {
        for kind in [38_100, 38_101, 38_102, 38_103, 38_105] {
            assert!(admit(kind).is_ok(), "kind {kind} should be signable");
        }
    }

    #[test]
    fn a_graduation_is_refused_and_says_why() {
        let e = admit(KIND_GRADUATION).unwrap_err();
        assert_eq!(e, Refusal::Graduation);
        assert!(e.to_string().contains("human decision"), "{e}");
    }

    #[test]
    fn governance_kinds_are_unreachable_through_this_door() {
        // Not a guarantee an agent cannot sign one — it can read the key — but
        // nothing in the estate offers it as a service. An agent routing a 31403
        // through here would be approving its own unit's promotion.
        for kind in [31_400, 31_401, 31_402, 31_403, 31_404, 31_405] {
            assert!(admit(kind).is_err(), "governance kind {kind} must never be signable");
        }
    }

    #[test]
    fn identity_and_messaging_kinds_are_refused() {
        // kind-0 metadata would let a caller rewrite the identity's profile;
        // 1059 is a NIP-59 gift wrap; 30840/30841 have their own curated paths.
        for kind in [0, 1, 42, 1059, 30_840, 30_841] {
            assert!(admit(kind).is_err(), "kind {kind} must not be signable here");
        }
    }

    #[test]
    fn an_unknown_future_kind_is_refused_by_default() {
        // The allowlist property: nothing is admitted by omission.
        assert!(admit(38_106).is_err());
        assert!(admit(99_999).is_err());
    }

    #[test]
    fn a_request_cannot_name_its_author() {
        // A caller sending an event-shaped document gets its pubkey ignored
        // rather than honoured — there is no field to carry it into signing.
        let req = parse_request(
            r#"{"pubkey":"deadbeef","kind":38100,"tags":[["d","abc"]],"content":"{}"}"#,
        )
        .unwrap();
        assert_eq!(req.kind, 38_100);
        assert_eq!(req.tags[0], vec!["d", "abc"]);
        // PublishRequest has no pubkey field at all; this is a type-level guard.
    }

    #[test]
    fn created_at_is_optional_and_tags_default_to_empty() {
        let req = parse_request(r#"{"kind":38101}"#).unwrap();
        assert_eq!(req.created_at, None);
        assert!(req.tags.is_empty());
        assert_eq!(req.content, "");
    }

    #[test]
    fn a_malformed_request_is_an_error_not_a_default() {
        assert!(parse_request("not json").is_err());
        assert!(parse_request(r#"{"tags":[]}"#).is_err(), "kind is required");
    }
}
