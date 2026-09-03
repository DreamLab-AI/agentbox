//! Sovereign agent identity: BIP-340 keypair derivation and the persisted
//! `<identity_root>/<agent_id>.json` file.
//!
//! Ported from `scripts/sovereign-bootstrap.py`, which hand-rolled bech32 and
//! derived keys through the pure-Python `ecdsa` package (flagged insecure
//! upstream for timing side channels, and pinned in `flake.nix` only to keep
//! that script running). Every primitive here now comes from an audited crate:
//!
//! * secp256k1 scalar and point arithmetic — [`k256`] (RustCrypto).
//! * NIP-19 `npub` / `nsec` bech32 — [`nostr_bbs_core::nip19`], which wraps the
//!   `bech32` crate behind the same encoder the rest of the mesh uses.
//!
//! ## The identity file
//!
//! Field set and order are byte-compatible with the Python original, because
//! `management-api` and the MCP servers read these files and `identity.env`:
//!
//! ```json
//! {
//!   "agent_id": "agentbox-core",
//!   "created_at": 1756900000,
//!   "private_key_hex": "…64 hex…",
//!   "public_key_hex":  "…128 hex — SEC1 uncompressed X || Y, no 0x04 prefix…",
//!   "x_only_pubkey_hex": "…64 hex — BIP-340 canonical identity…",
//!   "nsec": "nsec1…",
//!   "npub": "npub1…"
//! }
//! ```
//!
//! ## BIP-340 even-y canonicalisation
//!
//! BIP-340 §3.1 (`lift_x`) only admits public keys with even y. When a secret
//! key derives an odd-y point we negate the scalar (`d' = n - d`), which yields
//! the same x coordinate — hence the same Nostr identity — with even y. The
//! *negated* scalar is what gets persisted, so the stored `private_key_hex` is
//! always the one a BIP-340 signer must hold. This matches the Python original
//! exactly; `public_key_hex` therefore always has an even final byte.

use anyhow::{anyhow, Context, Result};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use nostr_bbs_core::nip19::{decode_npub, decode_nsec, encode_npub, encode_nsec};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::envmap::EnvMap;
use crate::pyjson;

/// The derived halves of an agent keypair, in the field order the identity file
/// records them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyMaterial {
    /// 64-char hex secret scalar, already even-y canonicalised.
    pub private_key_hex: String,
    /// 128-char hex SEC1 *uncompressed* public key (X ‖ Y), without the 0x04
    /// prefix — the shape `ecdsa`'s `VerifyingKey.to_string()` produced.
    pub public_key_hex: String,
    /// 64-char hex BIP-340 x-only public key — the canonical `did:nostr` body.
    pub x_only_pubkey_hex: String,
    /// NIP-19 bech32 secret key.
    pub nsec: String,
    /// NIP-19 bech32 public key, over the **32-byte x-only** key.
    pub npub: String,
}

/// A fully resolved agent identity: the keypair plus its file metadata.
#[derive(Debug, Clone, Serialize)]
pub struct Identity {
    pub agent_id: String,
    pub created_at: u64,
    pub private_key_hex: String,
    pub public_key_hex: String,
    pub x_only_pubkey_hex: String,
    pub nsec: String,
    pub npub: String,
}

impl Identity {
    fn new(agent_id: &str, created_at: u64, keys: KeyMaterial) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            created_at,
            private_key_hex: keys.private_key_hex,
            public_key_hex: keys.public_key_hex,
            x_only_pubkey_hex: keys.x_only_pubkey_hex,
            nsec: keys.nsec,
            npub: keys.npub,
        }
    }

    /// `did:nostr:<x-only hex>` — the canonical identity string (ADR-074 D1).
    pub fn did(&self) -> String {
        format!("did:nostr:{}", self.x_only_pubkey_hex)
    }
}

