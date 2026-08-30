//! Verdict parsing and finding sanitisation for evaluator reports.
//!
//! An evaluator report is free-form markdown produced by an LLM. Two facts must
//! be extracted deterministically:
//!
//! * the [`Verdict`] — did the experiment ACCEPT, REJECT, or come out
//!   INCONCLUSIVE, and
//! * a short human-readable finding suitable for a single markdown table cell.
//!
//! [`parse_verdict`] applies a strict priority order so that a stray keyword in
//! the report body can never override an explicit trailing `VERDICT:` line — a
//! false-positive that bit us in production (see the regression test).

/// The outcome of an evaluated experiment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Accept,
    Reject,
    Inconclusive,
    /// The environment (annexe checkout, evaluators) was broken before the
    /// hypothesis could be tested. Distinct from Inconclusive: it never
    /// counts toward a repo's dry streak — a broken harness must not park a
    /// healthy repo — and it is raised by the engine's pre-flight probe, not
    /// parsed from an LLM report.
    BlockedEnv,
}

impl Verdict {
    /// The canonical uppercase spelling used in the ledger and prompts.
    pub fn as_str(&self) -> &'static str {
        match self {
            Verdict::Accept => "ACCEPT",
            Verdict::Reject => "REJECT",
            Verdict::Inconclusive => "INCONCLUSIVE",
            Verdict::BlockedEnv => "BLOCKED-ENV",
        }
    }

    /// True for a decisive verdict (Accept or Reject), false for Inconclusive.
    pub fn is_significant(&self) -> bool {
        matches!(self, Verdict::Accept | Verdict::Reject)
    }
}

/// The uppercase keywords, matched case-sensitively.
const KEYWORDS: [(&str, Verdict); 3] = [
    ("ACCEPT", Verdict::Accept),
    ("REJECT", Verdict::Reject),
    ("INCONCLUSIVE", Verdict::Inconclusive),
];

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// An exact, whole-token match against a single keyword (e.g. `"REJECT"`).
fn keyword_exact(token: &str) -> Option<Verdict> {
    KEYWORDS
        .iter()
        .find(|(kw, _)| *kw == token)
        .map(|(_, v)| *v)
}

/// All standalone (word-boundary) keyword occurrences in `text`, sorted by
/// byte position. A match embedded in a longer identifier is ignored.
fn standalone_matches(text: &str) -> Vec<(usize, Verdict)> {
    let mut out = Vec::new();
    for (kw, v) in KEYWORDS.iter() {
        for (i, _) in text.match_indices(*kw) {
            let before_ok = i == 0
                || text[..i]
                    .chars()
                    .next_back()
                    .map(|c| !is_word_char(c))
                    .unwrap_or(true);
            let after_idx = i + kw.len();
            let after_ok = after_idx >= text.len()
                || text[after_idx..]
                    .chars()
                    .next()
                    .map(|c| !is_word_char(c))
                    .unwrap_or(true);
            if before_ok && after_ok {
                out.push((i, *v));
            }
        }
    }
    out.sort_by_key(|(i, _)| *i);
    out
}

fn first_keyword(text: &str) -> Option<Verdict> {
    standalone_matches(text).first().map(|(_, v)| *v)
}

fn last_keyword(text: &str) -> Option<Verdict> {
    standalone_matches(text).last().map(|(_, v)| *v)
}

