//! The chain document (SPEC 3, 5): the overlay that defines a sidestr chain
//! beside its parent, and the chain's identity.
//!
//! The document is what `siding new` writes and what every validator reads.
//! It is the chain's identity: `genesisHash` is derived from it (the genesis
//! commits to the chain id, the pegs, `genesisTime` and the signer's witness),
//! and a validator refuses to proceed past a block 0 that does not hash to it.
//! Changing any sealed field is a new chain, never a configuration edit.
//!
//! Every field siding reads is parsed and checked here. Fields siding does not
//! read (an operator's `depth`, `containment`, `containmentDigest`, a
//! `comment`, a peg's `parentAddress`) are carried through untouched in
//! [`ChainDocument::extra`] so a document round-trips, and none of them alter
//! the genesis.
//!
//! ```
//! use sidestr_core::document::{ChainDocument, magic_for};
//!
//! let doc = ChainDocument::from_json(r#"{
//!   "id": "sidestr:trial", "name": "trial", "parent": "tbtc4",
//!   "challenge": "512098b4e74305dac5ce76d5bee8e57a71549a27618a0e51b3bada3074fcba02325b",
//!   "powLimit": "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
//!   "addressPrefix": "trl", "magic": "a8f6706f", "genesisTime": 1790076612, "pegs": [],
//!   "signer": "98b4e74305dac5ce76d5bee8e57a71549a27618a0e51b3bada3074fcba02325b",
//!   "depth": 0
//! }"#).unwrap();
//! assert_eq!(doc.parent().unwrap().alias, "tbtc4");
//! assert_eq!(doc.peg_confirmations, 6);           // the SPEC default
//! assert_eq!(magic_for("trial"), "a8f6706f");     // what `siding new` derived
//! assert_eq!(doc.extra["depth"], 0);              // an estate field, carried through
//! ```

use std::collections::BTreeMap;

use bitcoin::{CompactTarget, ScriptBuf, Target};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::parents::{resolve_parent, Family, Parent};

/// A peg output the chain starts from (SPEC 5): the genesis coinbase pays
/// `script` exactly `amount`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Peg {
    /// Parent txid of the peg output, display order.
    pub txid: String,
    /// Output index on the parent.
    pub vout: u32,
    /// Amount in sats.
    pub amount: u64,
    /// The sidechain output script (hex) the coins appear on.
    pub script: String,
    /// Anything else the document says about the peg (`parentAddress`, …).
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// The chain document (SPEC 3). Field names are the wire names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainDocument {
    /// The chain id, `sidestr:<name>`.
    pub id: String,
    /// The short name; the key file and state directory are named after it.
    pub name: String,
    /// The parent: a SPEC 3.2 alias or an accepted long id.
    pub parent: String,
    /// The challenge script (hex); a block is valid when its witness satisfies it.
    pub challenge: String,
    /// The proof-of-work limit as 64 hex characters; no retarget.
    pub pow_limit: String,
    /// The bech32m prefix, distinct from the parent's.
    pub address_prefix: String,
    /// The network magic `siding new` derives from the name; absent on the very first chains.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magic: Option<String>,
    /// Parent confirmations before a peg-in may be claimed.
    #[serde(default = "default_peg_confirmations")]
    pub peg_confirmations: u32,
    /// The relative timelock on every peg output's refund path.
    #[serde(default = "default_refund_blocks")]
    pub refund_blocks: u32,
    /// Parent blocks within which a burn must be paid.
    #[serde(default = "default_pegout_blocks")]
    pub pegout_blocks: u32,
    /// The least a burn may carry, in sats.
    #[serde(default = "default_pegout_min")]
    pub pegout_min: u64,
    /// Producer policy, published so a wallet can compute it: sat/vB.
    #[serde(default = "default_min_fee_rate")]
    pub min_fee_rate: u64,
    /// The genesis block's time.
    pub genesis_time: u32,
    /// The peg outputs the chain starts from.
    #[serde(default)]
    pub pegs: Vec<Peg>,
    /// The signer's x-only public key (level 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signer: Option<String>,
    /// The genesis hash, set once the genesis is sealed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genesis_hash: Option<String>,
    /// Rules the chain names beyond the core (`assets`, `pool`, `evm`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<String>>,
    /// Level 2: the signers' public keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signers: Option<Vec<String>>,
    /// Level 2: how many signers a block needs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<u32>,
    /// Everything else, carried through untouched.
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

