//! Tooling for the agentbox `explainer` skill.
//!
//! The skill's job is to turn a codebase into an explanation that someone who
//! did not build it can act on, with every claim ledgered to evidence. Most of
//! that work is a person's, but the parts a machine can settle — does this
//! citation's range contain what it names, is this diagram stale, did the model
//! actually answer — belong here, so the expensive session model orients and
//! decides rather than reads.
//!
//! Today this crate holds the drafting path. The evidence, diagram and media
//! gates follow.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod draft;
