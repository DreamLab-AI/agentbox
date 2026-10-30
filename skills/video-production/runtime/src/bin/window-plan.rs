//! Plan generation windows and chained checkpoint keys, or diff two plans.
//!
//! Usage: `window-plan [--root DIR] plan ...` or `window-plan [--root DIR] diff OLD NEW`;
//! see `--help`.
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Err(error) = video_production_runtime::windows::run(args) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
