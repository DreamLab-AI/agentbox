//! The chain as the round sees it: a port over `sidestr-core`'s in-memory
//! [`StateOf`] and its file-backed [`ChainOf`], so the state machine can
//! read the tip, re-validate a proposal's transactions through the mempool
//! (`round.mjs onProposal`: "every transaction must be one my mempool
//! accepts") and ingest a sealed block through the validator
//! (`s.addSealed`), without knowing whether anything is written to disk.

use bitcoin::Transaction;
use sidestr_core::block::{HeaderFamily, SidestrBlock};
use sidestr_core::chain::ChainOf;
use sidestr_core::state::{Applied, StateOf, Submitted};

/// What the round needs of a chain.
pub trait ChainView<F: HeaderFamily> {
    /// The chain in memory, to read.
    fn state(&self) -> &StateOf<F>;
    /// The mempool's verdict on a transaction (`siding/lib/chain.mjs submit`).
    fn submit(&mut self, tx: Transaction) -> sidestr_core::Result<Submitted>;
    /// A candidate block, validated and applied (`s.addSealed`). `now` is
    /// the round's clock, unix seconds, for the future-time rule; a
    /// file-backed chain may use its own.
    fn add_block(&mut self, block: &F::Block, now: u64) -> sidestr_core::Result<Applied>;
}

impl<F: HeaderFamily> ChainView<F> for StateOf<F> {
    fn state(&self) -> &StateOf<F> {
        self
    }
    fn submit(&mut self, tx: Transaction) -> sidestr_core::Result<Submitted> {
        StateOf::submit(self, tx)
    }
    fn add_block(&mut self, block: &F::Block, now: u64) -> sidestr_core::Result<Applied> {
        StateOf::add_block(
            self,
            block,
            None,
            Some(u32::try_from(now).unwrap_or(u32::MAX)),
        )
    }
}

impl<F: HeaderFamily> ChainView<F> for ChainOf<F> {
    fn state(&self) -> &StateOf<F> {
        ChainOf::state(self)
    }
    fn submit(&mut self, tx: Transaction) -> sidestr_core::Result<Submitted> {
        ChainOf::submit(self, &bitcoin::consensus::encode::serialize(&tx))
    }
    /// Validated, applied and written to the block file; the chain's own
    /// clock judges the future-time rule.
    fn add_block(&mut self, block: &F::Block, _now: u64) -> sidestr_core::Result<Applied> {
        ChainOf::add_block(self, &block.encode(), None)
    }
}
