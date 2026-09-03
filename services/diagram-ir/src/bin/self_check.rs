//! Self-check a generated diagram HTML file, with no third-party services.
//!
//! Checks the accessible-SVG contract, the single-file safety rules (no remote
//! assets beyond the approved Google Fonts stylesheet, no executable
//! attributes, no scripts other than the one canonical motion controller), and
//! — when motion markup is present — the structural motion contract. This is a
//! distilled subset of the repository gates (`lint-skin.py`,
//! `verify-motion.py`), which remain the authority for contributions to the
//! repository itself.
//!
//! Exit codes: 0 every file passed, 1 at least one file failed.

use clap::Parser;

use diagram_ir::pyfmt::path_str;
use diagram_ir::selfcheck::checks::verify;
use diagram_ir::selfcheck::resolve_motion_template;

#[derive(Parser, Debug)]
#[command(
    name = "diagram-self-check",
    about = "Self-check a generated diagram HTML file."
)]
struct Args {
    /// HTML files to check
    #[arg(required = true, num_args = 1..)]
    files: Vec<String>,
    /// path to the canonical `template-motion.html`; otherwise
    /// `$DIAGRAM_DESIGN_SKILL_DIR/assets/`, the installed skill, then
    /// `./skills/diagram-design/assets/`
    #[arg(long = "motion-template")]
    motion_template: Option<String>,
}

fn main() -> std::process::ExitCode {
    let args = Args::parse();
    let template = resolve_motion_template(args.motion_template.as_deref());
    let template_display = template.display().to_string();
    let mut failed = false;
    for raw in &args.files {
        let path = path_str(raw);
        let errors = match std::fs::read(&path) {
            Err(error) => vec![format!("{error} (while reading {path})")],
            Ok(bytes) => match String::from_utf8(bytes) {
                Err(error) => vec![format!("{error} (while decoding {path})")],
                Ok(text) => {
                    // `Path.read_text` applies universal newlines.
                    let text = text.replace("\r\n", "\n").replace('\r', "\n");
                    verify(&text, &template_display, &template_display)
                }
            },
        };
        if errors.is_empty() {
            println!("OK {path}");
        } else {
            failed = true;
            println!("FAIL {path}");
            for error in &errors {
                println!("  - {error}");
            }
        }
    }
    if failed {
        std::process::ExitCode::from(1)
    } else {
        std::process::ExitCode::SUCCESS
    }
}
