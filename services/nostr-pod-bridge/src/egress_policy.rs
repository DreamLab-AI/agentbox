//! `egress_policy` — the Rust half of the ADR-2026 content-egress policy.
//!
//! The policy itself is `config/egress-policy.json`; this module implements it
//! for the **session-digest** path, and `config/hooks/lib/egress-policy.cjs`
//! implements the same rules for the **live-mirror** path. The two are held
//! together by a paired fixture, `tests/fixtures/egress-redaction.v1.json`,
//! which both must satisfy exactly — the tests at the bottom of this file read
//! that fixture, so a divergence fails `cargo test` rather than being noticed
//! later by a reviewer.
//!
//! ## What this closes
//!
//! The estate review recorded three separate problems on this path:
//!
//! * **No redaction before the provider request.** The digest producer flattened
//!   and trimmed transcript text and handed it straight to the summarisation
//!   provider. Curating the *output* does not undo the provider's receipt of the
//!   *input*, so redaction has to happen before the request is built.
//! * **No shared off switch.** `AGENTBOX_LIVE_MIRROR=0` disabled the JavaScript
//!   hook and said nothing about this path, which gates on its own bridge and
//!   provider configuration. [`egress_decision`] honours a single global
//!   `AGENTBOX_EGRESS` switch that both paths obey.
//! * **Indistinguishable outcomes.** Exit zero covered "disabled", "attempted",
//!   "delivered" and "failed" alike. [`Outcome`] names the four states.
//!
//! ## Why a hand-written scanner
//!
//! The crate carries no regular-expression dependency and this is not a good
//! reason to add one: the forms being matched are a short, closed list, and a
//! scanner makes the ordering between them explicit rather than emergent from
//! alternation order. The scanner is deliberately structured as the same five
//! ordered passes the JavaScript implementation applies.

use crate::envmap::EnvMap;

/// The four observable egress states. "Nothing happened" and "it failed" and
/// "it was delivered" are different facts and must never share a signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The path decided not to send. Nothing left the process.
    Skipped,
    /// Bytes were handed to a transport or provider; delivery unconfirmed.
    Attempted,
    /// The peer positively acknowledged.
    Accepted,
    /// The attempt was made and rejected or errored.
    Failed,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Skipped => "skipped",
            Outcome::Attempted => "attempted",
            Outcome::Accepted => "accepted",
            Outcome::Failed => "failed",
        }
    }
}

/// The decision for one egress attempt, taken before any content is composed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EgressDecision {
    pub allowed: bool,
    pub outcome: Outcome,
    pub reason: &'static str,
}

fn is_off(v: &str) -> bool {
    v.trim() == "0"
}

/// Decide whether the session-digest path may send.
///
/// `identity_present` is whether the bridge has everything it needs to sign and
/// publish; a false value is a *skip with a reason*, not a silent return.
pub fn egress_decision(env: &EnvMap, identity_present: bool) -> EgressDecision {
    // The GLOBAL switch, shared with the live-mirror hook. This is the single
    // thing an operator sets to stop every path in the policy.
    if is_off(env.first(&["AGENTBOX_EGRESS"])) {
        return EgressDecision {
            allowed: false,
            outcome: Outcome::Skipped,
            reason: "egress-globally-disabled",
        };
    }
    if is_off(env.first(&["AGENTBOX_SESSION_DIGEST"])) {
        return EgressDecision {
            allowed: false,
            outcome: Outcome::Skipped,
            reason: "session-digest-disabled",
        };
    }
    // A disabled redactor is a disabled path: there is no configuration in
    // which unredacted session text reaches a provider.
    if is_off(env.first(&["AGENTBOX_EGRESS_REDACTION"])) {
        return EgressDecision {
            allowed: false,
            outcome: Outcome::Skipped,
            reason: "redaction-disabled-so-egress-refused",
        };
    }
    if !identity_present {
        return EgressDecision {
            allowed: false,
            outcome: Outcome::Skipped,
            reason: "no-sender-identity",
        };
    }
    EgressDecision {
        allowed: true,
        outcome: Outcome::Attempted,
        reason: "permitted",
    }
}

