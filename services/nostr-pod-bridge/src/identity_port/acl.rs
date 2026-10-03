//! The identity-port ACL: which caller uid may run which named operation, on
//! which key, for which event kinds.
//!
//! The file is checked in (`config/custody/identity-port-acl.json`) and loaded
//! once at start. Everything in it is validated before the socket is bound: an
//! unknown operation name, a grant on a key the file does not declare, a kind
//! on an operation that takes no kind, or a kind no caller may ever be granted
//! is a load error, so a typo can never widen the port at run time.
//!
//! ```json
//! {
//!   "version": 1,
//!   "keys": {
//!     "core": {
//!       "file": "core.key", "required": true, "mirror_root": true,
//!       "nip98_url_prefixes": ["manifest:integrations.solid_pod_rs.base_url"],
//!       "relays": ["ws://127.0.0.1:7777"]
//!     }
//!   },
//!   "callers": {
//!     "1000": {
//!       "name": "devuser",
//!       "ops": {
//!         "pubkey": { "keys": ["core"] },
//!         "nip98": { "keys": ["core"] },
//!         "sign_event": { "keys": ["core"], "kinds": [38410] },
//!         "mirror_key": { "secret": true }
//!       }
//!     }
//!   }
//! }
//! ```

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use url::Url;

/// The closed list of operations (ADR-2101 :110-111). Nothing outside this
/// list is ever dispatched; an ACL naming anything else fails to load.
pub const OPERATIONS: &[&str] = &[
    OP_PUBKEY,
    OP_NIP98,
    OP_SIGN_EVENT,
    OP_FORUM_EVENT,
    OP_NIP42_AUTH,
    OP_MIRROR_KEY,
];

/// Public key of a held key: x-only hex, npub and `did:nostr`.
pub const OP_PUBKEY: &str = "pubkey";
/// A NIP-98 `Authorization` header (kind 27235) for an allowlisted URL.
pub const OP_NIP98: &str = "nip98";
/// A signed event of a kind the caller is granted.
pub const OP_SIGN_EVENT: &str = "sign_event";
/// A signed forum event (the port signs; it never publishes).
pub const OP_FORUM_EVENT: &str = "forum_event";
/// A NIP-42 AUTH event (kind 22242) for a configured relay.
pub const OP_NIP42_AUTH: &str = "nip42_auth";
/// The live-mirror child key (the phone's key), derived by [`crate::mirror_key`].
pub const OP_MIRROR_KEY: &str = "mirror_key";

/// Kinds no ACL may grant to `sign_event` or `forum_event`.
///
/// 27235 and 22242 have dedicated operations whose URL and relay checks a raw
/// signature would bypass. 31400-31405 are governance kinds and 38414 is a
/// graduation: both record a human decision and must not carry a container key
/// (see [`crate::colloquy_publish`]).
pub const NEVER_GRANTABLE_KINDS: &[u64] = &[
    27_235, 22_242, 31_400, 31_401, 31_402, 31_403, 31_404, 31_405, 38_414,
];

/// One grant: an operation a caller may run.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpGrant {
    /// Keys this operation may use for this caller. Ignored by `mirror_key`.
    #[serde(default)]
    pub keys: Vec<String>,
    /// Event kinds this caller may sign (only `sign_event` and `forum_event`).
    #[serde(default)]
    pub kinds: Vec<u64>,
    /// `mirror_key` only: whether the child *secret* is returned, not just the
    /// child's public key.
    #[serde(default)]
    pub secret: bool,
}

/// One caller uid and what it may do.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallerSpec {
    /// Account name, for receipts and humans; authorisation is by uid only.
    pub name: String,
    /// Operation name to grant.
    pub ops: BTreeMap<String, OpGrant>,
}

