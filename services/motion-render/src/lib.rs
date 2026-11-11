//! Frame-exact page renderer for the `motion-designer` skill.
//!
//! A motion design film is one HTML page whose every frame is a pure function of time
//! (`window.renderAt(t)`). This crate freezes that page at exact times in the browser
//! sidecar's Chrome, over raw CDP, and captures each frame. No browser runs in the agentbox
//! container, so two things have to cross the container boundary:
//!
//! * commands and screenshots, over one WebSocket ([`cdp`]);
//! * the page's own files, which the sidecar cannot read, over a short-lived read-only HTTP
//!   server bound to this container's address on the shared network ([`serve`]).
//!
//! [`lock`] keeps two renders from this container off the sidecar's GPU at once, [`diff`]
//! decides whether two captures of the same instant are the same picture, and [`plan`] holds
//! the frame arithmetic. The binary in `src/bin/motion_render.rs` wires them to ffmpeg.

pub mod cdp;
pub mod diff;
pub mod lock;
pub mod plan;
pub mod serve;