fn default_peg_confirmations() -> u32 {
    6
}
fn default_refund_blocks() -> u32 {
    10_000
}
fn default_pegout_blocks() -> u32 {
    144
}
fn default_pegout_min() -> u64 {
    10_000
}
fn default_min_fee_rate() -> u64 {
    1
}

/// The network magic `siding new` derives from a chain name
/// (`siding/bin/siding.mjs`): a 32-bit polynomial hash of `sidestr:<name>`,
/// seed 7, multiplier 31, as eight hex characters.
pub fn magic_for(name: &str) -> String {
    let h = format!("sidestr:{name}")
        .bytes()
        .fold(7u32, |h, b| h.wrapping_mul(31).wrapping_add(u32::from(b)));
    format!("{h:08x}")
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_hexdigit())
}

impl ChainDocument {
    /// Parse and validate a document from its JSON text.
    pub fn from_json(text: &str) -> Result<Self> {
        let doc: Self = serde_json::from_str(text)?;
        doc.validate()?;
        Ok(doc)
    }

    /// The document as JSON, one-space indented as `siding new` writes it.
    pub fn to_json(&self) -> Result<String> {
        let mut out = Vec::new();
        let fmt = serde_json::ser::PrettyFormatter::with_indent(b" ");
        let mut ser = serde_json::Serializer::with_formatter(&mut out, fmt);
        self.serialize(&mut ser)?;
        let mut s = String::from_utf8(out).map_err(|e| Error::Encoding(e.to_string()))?;
        s.push('\n');
        Ok(s)
    }

    /// Check every field this validator reads. A document naming a rule or a
    /// level this crate does not carry is refused here, as `loadEngine` refuses
    /// it, so a validator never runs a chain it would misjudge.
    pub fn validate(&self) -> Result<()> {
        let bad = |m: String| Err(Error::Document(m));
        let parent = self.parent()?;
        if parent.family != Family::Stock {
            return Err(Error::UnsupportedFamily(parent.family));
        }
        if self.id.is_empty() || self.name.is_empty() {
            return bad("id and name are required".into());
        }
        if self.challenge.len() < 2
            || self.challenge.len() % 2 != 0
            || !is_hex(&self.challenge, self.challenge.len())
        {
            return bad("challenge must be a non-empty hex script".into());
        }
        if !is_hex(&self.pow_limit, 64) {
            return bad("powLimit must be 64 hex characters".into());
        }
        if self.address_prefix.is_empty()
            || self.address_prefix.len() > 8
            || !self.address_prefix.bytes().all(|b| b.is_ascii_lowercase())
        {
            return bad("addressPrefix is 1 to 8 lower-case letters".into());
        }
        if let Some(m) = &self.magic {
            if !is_hex(m, 8) {
                return bad("magic must be 8 hex characters".into());
            }
        }
        if let Some(h) = &self.genesis_hash {
            if !is_hex(h, 64) {
                return bad("genesisHash must be 64 hex characters".into());
            }
        }
        for (i, p) in self.pegs.iter().enumerate() {
            if !is_hex(&p.txid, 64)
                || p.script.is_empty()
                || p.script.len() % 2 != 0
                || !is_hex(&p.script, p.script.len())
            {
                return bad(format!(
                    "peg {i}: txid must be 64 hex characters and script a hex script"
                ));
            }
        }
        if let Some(s) = &self.signer {
            if !is_hex(s, 64) {
                return bad("signer must be a 64-hex x-only public key".into());
            }
            let c = self.challenge.to_ascii_lowercase();
            if c.starts_with("5120") && c.len() == 68 && c[4..] != s.to_ascii_lowercase() {
                return bad("signer is not the key the challenge names".into());
            }
        }
        if let Some(rules) = &self.rules {
            if let Some(r) = rules.iter().find(|r| !r.is_empty()) {
                return bad(format!("chain {} names rule \"{r}\", which this validator does not have (sidestr-core 0.1 carries the core rules only)", self.id));
            }
        }
        if self.signers.is_some() || self.threshold.is_some() {
            return bad(format!("chain {} is a level 2 chain (signers/threshold); sidestr-core 0.1 validates level 1, one signer", self.id));
        }
        Ok(())
    }

