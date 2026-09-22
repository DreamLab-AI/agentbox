//! The policy hook: the wallet builds and signs, it does not decide.
//!
//! ADR-2100 says every settlement passes an authority gate; ADR-2101 says a
//! spend key is a role key behind a port. This crate keeps to its half of
//! that bargain: every builder asks a [`SpendPolicy`] before it signs, and
//! ships one implementation, [`Permissive`], which says yes. The gate itself
//! (limits per session, per chain, per counterparty; a supervisor's veto) is
//! the caller's to plug in. Nothing else in the crate reads an [`Intent`].
//!
//! ```
//! use sidestr_wallet::policy::{Intent, IntentKind, SpendPolicy};
//!
//! /// A cap: no single payment over 1 BTC-equivalent of sats.
//! struct Cap(u64);
//! impl SpendPolicy for Cap {
//!     fn permit(&self, intent: &Intent<'_>) -> Result<(), String> {
//!         if intent.amount > self.0 { Err(format!("{} sats is over the cap of {}", intent.amount, self.0)) } else { Ok(()) }
//!     }
//! }
//! let cap = Cap(100_000_000);
//! let script = bitcoin::ScriptBuf::new();
//! let small = Intent { chain_id: "sidestr:example", kind: IntentKind::Spend, script: &script, amount: 1, fee: 1, inputs: 1 };
//! assert!(cap.permit(&small).is_ok());
//! assert!(cap.permit(&Intent { amount: 200_000_000, ..small }).is_err());
//! ```

use bitcoin::Script;

/// What kind of settlement a builder is about to sign.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentKind {
    /// A payment to a script on this chain (`spend`).
    Spend,
    /// A peg-out burn: value leaves the chain, owed on the parent (`burn`, SPEC 7).
    Burn,
}

/// Everything a policy may weigh, decided before any signature exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Intent<'a> {
    /// The chain document's `id`.
    pub chain_id: &'a str,
    /// Spend or burn.
    pub kind: IntentKind,
    /// The output script paid: the destination for a spend, the parent
    /// output script named for a burn.
    pub script: &'a Script,
    /// Sats paid or burned, before the fee.
    pub amount: u64,
    /// The fee the transaction will carry.
    pub fee: u64,
    /// How many coins it spends.
    pub inputs: usize,
}

/// The gate a builder consults before signing. Return `Err(reason)` to
/// refuse; the builder surfaces it as [`Error::Policy`](crate::Error::Policy)
/// and signs nothing.
pub trait SpendPolicy {
    /// Permit or refuse an intent.
    fn permit(&self, intent: &Intent<'_>) -> core::result::Result<(), String>;
}

/// The default: every intent is permitted. The right choice for a test, a
/// faucet on a chain whose coins carry no value, or a caller that has
/// already passed the authority gate upstream; the wrong one for a wallet
/// holding value, which is why it has to be named to be used.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Permissive;

impl SpendPolicy for Permissive {
    fn permit(&self, _intent: &Intent<'_>) -> core::result::Result<(), String> {
        Ok(())
    }
}
