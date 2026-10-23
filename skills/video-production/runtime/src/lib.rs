//! Shared validation and exchange helpers for scene-directed production tools.
//!
//! * [`clock`] — exact rational frame-clock arithmetic and duration policy.
//! * [`paths`] — production-root resolution and root-relative receipt paths.
//! * [`comfy`] — hash-verified upload to a ComfyUI-compatible service.
//! * [`guide`] — decoded-clock and held-padding checks for guide video.
//! * [`render_cache`] — complete render-cache assembly after a scoped edit.
pub mod clock;
pub mod comfy;
pub mod guide;
pub mod paths;
pub mod render_cache;
