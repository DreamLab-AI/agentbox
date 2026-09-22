//! The coin set for a script (SPEC 11): what a producer's `/coins/<script
//! hex>` returns, or the same list folded from a `sidestr-core` state, and
//! the maturity filter both wallets apply before choosing.
//!
//! siding lists coins as `{outpoint: "txid:vout", value, height, coinbase}`
//! (`siding/lib/chain.mjs coins`); `spend.mjs` fetches that list and drops
//! immature coinbases against `/tip`. [`Coin`] is that record with serde
//! matching the JSON, so a wallet can take the producer's word for its
//! balance or, holding the block file, compute it with
//! [`sidestr_core::State`] and get the same list.
//!
//! ```
//! use sidestr_wallet::coins::{balance, from_json, mature, Coin};
//!
//! let listed = from_json(r#"[
//!   {"outpoint":"0000000000000000000000000000000000000000000000000000000000000001:0","value":50000,"height":0,"coinbase":true},
//!   {"outpoint":"0000000000000000000000000000000000000000000000000000000000000002:1","value":700,"height":90,"coinbase":false}
//! ]"#).unwrap();
//! assert_eq!(balance(&listed), 50_700);
//! // at tip 99 the genesis coinbase is one block short of maturity; at 100 it spends
//! assert_eq!(mature(&listed, 98).len(), 1);
//! assert_eq!(mature(&listed, 99).len(), 2);
//! assert_eq!(serde_json::to_string(&listed[1]).unwrap(), r#"{"outpoint":"0000000000000000000000000000000000000000000000000000000000000002:1","value":700,"height":90,"coinbase":false}"#);
//! ```

use bitcoin::{OutPoint, Script};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sidestr_core::rules::Params;
use sidestr_core::state::{CoinRef, State};

use crate::error::Result;

/// A coinbase output may be spent this many blocks later: 100, the
/// parameter every sidestr chain inherits ([`Params::coinbase_maturity`]).
pub fn coinbase_maturity() -> u32 {
    Params::default().coinbase_maturity
}

/// One unspent output paying a script, as the producer lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Coin {
    /// `txid:vout`, the txid in display order (`siding/lib/overlay.mjs outpointOf`).
    #[serde(serialize_with = "ser_outpoint", deserialize_with = "de_outpoint")]
    pub outpoint: OutPoint,
    /// Sats.
    pub value: u64,
    /// Height of the block that created it.
    pub height: u32,
    /// Whether it is a coinbase output (maturity applies).
    pub coinbase: bool,
}

fn ser_outpoint<S: Serializer>(op: &OutPoint, s: S) -> core::result::Result<S::Ok, S::Error> {
    s.serialize_str(&op.to_string())
}

fn de_outpoint<'de, D: Deserializer<'de>>(d: D) -> core::result::Result<OutPoint, D::Error> {
    let text = String::deserialize(d)?;
    text.parse().map_err(serde::de::Error::custom)
}

impl From<CoinRef> for Coin {
    fn from(c: CoinRef) -> Self {
        Self {
            outpoint: c.outpoint,
            value: c.value,
            height: c.height,
            coinbase: c.coinbase,
        }
    }
}

impl Coin {
    /// Whether the coin may be spent in the block after `tip_height`: not a
    /// coinbase, or one at least [`coinbase_maturity`] blocks deep
    /// (`spend.mjs`: `!c.coinbase || tip.height + 1 - c.height >= coinbaseMaturity`).
    pub fn is_mature(&self, tip_height: u32) -> bool {
        !self.coinbase || (tip_height + 1).saturating_sub(self.height) >= coinbase_maturity()
    }
}

/// The producer's `/coins/<script hex>` body.
pub fn from_json(text: &str) -> Result<Vec<Coin>> {
    Ok(serde_json::from_str(text)?)
}

/// The same list from a chain held in memory ([`State::coins`]), sorted by
/// height then outpoint as the state lists them.
pub fn from_state(state: &State, script: &Script) -> Vec<Coin> {
    state.coins(script).into_iter().map(Coin::from).collect()
}

/// The coins spendable in the next block, in the order given.
pub fn mature(coins: &[Coin], tip_height: u32) -> Vec<Coin> {
    coins
        .iter()
        .filter(|c| c.is_mature(tip_height))
        .cloned()
        .collect()
}

/// The sum of the coins' values.
pub fn balance(coins: &[Coin]) -> u64 {
    coins.iter().map(|c| c.value).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_shape_is_the_producers() {
        let bad = from_json(r#"[{"outpoint":"nothex:0","value":1,"height":0,"coinbase":false}]"#);
        assert!(bad.is_err());
        let c = from_json(&format!(
            r#"[{{"outpoint":"{}:7","value":1,"height":0,"coinbase":false}}]"#,
            "ab".repeat(32)
        ))
        .unwrap();
        assert_eq!(c[0].outpoint.vout, 7);
        assert_eq!(c[0].outpoint.txid.to_string(), "ab".repeat(32));
        assert!(c[0].is_mature(0));
        assert_eq!(coinbase_maturity(), 100);
    }
}
