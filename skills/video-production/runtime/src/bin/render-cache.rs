//! Assemble a complete native render cache after a verified scoped scene edit.
//!
//! Usage: `render-cache [--root DIR] --allow START..END [--allow ..] PARENT_DIR
//! REVISION_JSON PATCH_DIR WORLD NEW_DIR`.
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Err(error) = video_production_runtime::render_cache::run(args) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
