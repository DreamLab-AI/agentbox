//! Level 2's round (`proposals/level-2.md`; `siding/lib/round.mjs`), as a
//! pure state machine.
//!
//! In Melvin Carvalho's words, adapted: the proposer for a height builds
//! the block and publishes it as a kind 23510 event; each other signer
//! checks it against its own chain and mempool and answers with a kind
//! 23511 partial signature; with `k` the proposer seals the block, adds it,
//! publishes it as a kind 23514 event for the others and announces it.
//! Signer keys are Nostr keys, so an event's author is the signer. One
//! signature per height per signer — unless that proposal has had
//! `proposeAfter` seconds to seal and has not: then a later, entitled
//! proposer may have mine too, or a stalled height (its proposer gone after
//! collecting fewer than `k`) would never move. And a proposer drops its
//! own proposal after `proposeAfter × n` seconds.
//!
//! # No I/O, no clock
//!
//! [`Round::tick`] and [`Round::on_event`] take the time as an argument
//! (unix **milliseconds**, as `Date.now()` is) and return a list of [`Action`]s — events to publish,
//! blocks that entered the chain, lines to log — for the caller to act on.
//! The chain is a port ([`ChainView`]): the in-memory state in a test, the
//! file-backed chain in a signer. Nothing here opens a socket or reads a
//! clock, so every branch of the protocol is testable with a fixed `now`.
//!
//! # Timing, to the millisecond
//!
//! `round.mjs` measures in `Date.now()` milliseconds and the same
//! comparisons hold here, with `propose_after` = `P` seconds and `n`
//! signers:
//!
//! | rule | reference | here |
//! |---|---|---|
//! | one signature per height relaxes (`mayReSign`) | `now − signed.at > P·1000` | strictly more than `P` s after the signature's intent: at 30 001 ms for `P = 30`, not at 30 000 |
//! | my proposal is dropped | `now − pending.at > P·1000·n` | at 90 001 ms for `P = 30, n = 3` |
//! | a replayed proposal is ignored | `now/1000 − created_at > P·n` | `now − created_at·1000 > P·n·1000`: the same instant, 90 001 ms after the event's second |
//! | lateness (`entitled`) | `⌊(at − base) / 1000 / P⌋` | `(at − base) / (P·1000)`, integer; `base` = when the block became due, else the event's `created_at·1000` |
//! | the "signed … s ago" log | `Math.round(ms / 1000)` | rounded, the same |
//!
//! Events carry `created_at` in whole seconds (`now / 1000`), as NIP-01
//! requires; nothing on the wire changes.
//!
//! # Hardening, all behind options with upstream's behaviour as default
//!
//! - **The vote journal** ([`VoteJournal`]): the intent is journalled,
//!   durably, before the custody signer is asked, and the signature after
//!   it answers, before the `Publish` action is returned; a failed intent
//!   write means the signer is not called, a failed signature write means
//!   nothing is published. On restart the journal is loaded and the
//!   one-signature rule is applied against every entry.
//! - **`resign_after`** ([`RoundConfig::resign_after`]): upstream's
//!   relaxation (`Some(propose_after)`) by default, for interop; `None`
//!   never re-signs a height (ADR-2101). With `None`, a height whose
//!   proposal stranded stays stranded until the proposer returns — that is
//!   the trade the record chose, and it is the operator's to make.
//! - **A sealed block is a candidate**, ingested through the validator
//!   ([`ChainView::add_block`]) and never treated as final (review §9):
//!   nothing here decides finality, and a caller must not either.
//! - **Deterministic rules first, mempool policy second**: a proposal is
//!   judged under the chain's own rules (`StateOf::judge`, minus the two
//!   that cannot hold for an unsealed template: the block signature and the
//!   proof of work that sealing grinds) before any transaction reaches the
//!   mempool. Refusals are logged as `round.mjs` logs them; the one new
//!   refusal names the rules.
//!
//! # Honest limits
//!
//! This is upstream's protocol: it tolerates `n − k` signers being *down*
//! and nothing being *wrong*. A faulty proposer can strand a height; a
//! relay can delay a proposal past its window; two subsets of `k` can seal
//! one template to two hashes (`sidestr-core`'s template-versus-sealed
//! note). Byzantine tolerance is a separate protocol above the signature
//! (ADR-2101), not a setting here.

use std::collections::BTreeMap;

