//! `uiux-search` — thin binary wrapper around [`skill_tools::uiux::cli::run`].
//!
//! This is a direct replacement for `search.py` in the `ui-ux-pro-max-skill` skill:
//! `python3 skills/ui-ux-pro-max/scripts/search.py "<query>" [...]` becomes
//! `uiux-search "<query>" [...]`, flag-for-flag.

fn main() {
    let code = skill_tools::uiux::cli::run();
    std::process::exit(code);
}
