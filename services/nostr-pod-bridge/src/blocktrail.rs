//! The `blocktrails.json` trail shape, mirrored from solid-pod-rs.
//!
//! This is a field-for-field mirror of `solid_pod_rs::blocktrail::Blocktrail`
//! and `BlocktrailTxo` as solid-pod-rs `up/blocktrails-verify` 97582a8 defines
//! them. The bridge takes solid-pod-rs from crates.io (where that change is not
//! yet released), so the type is copied rather than imported; the golden test in
//! `tests/contract.rs` pins the serialised bytes to JSON emitted by the
//! solid-pod-rs code itself, and fails if either side drifts.
//!
//! The shape is blocktrails/spec, git-mark profile §5.2, as blocktrails/git-mark
//! b852d7d `trail()` writes it:
//!
//! ```json
//! {
//!   "@type": "Blocktrail",
//!   "version": "0.0.3",
//!   "profile": "gitmark",
//!   "pubkeyBase": "02…",
//!   "chain": "tbtc4",
//!   "states": ["<genesis_commit>", "<hash>"],
//!   "txo": ["txo:tbtc4:…:0?amount=…&commit=…", "txo:tbtc4:…"]
//! }
//! ```
//!
//! A *mark* is a Bitcoin output whose key is the trail's base key tweaked by
//! every state so far; the marks spend one another in order, so each state is
//! timestamped by the block that confirms its mark. Nothing here derives a key:
//! this module only reads and writes the file and its TXO URIs.
//!
//! The earlier shape (`@id`, `genesis`, and `txo` entries of the form
//! `{outpoint, blockheight}`) still parses and serialises back as it was read,
//! as it does in solid-pod-rs.

use std::fmt;
use std::str::FromStr;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// The `@type` every trail carries.
pub const BLOCKTRAIL_TYPE: &str = "Blocktrail";
/// The `version` blocktrails/git-mark b852d7d writes in `blocktrails.json`.
pub const BLOCKTRAIL_VERSION: &str = "0.0.3";
/// The git-mark profile: each state is a git commit hash, hashed as its text.
pub const GITMARK_PROFILE: &str = "gitmark";
/// The profile a trail with no `profile` is read as (blocktrails/verify).
pub const DEFAULT_PROFILE: &str = "monochrome";
/// The network name of the sidestr git-mark chain, as `chain` and TXO URIs
/// carry it. blocktrails/git-mark b852d7d maps it to the sidestr chain id
/// `sidestr:gitmark` (`NETWORK_CHAIN.gitmark`); the id itself never appears in
/// a TXO URI, which splits on `:`.
pub const GITMARK_NETWORK: &str = "gitmark";

/// Whether `commit` is a git commit hash a git-mark trail accepts as a state:
/// 40 lowercase hex characters (blocktrails/git-mark `validateCommitHash`), or
/// 64 for a repository using SHA-256 object names.
///
/// # Examples
///
/// ```
/// use nostr_pod_bridge::blocktrail::is_gitmark_commit;
///
/// assert!(is_gitmark_commit("9adc596cfd1100333393a12f2f41b2d820f16d0b"));
/// assert!(!is_gitmark_commit("9ADC596CFD1100333393A12F2F41B2D820F16D0B"));
/// assert!(!is_gitmark_commit("9adc596c"));
/// ```
#[must_use]
pub fn is_gitmark_commit(commit: &str) -> bool {
    matches!(commit.len(), 40 | 64)
        && commit
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

// ---------------------------------------------------------------------------
// TXO URIs
// ---------------------------------------------------------------------------

/// A TXO URI that could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxoUriError(pub String);

impl fmt::Display for TxoUriError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid TXO URI: {}", self.0)
    }
}

impl std::error::Error for TxoUriError {}

/// One mark of a trail: the output that commits to a state.
///
/// Written as a TXO URI,
/// `txo:<chain>:<txid>:<vout>?amount=<sats>&commit=<hash>[&pubkey=<x>]`
/// (blocktrails/spec git-mark profile §3; blocktrails/git-mark b852d7d
/// `formatTxoUri`, which writes `amount`, then `pubkey`, then `commit`, each
/// only when it is set). `chain` is `None` only for an entry read from the
/// earlier `{outpoint, blockheight}` form, which is written back in that form.
///
/// # Examples
///
/// ```
/// use nostr_pod_bridge::blocktrail::BlocktrailTxo;
///
/// let uri = "txo:tbtc4:51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf:0\
///            ?amount=999700&commit=9adc596cfd1100333393a12f2f41b2d820f16d0b";
/// let txo: BlocktrailTxo = uri.parse().unwrap();
/// assert_eq!(txo.chain.as_deref(), Some("tbtc4"));
/// assert_eq!(txo.vout, 0);
/// assert_eq!(txo.amount, Some(999_700));
/// assert_eq!(txo.to_string(), uri);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlocktrailTxo {
    /// The chain token (`tbtc4`, `mainnet`, `gitmark`, …); `None` for an entry
    /// in the earlier `{outpoint, blockheight}` form.
    pub chain: Option<String>,
    /// The transaction id, 64 hex characters.
    pub txid: String,
    /// The output index within `txid`.
    pub vout: u32,
    /// The output's value in sats, when recorded.
    pub amount: Option<u64>,
    /// The state this mark commits to; for a git-mark trail, its commit hash.
    pub commit: Option<String>,
    /// The output's x-only key (64 hex), when recorded. A verifier recomputes
    /// it from the base key and the states, so it is optional.
    pub pubkey: Option<String>,
    /// The confirmation height, kept only by the earlier entry form; a TXO URI
    /// carries no height.
    pub blockheight: Option<u64>,
}