use bitcoin::secp256k1::{schnorr::Signature, XOnlyPublicKey};
use bitcoin::BlockHash;
use sidestr_core::block::{
    block_height, block_sighash_for, template_id, HeaderFamily, SidestrBlock, SpendPath,
};
use sidestr_core::federation::{seal_federated, verify_partial, Federation};
use sidestr_core::state::{ClaimRequest, NextBlock};
use sidestr_nostr::event::{pubkey_from_hex, Event};
use sidestr_nostr::kinds::{KIND_BLOCK_PROPOSAL, KIND_PARTIAL_SIGNATURE, KIND_SEALED_BLOCK};
use sidestr_nostr::relay::Follower;
use sidestr_nostr::round::{sign_partial, sign_proposal, sign_sealed, Partial, Proposal};
use sidestr_nostr::tags::{first, height_tag, TAG_E, TAG_H};

use crate::chain::ChainView;
use crate::error::{Error, Result};
use crate::journal::{VoteEntry, VoteJournal, VoteRole, VoteScope, VoteStage};
use crate::signer::{PartialRequest, RoundSigner};

/// The rules that cannot hold for an unsealed template and are therefore
/// not held against a proposal: the solution is not there yet, and the
/// nonce is ground at sealing.
pub const RULES_NOT_JUDGED_ON_A_TEMPLATE: [&str; 2] =
    ["sidestr:rule-block-signature", "btc:rule-header-pow"];

/// The round's options.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoundConfig {
    /// Seconds without a block before the next signer in the ring may
    /// propose (`--propose-after`, upstream default 30).
    pub propose_after: u64,
    /// After how many seconds a signed-but-unsealed height may be signed
    /// again for another proposal (strictly more than this many, to the
    /// millisecond). `Some(propose_after)` is upstream's rule; `None` never
    /// re-signs.
    pub resign_after: Option<u64>,
}

impl RoundConfig {
    /// Upstream's behaviour for a given `propose_after`.
    pub fn upstream(propose_after: u64) -> Self {
        Self {
            propose_after,
            resign_after: Some(propose_after),
        }
    }
}

impl Default for RoundConfig {
    /// `propose_after = 30`, re-signing after 30: `round.mjs`'s defaults.
    fn default() -> Self {
        Self::upstream(30)
    }
}

/// A block that entered the chain through the round.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedBlock {
    /// Its height.
    pub height: u32,
    /// Its hash.
    pub hash: BlockHash,
    /// Transactions, coinbase included.
    pub txs: usize,
    /// Fees the coinbase collected (known for my own proposal, 0 otherwise).
    pub fees: u64,
    /// Claims it made (known for my own proposal, 0 otherwise).
    pub claims: usize,
    /// The signer whose 23514 carried it, or `None` when sealed here.
    pub from: Option<String>,
}

/// What the caller does after a [`Round::tick`] or [`Round::on_event`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Send this event to every relay (`relay.mjs publish`).
    Publish(Event),
    /// A block was validated and applied through [`ChainView::add_block`]:
    /// announce the tip, reset the block timer.
    Sealed(SealedBlock),
    /// A line for the signer's log, worded as `round.mjs` words it.
    Log(String),
}

/// The optional check a signer with a parent view runs on a proposal's
/// claims (`bin/siding.mjs checkClaims`): `Some(reason)` refuses it.
pub trait ClaimChecker<F: HeaderFamily> {
    /// Why the block's claims are unacceptable, or `None`.
    fn check(&self, block: &F::Block) -> Option<String>;
}

/// My proposal in flight (`round.mjs pending`).
#[derive(Debug, Clone)]
pub struct Pending<B> {
    /// The 23510's id.
    pub id: String,
    /// The height.
    pub height: u32,
    /// The template.
    pub block: B,
    /// Signatures gathered so far, mine included.
    pub sigs: BTreeMap<XOnlyPublicKey, Signature>,
    /// When it was proposed, unix milliseconds.
    pub at: u64,
    /// The fees it collects.
    pub fees: u64,
    /// The claims it makes.
    pub claims: usize,
}

#[derive(Debug, Clone)]
struct SignedAt {
    id: String,
    at: u64,
}