/// One held key.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeySpec {
    /// File name under the key directory (`AGENTBOX_IDENTITY_KEY_DIR`). A bare
    /// name: no `/`, no `..`.
    pub file: String,
    /// Refuse to start when the file is absent.
    #[serde(default)]
    pub required: bool,
    /// This key is the root of the live-mirror child (at most one key).
    #[serde(default)]
    pub mirror_root: bool,
    /// URL prefixes a NIP-98 header may be signed for. `manifest:a.b.c`
    /// resolves to that string value of the agentbox manifest.
    #[serde(default)]
    pub nip98_url_prefixes: Vec<String>,
    /// Relay URLs a NIP-42 AUTH may name. `manifest:` references as above.
    #[serde(default)]
    pub relays: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AclFile {
    version: u32,
    #[serde(default, rename = "_comment")]
    _comment: Option<serde_json::Value>,
    keys: BTreeMap<String, KeySpec>,
    callers: BTreeMap<String, CallerSpec>,
}

/// A key's resolved policy: its URL prefixes and relays after `manifest:`
/// references are resolved.
#[derive(Debug, Clone)]
pub struct KeyPolicy {
    /// The declaration as written.
    pub spec: KeySpec,
    /// Parsed NIP-98 prefixes.
    pub url_prefixes: Vec<Url>,
    /// Normalised relay URLs.
    pub relays: BTreeSet<String>,
}

/// The validated ACL.
#[derive(Debug, Clone)]
pub struct Acl {
    /// Declared keys by name.
    pub keys: BTreeMap<String, KeyPolicy>,
    /// Callers by uid.
    pub callers: BTreeMap<u32, CallerSpec>,
    /// Manifest references that did not resolve (they grant nothing).
    pub unresolved: Vec<String>,
}

impl Acl {
    /// Load and validate an ACL file. `manifest` is the parsed agentbox
    /// manifest used to resolve `manifest:` references, if available.
    pub fn load(path: &Path, manifest: Option<&toml::Value>) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("reading the identity-port ACL {}", path.display()))?;
        Self::parse(&raw, manifest).with_context(|| format!("in {}", path.display()))
    }

    /// Parse and validate ACL JSON.
    pub fn parse(raw: &str, manifest: Option<&toml::Value>) -> Result<Self> {
        let file: AclFile = serde_json::from_str(raw).context("parsing the identity-port ACL")?;
        if file.version != 1 {
            bail!("unsupported ACL version {} (expected 1)", file.version);
        }
        let mut unresolved = Vec::new();
        let mut keys = BTreeMap::new();
        let mut mirror_roots = 0;
        for (name, spec) in file.keys {
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            {
                bail!("key name {name:?} must be [A-Za-z0-9_-]+");
            }
            if spec.file.is_empty()
                || spec.file.contains('/')
                || spec.file == ".."
                || spec.file == "."
            {
                bail!("key {name}: file {:?} must be a bare file name", spec.file);
            }
            if spec.mirror_root {
                mirror_roots += 1;
            }
            let mut url_prefixes = Vec::new();
            for p in resolve_refs(&spec.nip98_url_prefixes, manifest, &mut unresolved) {
                let u = Url::parse(&p)
                    .with_context(|| format!("key {name}: NIP-98 prefix {p:?} is not a URL"))?;
                if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
                    bail!("key {name}: NIP-98 prefix {p:?} must be an http(s) URL with a host");
                }
                if u.query().is_some() || u.fragment().is_some() || !u.username().is_empty() {
                    bail!("key {name}: NIP-98 prefix {p:?} must not carry a query, fragment or userinfo");
                }
                url_prefixes.push(u);
            }
            let mut relays = BTreeSet::new();
            for r in resolve_refs(&spec.relays, manifest, &mut unresolved) {
                let u = Url::parse(&r)
                    .with_context(|| format!("key {name}: relay {r:?} is not a URL"))?;
                if !matches!(u.scheme(), "ws" | "wss") {
                    bail!("key {name}: relay {r:?} must be ws:// or wss://");
                }
                relays.insert(normalise_relay(&r));
            }
            keys.insert(
                name,
                KeyPolicy {
                    spec,
                    url_prefixes,
                    relays,
                },
            );
        }
        if mirror_roots > 1 {
            bail!("at most one key may be the mirror_root");
        }

        let mut callers = BTreeMap::new();
        for (uid, caller) in file.callers {
            let uid: u32 = uid
                .parse()
                .map_err(|_| anyhow!("caller {uid:?} is not a numeric uid"))?;
            for (op, grant) in &caller.ops {
                validate_grant(uid, op, grant, &keys)?;
            }
            callers.insert(uid, caller);
        }
        Ok(Self {
            keys,
            callers,
            unresolved,
        })
    }

    /// The grant for `(uid, op)`, if any.
    pub fn grant(&self, uid: u32, op: &str) -> Option<&OpGrant> {
        self.callers.get(&uid)?.ops.get(op)
    }
}

