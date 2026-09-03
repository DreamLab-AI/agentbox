//! The packaged self-check, one failure mode at a time.

mod common;

use common::{golden, motion_template};
use diagram_ir::selfcheck::checks::{
    canonical_controller, is_approved_google_fonts_stylesheet, normalised_controller,
    reference_error, verify,
};
use diagram_ir::selfcheck::resolve_motion_template;

fn check(name: &str) -> Vec<String> {
    let path = format!("tests/fixtures/selfcheck/{name}");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{path}: {error}"))
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let template = motion_template();
    verify(&source, &template, &template)
}

fn assert_only(name: &str, expected: &[&str]) {
    let errors = check(name);
    assert_eq!(
        errors,
        expected
            .iter()
            .map(|item| item.to_string())
            .collect::<Vec<_>>(),
        "unexpected findings for {name}"
    );
}

#[test]
fn a_compliant_file_passes() {
    assert_only("clean.html", &[]);
    assert_only("motion-step-ok.html", &[]);
}

#[test]
fn the_whole_fixture_report_matches_python() {
    let mut names: Vec<String> = std::fs::read_dir("tests/fixtures/selfcheck")
        .expect("fixture directory")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".html"))
        .collect();
    names.sort();
    let mut report = String::new();
    for name in &names {
        let errors = check(name);
        let path = format!("tests/fixtures/selfcheck/{name}");
        if errors.is_empty() {
            report.push_str(&format!("OK {path}\n"));
        } else {
            report.push_str(&format!("FAIL {path}\n"));
            for error in errors {
                report.push_str(&format!("  - {error}\n"));
            }
        }
    }
    assert_eq!(report, golden("selfcheck-report.txt"));
}

#[test]
fn accessible_svg_contract_failures_are_named() {
    assert_only("no-role.html", &["svg 1 needs role=img"]);
    assert_only(
        "title-not-first.html",
        &["svg 1 title must be its first child"],
    );
    assert_only(
        "empty-title.html",
        &["svg 1 needs non-empty title and desc"],
    );
    assert_only(
        "bare-ids.html",
        &["svg 1 title/desc IDs must be diagram-prefixed, never bare"],
    );
    assert_only(
        "labelledby-order.html",
        &["svg 1 aria-labelledby must name title then desc"],
    );
    assert_only(
        "no-accessible-svg.html",
        &["diagram file needs at least one accessible (non-aria-hidden) SVG"],
    );
}

#[test]
fn unsafe_markup_is_rejected() {
    assert_only(
        "unsafe-tags.html",
        &[
            "<base> is not allowed in a diagram file",
            "<embed> is not allowed in a diagram file",
            "<object> is not allowed in a diagram file",
            "<iframe> is not allowed in a diagram file",
            "srcdoc attribute on <iframe>",
        ],
    );
    assert_only(
        "on-attribute.html",
        &["executable attribute onclick on <rect>"],
    );
    assert_only(
        "javascript-url.html",
        &["executable URL on <a>: javascript:alert(1)"],
    );
    assert_only(
        "data-html-url.html",
        &["executable URL on <a>: data:text/html,x"],
    );
    assert_only(
        "non-image-data.html",
        &["non-image data URL on <image>: data:application/json,%7B%7D"],
    );
    assert_only(
        "remote-reference.html",
        &["remote reference on <a>: https://example.invalid/page"],
    );
}

#[test]
fn only_the_google_fonts_css2_url_is_an_approved_remote_stylesheet() {
    assert!(is_approved_google_fonts_stylesheet(
        "https://fonts.googleapis.com/css2?family=Geist"
    ));
    assert!(is_approved_google_fonts_stylesheet(
        "https://FONTS.googleapis.COM/css2"
    ));
    assert!(!is_approved_google_fonts_stylesheet(
        "http://fonts.googleapis.com/css2"
    ));
    assert!(!is_approved_google_fonts_stylesheet(
        "https://fonts.googleapis.com/css?family=Geist"
    ));
    assert!(!is_approved_google_fonts_stylesheet(
        "https://fonts.googleapis.com:8443/css2"
    ));
    assert!(!is_approved_google_fonts_stylesheet(
        "https://fonts.googleapis.com/css2#frag"
    ));
    assert!(!is_approved_google_fonts_stylesheet(
        "https://evil.invalid/css2"
    ));
    for name in [
        "bad-stylesheet.html",
        "fonts-wrong-path.html",
        "fonts-with-port.html",
        "fonts-fragment.html",
    ] {
        let errors = check(name);
        assert_eq!(errors.len(), 1, "{name}");
        assert!(
            errors[0].starts_with("remote stylesheet is not the approved Google Fonts /css2 URL:"),
            "{name}: {}",
            errors[0]
        );
    }
}

#[test]
fn local_and_fragment_references_are_allowed() {
    assert_eq!(reference_error("a", "", "#anchor"), None);
    assert_eq!(reference_error("img", "", "./local.png"), None);
    assert_eq!(
        reference_error("image", "", "data:image/svg+xml,%3Csvg/%3E"),
        None
    );
    assert_eq!(reference_error("a", "", "   "), None);
}