/// The round for one signer of one chain.
pub struct Round<F: HeaderFamily> {
    cfg: RoundConfig,
    family: F,
    chain_id: String,
    genesis_hash: BlockHash,
    fed: Federation,
    me: XOnlyPublicKey,
    me_hex: String,
    signer: Box<dyn RoundSigner>,
    journal: Box<dyn VoteJournal>,
    pending: Option<Pending<F::Block>>,
    signed: BTreeMap<u32, SignedAt>,
    due_since: Option<u64>,
    claims_wanted: Vec<ClaimRequest>,
    check_claims: Option<Box<dyn ClaimChecker<F>>>,
    proposals: Follower,
    partials: Follower,
    sealed: Follower,
}

impl<F: HeaderFamily> core::fmt::Debug for Round<F> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Round")
            .field("chain_id", &self.chain_id)
            .field("me", &self.me_hex)
            .field("cfg", &self.cfg)
            .field("pending", &self.pending.as_ref().map(|p| p.height))
            .field("signed", &self.signed.keys().collect::<Vec<_>>())
            .finish_non_exhaustive()
    }
}

fn short(s: &str, n: usize) -> &str {
    &s[..s.len().min(n)]
}

impl<F: HeaderFamily> Round<F> {
    /// A round for the chain `state` holds, as the signer `signer` — which
    /// must be one of the document's signers — with its journal loaded.
    pub fn new(
        state: &sidestr_core::state::StateOf<F>,
        signer: Box<dyn RoundSigner>,
        journal: Box<dyn VoteJournal>,
        cfg: RoundConfig,
    ) -> Result<Self> {
        let fed = state.federation().cloned().ok_or_else(|| {
            Error::Federation("not a federated chain: no signers/threshold".into())
        })?;
        let me = signer.pubkey();
        if !fed.signers.contains(&me) {
            return Err(Error::Key("this key is not one of the signers".into()));
        }
        let chain_id = state.document().id.clone();
        let mut signed = BTreeMap::new();
        for e in journal.entries()? {
            if let VoteScope::Height(h) = e.scope {
                signed.insert(
                    h,
                    SignedAt {
                        id: e.subject,
                        at: e.at,
                    },
                );
            }
        }
        Ok(Self {
            cfg,
            family: *state.family(),
            genesis_hash: state.genesis_hash(),
            fed,
            me,
            me_hex: hex::encode(me.serialize()),
            signer,
            journal,
            pending: None,
            signed,
            due_since: None,
            claims_wanted: Vec::new(),
            check_claims: None,
            proposals: Follower::new(KIND_BLOCK_PROPOSAL, &chain_id),
            partials: Follower::new(KIND_PARTIAL_SIGNATURE, &chain_id),
            sealed: Follower::new(KIND_SEALED_BLOCK, &chain_id),
            chain_id,
        })
    }

    /// Install the claims check a parent view provides.
    pub fn with_claim_checker(mut self, checker: Box<dyn ClaimChecker<F>>) -> Self {
        self.check_claims = Some(checker);
        self
    }

    /// The signer set.
    pub fn federation(&self) -> &Federation {
        &self.fed
    }
    /// My key.
    pub fn me(&self) -> &XOnlyPublicKey {
        &self.me
    }
    /// My slot in the ring (`fed.signers.indexOf(pub)`).
    pub fn slot(&self) -> usize {
        self.fed
            .signers
            .iter()
            .position(|k| *k == self.me)
            .expect("checked in new")
    }
    /// The options.
    pub fn config(&self) -> &RoundConfig {
        &self.cfg
    }
    /// My proposal in flight.
    pub fn pending(&self) -> Option<&Pending<F::Block>> {
        self.pending.as_ref()
    }
    /// The heights I have signed a proposal for, with the proposal id and
    /// when (unix milliseconds) — the journal's view after this run's
    /// additions.
    pub fn signed(&self) -> impl Iterator<Item = (u32, &str, u64)> {
        self.signed.iter().map(|(h, s)| (*h, s.id.as_str(), s.at))
    }
    /// What the producer wants claimed in the next block it proposes
    /// (`round.wantClaims`). Empty included: a claim sealed by another
    /// signer must leave the list, or every proposal of mine throws.
    pub fn want_claims(&mut self, claims: Vec<ClaimRequest>) {
        self.claims_wanted = claims;
    }

    fn n(&self) -> u64 {
        self.fed.signers.len() as u64
    }

