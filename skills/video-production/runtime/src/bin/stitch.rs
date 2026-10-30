//! Frame-exact stitch with copied audio, and retake planning.
//!
//! Usage: `stitch [--root DIR] assemble PLAN NEW_DIR`, `stitch [--root DIR]
//! retake RETAKE_PLAN NEW_DIR`, `stitch plan-retake FRAMES A..B [--pre N]
//! [--post N] [--overlap N]`. See `stitch --help`.
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Err(error) = video_production_runtime::stitch::run(args) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