    /// The parent's table row.
    pub fn parent(&self) -> Result<&'static Parent> {
        resolve_parent(&self.parent)
    }

    /// The header family the chain inherits.
    pub fn family(&self) -> Result<Family> {
        Ok(self.parent()?.family)
    }

    /// The challenge as a script.
    pub fn challenge_script(&self) -> Result<ScriptBuf> {
        Ok(ScriptBuf::from_bytes(
            hex::decode(&self.challenge).map_err(|e| Error::Encoding(e.to_string()))?,
        ))
    }

    /// `powLimit` as a 256-bit target.
    pub fn pow_limit_target(&self) -> Result<Target> {
        let bytes: [u8; 32] = hex::decode(&self.pow_limit)
            .map_err(|e| Error::Encoding(e.to_string()))?
            .try_into()
            .map_err(|_| Error::Document("powLimit must be 32 bytes".into()))?;
        Ok(Target::from_be_bytes(bytes))
    }

    /// The compact `bits` every block carries: `powLimit` encoded as Bitcoin
    /// Core's `GetCompact` does (`siding/lib/chain.mjs` sets it once per chain).
    pub fn bits(&self) -> Result<CompactTarget> {
        Ok(self.pow_limit_target()?.to_compact_lossy())
    }

    /// The magic the name derives to, whether or not the document carries it.
    pub fn derived_magic(&self) -> String {
        magic_for(&self.name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRIAL: &str = include_str!("../fixtures/trial/chain.json");
    const DREAMLAB: &str = include_str!("../fixtures/dreamlab/chain.json");

    #[test]
    fn fixtures_parse_and_round_trip() {
        for (text, name, magic) in [
            (TRIAL, "trial", "a8f6706f"),
            (DREAMLAB, "dreamlab", "d981eab1"),
        ] {
            let doc = ChainDocument::from_json(text).unwrap();
            assert_eq!(doc.name, name);
            assert_eq!(doc.magic.as_deref(), Some(magic));
            assert_eq!(doc.derived_magic(), magic);
            assert_eq!(doc.bits().unwrap().to_consensus(), 0x207f_ffff);
            let again: serde_json::Value = serde_json::from_str(&doc.to_json().unwrap()).unwrap();
            assert_eq!(
                again,
                serde_json::from_str::<serde_json::Value>(text).unwrap()
            );
        }
        let d = ChainDocument::from_json(DREAMLAB).unwrap();
        assert_eq!(d.extra["containment"]["parent"], "tbtc4");
    }

    #[test]
    fn refusals() {
        let base: serde_json::Value = serde_json::from_str(TRIAL).unwrap();
        let with = |f: &dyn Fn(&mut serde_json::Value)| {
            let mut v = base.clone();
            f(&mut v);
            ChainDocument::from_json(&v.to_string())
        };
        // siding/test/rules-test.mjs: a document naming a rule this validator lacks is refused
        let e = with(&|v| v["rules"] = serde_json::json!(["assets", "oracle"]))
            .unwrap_err()
            .to_string();
        assert!(e.contains("does not have"), "{e}");
        assert!(matches!(
            with(&|v| v["parent"] = "txbt4".into()),
            Err(Error::UnsupportedFamily(Family::Blake2b))
        ));
        assert!(matches!(
            with(&|v| v["parent"] = "doge".into()),
            Err(Error::UnknownParent(_))
        ));
        assert!(with(&|v| v["signers"] = serde_json::json!(["aa"])).is_err());
        assert!(with(&|v| v["signer"] = serde_json::json!("00".repeat(32))).is_err());
        assert!(with(&|v| v["powLimit"] = serde_json::json!("ff")).is_err());
        assert!(with(&|v| v["addressPrefix"] = serde_json::json!("TRL")).is_err());
        assert!(with(&|v| v["genesisHash"] = serde_json::json!("zz")).is_err());
    }
}
