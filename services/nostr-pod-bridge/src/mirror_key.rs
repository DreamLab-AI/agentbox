//! The live-mirror child key: the one key the operator's phone holds.
//!
//! `config/hooks/nostr-live-mirror.cjs` (`deriveChildKey`, lines 200-221) and
//! `config/nostr-gateway/nostr-send.cjs` derive a single-purpose child from
//! the container identity key:
//!
//! ```text
//! child_sk = HMAC-SHA256(key = operator_sk_bytes, msg = tag_utf8)
//! tag      = $AGENTBOX_MIRROR_KEY_TAG, default "agentbox-mirror-v1"
//! ```
//!
//! The phone (Amethyst/Amber) imports `child_sk`, so this derivation is a
//! compatibility contract: if the Rust identity port computed a different
//! value, the phone would silently lose the mirror. This module is the Rust
//! side of that contract. It changes nothing in the JavaScript; the
//! known-answer tests in `tests/mirror_key.rs` pin both to the same bytes.
//!
//! ## The HMAC key is the operator hex *as supplied*
//!
//! The JavaScript keys the HMAC with the raw `AGENTBOX_PRIVKEY_HEX` bytes.
//! [`crate::identity`] canonicalises a secret to BIP-340 even-y and persists
//! the *negated* scalar when the supplied one has odd y. For such a key the
//! identity file's `private_key_hex` differs from the env value, and keying the
//! HMAC with it would yield a different child, so a different phone key.
//! [`child_secret`] therefore takes the operator hex exactly as the env
//! carries it and must never be fed the normalised scalar.
//!
//! No primitive is implemented here: HMAC is the RustCrypto `hmac` crate over
//! `sha2::Sha256`, and the public half goes through
//! [`crate::identity::keypair_from_privkey_hex`] (`k256`).

use anyhow::{anyhow, Context, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// Domain-separation tag used when `AGENTBOX_MIRROR_KEY_TAG` is unset or empty.
/// Bumping it rotates the phone key; it is the same literal as the JavaScript.
pub const DEFAULT_TAG: &str = "agentbox-mirror-v1";

/// Derive the 32-byte mirror child secret from the operator key.
///
/// `operator_sk_hex` is the 64-hex secret exactly as `AGENTBOX_PRIVKEY_HEX`
/// supplies it, in either case, before any even-y normalisation (see the
/// module docs). `tag` of `None` or an empty or whitespace string selects
/// [`DEFAULT_TAG`], matching `envFirst(...) || 'agentbox-mirror-v1'`.
///
/// The result is not reduced modulo the curve order, as in the JavaScript. A
/// digest at or above `n` (probability about 2^-128) is rejected later by
/// [`child_xonly_pubkey_hex`] rather than altered here.
///
/// ```
/// use nostr_pod_bridge::mirror_key::child_secret;
/// // Synthetic vector shared with tests/sovereign/egress-boundary.test.js.
/// let child = child_secret(&"a".repeat(64), None).unwrap();
/// assert_eq!(
///     hex::encode(child),
///     "a25935d1bb6782faa0ceaca1dce34bb23bf45a507e8e19b8973de836cbdcab72"
/// );
/// ```
pub fn child_secret(operator_sk_hex: &str, tag: Option<&str>) -> Result<[u8; 32]> {
    let raw = operator_sk_hex.trim();
    if raw.len() != 64 || !raw.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(anyhow!("operator key must be exactly 64 hex characters"));
    }
    let key = hex::decode(raw).context("operator key is not valid hex")?;
    let tag = match tag.map(str::trim) {
        Some(t) if !t.is_empty() => t,
        _ => DEFAULT_TAG,
    };
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key)
        .map_err(|_| anyhow!("HMAC key rejected"))?;
    mac.update(tag.as_bytes());
    Ok(mac.finalize().into_bytes().into())
}

/// The BIP-340 x-only public key of the mirror child: the identity the phone
/// shows and the recipient the hook self-DMs.
pub fn child_xonly_pubkey_hex(operator_sk_hex: &str, tag: Option<&str>) -> Result<String> {
    let child = child_secret(operator_sk_hex, tag)?;
    Ok(crate::identity::keypair_from_privkey_hex(&hex::encode(child))?.x_only_pubkey_hex)
}