impl BlocktrailTxo {
    /// A mark at `txid:vout` on `chain`, with nothing else recorded.
    #[must_use]
    pub fn new(chain: impl Into<String>, txid: impl Into<String>, vout: u32) -> Self {
        Self {
            chain: Some(chain.into()),
            txid: txid.into(),
            vout,
            amount: None,
            commit: None,
            pubkey: None,
            blockheight: None,
        }
    }

    /// This mark with its output value recorded.
    #[must_use]
    pub fn with_amount(mut self, amount: u64) -> Self {
        self.amount = Some(amount);
        self
    }

    /// This mark with the state it commits to recorded (`commit=`).
    #[must_use]
    pub fn with_commit(mut self, commit: impl Into<String>) -> Self {
        self.commit = Some(commit.into());
        self
    }

    /// `<txid>:<vout>`.
    #[must_use]
    pub fn outpoint(&self) -> String {
        format!("{}:{}", self.txid, self.vout)
    }

    /// Whether this entry was read from the earlier `{outpoint, blockheight}`
    /// form (it has no chain).
    #[must_use]
    pub fn is_legacy(&self) -> bool {
        self.chain.is_none()
    }

    /// The TXO URI, or `None` for an entry with no chain.
    #[must_use]
    pub fn to_uri(&self) -> Option<String> {
        let chain = self.chain.as_deref()?;
        let mut uri = format!("txo:{chain}:{}:{}", self.txid, self.vout);
        let mut params = Vec::new();
        if let Some(a) = self.amount {
            params.push(format!("amount={a}"));
        }
        if let Some(p) = self.pubkey.as_deref().filter(|p| !p.is_empty()) {
            params.push(format!("pubkey={p}"));
        }
        if let Some(c) = self.commit.as_deref().filter(|c| !c.is_empty()) {
            params.push(format!("commit={c}"));
        }
        if !params.is_empty() {
            uri.push('?');
            uri.push_str(&params.join("&"));
        }
        Some(uri)
    }

    /// Parse a TXO URI.
    ///
    /// The chain is letters and digits and the txid 64 hex characters, as
    /// blocktrails/verify requires; the vout a non-negative integer. Query
    /// parameters are read as blocktrails/git-mark reads them: `amount` as an
    /// integer, `commit` and `pubkey` as given (percent-decoded), an empty
    /// value as absent; any other parameter is ignored.
    ///
    /// # Errors
    ///
    /// [`TxoUriError`] for a URI that does not start with `txo:`, lacks the
    /// chain, txid or vout, or has a malformed one of them or of `amount`.
    pub fn parse_uri(uri: &str) -> Result<Self, TxoUriError> {
        let body = uri
            .strip_prefix("txo:")
            .ok_or_else(|| TxoUriError("must start with txo:".into()))?;
        let (path, query) = match body.split_once('?') {
            Some((p, q)) => (p, Some(q)),
            None => (body, None),
        };
        let mut parts = path.split(':');
        let (Some(chain), Some(txid), Some(vout), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(TxoUriError("expected txo:<chain>:<txid>:<vout>".into()));
        };
        if chain.is_empty() || !chain.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Err(TxoUriError(format!("bad chain {chain:?}")));
        }
        if txid.len() != 64 || !txid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(TxoUriError("the txid must be 64 hex characters".into()));
        }
        if vout.is_empty() || !vout.bytes().all(|b| b.is_ascii_digit()) {
            return Err(TxoUriError(format!("bad vout {vout:?}")));
        }
        let vout: u32 = vout
            .parse()
            .map_err(|_| TxoUriError(format!("vout {vout} out of range")))?;

        let mut txo = Self::new(chain, txid, vout);
        for pair in query.unwrap_or_default().split('&') {
            let Some((key, raw)) = pair.split_once('=') else {
                continue;
            };
            let value = percent_decode(raw)?;
            if value.is_empty() {
                continue;
            }
            match key {
                "amount" => {
                    txo.amount = Some(
                        value
                            .parse()
                            .map_err(|_| TxoUriError(format!("bad amount {value:?}")))?,
                    );
                }
                "commit" => txo.commit = Some(value),
                "pubkey" => txo.pubkey = Some(value),
                _ => {}
            }
        }
        Ok(txo)
    }

    fn from_legacy(outpoint: &str, blockheight: Option<u64>) -> Result<Self, TxoUriError> {
        let (txid, vout) = outpoint
            .rsplit_once(':')
            .ok_or_else(|| TxoUriError(format!("outpoint {outpoint:?} is not <txid>:<vout>")))?;
        let vout = vout
            .parse()
            .map_err(|_| TxoUriError(format!("bad vout in outpoint {outpoint:?}")))?;
        Ok(Self {
            chain: None,
            txid: txid.to_string(),
            vout,
            amount: None,
            commit: None,
            pubkey: None,
            blockheight,
        })
    }
}