    /// `round.mjs mayReSign`: no signature at this height, or the one there
    /// is has had its window to seal — strictly more than `resign_after`
    /// seconds, measured in milliseconds.
    fn may_resign(&self, height: u32, now_ms: u64) -> bool {
        match (self.signed.get(&height), self.cfg.resign_after) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(prev), Some(after)) => now_ms.saturating_sub(prev.at) > after * 1000,
        }
    }

    /// `propose_after × n`, in milliseconds: the proposal's life.
    fn ring_ms(&self) -> u64 {
        self.cfg.propose_after * 1000 * self.n()
    }

    /// `round.mjs entitled`: the proposer for a height is `height mod n`;
    /// every `propose_after` seconds of lateness lets the next signer in
    /// the ring propose too. Lateness counts from when the block became
    /// due (`due_since`), not from the last block. Never negative: another
    /// signer's clock may run a little ahead of mine. `at_ms` and
    /// `due_since` are milliseconds, as upstream's.
    fn entitled(&self, signer: &XOnlyPublicKey, height: u32, at_ms: u64) -> bool {
        let Some(slot) = self.fed.signers.iter().position(|k| k == signer) else {
            return false;
        };
        let n = self.n();
        let turn = u64::from(height) % n;
        let base = self.due_since.unwrap_or(at_ms);
        let late = at_ms.saturating_sub(base) / (self.cfg.propose_after.max(1) * 1000);
        (slot as u64 + n - turn) % n <= late
    }

    fn template_id(&self, block: &F::Block) -> Result<[u8; 32]> {
        Ok(template_id(
            &self.family,
            block,
            &self.chain_id,
            Some(self.genesis_hash),
        )?)
    }

    fn partial(&self, block: &F::Block, height: u32, tid: [u8; 32]) -> Result<Signature> {
        let digest = block_sighash_for(
            &self.family,
            block,
            &self.fed.challenge(),
            &SpendPath::ScriptPath {
                leaf_hash: self.fed.leaf_hash,
                annex: None,
                codesep_pos: 0xffff_ffff,
            },
        )?;
        self.signer
            .sign_partial(&PartialRequest::new(&self.chain_id, height, tid, digest))
    }

    /// One journal record. The intent goes in before the custody signer is
    /// asked, the signature after it answers.
    fn journal(
        &mut self,
        tid: [u8; 32],
        height: u32,
        role: VoteRole,
        subject: &str,
        at_ms: u64,
        signature: Option<&Signature>,
    ) -> Result<()> {
        self.journal.record(&VoteEntry {
            scope: VoteScope::Height(height),
            role,
            subject: subject.to_string(),
            digest: hex::encode(tid),
            at: at_ms,
            stage: if signature.is_some() {
                VoteStage::Signed
            } else {
                VoteStage::Intent
            },
            signature: signature.map(|s| hex::encode(s.as_ref())),
        })
    }

    /// Intent, then the custody signer, then the signature: the order the
    /// journal guarantees. `Err` before the signer was asked means no
    /// signature exists; `Err` after means one exists, is journalled, and
    /// is not published.
    fn authorise(
        &mut self,
        block: &F::Block,
        height: u32,
        role: VoteRole,
        subject: &str,
        now_ms: u64,
    ) -> core::result::Result<Signature, (bool, Error)> {
        let tid = self.template_id(block).map_err(|e| (false, e))?;
        self.journal(tid, height, role, subject, now_ms, None)
            .map_err(|e| (false, e))?;
        // journalled: from here the height counts as signed whatever happens next
        self.signed.insert(
            height,
            SignedAt {
                id: subject.to_string(),
                at: now_ms,
            },
        );
        let sig = self.partial(block, height, tid).map_err(|e| (true, e))?;
        self.journal(tid, height, role, subject, now_ms, Some(&sig))
            .map_err(|e| (true, e))?;
        Ok(sig)
    }

    /// Called every second by the producer (`round.tick({ due })`): drop a
    /// proposal nobody sealed, and propose when a block is due and it is my
    /// turn. `now_ms` is unix milliseconds; `due` is the producer's block
    /// timer, as upstream computes it.
    pub fn tick(&mut self, now_ms: u64, chain: &mut dyn ChainView<F>, due: bool) -> Vec<Action> {
        let now = now_ms;
        let mut out = Vec::new();
        if let Some(p) = &self.pending {
            if p.height <= chain.state().height() {
                // the height moved under my proposal: a sealed block from elsewhere took it
                self.pending = None;
            } else if now.saturating_sub(p.at) > self.ring_ms() {
                out.push(Action::Log(format!(
                    "round: my proposal h{} got {} signature(s); dropping it",
                    p.height,
                    p.sigs.len()
                )));
                self.pending = None;
                return out;
            } else {
                return out;
            }
        }
        if !due {
            self.due_since = None;
            return out;
        }
        if self.due_since.is_none() {
            self.due_since = Some(now);
        }
        let height = chain.state().height().saturating_add(1);
        if !self.may_resign(height, now) {
            return out;
        }
        if self.entitled(&self.me, height, now) {
            match self.propose(now, chain, &mut out) {
                Ok(()) => {}
                Err(e) => out.push(Action::Log(format!("round: {e}"))),
            }
        }
        out
    }

    /// `round.mjs propose`. `now` is milliseconds.
    fn propose(
        &mut self,
        now: u64,
        chain: &mut dyn ChainView<F>,
        out: &mut Vec<Action>,
    ) -> Result<()> {
        let secs = now / 1000;
        let state = chain.state();
        // never propose a claim the chain already has
        let wanted: Vec<ClaimRequest> = self
            .claims_wanted
            .iter()
            .filter(|c| !state.claimed(&c.txid, c.vout))
            .cloned()
            .collect();
        let (block, fees, claims) = state.build_next(&NextBlock {
            time: u32::try_from(secs).unwrap_or(u32::MAX),
            claims: wanted,
        })?;
        let height = block_height(&self.family, &block)?;
        let ev = sign_proposal(
            self.signer.as_ref(),
            &Proposal {
                chain_id: self.chain_id.clone(),
                height,
                block_hex: hex::encode(block.encode()),
            },
            secs,
        )?;
        // the intent is journalled before the key is asked, the signature before anything is handed out
        let sig = self
            .authorise(&block, height, VoteRole::Proposed, &ev.id, now)
            .map_err(|(_, e)| e)?;
        let mut sigs = BTreeMap::new();
        sigs.insert(self.me, sig);
        self.pending = Some(Pending {
            id: ev.id.clone(),
            height,
            block: block.clone(),
            sigs,
            at: now,
            fees,
            claims,
        });
        out.push(Action::Log(format!(
            "round: proposing h{height} {}… ({} txs, {claims} claim(s))",
            short(&ev.id, 12),
            block.txdata().len() - 1
        )));
        out.push(Action::Publish(ev));
        self.maybe_seal(now, chain, out);
        Ok(())
    }

    /// An event from a relay (`relay.mjs subscribe` → `onProposal`,
    /// `onPartial`, `onSealed`). The on-receipt checks — kind, unseen,
    /// tagged for this chain, signature — are applied here, so the caller
    /// may hand over everything the relay sends. `now_ms` is unix
    /// milliseconds.
    pub fn on_event(
        &mut self,
        now_ms: u64,
        chain: &mut dyn ChainView<F>,
        ev: &Event,
    ) -> Vec<Action> {
        let now = now_ms;
        let mut out = Vec::new();
        match ev.kind {
            KIND_BLOCK_PROPOSAL => {
                if self.proposals.accept(ev).is_some() {
                    self.on_proposal(now, chain, ev, &mut out);
                }
            }
            KIND_PARTIAL_SIGNATURE => {
                if self.partials.accept(ev).is_some() {
                    self.on_partial(now, chain, ev, &mut out);
                }
            }
            KIND_SEALED_BLOCK if self.sealed.accept(ev).is_some() => {
                self.on_sealed(now, chain, ev, &mut out);
            }
            _ => {}
        }
        out
    }

    /// `round.mjs onProposal`, with the deterministic rules judged before
    /// the mempool.
    fn on_proposal(
        &mut self,
        now: u64,
        chain: &mut dyn ChainView<F>,
        ev: &Event,
        out: &mut Vec<Action>,
    ) {
        let Ok(height) = height_tag(&ev.tags, TAG_H) else {
            return;
        };
        if ev.pubkey == self.me_hex {
            return;
        }
        // a relay replaying an old proposal: its proposer has moved on
        if now.saturating_sub(ev.created_at.saturating_mul(1000)) > self.ring_ms() {
            return;
        }
        let secs = now / 1000;
        let log = |s: String| Action::Log(s);
        let my = chain.state().height();
        if u64::from(height) != u64::from(my) + 1 {
            out.push(log(format!(
                "round: proposal h{height} from {}… ignored (my tip is {my})",
                short(&ev.pubkey, 8)
            )));
            return;
        }
        let proposer = pubkey_from_hex(&ev.pubkey).ok();
        if !proposer.is_some_and(|p| self.entitled(&p, height, ev.created_at.saturating_mul(1000))) {
            out.push(log(format!(
                "round: proposal h{height} from {}… refused: not its turn",
                short(&ev.pubkey, 8)
            )));
            return;
        }
        if !self.may_resign(height, now) {
            let prev = self
                .signed
                .get(&height)
                .expect("may_resign is false only with an entry");
            out.push(log(format!(
                "round: proposal h{height} from {}… refused: I signed {}… for this height {} s ago",
                short(&ev.pubkey, 8),
                short(&prev.id, 8),
                (now.saturating_sub(prev.at) + 500) / 1000
            )));
            return;
        }
        let block = match hex::decode(ev.content.trim())
            .ok()
            .and_then(|b| F::Block::decode(&b).ok())
        {
            Some(b) => b,
            None => {
                out.push(log("round: proposal is not a block".into()));
                return;
            }
        };
        let tip = chain.state().tip();
        let header = block.header();
        if self.family.prev(header) != tip.hash || self.family.time(header) <= tip.time {
            out.push(log(format!(
                "round: proposal h{height} refused: does not build on my tip"
            )));
            return;
        }
        // deterministic chain rules first (hardening: the template judged as a block would be,
        // minus the two rules sealing satisfies), local mempool policy second
        let (verdict, _) =
            chain
                .state()
                .judge(height, &block, Some(u32::try_from(secs).unwrap_or(u32::MAX)));
        let failed: Vec<String> = verdict
            .failed()
            .into_iter()
            .filter(|r| !RULES_NOT_JUDGED_ON_A_TEMPLATE.contains(&r.as_str()))
            .collect();
        if !failed.is_empty() {
            out.push(log(format!(
                "round: proposal h{height} refused: rules {}",
                failed.join(", ")
            )));
            return;
        }
        // every transaction must be one my mempool accepts (or already holds): the same checks a producer makes
        for tx in &block.txdata()[1..] {
            let txid = tx.compute_txid();
            if chain.state().mempool().any(|m| m.compute_txid() == txid) {
                continue;
            }
            if let Err(e) = chain.submit(tx.clone()) {
                out.push(log(format!(
                    "round: proposal h{height} refused: tx {}… {e}",
                    short(&txid.to_string(), 12)
                )));
                return;
            }
        }
        if let Some(why) = self.check_claims.as_ref().and_then(|c| c.check(&block)) {
            out.push(log(format!("round: proposal h{height} refused: {why}")));
            return;
        }
        let sig = match self.authorise(&block, height, VoteRole::Signed, &ev.id, now) {
            Ok(s) => s,
            Err((false, e)) => {
                out.push(log(format!("round: proposal h{height} not signed: {e}")));
                return;
            }
            Err((true, e)) => {
                out.push(log(format!(
                    "round: proposal h{height} signed but not published: {e}"
                )));
                return;
            }
        };
        let pev = match sign_partial(
            self.signer.as_ref(),
            &Partial {
                chain_id: self.chain_id.clone(),
                height,
                proposal: ev.id.clone(),
                signature_hex: hex::encode(sig.as_ref()),
            },
            secs,
        ) {
            Ok(p) => p,
            Err(e) => {
                out.push(log(format!("round: {e}")));
                return;
            }
        };
        out.push(Action::Publish(pev));
        out.push(log(format!(
            "round: signed h{height} {}… from {}…",
            short(&ev.id, 12),
            short(&ev.pubkey, 8)
        )));
    }

    /// `round.mjs onPartial`.
    fn on_partial(
        &mut self,
        now: u64,
        chain: &mut dyn ChainView<F>,
        ev: &Event,
        out: &mut Vec<Action>,
    ) {
        let Some(p) = &self.pending else {
            return;
        };
        if first(&ev.tags, TAG_E) != Some(p.id.as_str()) || ev.pubkey == self.me_hex {
            return;
        }
        let Ok(pk) = pubkey_from_hex(&ev.pubkey) else {
            return;
        };
        if !self.fed.signers.contains(&pk) {
            return;
        }
        let sig = hex::decode(ev.content.trim())
            .ok()
            .and_then(|b| Signature::from_slice(&b).ok());
        let ok = sig.is_some_and(|s| verify_partial(&self.family, &p.block, &self.fed, &pk, &s));
        if !ok {
            out.push(Action::Log(format!(
                "round: bad partial from {}…",
                short(&ev.pubkey, 8)
            )));
            return;
        }
        let p = self.pending.as_mut().expect("checked");
        p.sigs.insert(pk, sig.expect("checked"));
        out.push(Action::Log(format!(
            "round: {}/{} signatures for h{}",
            p.sigs.len(),
            self.fed.threshold,
            p.height
        )));
        self.maybe_seal(now, chain, out);
    }

    /// `round.mjs maybeSeal`: with `k`, seal, add through the validator,
    /// publish the sealed block.
    fn maybe_seal(&mut self, now: u64, chain: &mut dyn ChainView<F>, out: &mut Vec<Action>) {
        let Some(p) = &self.pending else {
            return;
        };
        if p.sigs.len() < usize::from(self.fed.threshold) {
            return;
        }
        let p = self.pending.take().expect("checked");
        let sealed = match seal_federated(&self.family, &p.block, &self.fed, &p.sigs) {
            Ok(s) => s,
            Err(e) => {
                out.push(Action::Log(format!(
                    "round: sealed block refused by my own validator: {e}"
                )));
                return;
            }
        };
        let secs = now / 1000;
        match chain.add_block(&sealed, secs) {
            Ok(r) => {
                self.claims_wanted.clear();
                self.due_since = None;
                out.push(Action::Log(format!(
                    "block {} {}… sealed by {} of {}, {} txs, fees {}{}",
                    r.height,
                    short(&r.hash.to_string(), 16),
                    self.fed.threshold,
                    self.n(),
                    r.txs - 1,
                    p.fees,
                    if p.claims > 0 {
                        format!(", claims {}", p.claims)
                    } else {
                        String::new()
                    }
                )));
                match sign_sealed(
                    self.signer.as_ref(),
                    &Proposal {
                        chain_id: self.chain_id.clone(),
                        height: r.height,
                        block_hex: hex::encode(sealed.encode()),
                    },
                    secs,
                ) {
                    Ok(ev) => out.push(Action::Publish(ev)),
                    Err(e) => out.push(Action::Log(format!("round: {e}"))),
                }
                out.push(Action::Sealed(SealedBlock {
                    height: r.height,
                    hash: r.hash,
                    txs: r.txs,
                    fees: p.fees,
                    claims: p.claims,
                    from: None,
                }));
            }
            Err(e) => out.push(Action::Log(format!(
                "round: sealed block refused by my own validator: {e}"
            ))),
        }
    }

    /// `round.mjs onSealed`: a block another signer sealed is a candidate
    /// for the validator, nothing more.
    fn on_sealed(
        &mut self,
        now: u64,
        chain: &mut dyn ChainView<F>,
        ev: &Event,
        out: &mut Vec<Action>,
    ) {
        let Ok(height) = height_tag(&ev.tags, TAG_H) else {
            return;
        };
        let from_signer = pubkey_from_hex(&ev.pubkey).is_ok_and(|p| self.fed.signers.contains(&p));
        if ev.pubkey == self.me_hex
            || !from_signer
            || u64::from(height) != u64::from(chain.state().height()) + 1
        {
            return;
        }
        let refused = |e: String| {
            Action::Log(format!(
                "round: sealed block h{height} from {}… refused: {e}",
                short(&ev.pubkey, 8)
            ))
        };
        let block = match hex::decode(ev.content.trim())
            .map_err(|e| e.to_string())
            .and_then(|b| F::Block::decode(&b).map_err(|e| e.to_string()))
        {
            Ok(b) => b,
            Err(e) => {
                out.push(refused(e));
                return;
            }
        };
        match chain.add_block(&block, now / 1000) {
            Ok(r) => {
                self.due_since = None;
                if self.pending.as_ref().is_some_and(|p| p.height <= r.height) {
                    self.pending = None;
                }
                out.push(Action::Log(format!(
                    "block {} {}… from {}… (sealed by the federation)",
                    r.height,
                    short(&r.hash.to_string(), 16),
                    short(&ev.pubkey, 8)
                )));
                out.push(Action::Sealed(SealedBlock {
                    height: r.height,
                    hash: r.hash,
                    txs: r.txs,
                    fees: 0,
                    claims: 0,
                    from: Some(ev.pubkey.clone()),
                }));
            }
            Err(e) => out.push(refused(e.to_string())),
        }
    }
}
