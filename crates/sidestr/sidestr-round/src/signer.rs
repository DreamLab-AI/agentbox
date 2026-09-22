//! The port a signer's key sits behind, and the in-memory key for a key
//! file.
//!
//! siding uses one 32-byte hex key as Nostr identity, block-sealing key and
//! taproot spending key (`proposals/level-2.md`: "signer keys are Nostr
//! keys"). This crate keeps that convention on the wire — the event's author
//! is the signer, and the same x-only key sits in the `multi_a` leaf — but
//! never hands the key around. Event signing goes through
//! `sidestr-nostr`'s sealed [`Signer`] port; block partial signatures and
//! peg-out input signatures go through [`BlockSigner`], whose requests
//! ([`PartialRequest`], [`PegoutSignRequest`]) have no public constructor,
//! so a signer is only ever asked to sign a named thing it can inspect
//! (ADR-2101: "a generic 'sign this payload' port is a bypass").
//!
//! [`LocalKey`] implements both for a key file's text, signing with zero
//! BIP-340 auxiliary randomness so a signature is a pure function of its
//! inputs and the key (as `sidestr-core` seals blocks and `sidestr-nostr`
//! signs events). siding's `schnorr.mjs` draws random aux; both are valid.

use bitcoin::secp256k1::{schnorr::Signature, Keypair, Message, SecretKey, XOnlyPublicKey};
use bitcoin::Txid;
use sidestr_core::block::secp;
use sidestr_nostr::event::{SignRequest, Signer};

use crate::error::{Error, Result};

/// A request to partially sign a block template for the federation's leaf
/// (`federation.mjs partialSignature`). Built only by [`crate::round::Round`].
#[derive(Debug, Clone, Copy)]
pub struct PartialRequest<'a> {
    chain_id: &'a str,
    height: u32,
    template_id: [u8; 32],
    digest: [u8; 32],
}

impl<'a> PartialRequest<'a> {
    pub(crate) fn new(
        chain_id: &'a str,
        height: u32,
        template_id: [u8; 32],
        digest: [u8; 32],
    ) -> Self {
        Self {
            chain_id,
            height,
            template_id,
            digest,
        }
    }
    /// The chain the template is for.
    pub fn chain_id(&self) -> &str {
        self.chain_id
    }
    /// The template's height.
    pub fn height(&self) -> u32 {
        self.height
    }
    /// The template's identity ([`sidestr_core::block::template_id`]): what
    /// is being authorised, unchanged by sealing.
    pub fn template_id(&self) -> &[u8; 32] {
        &self.template_id
    }
    /// The tapscript sighash the signature is over.
    pub fn digest(&self) -> &[u8; 32] {
        &self.digest
    }
}

/// A request to sign one input of a peg-out PSBT for the federation's leaf
/// (`pegoutround.mjs onProposal`, the wallet's `walletprocesspsbt`). Built
/// only by [`crate::pegout`].
#[derive(Debug, Clone, Copy)]
pub struct PegoutSignRequest<'a> {
    chain_id: &'a str,
    burn: &'a str,
    unsigned_txid: Txid,
    input: usize,
    digest: [u8; 32],
}

impl<'a> PegoutSignRequest<'a> {
    pub(crate) fn new(
        chain_id: &'a str,
        burn: &'a str,
        unsigned_txid: Txid,
        input: usize,
        digest: [u8; 32],
    ) -> Self {
        Self {
            chain_id,
            burn,
            unsigned_txid,
            input,
            digest,
        }
    }
    /// The chain the burn is on.
    pub fn chain_id(&self) -> &str {
        self.chain_id
    }
    /// The burn being paid, `<txid>:<vout>`.
    pub fn burn(&self) -> &str {
        self.burn
    }
    /// The txid of the unsigned parent transaction.
    pub fn unsigned_txid(&self) -> Txid {
        self.unsigned_txid
    }
    /// Which input.
    pub fn input(&self) -> usize {
        self.input
    }
    /// The tapscript sighash the signature is over.
    pub fn digest(&self) -> &[u8; 32] {
        &self.digest
    }
}

