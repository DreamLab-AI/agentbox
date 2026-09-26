//! End-to-end encrypted forum zones for the nightly digest (forum kit
//! ADR-2016).
//!
//! The digest is a kind-42 into the dreamlab zone. When the deployment has
//! zone encryption on (`ENCRYPTION_ENABLED` is exactly `"true"`) and that
//! zone's `ZONE_CONFIG` entry is `"encrypted": true` (and not public), the
//! relay refuses plaintext there, so the digest is encrypted to the zone key:
//! `content = nip44_encrypt(author_sk, zone_epoch_pk, text)` plus the tag
//! `["zk", <zone>, "<epoch>", <zone epoch pubkey hex>]`. Without a key the
//! digest is **not posted** — never a plaintext fallback.
//!
//! No cryptography lives here: NIP-44 v2 is `nostr_bbs_core::nip44`
//! (rust-nostr, upstream-vector tested). This module only reads settings and
//! the key file and composes the event.
//!
//! The key file is written by the JunkieJarvis forum agent
//! (`management-api/lib/zone-keys.js`, which accepts admin-sealed grants) and
//! read here: `$WORKSPACE/.agentbox/zone-keys.json` (override
//! `ZONE_KEYS_FILE`), mode 0600, never in git —
//! `{"version":1,"owner":"<holder pubkey hex>","keys":[{"zone","epoch","secret","pubkey","granted_by","received_at"}]}`.
//! A file owned by a different identity is ignored.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Tag marking a zone-encrypted kind-42.
pub const ZK_TAG: &str = "zk";
/// Key-file format version understood here.
pub const KEY_FILE_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// A non-secret setting: the process environment when set and non-empty,
/// else the `NAME=value` line of `env_file` (surrounding quotes stripped) —
/// the same lookup the JS side uses, so both read the operator's
/// `agentbox/.env` identically.
pub fn read_setting(name: &str, env_file: &Path) -> Option<String> {
    if let Ok(v) = std::env::var(name) {
        if !v.trim().is_empty() {
            return Some(v);
        }
    }
    let text = std::fs::read_to_string(env_file).ok()?;
    setting_from_text(name, &text)
}

fn setting_from_text(name: &str, text: &str) -> Option<String> {
    let prefix = format!("{name}=");
    text.lines().find_map(|raw| {
        let line = raw.trim();
        let v = line.strip_prefix(&prefix)?.trim();
        let unquoted = if v.len() >= 2
            && ((v.starts_with('"') && v.ends_with('"'))
                || (v.starts_with('\'') && v.ends_with('\'')))
        {
            &v[1..v.len() - 1]
        } else {
            v
        };
        Some(unquoted.to_string())
    })
}

/// The deployment gate: only the exact string `"true"` is on.
pub fn gate_value_enabled(raw: Option<&str>) -> bool {
    raw == Some("true")
}

/// One `ZONE_CONFIG` entry, as far as encryption needs it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ZoneEntry {
    pub id: String,
    #[serde(default)]
    pub encrypted: bool,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub required_cohorts: Vec<String>,
}

/// Parse a `ZONE_CONFIG` JSON array; malformed or absent yields no zones.
pub fn parse_zones(raw: Option<&str>) -> Vec<ZoneEntry> {
    raw.and_then(|r| serde_json::from_str::<Vec<ZoneEntry>>(r.trim()).ok())
        .unwrap_or_default()
}

/// Channel section → zone id: the kit's `section_to_zone` (exact id, then an
/// `<id>-` prefix, then the first zone as a catch-all).
pub fn section_to_zone(section: &str, zones: &[ZoneEntry]) -> Option<String> {
    let sec = section.to_lowercase();
    if let Some(z) = zones.iter().find(|z| z.id.to_lowercase() == sec) {
        return Some(z.id.clone());
    }
    if let Some(z) = zones
        .iter()
        .find(|z| sec.starts_with(&format!("{}-", z.id.to_lowercase())))
    {
        return Some(z.id.clone());
    }
    zones.first().map(|z| z.id.clone())
}

