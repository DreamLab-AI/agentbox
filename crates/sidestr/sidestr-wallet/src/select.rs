//! Coin selection, as the reference does it (`siding/lib/spend.mjs
//! buildSpend`): largest first, until the picked coins cover the amount plus
//! a fee bound.
//!
//! The strategy is deliberately simple. A sidestr wallet's coins are a few
//! faucet payments and change; there is no privacy goal a cleverer selection
//! would serve, and a level-1 chain has no fee market. The bound is the fee
//! when the caller fixed one, else the chain's `minFeeRate` times 200 vB, a
//! generous guess at a one-in-two-out key-path spend (about 111 vB) that
//! leaves room for a second input. The exact fee is computed from the
//! sized transaction afterwards ([`crate::spend`]); if the picked coins
//! then fall short by the difference, the builder reports
//! [`Error::InsufficientForFee`] rather than picking again, as the reference
//! does.
//!
//! ```
//! use bitcoin::OutPoint;
//! use sidestr_wallet::coins::Coin;
//! use sidestr_wallet::select::{fee_bound, select};
//!
//! let coin = |v: u64, n: u32| Coin { outpoint: OutPoint { txid: bitcoin::Txid::from_raw_hash(bitcoin::hashes::Hash::all_zeros()), vout: n }, value: v, height: 0, coinbase: false };
//! let coins = [coin(1_000, 0), coin(50_000, 1), coin(20_000, 2)];
//! let s = select(&coins, 60_000, fee_bound(1)).unwrap();
//! assert_eq!(s.picked.iter().map(|c| c.value).collect::<Vec<_>>(), vec![50_000, 20_000]);
//! assert_eq!(s.sum, 70_000);
//! assert!(select(&coins, 71_000, fee_bound(1)).is_err());
//! ```

use crate::coins::Coin;
use crate::error::{Error, Result};

/// The fee bound selection covers before the transaction is sized:
/// `minFeeRate × 200` (`spend.mjs`: `Math.ceil(rate * 200)`).
pub fn fee_bound(min_fee_rate: u64) -> u64 {
    min_fee_rate.saturating_mul(200)
}

/// What selection picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Selection {
    /// The coins, largest first.
    pub picked: Vec<Coin>,
    /// Their values summed.
    pub sum: u64,
}

/// Largest first until `sum >= amount + bound`; [`Error::Insufficient`] when
/// every coin together does not reach it. Coins of equal value keep the
/// order given (a stable sort, as JavaScript's), so the pick from a
/// producer's list and from a state fold can differ in *which* equal coins
/// it takes; both are valid.
pub fn select(coins: &[Coin], amount: u64, bound: u64) -> Result<Selection> {
    let need = amount.saturating_add(bound);
    let mut sorted: Vec<Coin> = coins.to_vec();
    sorted.sort_by_key(|c| core::cmp::Reverse(c.value));
    let mut picked = Vec::new();
    let mut sum = 0u64;
    for c in sorted {
        sum = sum.saturating_add(c.value);
        picked.push(c);
        if sum >= need {
            return Ok(Selection { picked, sum });
        }
    }
    Err(Error::Insufficient { have: sum, need })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::hashes::Hash;
    use bitcoin::{OutPoint, Txid};

    fn coin(v: u64, n: u32) -> Coin {
        Coin {
            outpoint: OutPoint {
                txid: Txid::from_raw_hash(Hash::all_zeros()),
                vout: n,
            },
            value: v,
            height: 0,
            coinbase: false,
        }
    }

    #[test]
    fn largest_first_and_stable() {
        let coins = [coin(5, 0), coin(5, 1), coin(9, 2)];
        let s = select(&coins, 10, 0).unwrap();
        assert_eq!(
            s.picked.iter().map(|c| c.outpoint.vout).collect::<Vec<_>>(),
            vec![2, 0]
        );
        assert_eq!(
            select(&[], 1, 0).unwrap_err().to_string(),
            "insufficient: 0 sats mature, 1 needed"
        );
        assert_eq!(fee_bound(3), 600);
    }
}