/// The block-and-peg custody key behind a port: two named operations, no
/// generic digest signing.
pub trait BlockSigner {
    /// The x-only key that sits in the federation's leaf.
    fn pubkey(&self) -> XOnlyPublicKey;
    /// A BIP-340 signature over a block template's tapscript sighash.
    fn sign_partial(&self, request: &PartialRequest<'_>) -> Result<Signature>;
    /// A BIP-340 signature over one peg-out input's tapscript sighash.
    fn sign_pegout_input(&self, request: &PegoutSignRequest<'_>) -> Result<Signature>;
}

/// What the round needs of a signer: Nostr events and block signatures from
/// one key, as upstream. Implemented for anything that is both.
pub trait RoundSigner: Signer + BlockSigner {}
impl<T: Signer + BlockSigner + ?Sized> RoundSigner for T {}

/// A secp256k1 key held in memory, from a key file's text (32-byte hex,
/// `sign.mjs loadKey`). Nothing here prints or displays the key.
pub struct LocalKey {
    keypair: Keypair,
}

impl core::fmt::Debug for LocalKey {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("LocalKey")
            .field("pubkey", &self.pubkey())
            .finish_non_exhaustive()
    }
}

impl LocalKey {
    /// From a secret key.
    pub fn new(key: SecretKey) -> Self {
        Self {
            keypair: Keypair::from_secret_key(secp(), &key),
        }
    }
    /// From 32 bytes.
    pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self> {
        Ok(Self::new(
            SecretKey::from_slice(bytes).map_err(|e| Error::Key(e.to_string()))?,
        ))
    }
    /// From a key file's text: 64 hex characters, surrounding whitespace
    /// ignored (`sign.mjs loadKey`).
    pub fn from_hex(text: &str) -> Result<Self> {
        Ok(Self::new(sidestr_core::block::key_from_hex(text)?))
    }
    /// The x-only public key as 64 lowercase hex characters.
    pub fn pubkey_hex(&self) -> String {
        hex::encode(self.pubkey().serialize())
    }
    fn sign_digest(&self, digest: &[u8; 32]) -> Signature {
        secp().sign_schnorr_with_aux_rand(&Message::from_digest(*digest), &self.keypair, &[0u8; 32])
    }
}

impl Signer for LocalKey {
    fn pubkey_hex(&self) -> sidestr_nostr::Result<String> {
        Ok(LocalKey::pubkey_hex(self))
    }
    fn sign(&self, request: &SignRequest<'_>) -> sidestr_nostr::Result<[u8; 64]> {
        Ok(*self.sign_digest(request.id()).as_ref())
    }
}

impl BlockSigner for LocalKey {
    fn pubkey(&self) -> XOnlyPublicKey {
        self.keypair.x_only_public_key().0
    }
    fn sign_partial(&self, request: &PartialRequest<'_>) -> Result<Signature> {
        Ok(self.sign_digest(request.digest()))
    }
    fn sign_pegout_input(&self, request: &PegoutSignRequest<'_>) -> Result<Signature> {
        Ok(self.sign_digest(request.digest()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_key_is_deterministic_and_never_displays_itself() {
        let k = LocalKey::from_hex(&format!(" {} \n", "07".repeat(32))).unwrap();
        assert_eq!(k.pubkey_hex().len(), 64);
        assert!(!format!("{k:?}").contains(&"07".repeat(32)));
        let r = PartialRequest::new("sidestr:t", 1, [1u8; 32], [2u8; 32]);
        assert_eq!(k.sign_partial(&r).unwrap(), k.sign_partial(&r).unwrap());
        assert!(LocalKey::from_hex("zz").is_err());
        assert!(LocalKey::from_bytes(&[0u8; 32]).is_err());
    }
}