fn validate_grant(
    uid: u32,
    op: &str,
    g: &OpGrant,
    keys: &BTreeMap<String, KeyPolicy>,
) -> Result<()> {
    if !OPERATIONS.contains(&op) {
        bail!(
            "caller {uid}: {op:?} is not an identity-port operation (closed list: {OPERATIONS:?})"
        );
    }
    let takes_kinds = op == OP_SIGN_EVENT || op == OP_FORUM_EVENT;
    if takes_kinds && g.kinds.is_empty() {
        bail!("caller {uid}: {op} needs a non-empty kinds allowlist");
    }
    if !takes_kinds && !g.kinds.is_empty() {
        bail!("caller {uid}: {op} takes no kinds");
    }
    if let Some(k) = g.kinds.iter().find(|k| NEVER_GRANTABLE_KINDS.contains(k)) {
        bail!("caller {uid}: kind {k} may never be granted (see NEVER_GRANTABLE_KINDS)");
    }
    if g.secret && op != OP_MIRROR_KEY {
        bail!("caller {uid}: `secret` applies to mirror_key only");
    }
    if op == OP_MIRROR_KEY {
        if !g.keys.is_empty() {
            bail!("caller {uid}: mirror_key derives from the mirror_root key; it takes no keys");
        }
        if !keys.values().any(|k| k.spec.mirror_root) {
            bail!("caller {uid}: mirror_key granted but no key is the mirror_root");
        }
    } else if g.keys.is_empty() {
        bail!("caller {uid}: {op} grants no keys");
    }
    for k in &g.keys {
        if !keys.contains_key(k) {
            bail!("caller {uid}: {op} names undeclared key {k:?}");
        }
    }
    Ok(())
}

/// Resolve `manifest:a.b.c` entries; literal entries pass through.
fn resolve_refs(
    items: &[String],
    manifest: Option<&toml::Value>,
    unresolved: &mut Vec<String>,
) -> Vec<String> {
    let mut out = Vec::new();
    for item in items {
        match item.strip_prefix("manifest:") {
            None => out.push(item.clone()),
            Some(path) => {
                let v = manifest.and_then(|m| path.split('.').try_fold(m, |cur, seg| cur.get(seg)));
                match v.and_then(toml::Value::as_str).map(str::trim) {
                    Some(s) if !s.is_empty() => out.push(s.to_string()),
                    _ => unresolved.push(item.clone()),
                }
            }
        }
    }
    out
}

/// Relay URLs compare without a trailing slash.
pub fn normalise_relay(r: &str) -> String {
    r.trim().trim_end_matches('/').to_string()
}

