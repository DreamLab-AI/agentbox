//! Shared validation and exchange helpers for scene-directed production tools.
//!
//! * [`calibration`] — calibration claims honoured only with hashed evidence.
//! * [`clock`] — exact rational frame-clock arithmetic and duration policy.
//! * [`paths`] — production-root resolution and root-relative receipt paths.
//! * [`comfy`] — hash-verified upload to a ComfyUI-compatible service.
//! * [`media`] — decoded frames, PCM and frame/packet hashes via ffmpeg raw pipes.
//! * [`guide`] — decoded-clock and held-padding checks for guide video.
//! * [`prompt_lint`] — static checks over film and performance plans before GPU spend.
//! * [`windows`] — generation-window planner and chained checkpoint keys.
//! * [`seam_qa`] — measured seam checks against a local baseline.
//! * [`render_cache`] — complete render-cache assembly after a scoped edit.
//! * [`stitch`] — frame-exact stitch, copied audio and retake planning.
pub mod calibration;
pub mod clock;
pub mod comfy;
pub mod guide;
pub mod media;
pub mod paths;
pub mod prompt_lint;
pub mod render_cache;
pub mod seam_qa;
pub mod stitch;
pub mod windows;