/// Whether writes into `zone` must be encrypted: gate on, zone flagged, and
/// not a public zone (the relay's rule — anonymous readers hold no key).
pub fn zone_is_encrypted(zone: &str, gate: bool, zones: &[ZoneEntry]) -> bool {
    gate && zones.iter().any(|z| {
        z.id == zone
            && z.encrypted
            && !(z.visibility.as_deref() == Some("public") && z.required_cohorts.is_empty())
    })
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// A held zone key. `Debug` never prints the secret.
#[derive(Clone, PartialEq, Eq, Deserialize)]
pub struct ZoneKey {
    pub zone: String,
    pub epoch: u32,
    pub secret: String,
    pub pubkey: String,
    #[serde(default)]
    pub granted_by: String,
    #[serde(default)]
    pub received_at: u64,
}

impl fmt::Debug for ZoneKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ZoneKey")
            .field("zone", &self.zone)
            .field("epoch", &self.epoch)
            .field("pubkey", &self.pubkey)
            .field("secret", &"<redacted>")
            .finish()
    }
}

impl ZoneKey {
    fn secret_bytes(&self) -> Option<[u8; 32]> {
        hex32(&self.secret)
    }
}

fn hex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    hex::decode(s).ok()?.try_into().ok()
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Deserialize)]
struct KeyFile {
    version: u32,
    owner: String,
    #[serde(default)]
    keys: Vec<ZoneKey>,
}

/// The key file path: `ZONE_KEYS_FILE`, else `$WORKSPACE/.agentbox/zone-keys.json`.
pub fn key_file_path() -> PathBuf {
    if let Ok(p) = std::env::var("ZONE_KEYS_FILE") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let ws = std::env::var("WORKSPACE").unwrap_or_else(|_| "/home/devuser/workspace".into());
    PathBuf::from(ws).join(".agentbox/zone-keys.json")
}

/// Keys held by `owner`, from key-file JSON text. Wrong version, wrong owner
/// or malformed entries yield nothing.
pub fn keys_from_text(text: &str, owner: &str) -> Vec<ZoneKey> {
    let Ok(file) = serde_json::from_str::<KeyFile>(text) else {
        return Vec::new();
    };
    if file.version != KEY_FILE_VERSION || file.owner != owner {
        return Vec::new();
    }
    file.keys
        .into_iter()
        .filter(|k| {
            !k.zone.is_empty() && k.epoch >= 1 && is_hex64(&k.secret) && is_hex64(&k.pubkey)
        })
        .collect()
}

/// Keys held by `owner` in the key file at `path` (none if unreadable).
pub fn load_keys(path: &Path, owner: &str) -> Vec<ZoneKey> {
    std::fs::read_to_string(path)
        .map(|t| keys_from_text(&t, owner))
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Write plan
// ---------------------------------------------------------------------------

/// How a kind-42 into a zone must be published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WritePlan {
    /// The zone is not encrypted.
    Plain,
    /// Encrypt to this (latest-epoch) key.
    Encrypt(ZoneKey),
    /// Encrypted zone and no key held: do not post.
    Refuse(String),
}

/// Decide how to publish into `zone`.
pub fn write_plan(zone: &str, gate: bool, zones: &[ZoneEntry], keys: &[ZoneKey]) -> WritePlan {
    if !zone_is_encrypted(zone, gate, zones) {
        return WritePlan::Plain;
    }
    match keys
        .iter()
        .filter(|k| k.zone == zone)
        .max_by_key(|k| k.epoch)
    {
        Some(k) => WritePlan::Encrypt(k.clone()),
        None => WritePlan::Refuse(format!("no zone key held for encrypted zone {zone}")),
    }
}