/// `%XX` decoding of a query value (what `decodeURIComponent` does for the
/// ASCII values a TXO URI carries).
fn percent_decode(raw: &str) -> Result<String, TxoUriError> {
    if !raw.contains('%') {
        return Ok(raw.to_string());
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = raw
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or_else(|| TxoUriError(format!("bad percent escape in {raw:?}")))?;
            out.push(hex);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| TxoUriError(format!("{raw:?} is not UTF-8")))
}

impl FromStr for BlocktrailTxo {
    type Err = TxoUriError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse_uri(s)
    }
}

impl fmt::Display for BlocktrailTxo {
    /// The TXO URI, or `<txid>:<vout>` for an entry with no chain.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.to_uri() {
            Some(uri) => f.write_str(&uri),
            None => f.write_str(&self.outpoint()),
        }
    }
}

#[derive(Serialize)]
struct LegacyTxoOut<'a> {
    outpoint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    blockheight: &'a Option<u64>,
}

#[derive(Deserialize)]
struct LegacyTxoIn {
    outpoint: String,
    #[serde(default)]
    blockheight: Option<u64>,
}

impl Serialize for BlocktrailTxo {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self.to_uri() {
            Some(uri) => s.serialize_str(&uri),
            None => LegacyTxoOut {
                outpoint: self.outpoint(),
                blockheight: &self.blockheight,
            }
            .serialize(s),
        }
    }
}