/// Current wall-clock seconds since the Unix epoch.
fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Canonicalise a secret scalar to BIP-340 even-y, returning the (possibly
/// negated) scalar and its SEC1 uncompressed public point (X ‖ Y, 64 bytes).
fn normalise_even_y(bytes: &[u8; 32]) -> Result<([u8; 32], [u8; 64])> {
    let sk = k256::SecretKey::from_slice(bytes)
        .map_err(|_| anyhow!("secret key is not a valid secp256k1 scalar"))?;
    let point = sk.public_key().to_encoded_point(false);
    // SEC1 uncompressed: 0x04 ‖ X(32) ‖ Y(32). The final byte's low bit is y's
    // parity, which is what BIP-340 lift_x constrains.
    let odd_y = point.as_bytes()[64] & 1 == 1;
    let sk = if odd_y {
        k256::SecretKey::from(-sk.to_nonzero_scalar())
    } else {
        sk
    };
    let point = sk.public_key().to_encoded_point(false);

    let mut secret = [0u8; 32];
    secret.copy_from_slice(&sk.to_bytes());
    let mut public = [0u8; 64];
    public.copy_from_slice(&point.as_bytes()[1..65]);
    Ok((secret, public))
}

/// Derive the full [`KeyMaterial`] from a hex secret key, canonicalising to
/// BIP-340 even-y first.
pub fn keypair_from_privkey_hex(privkey_hex: &str) -> Result<KeyMaterial> {
    let raw = hex::decode(privkey_hex.trim()).context("secret key is not valid hex")?;
    let bytes: [u8; 32] = raw
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("secret key must be exactly 32 bytes (64 hex chars)"))?;
    let (secret, public) = normalise_even_y(&bytes)?;

    let private_key_hex = hex::encode(secret);
    let x_only_pubkey_hex = hex::encode(&public[..32]);
    Ok(KeyMaterial {
        nsec: encode_nsec(&private_key_hex).map_err(|e| anyhow!("nsec encoding failed: {e}"))?,
        // NIP-19 §npub bech32-encodes the BIP-340 x-only pubkey (32 bytes), not
        // the SEC1 uncompressed form. Encoding the 64-byte form (PRD-010 C2)
        // produces an npub whose payload no relay or client can check against
        // an event signature.
        npub: encode_npub(&x_only_pubkey_hex).map_err(|e| anyhow!("npub encoding failed: {e}"))?,
        private_key_hex,
        public_key_hex: hex::encode(public),
        x_only_pubkey_hex,
    })
}

/// Generate a fresh keypair from the OS CSPRNG.
pub fn generate_keypair() -> Result<KeyMaterial> {
    let kp = nostr_bbs_core::keys::generate_keypair()
        .map_err(|e| anyhow!("keypair generation failed: {e}"))?;
    keypair_from_privkey_hex(&hex::encode(kp.secret.as_bytes()))
}

/// Resolve an operator-supplied secret key from the environment.
///
/// Precedence matches the Python original: `AGENTBOX_PRIVKEY_HEX` (64-char hex)
/// wins; otherwise `AGENTBOX_NSEC` (bech32) is decoded. A malformed value in
/// either falls through to the persisted-or-generated path rather than failing
/// the boot — an unusable override must not brick the container.
pub fn env_privkey_hex(env: &EnvMap) -> Option<String> {
    let hex_var = env
        .get("AGENTBOX_PRIVKEY_HEX")
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if !hex_var.is_empty() {
        return Some(hex_var);
    }
    let nsec = env.get("AGENTBOX_NSEC").unwrap_or("").trim();
    if nsec.is_empty() {
        return None;
    }
    decode_nsec(nsec).ok()
}

/// Path of the identity file for `agent_id`.
pub fn identity_path(identity_root: &Path, agent_id: &str) -> PathBuf {
    identity_root.join(format!("{agent_id}.json"))
}

/// Serialise `value` exactly as CPython's `json.dumps(value, indent=2)` plus a
/// trailing newline, creating parent directories as needed.
pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let body = format!("{}\n", pyjson::dumps_indent(value, 2));
    std::fs::write(path, body).with_context(|| format!("writing {}", path.display()))
}

