//! The one error type every fallible function in this crate returns.
//!
//! siding reports a malformed event by returning `null` from a parser and a
//! refused mirror by throwing with a message its tests match against (`/no
//! mirror it names checks out/`). Here every refusal is a named variant with
//! the reason in it, so a caller can log siding's wording and a test can match
//! the variant.

/// Everything that can go wrong between an event and the thing it carries.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The event is not of the kind the codec handles.
    #[error("kind {found} is not {expected} ({what})")]
    Kind {
        /// The kind the codec decodes.
        expected: u32,
        /// The kind the event carries.
        found: u32,
        /// The codec's name of the expected kind.
        what: &'static str,
    },
    /// A tag the codec needs is absent.
    #[error("missing tag \"{0}\"")]
    MissingTag(&'static str),
    /// A tag is present but does not fit its grammar.
    #[error("tag \"{tag}\": {reason}")]
    Tag {
        /// The tag name.
        tag: &'static str,
        /// Why it was refused.
        reason: String,
    },
    /// The content does not fit the kind's shape.
    #[error("content: {0}")]
    Content(String),
    /// A tag and the content disagree; content is authoritative, so the
    /// event is refused rather than resolved silently.
    #[error("tag \"{tag}\" says {tag_value:?} but the content says {content_value:?}")]
    Disagree {
        /// The tag name.
        tag: &'static str,
        /// What the tag carries.
        tag_value: String,
        /// What the content carries.
        content_value: String,
    },
    /// Hex that is not hex, or not the length the field needs.
    #[error("{what}: {reason}")]
    Hex {
        /// Which field.
        what: &'static str,
        /// Why it was refused.
        reason: String,
    },
    /// JSON that does not parse or does not fit the shape.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The event id is not the hash of its fields, or the signature does not
    /// verify against the author's key.
    #[error("signature: {0}")]
    Signature(String),
    /// A key that is not a key, or a signer that cannot sign.
    #[error("key: {0}")]
    Key(String),
    /// A value that must name this chain, or its signer, names another.
    #[error("chain: {0}")]
    Chain(String),
    /// No mirror the announcement names checks out (`siding/lib/announce.mjs
    /// chooseMirror`): the message lists what each one said.
    #[error("{chain_id}: announced at tip {tip} by {announcer}… but no mirror it names checks out ({tried})")]
    NoMirror {
        /// The chain id.
        chain_id: String,
        /// The announced height.
        tip: u32,
        /// The announcer's pubkey, first eight characters.
        announcer: String,
        /// What each mirror said, `; `-joined, or `no mirrors named`.
        tried: String,
    },
    /// The header family cannot be told from the content, or the content is
    /// not a whole number of headers of the family asked for.
    #[error("headers: {0}")]
    Family(String),
    /// An identifier that is not an `urn:agentbox:` URN. URNs are minted by
    /// the estate's sole mint, never here; this crate only refuses what is
    /// plainly not one.
    #[error("urn: {0}")]
    Urn(String),
}

/// `Result` with this crate's [`Error`].
pub type Result<T> = core::result::Result<T, Error>;

/// Lowercase hex of exactly `bytes` bytes, or [`Error::Hex`].
pub(crate) fn hex_of(what: &'static str, s: &str, bytes: usize) -> Result<String> {
    let s = s.trim();
    if s.len() != bytes * 2 {
        return Err(Error::Hex {
            what,
            reason: format!("{} hex characters, not {}", s.len(), bytes * 2),
        });
    }
    if !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::Hex {
            what,
            reason: "not hex".into(),
        });
    }
    Ok(s.to_ascii_lowercase())
}

/// Lowercase hex of any even, non-zero length, or [`Error::Hex`].
pub(crate) fn any_hex(what: &'static str, s: &str) -> Result<String> {
    let s = s.trim();
    if s.is_empty() || s.len() % 2 != 0 {
        return Err(Error::Hex {
            what,
            reason: format!("{} hex characters is not a whole number of bytes", s.len()),
        });
    }
    if !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::Hex {
            what,
            reason: "not hex".into(),
        });
    }
    Ok(s.to_ascii_lowercase())
}
