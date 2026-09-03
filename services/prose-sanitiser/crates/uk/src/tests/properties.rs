//! Randomised checks over generated documents.
//!
//! The headline property is the one the design turns on: **a fix never touches
//! an excluded span**. Everything else in the crate is a judgement about
//! English, but that one is a structural guarantee, and it is exactly the kind
//! of claim that a hand-written example set is bad at testing, because the
//! interesting failures come from fragments interacting.
//!
//! No external generator crate is used. A small linear congruential generator
//! gives a fixed, reproducible sequence, which means a failure here is a
//! failure anyone can reproduce from the seed alone rather than a flake.

use prose_sanitiser_core::{Check, Config, Fix};

use crate::UkEnglish;

/// A reproducible pseudo-random source.
///
/// Numerical Recipes' LCG constants. Cryptographically worthless and entirely
/// adequate for shuffling test fragments.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.next() as usize % items.len()]
    }
}

/// Fragments that must never be modified, and that work mid-line.
const PROTECTED_INLINE: &[&str] = &[
    "`color: red`",
    "https://example.com/color/center",
    "color.center@example.com",
    "\"the color of the center\"",
    "\u{201C}a color and a center\u{201D}",
    "The World Health Organization",
    "the Department of Defense",
    "sulfur dioxide and a fetus",
    "the dialog box and the disk",
    "a colorimeter reading",
];

/// Fragments that must never be modified, but only when they start a line.
///
/// CommonMark recognises a fence or a blockquote marker only at the start of a
/// line, so these are laid out that way. A mid-line ``` really is not a fence,
/// and asserting otherwise would test a rule the format does not have.
const PROTECTED_BLOCK: &[&str] = &[
    "```\ncolor center theater\n```",
    "> The color of the center.",
];

/// Fragments that are ordinary prose, some of it American.
const PROSE: &[&str] = &[
    "The color was wrong.",
    "We optimize things here.",
    "The centre held.",
    "Nothing to see.",
    "They traveled far.",
    "A gas meter reading.",
    "The computer program ran.",
    "She wrote a check to the bank.",
    "Order fulfillment matters.",
];

/// Every protected fragment, whatever its placement rules.
fn protected_fragments() -> impl Iterator<Item = &'static &'static str> {
    PROTECTED_INLINE.iter().chain(PROTECTED_BLOCK)
}

/// Build a document from `count` fragments.
fn generate(rng: &mut Rng, count: usize) -> String {
    let mut document = String::new();
    for index in 0..count {
        match rng.next() % 6 {
            0 | 1 => {
                document.push_str(rng.pick(PROTECTED_INLINE));
                document.push_str(if index % 3 == 2 { "\n\n" } else { " " });
            }
            2 => {
                // Isolated on its own lines, as the format requires.
                if !document.is_empty() && !document.ends_with("\n\n") {
                    document.push_str("\n\n");
                }
                document.push_str(rng.pick(PROTECTED_BLOCK));
                document.push_str("\n\n");
            }
            _ => {
                document.push_str(rng.pick(PROSE));
                document.push_str(if index % 3 == 2 { "\n\n" } else { " " });
            }
        }
    }
    document
}

#[test]
fn a_fix_never_touches_an_excluded_span() {
    let checker = UkEnglish::new();
    let mut rng = Rng(0x5EED_1234_ABCD_0001);

    for iteration in 0..600 {
        let document = generate(&mut rng, 1 + (iteration % 8));
        let exclusions = checker.exclusions(&document);

        for config in [
            Config::new().with_write(true),
            Config::new().with_write(true).with_oxford(true),
        ] {
            let (findings, patch) = checker.check_and_fix(&document, &config);

            for finding in &findings {
                assert!(
                    !exclusions.blocks(finding.span),
                    "finding {:?} sits inside an excluded span in {document:?}",
                    finding.matched
                );
                assert_eq!(
                    finding.span.slice(&document),
                    Some(finding.matched.as_str()),
                    "span does not address its own match in {document:?}"
                );
            }

            for edit in patch.edits() {
                assert!(
                    !exclusions.blocks(edit.span),
                    "edit at {:?} sits inside an excluded span in {document:?}",
                    edit.span
                );
            }

            // A patch built from a live document must always apply.
            assert!(
                patch.apply(&document).is_some(),
                "patch failed to apply to {document:?}"
            );
        }
    }
}

#[test]
fn protected_fragments_survive_a_rewrite_byte_for_byte() {
    let checker = UkEnglish::new();
    let mut rng = Rng(0x5EED_1234_ABCD_0002);
    let config = Config::new().with_write(true);

    for iteration in 0..600 {
        let document = generate(&mut rng, 1 + (iteration % 8));
        let (findings, patch) = checker.check_and_fix(&document, &config);
        let rewritten = patch.apply(&document).expect("the patch applies");

        for fragment in protected_fragments() {
            let before = document.matches(fragment).count();
            let after = rewritten.matches(fragment).count();
            assert_eq!(
                before,
                after,
                "fragment {fragment:?} was altered.\nbefore: {document:?}\nafter:  {rewritten:?}\n\
                 findings: {:?}",
                findings.iter().map(|f| &f.matched).collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn checking_is_idempotent_under_its_own_fixes() {
    // Applying every fix the checker offers must leave nothing it still wants
    // to fix, or the rules contradict each other.
    let checker = UkEnglish::new();
    let mut rng = Rng(0x5EED_1234_ABCD_0003);
    let config = Config::new().with_write(true);

    for iteration in 0..300 {
        let document = generate(&mut rng, 1 + (iteration % 6));
        let (_, patch) = checker.check_and_fix(&document, &config);
        let rewritten = patch.apply(&document).expect("the patch applies");
        let (_, again) = checker.check_and_fix(&rewritten, &config);
        assert!(
            again.is_empty(),
            "a second pass still wanted {:?} in {rewritten:?}",
            again.edits()
        );
    }
}

#[test]
fn checking_never_panics_on_awkward_input() {
    let checker = UkEnglish::new();
    for document in [
        "\u{FEFF}color",
        "color\u{200B}center",
        "\u{201C}color",
        "```",
        "---",
        "`",
        "\"\"\"color\"\"\"",
        "na\u{00EF}ve color caf\u{00E9}",
        "\u{4F60}\u{597D} color",
        "color's colors' color\u{2019}s",
    ] {
        let _ = checker.check(document, &Config::new());
    }
}