/// Parse the authoritative verdict from a free-form evaluator report.
///
/// Priority order (each step only reached if the earlier ones find nothing):
/// 1. the LAST line whose trimmed text starts with `VERDICT:` — the keyword
///    after the colon wins;
/// 2. a `## VERDICT` markdown section — the first keyword inside it;
/// 3. a `verdict=` field anywhere — its immediate value;
/// 4. the LAST standalone keyword occurrence anywhere in the report;
/// 5. otherwise [`Verdict::Inconclusive`].
pub fn parse_verdict(report: &str) -> Verdict {
    // 1. Last explicit "VERDICT:" line.
    let mut last_verdict_line: Option<&str> = None;
    for line in report.lines() {
        if line.trim_start().starts_with("VERDICT:") {
            last_verdict_line = Some(line);
        }
    }
    if let Some(line) = last_verdict_line {
        let after = &line.trim_start()["VERDICT:".len()..];
        if let Some(v) = first_keyword(after) {
            return v;
        }
    }

    // 2. "## VERDICT" markdown section.
    if let Some(v) = verdict_section(report) {
        return v;
    }

    // 3. "verdict=" field.
    if let Some(v) = verdict_field(report) {
        return v;
    }

    // 4. Last standalone keyword anywhere.
    if let Some(v) = last_keyword(report) {
        return v;
    }

    // 5. Nothing decisive.
    Verdict::Inconclusive
}

/// Extract the verdict from a `## VERDICT` section, if present. The section runs
/// from the heading line up to (but not including) the next `##` heading.
fn verdict_section(report: &str) -> Option<Verdict> {
    let mut in_section = false;
    let mut section = String::new();
    for line in report.lines() {
        let trimmed = line.trim_start();
        if in_section {
            if trimmed.starts_with("##") {
                break;
            }
            section.push_str(line);
            section.push('\n');
        } else if trimmed.starts_with("## VERDICT") {
            in_section = true;
            section.push_str(line);
            section.push('\n');
        }
    }
    if in_section {
        first_keyword(&section)
    } else {
        None
    }
}

/// Extract the immediate value of a `verdict=` field, e.g. `verdict=REJECT`.
fn verdict_field(report: &str) -> Option<Verdict> {
    let idx = report.find("verdict=")?;
    let after = &report[idx + "verdict=".len()..];
    let value: String = after.chars().take_while(|c| is_word_char(*c)).collect();
    keyword_exact(&value)
}

/// Strip leading blockquote/list/backtick markers and trailing decoration from a
/// markdown line, returning the plain text.
fn strip_markdown(line: &str) -> String {
    let mut t = line.trim();
    loop {
        let stripped = t.trim_start_matches([' ', '>', '*', '-', '`']);
        if stripped == t {
            break;
        }
        t = stripped;
    }
    t.trim_end_matches([' ', '`', '*']).to_string()
}