impl<'de> Deserialize<'de> for BlocktrailTxo {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match Value::deserialize(d)? {
            Value::String(uri) => Self::parse_uri(&uri).map_err(D::Error::custom),
            obj @ Value::Object(_) => {
                let legacy: LegacyTxoIn = serde_json::from_value(obj).map_err(D::Error::custom)?;
                Self::from_legacy(&legacy.outpoint, legacy.blockheight).map_err(D::Error::custom)
            }
            other => Err(D::Error::custom(format!(
                "a txo entry is a TXO URI or {{outpoint, blockheight}}, not {other}"
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// blocktrails.json
// ---------------------------------------------------------------------------

/// A trail as `blocktrails.json` carries it: what a verifier reads.
///
/// `pubkeyBase` is the base key as a full compressed point (02/03 + x), so a
/// verifier has nothing to guess. `states` holds one state per mark, in order:
/// a string state (a git-mark commit) is hashed as its text, an object state
/// as its JCS. The earlier shape's `@id` and `genesis` are kept when read and
/// are `None` in a trail built here ([`Blocktrail::gitmark`]).
///
/// # Examples
///
/// ```
/// use nostr_pod_bridge::blocktrail::{Blocktrail, BlocktrailTxo};
///
/// let commit = "9adc596cfd1100333393a12f2f41b2d820f16d0b";
/// let txid = "51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf";
/// let trail = Blocktrail::gitmark(
///     "0273c7f6cf0f135a63bc95a2e676bcf0a592c8b508fae8697e43f778c74e232b24",
///     "tbtc4",
///     vec![commit.to_string()],
///     vec![BlocktrailTxo::new("tbtc4", txid, 0).with_amount(999_700).with_commit(commit)],
/// );
/// let json: serde_json::Value = serde_json::to_value(&trail).unwrap();
/// assert_eq!(json["@type"], "Blocktrail");
/// assert_eq!(json["profile"], "gitmark");
/// assert_eq!(json["txo"][0], format!("txo:tbtc4:{txid}:0?amount=999700&commit={commit}"));
/// assert!(json.get("@id").is_none());
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Blocktrail {
    /// The earlier shape's `@id` (`gitmark:<first-commit>:0`); `None` in the
    /// §5.2 shape.
    #[serde(rename = "@id", default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Always [`BLOCKTRAIL_TYPE`].
    #[serde(rename = "@type")]
    pub type_: String,
    /// The schema version ([`BLOCKTRAIL_VERSION`] for a trail built here).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The profile (`gitmark`, or a plain profile id); a trail with none is
    /// read as [`DEFAULT_PROFILE`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// The base key as a full compressed point (02/03 + x).
    #[serde(
        rename = "pubkeyBase",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub pubkey_base: Option<String>,
    /// The chain token the marks live on (`tbtc4`, `mainnet`, `gitmark`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chain: Option<String>,
    /// The earlier shape's `genesis` (`gitmark:<first-commit>:0`); `None` in
    /// the §5.2 shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genesis: Option<String>,
    /// One state per mark, in order.
    #[serde(default)]
    pub states: Vec<Value>,
    /// The marks, in order.
    #[serde(default)]
    pub txo: Vec<BlocktrailTxo>,
}

impl Blocktrail {
    /// A git-mark trail in the §5.2 shape: `pubkey_base` as a full compressed
    /// point, the marks on `chain`, the commits as its states.
    #[must_use]
    pub fn gitmark(
        pubkey_base: impl Into<String>,
        chain: impl Into<String>,
        commits: Vec<String>,
        txo: Vec<BlocktrailTxo>,
    ) -> Self {
        Self {
            id: None,
            type_: BLOCKTRAIL_TYPE.to_string(),
            version: Some(BLOCKTRAIL_VERSION.to_string()),
            profile: Some(GITMARK_PROFILE.to_string()),
            pubkey_base: Some(pubkey_base.into()),
            chain: Some(chain.into()),
            genesis: None,
            states: commits.into_iter().map(Value::String).collect(),
            txo,
        }
    }

    /// The profile, lower-cased, or [`DEFAULT_PROFILE`] when none is set (as
    /// blocktrails/verify reads it).
    #[must_use]
    pub fn profile_name(&self) -> String {
        self.profile
            .as_deref()
            .filter(|p| !p.is_empty())
            .unwrap_or(DEFAULT_PROFILE)
            .to_lowercase()
    }

    /// Whether this is a git-mark trail.
    #[must_use]
    pub fn is_gitmark(&self) -> bool {
        self.profile_name() == GITMARK_PROFILE
    }

    /// Whether the trail carries anything of the earlier shape (`@id`,
    /// `genesis`, or a `{outpoint, blockheight}` entry).
    #[must_use]
    pub fn is_legacy(&self) -> bool {
        self.id.is_some() || self.genesis.is_some() || self.txo.iter().any(|t| t.is_legacy())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TXID: &str = "51d87101b7cbb01cc5a68785bf3141ec6fd00894d71ab1168d4daa20420eeacf";
    const COMMIT: &str = "9adc596cfd1100333393a12f2f41b2d820f16d0b";

    #[test]
    fn txo_uri_round_trips_in_git_mark_order() {
        let uri = format!(
            "txo:tbtc4:{TXID}:0?amount=999700&pubkey={}&commit={COMMIT}",
            "ab".repeat(32)
        );
        let t: BlocktrailTxo = uri.parse().unwrap();
        assert_eq!(t.to_string(), uri);
        let reordered: BlocktrailTxo = format!("txo:gitmark:{TXID}:3?commit={COMMIT}&amount=5")
            .parse()
            .unwrap();
        assert_eq!(
            reordered.to_string(),
            format!("txo:gitmark:{TXID}:3?amount=5&commit={COMMIT}")
        );
    }

    #[test]
    fn txo_uri_rejects_malformed() {
        for bad in [
            format!("btc:mainnet:{TXID}:0"),
            format!("txo:{TXID}:0"),
            format!("txo:tbtc4:{}:0", &TXID[..60]),
            format!("txo:sidestr:gitmark:{TXID}:0"),
            format!("txo:tbtc4:{TXID}:x"),
            format!("txo:tbtc4:{TXID}:0?amount=lots"),
        ] {
            assert!(BlocktrailTxo::parse_uri(&bad).is_err(), "{bad} accepted");
        }
    }

    #[test]
    fn legacy_trail_round_trips_unchanged() {
        let old = json!({
            "@id": format!("gitmark:{COMMIT}:0"),
            "@type": "Blocktrail",
            "profile": "gitmark",
            "genesis": format!("gitmark:{COMMIT}:0"),
            "states": [COMMIT],
            "txo": [{"outpoint": format!("{TXID}:0"), "blockheight": 12}]
        });
        let t: Blocktrail = serde_json::from_value(old.clone()).unwrap();
        assert!(t.is_legacy());
        assert_eq!(serde_json::to_value(&t).unwrap(), old);
    }
}