/// Whether `url` falls under one of `prefixes`: same scheme, host and port,
/// and the path starts with the prefix path on a segment boundary.
pub fn url_allowed(url: &Url, prefixes: &[Url]) -> bool {
    prefixes.iter().any(|p| {
        if p.scheme() != url.scheme()
            || p.host_str() != url.host_str()
            || p.port_or_known_default() != url.port_or_known_default()
        {
            return false;
        }
        let pp = p.path().trim_end_matches('/');
        let up = url.path();
        pp.is_empty() || up == pp || up.starts_with(&format!("{pp}/"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: &str = r#"{"version":1,"keys":{"core":{"file":"core.key","required":true,"mirror_root":true,
        "nip98_url_prefixes":["https://pod.example/base/"],"relays":["ws://127.0.0.1:7777/"]}},
        "callers":{"1000":{"name":"devuser","ops":{"pubkey":{"keys":["core"]},
        "sign_event":{"keys":["core"],"kinds":[38410]},"mirror_key":{"secret":true}}}}}"#;

    fn with_ops(ops: &str) -> String {
        format!(
            r#"{{"version":1,"keys":{{"core":{{"file":"core.key","mirror_root":true}}}},
            "callers":{{"7":{{"name":"x","ops":{ops}}}}}}}"#
        )
    }

    #[test]
    fn a_valid_acl_loads() {
        let acl = Acl::parse(MIN, None).unwrap();
        assert!(acl.grant(1000, OP_PUBKEY).is_some());
        assert!(acl.grant(1000, OP_NIP98).is_none());
        assert!(acl.grant(1001, OP_PUBKEY).is_none());
        assert!(acl.keys["core"].relays.contains("ws://127.0.0.1:7777"));
    }

    #[test]
    fn an_unknown_operation_fails_to_load() {
        let e = Acl::parse(&with_ops(r#"{"dm_unwrap":{"keys":["core"]}}"#), None).unwrap_err();
        assert!(
            format!("{e:#}").contains("not an identity-port operation"),
            "{e:#}"
        );
    }

    #[test]
    fn a_never_grantable_kind_fails_to_load() {
        for k in NEVER_GRANTABLE_KINDS {
            let ops = format!(r#"{{"sign_event":{{"keys":["core"],"kinds":[1,{k}]}}}}"#);
            assert!(
                Acl::parse(&with_ops(&ops), None).is_err(),
                "kind {k} was grantable"
            );
        }
    }

    #[test]
    fn kinds_on_the_wrong_op_or_missing_kinds_fail() {
        assert!(Acl::parse(
            &with_ops(r#"{"nip98":{"keys":["core"],"kinds":[1]}}"#),
            None
        )
        .is_err());
        assert!(Acl::parse(&with_ops(r#"{"sign_event":{"keys":["core"]}}"#), None).is_err());
        assert!(Acl::parse(
            &with_ops(r#"{"pubkey":{"keys":["core"],"secret":true}}"#),
            None
        )
        .is_err());
        assert!(Acl::parse(&with_ops(r#"{"pubkey":{"keys":["nope"]}}"#), None).is_err());
        assert!(Acl::parse(&with_ops(r#"{"pubkey":{"keys":[]}}"#), None).is_err());
        assert!(Acl::parse(&with_ops(r#"{"pubkey":{"keys":["core"],"extra":1}}"#), None).is_err());
    }

    #[test]
    fn non_numeric_uid_and_path_like_key_file_fail() {
        let bad_uid = MIN.replace("\"1000\"", "\"devuser\"");
        assert!(Acl::parse(&bad_uid, None).is_err());
        let bad_file = MIN.replace("core.key", "../core.key");
        assert!(Acl::parse(&bad_file, None).is_err());
    }

    #[test]
    fn manifest_references_resolve_or_grant_nothing() {
        let raw = MIN.replace(
            "https://pod.example/base/",
            "manifest:integrations.solid_pod_rs.base_url",
        );
        let m: toml::Value =
            toml::from_str("[integrations.solid_pod_rs]\nbase_url = \"https://pods.example\"\n")
                .unwrap();
        let acl = Acl::parse(&raw, Some(&m)).unwrap();
        assert_eq!(
            acl.keys["core"].url_prefixes[0].as_str(),
            "https://pods.example/"
        );
        let acl = Acl::parse(&raw, None).unwrap();
        assert!(acl.keys["core"].url_prefixes.is_empty());
        assert_eq!(
            acl.unresolved,
            vec!["manifest:integrations.solid_pod_rs.base_url"]
        );
    }

    #[test]
    fn url_prefix_matching_is_segment_bounded_and_origin_exact() {
        let p = vec![Url::parse("https://pod.example/base/").unwrap()];
        let ok = |s: &str| url_allowed(&Url::parse(s).unwrap(), &p);
        assert!(ok("https://pod.example/base/x"));
        assert!(ok("https://pod.example/base"));
        assert!(ok("https://pod.example:443/base/x"));
        assert!(!ok("https://pod.example/basement/x"));
        assert!(!ok("http://pod.example/base/x"));
        assert!(!ok("https://pod.example:8443/base/x"));
        assert!(!ok("https://pod.example.evil/base/x"));
        assert!(!ok("https://not-allowlisted.invalid/x"));
        let root = vec![Url::parse("http://pod.test").unwrap()];
        assert!(url_allowed(
            &Url::parse("http://pod.test/kg/a").unwrap(),
            &root
        ));
    }
}