/// Collapse a candidate finding to a table-safe single line: pipes stripped,
/// whitespace collapsed. Length is bounded by the callers, not here.
fn finalize(s: &str) -> String {
    let no_pipe = s.replace('|', "");
    no_pipe.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Upper bound for the full finding (memory rows, PR bodies). Generous enough
/// to never lose a real hypothesis; a bound at all so a runaway report line
/// cannot bloat the memory row or embedding input.
const FINDING_FULL_MAX: usize = 1000;

/// Extract the text after the first colon in `line`, or the whole line if there
/// is none.
fn after_colon(line: &str) -> &str {
    match line.find(':') {
        Some(i) => &line[i + 1..],
        None => line,
    }
}

/// Produce a short single-line finding (≤80 chars) for a markdown table cell.
///
/// Preference order:
/// 1. the frozen hypothesis — the first line whose (markdown-stripped) text
///    starts with `Given `;
/// 2. a `**Main lesson:**` line — the text after the colon;
/// 3. a `**Finding:**` line — the text after the colon;
/// 4. for an inconclusive verdict, the literal `INCONCLUSIVE — see report`;
/// 5. otherwise the first non-empty, non-heading line.
///
/// The chosen text is then whitespace-collapsed, stripped of `|`, and truncated
/// to 80 characters.
pub fn sanitise_finding(report: &str, verdict: Verdict) -> String {
    select_finding(report, verdict).chars().take(80).collect()
}

/// The same finding selection as [`sanitise_finding`], without the 80-char
/// ledger-cell cap. Used for RuVector memory rows and PR bodies, where the
/// audit trail should carry the whole hypothesis (bounded at
/// [`FINDING_FULL_MAX`] chars).
pub fn sanitise_finding_full(report: &str, verdict: Verdict) -> String {
    select_finding(report, verdict)
        .chars()
        .take(FINDING_FULL_MAX)
        .collect()
}

/// Select and collapse the finding line per the preference order documented on
/// [`sanitise_finding`]; unbounded length.
fn select_finding(report: &str, verdict: Verdict) -> String {
    // 1. Frozen hypothesis ("Given ..."). Inline bold ("**Given** the ...")
    //    leaves a `**` after the word once the prefix is stripped, so drop
    //    embedded emphasis markers before matching.
    for line in report.lines() {
        let stripped = strip_markdown(line).replace("**", "");
        if stripped.starts_with("Given ") {
            return finalize(&stripped);
        }
    }

    // 2. Main lesson.
    for line in report.lines() {
        if line.contains("Main lesson:") {
            let text = strip_markdown(after_colon(line));
            if !text.is_empty() {
                return finalize(&text);
            }
        }
    }

    // 3. Finding.
    for line in report.lines() {
        if line.contains("Finding:") {
            let text = strip_markdown(after_colon(line));
            if !text.is_empty() {
                return finalize(&text);
            }
        }
    }

    // 4. Inconclusive fallback.
    if verdict == Verdict::Inconclusive {
        return "INCONCLUSIVE — see report".to_string();
    }

    // 5. First non-empty, non-heading line.
    for line in report.lines() {
        let stripped = strip_markdown(line);
        if !stripped.is_empty() && !line.trim_start().starts_with('#') {
            return finalize(&stripped);
        }
    }

    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdict_str_and_significance() {
        assert_eq!(Verdict::Accept.as_str(), "ACCEPT");
        assert_eq!(Verdict::Reject.as_str(), "REJECT");
        assert_eq!(Verdict::Inconclusive.as_str(), "INCONCLUSIVE");
        assert!(Verdict::Accept.is_significant());
        assert!(Verdict::Reject.is_significant());
        assert!(!Verdict::Inconclusive.is_significant());
    }

    #[test]
    fn parses_trailing_verdict_line() {
        let report = "some analysis\nVERDICT: ACCEPT\n";
        assert_eq!(parse_verdict(report), Verdict::Accept);
    }

    #[test]
    fn last_verdict_line_wins() {
        let report = "VERDICT: ACCEPT\nmore thought\nVERDICT: REJECT\n";
        assert_eq!(parse_verdict(report), Verdict::Reject);
    }

    #[test]
    fn verdict_line_tolerates_punctuation_and_indent() {
        let report = "  VERDICT:   REJECT.\n";
        assert_eq!(parse_verdict(report), Verdict::Reject);
    }

    /// Regression: a keyword buried mid-document must not beat the explicit
    /// trailing `VERDICT:` line. This was a real production false positive.
    #[test]
    fn mid_document_keyword_does_not_override_trailing_verdict_line() {
        let report = "\
# Report
We explored whether ACCEPT is unreachable tonight given the constraints.
Detailed reasoning shows several REJECT-like signals but nothing conclusive.

VERDICT: INCONCLUSIVE
";
        assert_eq!(parse_verdict(report), Verdict::Inconclusive);
    }

    #[test]
    fn parses_verdict_section() {
        let report = "\
# Analysis
lots of text mentioning nothing decisive here

## VERDICT
After weighing the evidence: ACCEPT

## Next steps
do more
";
        assert_eq!(parse_verdict(report), Verdict::Accept);
    }

    #[test]
    fn parses_verdict_field() {
        let report = "meta line verdict=REJECT trailing";
        assert_eq!(parse_verdict(report), Verdict::Reject);
    }

    #[test]
    fn falls_back_to_last_standalone_keyword() {
        let report = "notes: ACCEPT considered, then REJECT considered";
        assert_eq!(parse_verdict(report), Verdict::Reject);
    }

    #[test]
    fn embedded_keyword_is_not_a_match() {
        // "ACCEPTED" / "REJECTED" are longer words and must not match.
        let report = "The change was ACCEPTED and later REJECTED by review.";
        assert_eq!(parse_verdict(report), Verdict::Inconclusive);
    }

    #[test]
    fn defaults_to_inconclusive() {
        assert_eq!(
            parse_verdict("nothing decisive here"),
            Verdict::Inconclusive
        );
    }

    #[test]
    fn sanitise_prefers_given_hypothesis() {
        let report = "\
# Experiment
```text
Given a cold cache, the second request should be faster than the first.
```
More prose here.
**Main lesson:** something else entirely
";
        let finding = sanitise_finding(report, Verdict::Accept);
        assert_eq!(
            finding,
            "Given a cold cache, the second request should be faster than the first."
        );
    }

    #[test]
    fn sanitise_strips_blockquote_from_given() {
        let report = "> Given the flag is off, no requests should be made.";
        let finding = sanitise_finding(report, Verdict::Reject);
        assert_eq!(
            finding,
            "Given the flag is off, no requests should be made."
        );
    }

    #[test]
    fn sanitise_uses_main_lesson() {
        let report = "# Report\nno hypothesis line\n- **Main lesson:** cache warming pays off\n";
        let finding = sanitise_finding(report, Verdict::Accept);
        assert_eq!(finding, "cache warming pays off");
    }

    #[test]
    fn sanitise_uses_finding_line() {
        let report = "# Report\n**Finding:** the retry loop never terminates\n";
        let finding = sanitise_finding(report, Verdict::Reject);
        assert_eq!(finding, "the retry loop never terminates");
    }

    #[test]
    fn sanitise_inconclusive_fallback() {
        let report = "# Report\n## Details\n";
        let finding = sanitise_finding(report, Verdict::Inconclusive);
        assert_eq!(finding, "INCONCLUSIVE — see report");
    }

    #[test]
    fn sanitise_first_non_heading_line() {
        let report = "# Heading\n\nThe system behaved as expected under load.\n";
        let finding = sanitise_finding(report, Verdict::Accept);
        assert_eq!(finding, "The system behaved as expected under load.");
    }

    #[test]
    fn sanitise_full_keeps_whole_hypothesis_past_80_chars() {
        let hypothesis = format!("Given {}", "a long clause ".repeat(12).trim_end());
        let report = format!("{hypothesis}\nVERDICT: ACCEPT\n");
        assert!(hypothesis.chars().count() > 80);
        assert_eq!(sanitise_finding_full(&report, Verdict::Accept), hypothesis);
        // Cell variant is the same text, capped.
        assert_eq!(
            sanitise_finding(&report, Verdict::Accept),
            hypothesis.chars().take(80).collect::<String>()
        );
        // Full variant is still bounded.
        let runaway = format!("Given {}\nVERDICT: ACCEPT\n", "x ".repeat(2000));
        assert!(sanitise_finding_full(&runaway, Verdict::Accept).chars().count() <= 1000);
    }

    #[test]
    fn sanitise_is_table_safe_and_truncated() {
        let long = "Given ".to_string() + &"x ".repeat(100) + "| pipe | here";
        let finding = sanitise_finding(&long, Verdict::Accept);
        assert!(finding.chars().count() <= 80);
        assert!(!finding.contains('|'));
        assert!(!finding.contains('\n'));
    }

    #[test]
    fn sanitise_matches_bold_hypothesis() {
        // Real GLM output (loom night, witness 047e2fbc): inline bold around
        // the keywords defeated the prefix strip and fell through to the
        // "INCONCLUSIVE — see report" fallback.
        let report = "> **Given** the `tests/` suite of DreamLab-AI/loom, **when** pytest runs, **then** zero tests exercise triple-loading.\n\nVERDICT: INCONCLUSIVE";
        let finding = sanitise_finding(report, Verdict::Inconclusive);
        assert!(finding.starts_with("Given the"), "got: {finding}");
    }
}