// ── redaction ───────────────────────────────────────────────────────────────

/// Secret-introducing keywords, lower case. A token counts when it *contains*
/// one of these, so `ZAI_API_KEY` matches through `api_key`.
const SECRET_WORDS: &[&str] = &[
    "password",
    "passwd",
    "pwd",
    "token",
    "secret",
    "api_key",
    "api-key",
    "apikey",
    "authorization",
    "auth",
    "credentials",
    "credential",
    "nsec",
    "private_key",
    "private-key",
    "privatekey",
];

fn contains_secret_word(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    let stripped = lower.trim_start_matches('-');
    SECRET_WORDS.iter().any(|w| stripped.contains(w))
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.'
}

/// Pass 1 — `scheme://user:secret@host` keeps its shape and loses the secret.
fn redact_uri_credentials(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"://") {
            out.push_str("://");
            let mut j = i + 3;
            // userinfo runs until '@', but must not cross '/' or whitespace.
            let start = j;
            let mut colon: Option<usize> = None;
            let mut at: Option<usize> = None;
            while j < bytes.len() {
                match bytes[j] {
                    b'/' | b' ' | b'\t' | b'\n' | b'\r' => break,
                    b':' if colon.is_none() => colon = Some(j),
                    b'@' => {
                        at = Some(j);
                        break;
                    }
                    _ => {}
                }
                j += 1;
            }
            match (colon, at) {
                (Some(c), Some(a)) if c < a => {
                    out.push_str(&s[start..c]);
                    out.push_str(":<redacted>@");
                    i = a + 1;
                }
                _ => {
                    i += 3;
                }
            }
            continue;
        }
        let ch_len = utf8_len(bytes[i]);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else if b >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

