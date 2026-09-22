//! The one error type every fallible function in this crate returns.
//!
//! siding's `spend.mjs` throws `Error` objects whose *messages* are the
//! contract its callers and tests read (`insufficient: … sats mature, …
//! needed`, `a peg-out burns at least … sats`, `bad address …`). The
//! variants here keep that wording, so a message from this crate reads like
//! one from the reference, while a caller can match on the variant.

/// Everything that can go wrong between "I want to pay" and a transaction
/// the producer accepts.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The amount is zero (`spend.mjs`: "the amount is a whole number of sats").
    #[error("the amount is a whole number of sats")]
    BadAmount,
    /// The destination is neither a script hex nor a segwit address under
    /// any prefix (`spend.mjs resolveTo`: "bad address …").
    #[error("bad address {0}")]
    BadDestination(String),
    /// The mature coins do not cover the amount plus the fee bound
    /// (`spend.mjs`: "insufficient: … sats mature, … needed").
    #[error("insufficient: {have} sats mature, {need} needed")]
    Insufficient {
        /// Sats the picked coins sum to.
        have: u64,
        /// Amount plus the fee bound.
        need: u64,
    },
    /// The coins covered the bound but not the fee the size came to
    /// (`spend.mjs`: "insufficient coins for … plus the …-sat minimum fee").
    #[error("insufficient coins for {amount} plus the {fee}-sat minimum fee")]
    InsufficientForFee {
        /// The amount wanted.
        amount: u64,
        /// The fee the sized transaction needs.
        fee: u64,
    },
    /// A burn below the document's `pegoutMin` (SPEC 7; `spend.mjs`: "a
    /// peg-out burns at least … sats").
    #[error("a peg-out burns at least {min} sats, not {value}")]
    BelowPegoutMin {
        /// The value asked for.
        value: u64,
        /// The document's `pegoutMin`.
        min: u64,
    },
    /// An explicit fee under the producer's `minFeeRate` policy, in the
    /// words `State::submit` would refuse it with.
    #[error("fee {fee} is below the minimum {min} sats ({vsize} vB at {rate} sat/vB)")]
    FeeBelowMinimum {
        /// The fee given.
        fee: u64,
        /// The least the producer accepts for this size.
        min: u64,
        /// The transaction's virtual size.
        vsize: u64,
        /// The document's `minFeeRate`.
        rate: u64,
    },
    /// An output below Bitcoin's dust threshold for its script: the chain
    /// would accept it and no wallet could economically spend it. The
    /// reference does not check; this crate does (see the crate docs).
    #[error("{value} sats to {script} is dust: at least {min} sats")]
    Dust {
        /// The value asked for.
        value: u64,
        /// The dust threshold for that script.
        min: u64,
        /// The script, hex.
        script: String,
    },
    /// A parent address for the wrong network: a peg-in to a `bc1…`
    /// address beside `tbtc4`, or the reverse (SPEC 6, 3.2).
    #[error("{address} is not a {network} address: the parent is {parent}")]
    WrongNetwork {
        /// The address given.
        address: String,
        /// The network the parent alias resolves to.
        network: String,
        /// The parent alias from the document.
        parent: String,
    },
    /// A parent-side marker (peg-in, peg-out record) longer than the
    /// parent's 80-byte `OP_RETURN` relay policy allows, or any marker push
    /// over the 255 bytes the shared grammar reads back (a 61-byte peg-in
    /// marker for a 15-byte chain id fits).
    #[error(
        "marker of {0} bytes exceeds the parent's 80-byte data limit; the chain id is too long"
    )]
    MarkerTooLong(usize),
    /// The [`SpendPolicy`](crate::policy::SpendPolicy) refused the intent.
    #[error("policy refused: {0}")]
    Policy(String),
    /// The [`SpendSigner`](crate::key::SpendSigner) could not sign.
    #[error("signer: {0}")]
    Signer(String),
    /// A producer answered `{"error": …}` to a `POST /tx`.
    #[error("producer refused: {0}")]
    Refused(String),
    /// JSON that does not parse or does not fit the shape.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// Hex or bytes that do not decode.
    #[error("encoding: {0}")]
    Encoding(String),
    /// An error from `sidestr-core`: a document naming an unknown parent, a
    /// marker that cannot be built.
    #[error(transparent)]
    Core(#[from] sidestr_core::Error),
    /// A secp256k1 failure: a derived scalar out of range, a bad key.
    #[error("secp256k1: {0}")]
    Secp(#[from] bitcoin::secp256k1::Error),
    /// An HTTP failure talking to a producer (feature `client`).
    #[cfg(feature = "client")]
    #[error("http: {0}")]
    Http(String),
}

/// `Result` with this crate's [`Error`].
pub type Result<T> = core::result::Result<T, Error>;
