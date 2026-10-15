//! Dream engine — nightly evidence-gated repository evolution.
//!
//! This crate is the **AGPL-3.0 adapter** around two permissive crates: the
//! mechanism lives in `dream-core` (receipts-driven candidate worktrees, the
//! ledger, source reading, the context governor, streaks, prompts) and the
//! judgement in `dream-gate` (manifest, protected-path guard, verdict parsing,
//! the pure gate). What stays here is everything estate-specific, and it stays
//! AGPL because it links `nostr-bbs-core` and `zone_crypto` is never published.
//!
//! The acceptance path is deliberately split into small, pure, testable pieces
//! (ADR-2024 closeout): `dream_core::readiness` refuses an unusable nomination
//! before scheduling → `dream_gate::manifest` freezes what the experiment is,
//! before any model call → [`runner`] executes evaluators behind the
//! `dream_core` seam → `dream_gate::receipts` types and persists their raw
//! results → [`candidate_flow`] applies the emitted patch in isolation
//! (guarded by [`policy`]) and re-runs the required evaluators →
//! `dream_gate::gate` decides, from the receipts alone, whether ACCEPT
//! survives. `dream_core::source` reads the files a hypothesis touches from the
//! dispatched commit so the model's diff is written against real text
//! (ADR-2114). `dream_core::runstate` keeps the run restart-safe and
//! `dream_core::roster` keeps the nightly schedule fair. [`journal`] records
//! every side effect through the management API (ADR-2071), and
//! `dream_core::sweep` applies the seven-day rule to `dream/*` branches.
//!
//! The adapter's own modules: [`engine`] (composition root), [`estate`]
//! (defaults and environment reads), [`config`], [`prompt`] (the agentbox
//! template), [`policy`], [`candidate_flow`], [`llm`] (Z.AI/Loom as an `Llm`),
//! [`ruvector`] (memory sink), [`notify`] (inbox/journal notifiers),
//! [`dispatch`] (SSH to the annexe), [`present`], [`baseline`], and the forum
//! drivers [`digest`], [`governance`], [`relay`], [`inbox`], [`zone_crypto`].

pub mod baseline;
pub mod candidate_flow;
pub mod config;
pub mod digest;
pub mod dispatch;
pub mod engine;
pub mod estate;
pub mod governance;
pub mod inbox;
pub mod journal;
pub mod llm;
pub mod notify;
pub mod policy;
pub mod present;
pub mod prompt;
pub mod records;
pub mod relay;
pub mod runner;
pub mod ruvector;
pub mod zone_crypto;