/// Pass 2 — `Authorization: <whole value>`. The value is taken to the closing
/// quote, comma, brace or line end: a header carries two tokens
/// (`Bearer abc`) and redacting only the first leaves the secret standing.
fn redact_authorization_header(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < s.len() {
        if lower[i..].starts_with("authorization") {
            let after = i + "authorization".len();
            let mut j = after;
            while j < s.len() && matches!(s.as_bytes()[j], b' ' | b'\t') {
                j += 1;
            }
            if j < s.len() && s.as_bytes()[j] == b':' {
                out.push_str(&s[i..after]);
                out.push_str(": <redacted>");
                // Consume to a terminator.
                let mut k = j + 1;
                while k < s.len() && !matches!(s.as_bytes()[k], b'"' | b'\'' | b'\n' | b',' | b'}') {
                    k += 1;
                }
                i = k;
                continue;
            }
        }
        let ch_len = utf8_len(s.as_bytes()[i]);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Pass 3 — a standalone `Bearer <token>` not behind an Authorization header.
fn redact_bearer(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < s.len() {
        if lower[i..].starts_with("bearer ") && (i == 0 || !is_ident_byte(s.as_bytes()[i - 1])) {
            let after = i + "bearer ".len();
            let mut k = after;
            while k < s.len() && !matches!(s.as_bytes()[k], b' ' | b'"' | b'\'' | b'\n') {
                k += 1;
            }
            if k > after {
                out.push_str(&s[i..after]);
                out.push_str("<redacted>");
                i = k;
                continue;
            }
        }
        let ch_len = utf8_len(s.as_bytes()[i]);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Pass 4 — assignment, JSON/YAML and flag forms.
///
/// A secret keyword only triggers when it is in a VALUE-BEARING position:
/// followed by `=` or `:`, or used as a `--flag` with a following value. A
/// keyword in prose ("the password reset flow") is left alone, because rejecting
/// English is not privacy.
fn redact_assignments(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if is_ident_byte(bytes[i]) && (i == 0 || !is_ident_byte(bytes[i - 1])) {
            let start = i;
            let mut end = i;
            while end < bytes.len() && is_ident_byte(bytes[end]) {
                end += 1;
            }
            let token = &s[start..end];
            if contains_secret_word(token) {
                let is_flag = token.starts_with('-');
                // Optional closing quote (the JSON `"password"` form).
                let mut j = end;
                if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
                    j += 1;
                }
                let quote_end = j;
                // Optional whitespace before the separator.
                while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
                    j += 1;
                }
                if j < bytes.len() && (bytes[j] == b'=' || bytes[j] == b':') {
                    let sep = bytes[j];
                    let mut k = j + 1;
                    // Preserve the exact spacing after the separator.
                    while k < bytes.len() && matches!(bytes[k], b' ' | b'\t') {
                        k += 1;
                    }
                    out.push_str(&s[start..quote_end]);
                    out.push_str(&s[quote_end..j]);
                    out.push(sep as char);
                    out.push_str(&s[j + 1..k]);
                    let (consumed, quoted) = consume_value(bytes, k);
                    if quoted && sep == b':' {
                        out.push_str("\"<redacted>\"");
                    } else {
                        out.push_str("<redacted>");
                    }
                    i = consumed;
                    continue;
                }
                if is_flag {
                    // `--password <value>` — the space-separated flag form.
                    let mut k = end;
                    while k < bytes.len() && matches!(bytes[k], b' ' | b'\t') {
                        k += 1;
                    }
                    if k > end && k < bytes.len() {
                        out.push_str(&s[start..k]);
                        let (consumed, _) = consume_value(bytes, k);
                        out.push_str("<redacted>");
                        i = consumed;
                        continue;
                    }
                }
            }
            out.push_str(token);
            i = end;
            continue;
        }
        let ch_len = utf8_len(bytes[i]);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Consume a value starting at `k`. Returns the index just past it and whether
/// it was quoted (a quoted value is consumed WHOLE, which is what the review's
/// `--password "a b c"` case needed).
fn consume_value(bytes: &[u8], k: usize) -> (usize, bool) {
    if k >= bytes.len() {
        return (k, false);
    }
    if bytes[k] == b'"' || bytes[k] == b'\'' {
        let quote = bytes[k];
        let mut j = k + 1;
        while j < bytes.len() {
            if bytes[j] == b'\\' {
                j += 2;
                continue;
            }
            if bytes[j] == quote {
                return (j + 1, true);
            }
            j += 1;
        }
        return (bytes.len(), true);
    }
    let mut j = k;
    while j < bytes.len()
        && !matches!(
            bytes[j],
            b' ' | b'\t' | b'\n' | b'\r' | b',' | b'}' | b']' | b'"' | b'\''
        )
    {
        j += 1;
    }
    (j, false)
}

/// Pass 5 — long hex then long base64 runs (keys, nsec, digests). Hex is tested
/// first, matching the JavaScript implementation: the key material on this path
/// is hex, and a 64-character hex key is also a valid base64 character run, so
/// hex-first produces the accurate label. Either way the run is removed.
fn redact_long_runs(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < bytes.len() {
        let boundary = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        if boundary && bytes[i].is_ascii_alphanumeric() {
            let mut hex_end = i;
            while hex_end < bytes.len() && bytes[hex_end].is_ascii_hexdigit() {
                hex_end += 1;
            }
            let hex_terminated = hex_end >= bytes.len() || !bytes[hex_end].is_ascii_alphanumeric();
            if hex_end - i >= 32 && hex_terminated {
                out.push_str("<redacted-hex>");
                i = hex_end;
                continue;
            }
            let mut b64_end = i;
            while b64_end < bytes.len()
                && (bytes[b64_end].is_ascii_alphanumeric()
                    || bytes[b64_end] == b'+'
                    || bytes[b64_end] == b'/')
            {
                b64_end += 1;
            }
            if b64_end - i >= 40 {
                let mut pad = b64_end;
                while pad < bytes.len() && bytes[pad] == b'=' {
                    pad += 1;
                }
                out.push_str("<redacted-b64>");
                i = pad;
                continue;
            }
        }
        let ch_len = utf8_len(bytes[i]);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Redact text destined for egress.
///
/// This is the function every send site on this path must call on the exact
/// bytes it is about to transmit — before the provider request is built, before
/// signing, before publishing.
pub fn redact_for_egress(text: &str) -> String {
    let s = redact_uri_credentials(text);
    let s = redact_authorization_header(&s);
    let s = redact_bearer(&s);
    let s = redact_assignments(&s);
    redact_long_runs(&s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The PAIRED fixture. Both implementations read this file; a divergence
    /// between the JavaScript live-mirror redactor and this one fails here.
    #[test]
    fn matches_the_paired_cross_language_fixture() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/egress-redaction.v1.json"
        );
        let raw = std::fs::read_to_string(path).expect("paired egress redaction fixture");
        let fixture: Value = serde_json::from_str(&raw).expect("fixture parses");
        let cases = fixture["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty(), "the fixture must carry cases");
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let input = case["input"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            assert_eq!(
                redact_for_egress(input),
                expected,
                "paired fixture case `{name}` diverges between the Rust and JavaScript redactors"
            );
        }
    }

    #[test]
    fn global_switch_disables_the_digest_path() {
        let env = [("AGENTBOX_EGRESS", "0")].into_iter().collect::<EnvMap>();
        let d = egress_decision(&env, true);
        assert!(!d.allowed);
        assert_eq!(d.outcome, Outcome::Skipped);
        assert_eq!(d.reason, "egress-globally-disabled");
    }

    #[test]
    fn per_path_switch_disables_only_this_path() {
        let env = [("AGENTBOX_SESSION_DIGEST", "0")].into_iter().collect::<EnvMap>();
        assert_eq!(egress_decision(&env, true).reason, "session-digest-disabled");
    }

    #[test]
    fn disabling_redaction_disables_egress_rather_than_sending_raw() {
        let env = [("AGENTBOX_EGRESS_REDACTION", "0")].into_iter().collect::<EnvMap>();
        let d = egress_decision(&env, true);
        assert!(!d.allowed, "there is no configuration that sends unredacted text");
        assert_eq!(d.reason, "redaction-disabled-so-egress-refused");
    }

    #[test]
    fn absent_identity_is_a_named_skip_not_a_silent_return() {
        let env = Vec::<(String, String)>::new().into_iter().collect::<EnvMap>();
        let d = egress_decision(&env, false);
        assert_eq!(d.outcome, Outcome::Skipped);
        assert_eq!(d.reason, "no-sender-identity");
    }

    #[test]
    fn permitted_when_nothing_forbids_it() {
        let env = Vec::<(String, String)>::new().into_iter().collect::<EnvMap>();
        let d = egress_decision(&env, true);
        assert!(d.allowed);
        assert_eq!(d.outcome, Outcome::Attempted);
    }

    #[test]
    fn outcome_vocabulary_matches_the_policy_document() {
        assert_eq!(Outcome::Skipped.as_str(), "skipped");
        assert_eq!(Outcome::Attempted.as_str(), "attempted");
        assert_eq!(Outcome::Accepted.as_str(), "accepted");
        assert_eq!(Outcome::Failed.as_str(), "failed");
    }

    #[test]
    fn prose_containing_a_keyword_survives_intact() {
        let s = "I fixed the password reset flow and the auth journey";
        assert_eq!(redact_for_egress(s), s);
    }

    #[test]
    fn a_quoted_multi_word_secret_is_consumed_whole() {
        assert_eq!(
            redact_for_egress("run --password \"a b c\" now"),
            "run --password <redacted> now"
        );
    }
}