/// True when a persisted identity predates the BIP-340 x-only fix and must be
/// re-derived from its (still valid) secret key.
///
/// The Python original tested three conditions; this adds a fourth — any of the
/// derived fields missing or empty — because Rust cannot silently `KeyError` its
/// way past a half-written file the way the original could. Re-derivation is
/// idempotent and changes no key bytes, so widening the trigger is safe.
fn needs_migration(identity: &Value) -> bool {
    let s = |k: &str| identity.get(k).and_then(Value::as_str).unwrap_or("");

    let x_only = s("x_only_pubkey_hex");
    if x_only.len() != 64 {
        return true;
    }
    // Legacy writers bech32-encoded the 64-byte SEC1 pubkey, yielding an npub
    // whose payload is not 32 bytes. `decode_npub` rejects exactly that.
    let npub = s("npub");
    if npub.starts_with("npub") && decode_npub(npub).is_err() {
        return true;
    }
    s("public_key_hex").is_empty() || s("nsec").is_empty() || npub.is_empty()
}

/// Apply the migration in place, preserving the file's existing key order the
/// way CPython's `dict.update` does (hence `serde_json/preserve_order`).
fn apply_migration(identity: &mut Value, keys: KeyMaterial, now: u64) -> Result<()> {
    let obj = identity
        .as_object_mut()
        .ok_or_else(|| anyhow!("identity file is not a JSON object"))?;
    for (key, value) in [
        ("private_key_hex", keys.private_key_hex),
        ("public_key_hex", keys.public_key_hex),
        ("x_only_pubkey_hex", keys.x_only_pubkey_hex),
        ("nsec", keys.nsec),
        ("npub", keys.npub),
    ] {
        obj.insert(key.to_string(), Value::String(value));
    }
    if !obj.get("created_at").is_some_and(Value::is_u64) {
        obj.insert("created_at".to_string(), Value::from(now));
    }
    Ok(())
}

/// Read a migrated-or-current identity file into the typed [`Identity`].
fn identity_from_value(agent_id: &str, value: &Value) -> Result<Identity> {
    let field = |k: &str| -> Result<String> {
        value
            .get(k)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("identity file is missing field `{k}`"))
    };
    Ok(Identity {
        agent_id: value
            .get("agent_id")
            .and_then(Value::as_str)
            .unwrap_or(agent_id)
            .to_string(),
        created_at: value
            .get("created_at")
            .and_then(Value::as_u64)
            .unwrap_or_else(now_unix),
        private_key_hex: field("private_key_hex")?,
        public_key_hex: field("public_key_hex")?,
        x_only_pubkey_hex: field("x_only_pubkey_hex")?,
        nsec: field("nsec")?,
        npub: field("npub")?,
    })
}

/// Resolve the agent identity, writing it to `<identity_root>/<agent_id>.json`.
///
/// Precedence, unchanged from the Python original:
///
/// 1. `AGENTBOX_PRIVKEY_HEX`, then `AGENTBOX_NSEC` — an operator-pinned key
///    always wins and is re-written to the file so every consumer agrees.
/// 2. An existing identity file, migrated in place if it predates the x-only
///    fix.
/// 3. A freshly generated keypair (first boot).
pub fn ensure_identity(agent_id: &str, identity_root: &Path, env: &EnvMap) -> Result<Identity> {
    let path = identity_path(identity_root, agent_id);

    if let Some(privkey_hex) = env_privkey_hex(env) {
        if let Ok(keys) = keypair_from_privkey_hex(&privkey_hex) {
            let identity = Identity::new(agent_id, now_unix(), keys);
            write_json(&path, &identity)?;
            return Ok(identity);
        }
        tracing::warn!(
            "operator-supplied AGENTBOX_PRIVKEY_HEX/AGENTBOX_NSEC is unusable; \
             falling back to the persisted or generated identity"
        );
    }

    if path.exists() {
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        let mut value: Value =
            serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
        let stored_privkey = value
            .get("private_key_hex")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let (true, Some(privkey_hex)) = (needs_migration(&value), stored_privkey) {
            let keys = keypair_from_privkey_hex(&privkey_hex)
                .with_context(|| format!("migrating {}", path.display()))?;
            apply_migration(&mut value, keys, now_unix())?;
            write_json(&path, &value)?;
        }
        return identity_from_value(agent_id, &value);
    }

    let identity = Identity::new(agent_id, now_unix(), generate_keypair()?);
    write_json(&path, &identity)?;
    Ok(identity)
}
