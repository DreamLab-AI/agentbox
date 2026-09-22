//! The crate's error type: every refusal names what was checked.

/// What can go wrong in the round, outside the log lines the state machines
/// emit as [`crate::round::Action::Log`] (those are the protocol's own
/// refusals, and are not errors).
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A consensus-level failure from `sidestr-core` (a block the rules
    /// refuse, a transaction the mempool refuses, an encoding).
    #[error("{0}")]
    Core(#[from] sidestr_core::Error),
    /// An event-level failure from `sidestr-nostr` (a signature, a tag, a
    /// malformed envelope).
    #[error("{0}")]
    Nostr(#[from] sidestr_nostr::Error),
    /// The vote journal could not be read or written. A signer that cannot
    /// journal does not sign.
    #[error("journal: {0}")]
    Journal(String),
    /// The operating system.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// The document, the key or the signer set.
    #[error("federation: {0}")]
    Federation(String),
    /// A peg-out PSBT could not be built, combined or finalised.
    #[error("peg-out: {0}")]
    Pegout(String),
    /// A key that is malformed or is not one of the signers.
    #[error("key: {0}")]
    Key(String),
}

/// `Result` with this crate's [`Error`].
pub type Result<T> = core::result::Result<T, Error>;
