//! Agentbox session plane (ADR-2153).
//!
//! A tmux-backed daemon and CLI that makes `[[interaction_plane.session_seeds]]`
//! in `agentbox.toml` true and keeps it true. It replaces Agent of Empires,
//! which created sessions once and never reconciled them.
//!
//! * [`manifest`] reads the declared sessions.
//! * [`contract`] turns a seed into a command, from `config/session-plane/launch.json`.
//! * [`reconcile`] decides, as a pure function, what each seed needs.
//! * [`plane`] carries the decision out and serves status, send, create and close.
//! * [`tmux`], [`worktree`] and [`trust`] are the three things a session needs
//!   underneath it: a pane, a checkout, and a config store that trusts the folder.
//! * [`api`] is the unix-socket surface; [`boundary`] reports to management-api;
//!   [`pick`] is the tab-8 picker; [`status`] classifies a pane.

pub mod api;
pub mod boundary;
pub mod contract;
pub mod manifest;
pub mod pick;
pub mod plane;
pub mod reconcile;
pub mod status;
pub mod tmux;
pub mod trust;
pub mod worktree;
