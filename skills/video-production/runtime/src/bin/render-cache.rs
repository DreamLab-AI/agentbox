//! Assemble a complete native render cache after a verified scoped scene edit.
//!
//! Usage: `render-cache [--root DIR] (--allow START..END [--allow ..] | --allow-from-diff DIFF_JSON --old-plan P --new-plan P) [--plan PLAN_JSON] PARENT_DIR
//! REVISION_JSON PATCH_DIR WORLD NEW_DIR`.
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Err(error) = video_production_runtime::render_cache::run(args) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