/// Apply `plan` to a kind-42's content and tags, encrypting with the author's
/// secret `author_sk` to the zone pubkey. `Plain` passes through; `Refuse` is
/// an error.
pub fn apply(
    plan: &WritePlan,
    author_sk: &[u8; 32],
    content: String,
    mut tags: Vec<Vec<String>>,
) -> Result<(String, Vec<Vec<String>>), String> {
    match plan {
        WritePlan::Plain => Ok((content, tags)),
        WritePlan::Refuse(reason) => Err(reason.clone()),
        WritePlan::Encrypt(key) => {
            let zone_pk = hex32(&key.pubkey).ok_or("malformed zone pubkey")?;
            let ct = nostr_bbs_core::nip44::encrypt(author_sk, &zone_pk, &content)
                .map_err(|e| format!("nip44 encrypt: {e}"))?;
            tags.retain(|t| t.first().map(String::as_str) != Some(ZK_TAG));
            tags.push(vec![
                ZK_TAG.to_string(),
                key.zone.clone(),
                key.epoch.to_string(),
                key.pubkey.clone(),
            ]);
            Ok((ct, tags))
        }
    }
}

/// Decrypt a zone message by `author_pubkey` with a held `key` (the reader's
/// side: ECDH(zone_sk, author_pk)).
pub fn decrypt_with(key: &ZoneKey, author_pubkey: &str, content: &str) -> Result<String, String> {
    let sk = key.secret_bytes().ok_or("malformed zone secret")?;
    let author = hex32(author_pubkey).ok_or("malformed author pubkey")?;
    nostr_bbs_core::nip44::decrypt(&sk, &author, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test-only keys (not secrets): the same fixed scalars as the JS
    // cross-check in tests/sovereign/zone-keys.test.js.
    const AUTHOR_SK: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const ZONE_SK: &str = "0000000000000000000000000000000000000000000000000000000000000002";

    fn zone_key(epoch: u32) -> ZoneKey {
        ZoneKey {
            zone: "zone4".into(),
            epoch,
            secret: ZONE_SK.into(),
            pubkey: nostr_bbs_core::keys::pubkey_hex(&hex32(ZONE_SK).unwrap()).unwrap(),
            granted_by: "admin".into(),
            received_at: 0,
        }
    }

    fn author_pk() -> String {
        nostr_bbs_core::keys::pubkey_hex(&hex32(AUTHOR_SK).unwrap()).unwrap()
    }

    fn zones() -> Vec<ZoneEntry> {
        parse_zones(Some(
            r#"[{"id":"zone1","visibility":"public","required_cohorts":[],"encrypted":true},
                {"id":"zone3","visibility":"locked","required_cohorts":["family"],"encrypted":true},
                {"id":"zone4","visibility":"locked","required_cohorts":["dreamlab"],"encrypted":true,"agent_keys":true},
                {"id":"zone2","visibility":"locked","required_cohorts":["m"]}]"#,
        ))
    }

    #[test]
    fn settings_read_from_env_file_text() {
        let text = "FOO=1\nENCRYPTION_ENABLED=\"true\"\nZONE_CONFIG='[{\"id\":\"zone4\"}]'\n";
        assert_eq!(
            setting_from_text("ENCRYPTION_ENABLED", text).as_deref(),
            Some("true")
        );
        assert_eq!(
            parse_zones(setting_from_text("ZONE_CONFIG", text).as_deref())[0].id,
            "zone4"
        );
        assert_eq!(setting_from_text("MISSING", text), None);
    }

    #[test]
    fn gate_is_exact_true() {
        assert!(gate_value_enabled(Some("true")));
        for off in [None, Some("TRUE"), Some("1"), Some("false"), Some(" true")] {
            assert!(!gate_value_enabled(off), "{off:?}");
        }
    }

    #[test]
    fn digest_section_maps_to_zone4_and_public_is_never_encrypted() {
        let z = zones();
        assert_eq!(
            section_to_zone("zone4-chat-with-agents", &z).as_deref(),
            Some("zone4")
        );
        assert_eq!(section_to_zone("zone3", &z).as_deref(), Some("zone3"));
        assert_eq!(section_to_zone("elsewhere", &z).as_deref(), Some("zone1"));
        assert!(zone_is_encrypted("zone4", true, &z));
        assert!(!zone_is_encrypted("zone4", false, &z), "gate off");
        assert!(!zone_is_encrypted("zone1", true, &z), "public zone");
        assert!(!zone_is_encrypted("zone2", true, &z), "not flagged");
    }

    #[test]
    fn gate_off_leaves_the_digest_plaintext() {
        let plan = write_plan("zone4", false, &zones(), &[]);
        assert_eq!(plan, WritePlan::Plain);
        let tags = vec![vec!["e".to_string(), "chan".to_string()]];
        let (c, t) = apply(
            &plan,
            &hex32(AUTHOR_SK).unwrap(),
            "hello".into(),
            tags.clone(),
        )
        .unwrap();
        assert_eq!((c.as_str(), t), ("hello", tags));
    }

    #[test]
    fn no_key_refuses_never_plaintext() {
        let plan = write_plan("zone4", true, &zones(), &[]);
        assert!(matches!(plan, WritePlan::Refuse(_)));
        assert!(apply(&plan, &hex32(AUTHOR_SK).unwrap(), "x".into(), vec![]).is_err());
    }

    #[test]
    fn encrypts_to_latest_epoch_and_round_trips() {
        let keys = vec![zone_key(1), zone_key(3), zone_key(2)];
        let plan = write_plan("zone4", true, &zones(), &keys);
        let WritePlan::Encrypt(k) = &plan else {
            panic!("expected encrypt")
        };
        assert_eq!(k.epoch, 3);
        let (ct, tags) = apply(
            &plan,
            &hex32(AUTHOR_SK).unwrap(),
            "tonight's digest".into(),
            vec![vec!["e".into(), "chan".into(), "".into(), "root".into()]],
        )
        .unwrap();
        assert_ne!(ct, "tonight's digest");
        assert_eq!(tags[0][1], "chan", "other tags untouched");
        assert_eq!(
            tags[1],
            vec![
                "zk".to_string(),
                "zone4".into(),
                "3".into(),
                k.pubkey.clone()
            ]
        );
        assert_eq!(
            decrypt_with(k, &author_pk(), &ct).unwrap(),
            "tonight's digest"
        );
        // Shape the relay accepts: standard base64 of a v2 payload.
        use base64::Engine as _;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&ct)
            .unwrap();
        assert_eq!(raw[0], 2);
        assert!((132..=87_472).contains(&ct.len()));
    }

    /// Cross-implementation vector: this ciphertext was produced by the JS
    /// side (nostr-tools nip44 v2, `zone-keys.js` `applyWritePlan`) with the
    /// fixed test keys above; Rust must decrypt it. The mirror test in
    /// tests/sovereign/zone-keys.test.js decrypts [`RUST_CIPHERTEXT`].
    const JS_CIPHERTEXT: &str = include_str!("../tests/fixtures/zone-js-ciphertext.txt");
    const RUST_CIPHERTEXT: &str = include_str!("../tests/fixtures/zone-rust-ciphertext.txt");

    #[test]
    fn cross_checks_with_the_js_implementation() {
        let key = zone_key(1);
        assert_eq!(
            decrypt_with(&key, &author_pk(), JS_CIPHERTEXT.trim()).unwrap(),
            "cross-check from js"
        );
        // And the committed Rust vector still decrypts (guards the fixture).
        assert_eq!(
            decrypt_with(&key, &author_pk(), RUST_CIPHERTEXT.trim()).unwrap(),
            "cross-check from rust"
        );
    }

    #[test]
    fn key_file_owner_and_shape_are_enforced() {
        let k = zone_key(1);
        let text = format!(
            r#"{{"version":1,"owner":"me","keys":[{{"zone":"zone4","epoch":1,"secret":"{}","pubkey":"{}"}},{{"zone":"","epoch":1,"secret":"x","pubkey":"y"}}]}}"#,
            k.secret, k.pubkey
        );
        assert_eq!(keys_from_text(&text, "me").len(), 1);
        assert!(keys_from_text(&text, "someone-else").is_empty());
        assert!(keys_from_text(&text.replace("\"version\":1", "\"version\":2"), "me").is_empty());
        assert!(keys_from_text("not json", "me").is_empty());
    }

    #[test]
    fn debug_never_prints_the_secret() {
        let k = zone_key(1);
        assert!(!format!("{k:?}").contains(&k.secret));
    }
}