#[test]
fn motion_root_and_step_count_rules() {
    assert_only(
        "motion-two-roots.html",
        &["expected exactly one data-motion-root; found 2"],
    );
    assert_only(
        "motion-bad-mode.html",
        &["data-motion-mode must be one of ['loop', 'none', 'reveal', 'step']; got 'sparkle'"],
    );
    assert_only(
        "motion-bad-count.html",
        &[
            "data-step-count must be an ASCII decimal integer",
            "semantic step count must be 1..8; got -1",
            "semantic steps must be contiguous 1..-1; found [1, 2, 3, 4, 5]",
        ],
    );
    assert_only(
        "motion-count-range.html",
        &[
            "semantic step count must be 1..8; got 9",
            "semantic steps must be contiguous 1..9; found [1, 2, 3, 4, 5]",
        ],
    );
    assert_only(
        "motion-noncontiguous.html",
        &["semantic steps must be contiguous 1..5; found [1, 2, 4, 5, 7]"],
    );
    assert_only(
        "motion-crowded.html",
        &["no more than two semantic items may share a step; found {2: 4}"],
    );
    assert_only(
        "motion-item-budget.html",
        &["motion item budget is 12; found 14"],
    );
}

#[test]
fn motion_item_accessibility_rules() {
    assert_only(
        "motion-no-aria-label.html",
        &["semantic motion item 1 needs a non-color aria-label"],
    );
    assert_only(
        "motion-decorative-missing.html",
        &["decorative motion item 6 needs aria-hidden=true and focusable=false"],
    );
    assert_only(
        "motion-hidden-item.html",
        &["motion item 1 is hidden in source; the fallback must be visible"],
    );
}

#[test]
fn script_free_modes_stay_script_free() {
    assert_only(
        "motion-loop-mode.html",
        &[
            "loop mode must be script-free",
            "loop mode must not expose playback controls or live status",
        ],
    );
    assert_only(
        "motion-none-with-controls.html",
        &[
            "semantic steps must be contiguous 1..0; found [1, 2, 3, 4, 5]",
            "none mode must not expose playback controls or live status",
        ],
    );
}

#[test]
fn controlled_mode_requires_controls_actions_and_status() {
    assert_only(
        "motion-no-controls.html",
        &["controlled mode needs one in-root control group; found 0"],
    );
    assert_only(
        "motion-missing-actions.html",
        &["controlled mode is missing actions: prev, replay"],
    );
    assert_only(
        "motion-no-status.html",
        &["controlled mode needs data-motion-status"],
    );
    assert_only(
        "motion-status-attrs.html",
        &["motion status needs role=status, aria-live=polite, aria-atomic=true"],
    );
    assert_only(
        "motion-status-in-controls.html",
        &["motion status must sit outside data-motion-controls"],
    );
    assert_only(
        "motion-step-no-script.html",
        &["controlled mode needs the scoped control script"],
    );
}

#[test]
fn script_rules_pin_the_canonical_controller() {
    assert_only(
        "motion-two-scripts.html",
        &[
            "at most one script is allowed; found 2",
            "script 1 must exactly match the controller in template-motion.html",
        ],
    );
    assert_only(
        "motion-script-attrs.html",
        &["script 1 must carry only the canonical data-diagram-controls attribute"],
    );
    assert_only(
        "motion-script-mismatch.html",
        &["script 1 must exactly match the controller in template-motion.html"],
    );
    assert_only(
        "motion-unclosed-script.html",
        &[
            "script 1 must have a closing script tag",
            "script 1 must exactly match the controller in template-motion.html",
        ],
    );
}

#[test]
fn reduced_motion_print_and_noscript_fallbacks_are_required() {
    assert_only(
        "motion-no-reduced-motion.html",
        &["missing reduced-motion CSS fallback (prefers-reduced-motion)"],
    );
    assert_only(
        "motion-no-print.html",
        &["missing print CSS fallback (@media print)"],
    );
    assert_only(
        "motion-no-noscript.html",
        &["motion file needs a <noscript> explanation of the complete static frame"],
    );
}

#[test]
fn a_missing_controller_template_degrades_to_a_finding() {
    let source = std::fs::read_to_string("tests/fixtures/selfcheck/motion-step-ok.html").unwrap();
    let missing = "/nonexistent/template-motion.html";
    assert_eq!(
        verify(&source, missing, missing),
        vec![format!(
            "cannot find the canonical controller at {missing}; \
pass --motion-template or set DIAGRAM_DESIGN_SKILL_DIR to the diagram-design skill"
        )]
    );
    assert!(canonical_controller(missing, missing).is_err());
}

#[test]
fn a_template_without_one_closed_controller_is_rejected() {
    let path = "tests/fixtures/selfcheck/clean.html";
    assert_eq!(
        canonical_controller(path, path).unwrap_err(),
        "template-motion.html must contain one closed controller"
    );
}

#[test]
fn the_canonical_controller_is_newline_normalised() {
    assert_eq!(normalised_controller("  a\r\nb\rc  "), "a\nb\nc");
    let controller = canonical_controller(&motion_template(), &motion_template())
        .expect("the shipped template resolves");
    assert!(controller.starts_with('('), "the controller is an IIFE");
    assert!(!controller.contains('\r'));
}

#[test]
fn the_template_resolver_prefers_an_explicit_path() {
    assert_eq!(
        resolve_motion_template(Some("/explicit/template.html")),
        std::path::PathBuf::from("/explicit/template.html")
    );
    // With nothing on disk and no environment override the last candidate is
    // reported so the error names a plausible location.
    let resolved = resolve_motion_template(None);
    assert!(
        resolved.ends_with("assets/template-motion.html"),
        "{resolved:?}"
    );
}
