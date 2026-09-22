//! The one error type every fallible function in this crate returns.
//!
//! siding throws `Error` objects whose *messages* are the contract its tests
//! match against (`/already claimed/`, `/below the minimum/`, `/not a hex
//! script/`). The messages here keep that wording where a test in `tests/`
//! depends on it, so a port of a siding test reads the same way.

use crate::parents::Family;

/// Everything that can go wrong, from a document that names a parent this
/// validator does not carry to a block the rules refuse.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The document names a parent alias that is not in the SPEC 3.2 table.
    #[error("unknown parent \"{0}\": one of btc, tbtc4, xbt, txbt4, ltc, vtc (SPEC 3.2)")]
    UnknownParent(String),
    /// The alias is in the table but reserved: no validator carries its rules.
    #[error(
        "parent \"{alias}\" ({label}) is reserved: no validator carries its rules yet (SPEC 3.2)"
    )]
    ReservedParent {
        /// The short alias, `ltc` or `vtc`.
        alias: &'static str,
        /// The human label from the table.
        label: &'static str,
    },
    /// The document's parent hands down a header family other than the one
    /// this state or chain is instantiated for (SPEC 3): a `State` over
    /// `Stock` refuses a `txbt4` document, a `StateOf<Blake2bV2>` a `tbtc4` one.
    #[error("the document's parent hands down the {0:?} header family, not the one this validator is instantiated for (SPEC 3.2: stock for btc/tbtc4, BLAKE2b for xbt/txbt4)")]
    UnsupportedFamily(Family),
    /// The chain document is malformed or names something this validator lacks.
    #[error("chain document: {0}")]
    Document(String),
    /// JSON that does not parse or does not fit the document shape.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// Bytes that do not decode as a block, transaction or hex.
    #[error("encoding: {0}")]
    Encoding(String),
    /// A coinbase whose scriptSig does not start with a BIP 34 height push.
    #[error("{0}")]
    CoinbaseHeight(String),
    /// A block the rules refused; `rules` lists the failed rule ids in order.
    #[error("block {height} failed: {}", rules.join(", "))]
    Rejected {
        /// The height the block claimed.
        height: u32,
        /// The rule ids whose check returned `false`.
        rules: Vec<String>,
    },
    /// A block that does not follow the tip, or whose hash is not the expected one.
    #[error("{0}")]
    Chain(String),
    /// The block file's block 0 does not hash to the document's `genesisHash`.
    #[error("genesis {found} is not the document's {expected}")]
    GenesisMismatch {
        /// The hash of block 0 as read.
        found: String,
        /// The document's `genesisHash`.
        expected: String,
    },
    /// A transaction the producer's mempool policy or the rules refused.
    #[error("{0}")]
    Transaction(String),
    /// Building or signing a block failed (no commitment output, a solution
    /// too long for one push, a key that is not the challenge's).
    #[error("{0}")]
    Block(String),
    /// A federation that cannot be built or used: signers out of range, a
    /// duplicate signer, too few signatures, a key that is not a signer, or
    /// `produce()` on a chain whose blocks come from a round.
    #[error("federation: {0}")]
    Federation(String),
    /// The parent view: a node that cannot be reached or answers badly, a
    /// cookie the node refuses, a script with no parent address, a
    /// checkpoint over the data limit.
    #[error("parent: {0}")]
    Parent(String),
    /// A secp256k1 failure: a bad key, a message that is not 32 bytes.
    #[error("secp256k1: {0}")]
    Secp(#[from] bitcoin::secp256k1::Error),
    /// Filesystem trouble reading or writing the block file (feature `std`).
    #[cfg(feature = "std")]
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// The block file and its index disagree (feature `std`): an index entry
    /// that runs past the end of `blocks.dat`, or a record whose
    /// `[u32 height][u32 size]` prefix is not what the index entry says.
    #[cfg(feature = "std")]
    #[error("block file: {0}")]
    BlockFile(String),
}

/// `Result` with this crate's [`Error`].
pub type Result<T> = core::result::Result<T, Error>;
