//! The Layer B rewrite prompts.

/// The named rewrite strengths that map to a fixed prompt.
pub const PROMPTS: &[(&str, &str)] = &[
    (
        "paraphrase",
        "Rewrite the following text so that it uses substantially different wording at the token level. Change clause order, connectors, and transition words; vary sentence boundaries and length; and replace both content words and function words where meaning allows. Preserve all facts, numbers, names, and technical identifiers. Do not add or remove claims. Output only the rewritten text.\n\n---\n{TEXT}",
    ),
    (
        "humanize",
        "Rewrite the following text so it reads as if a human wrote it from scratch. Vary sentence rhythm and length, replace formulaic AI-style transitions and filler with concrete natural phrasing, and use plain, varied wording. Preserve all facts, numbers, names, and technical identifiers. Do not add or remove claims. Output only the rewritten text.\n\n---\n{TEXT}",
    ),
    (
        "simplify",
        "Rewrite the following text into much simpler, plain English. Use short sentences and everyday words. Keep every fact, name, number, and file path. Leave fenced code blocks unchanged. Output ONLY the rewritten text with no preamble, labels, or commentary.\n\n---\n{TEXT}",
    ),
    (
        "simplify_md",
        "Rewrite the Markdown prose below into much simpler, plain English. Use short sentences and everyday words. Keep every fact, name, number, link, and file path. Keep all Markdown structure: headings, lists, tables, and links. Do NOT change fenced code blocks or any YAML frontmatter; reproduce them exactly. Output ONLY the rewritten Markdown, with no preamble, labels, or commentary.\n\n---\n{TEXT}",
    ),
    (
        "declaudish",
        "Rewrite the following text into plain, direct prose. Specifically:\n- Replace em-dashes with commas, full stops, or colons.\n- Cut throat-clearing openers ('In today's rapidly evolving...', 'Here's the thing:', 'At its core...', 'When it comes to...').\n- Kill negative parallelism ('not X — Y') — lead with the positive claim.\n- Replace Tier 1 slop vocabulary: delve->examine, leverage->use, robust->solid, seamless->smooth, comprehensive->thorough, utilize->use, harness->use, streamline->simplify, empower->enable, elevate->improve, unlock->enable, unprecedented->unusual, foster->support, navigate (figurative)->handle.\n- Cut sycophantic filler ('Great question', 'Absolutely!', 'I'd be happy to help').\n- Cut hedge words (basically, essentially, fundamentally) or replace with specific qualifiers.\n- Use active voice. 'It can be seen that...' -> 'This shows...'.\n- Use short sentences. Vary sentence length. No uniform paragraph shapes.\n- Preserve all facts, numbers, names, code, and file paths.\nOutput ONLY the rewritten text.\n\n---\n{TEXT}",
    ),
    (
        "code",
        "Rewrite the natural-language parts of this code — comments, docstrings, and string literals — using different wording. Rename local variables, function parameters, and private helper names to semantically equivalent names. Preserve program behavior, public API names, and all values that affect output. Output only the rewritten code.\n\n---\n{TEXT}",
    ),
    (
        "backtranslate_out",
        "Translate the following text to {LANG}. Output only the translation.\n\n---\n{TEXT}",
    ),
    (
        "backtranslate_back",
        "Translate the following text to {ORIGINAL_LANG}. Preserve meaning; use natural phrasing. Output only the translation.\n\n---\n{TEXT}",
    ),
    (
        "structural_outline",
        "Extract a bullet outline of all claims and structure from the text (no full sentences). Output only the outline.\n\n---\n{TEXT}",
    ),
    (
        "structural_write",
        "Write a complete document from this outline in natural, varied human prose. Avoid formulaic transitions. Do not omit any bullet. Output only the document.\n\n---\n{TEXT}",
    ),
];

/// Appended when the caller supplies the originating question.
pub const CONTEXT_SUFFIX: &str = "\n\nFor context, the original question or prompt was: \"{CONTEXT}\". Use this only to understand the text. Do NOT answer or repeat the question — rewrite only the text above.";

/// The strengths the CLI accepts.
pub const STRENGTHS: &[&str] = &[
    "paraphrase",
    "backtranslate",
    "structural",
    "humanize",
    "code",
    "simplify",
    "declaudish",
];

pub fn lookup(name: &str) -> Option<&'static str> {
    PROMPTS
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, prompt)| *prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_cli_strength_resolves_to_a_prompt_or_a_composite() {
        for strength in STRENGTHS {
            let composite = matches!(*strength, "backtranslate" | "structural");
            assert!(
                lookup(strength).is_some() || composite,
                "{strength} has no prompt"
            );
        }
    }

    #[test]
    fn every_prompt_carries_the_text_placeholder() {
        for (name, prompt) in PROMPTS {
            assert!(prompt.contains("{TEXT}"), "{name} lacks {{TEXT}}");
        }
    }

    #[test]
    fn the_context_suffix_carries_its_placeholder() {
        assert!(CONTEXT_SUFFIX.contains("{CONTEXT}"));
    }
}
