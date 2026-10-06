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
    /// The nomination was refused before scheduling because no usable
    /// evaluator covers tonight's deep (ADR-2024 closeout, evaluator-readiness
    /// admission). Like [`Verdict::BlockedEnv`] this is operational state, not
    /// a claim about the repository: no evaluator ran and no model was called.
    Handoff,
}

impl Verdict {
    /// The canonical uppercase spelling used in the ledger and prompts.
    pub fn as_str(&self) -> &'static str {
        match self {
            Verdict::Accept => "ACCEPT",
            Verdict::Reject => "REJECT",
            Verdict::Inconclusive => "INCONCLUSIVE",
            Verdict::BlockedEnv => "BLOCKED-ENV",
            Verdict::Handoff => "HANDOFF",
        }
    }

    /// True for a decisive verdict (Accept or Reject), false for Inconclusive.
    pub fn is_significant(&self) -> bool {
        matches!(self, Verdict::Accept | Verdict::Reject)
    }
}

/// Parse a canonical ledger label back into a [`Verdict`].
///
/// The inverse of [`Verdict::as_str`], used when a restart reads a completed
/// run's recorded verdict out of the journal. Anything unrecognised reads as
/// `Inconclusive` — never as an acceptance.
pub fn from_label(label: &str) -> Verdict {
    match label.trim().to_ascii_uppercase().as_str() {
        "ACCEPT" => Verdict::Accept,
        "REJECT" => Verdict::Reject,
        "BLOCKED-ENV" => Verdict::BlockedEnv,
        "HANDOFF" => Verdict::Handoff,
        _ => Verdict::Inconclusive,
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

/// Why a strict parse refused to name a verdict.
///
/// Every variant is a *refusal*, never a silent default: [`parse_verdict_strict`]
/// is the only parse the acceptance gate consults, so anything it cannot read
/// unambiguously must fail closed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VerdictParseError {
    #[error("no `VERDICT:` declaration line in the report")]
    Missing,
    #[error("conflicting VERDICT declarations: {0:?}")]
    Ambiguous(Vec<String>),
    #[error("unrecognised verdict token {0:?}")]
    Unknown(String),
    #[error("VERDICT line is not a bare token: {0:?}")]
    Noisy(String),
}

/// Every token a `VERDICT:` line may legally carry.
const STRICT_TOKENS: [(&str, Verdict); 5] = [
    ("ACCEPT", Verdict::Accept),
    ("REJECT", Verdict::Reject),
    ("INCONCLUSIVE", Verdict::Inconclusive),
    ("BLOCKED-ENV", Verdict::BlockedEnv),
    ("HANDOFF", Verdict::Handoff),
];

/// Strict, typed verdict parse — the only reading the acceptance gate trusts.
///
/// [`parse_verdict`] is deliberately forgiving: it will hunt through prose for
/// the last standalone keyword so that a rambling report still yields a ledger
/// row. That forgiveness is exactly what let a report carrying failure text
/// arrive at ACCEPT (ADR-2024 closeout), so acceptance uses this parse instead.
///
/// The contract is narrow and mechanical:
///
/// * the report must contain at least one line whose trimmed text begins
///   `VERDICT:` (case-sensitive);
/// * what follows the colon must be exactly one token — an uppercase keyword,
///   optionally wrapped in markdown emphasis or backticks and optionally
///   followed by a single sentence-ending `.`, `!` or `,`. Trailing prose is a
///   refusal, not a hint;
/// * every such line must name the same verdict.
///
/// Anything else returns a [`VerdictParseError`]. Callers must map an error to
/// a non-accepting verdict; there is no default.
pub fn parse_verdict_strict(report: &str) -> Result<Verdict, VerdictParseError> {
    let mut seen: Vec<(String, Verdict)> = Vec::new();
    for line in report.lines() {
        let trimmed = line.trim();
        // Tolerate the markdown decoration real reports use around the line
        // itself ("> **VERDICT:** ACCEPT") without loosening the token rule.
        let bare = trimmed
            .trim_start_matches(['>', '*', '-', '#', ' ', '`'])
            .trim_start();
        let bare = bare.strip_prefix("**").unwrap_or(bare);
        if !bare.starts_with("VERDICT:") {
            continue;
        }
        let after = bare["VERDICT:".len()..].trim();
        let after = after.trim_start_matches("**").trim();
        let token = normalise_token(after).ok_or_else(|| VerdictParseError::Noisy(after.into()))?;
        let verdict = STRICT_TOKENS
            .iter()
            .find(|(t, _)| *t == token)
            .map(|(_, v)| *v)
            .ok_or_else(|| VerdictParseError::Unknown(token.clone()))?;
        seen.push((token, verdict));
    }
    match seen.split_first() {
        None => Err(VerdictParseError::Missing),
        Some((first, rest)) => {
            if rest.iter().any(|(_, v)| *v != first.1) {
                let mut names: Vec<String> = seen.iter().map(|(t, _)| t.clone()).collect();
                names.dedup();
                return Err(VerdictParseError::Ambiguous(names));
            }
            Ok(first.1)
        }
    }
}

/// Reduce the text after `VERDICT:` to a bare uppercase token, or `None` if it
/// carries anything else.
fn normalise_token(after: &str) -> Option<String> {
    let cleaned = after
        .trim()
        .trim_start_matches(['`', '*'])
        .trim_end_matches(['.', '!', ',', ' ', '`', '*'])
        .trim();
    if cleaned.is_empty() {
        return None;
    }
    let ok = cleaned
        .chars()
        .all(|c| c.is_ascii_uppercase() || c == '-');
    if ok {
        Some(cleaned.to_string())
    } else {
        None
    }
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
/// 0. the finding cell of the ledger row the report proposes for tonight —
///    a row dated `night_date`, bare or wrapped in backticks — when it
///    satisfies the row contract;
/// 1. a contract-satisfying `Finding:` line;
/// 2. the [`select_finding`] heuristics (frozen hypothesis, `Main lesson:`,
///    `Finding:`, the INCONCLUSIVE fallback, the first prose line).
///
/// The chosen text is whitespace-collapsed, stripped of `|`, and truncated to
/// 80 characters. Steps 0 and 1 already satisfy the row contract; step 2 may
/// not (a "Given …" hypothesis, the "see report" fallback), which is why the
/// append path re-checks every row with [`finding_violations`].
pub fn sanitise_finding(report: &str, verdict: Verdict, night_date: &str) -> String {
    // 0. The ledger row the report authored itself (Step 19). Every night
    //    since 2026-09-02 wrote a self-contained, ≤80-char finding cell there,
    //    and the engine discarded it for the truncated hypothesis — which is
    //    exactly what the ledger row contract (dream-engine PR #10,
    //    `finding-hypothesis-leak`) rejects. Only tonight's row, and only a
    //    contract-satisfying cell, is taken; anything else falls through to
    //    the older heuristics.
    if let Some(cell) = report_ledger_row_finding(report, night_date) {
        return cell;
    }
    // 1. A self-contained `Finding:` line that satisfies the contract.
    for line in report.lines() {
        if line.contains("Finding:") {
            let text = finalize(&strip_markdown(after_colon(line)));
            if ledger_cell_ok(&text) {
                return text;
            }
        }
    }
    select_finding(report, verdict).chars().take(80).collect()
}

/// Maximum finding-cell length, counted as the contract counts it: UTF-16
/// code units (JavaScript `String.length`), not Rust chars.
pub const FINDING_MAX_UTF16: usize = 80;

/// The rules a ledger finding cell breaks, named as dream-machine's
/// `packages/ledger/src/rowContract.ts` names them (`finding-empty`,
/// `finding-too-long`, `finding-pointer`, `finding-hypothesis-leak`).
///
/// This is the engine's only implementation of the finding rules; the
/// row-level check ([`crate::ledger::row_violations`]) builds on it. The cell
/// is trimmed first, as the TypeScript parser trims every cell.
pub fn finding_violations(cell: &str) -> Vec<&'static str> {
    let cell = cell.trim();
    let lower = cell.to_ascii_lowercase();
    let mut out = Vec::new();
    if cell.is_empty() {
        out.push("finding-empty");
    }
    if cell.encode_utf16().count() > FINDING_MAX_UTF16 {
        out.push("finding-too-long");
    }
    // /\bsee\s+(report|gist)\b/i  ||  /^(see|gist)\b/i
    if contains_see_pointer(&lower) || starts_with_word(&lower, "see") || starts_with_word(&lower, "gist") {
        out.push("finding-pointer");
    }
    // /^given\b/i
    if starts_with_word(&lower, "given") {
        out.push("finding-hypothesis-leak");
    }
    out
}

/// True when `cell` satisfies every finding rule of the row contract.
pub fn ledger_cell_ok(cell: &str) -> bool {
    finding_violations(cell).is_empty()
}

/// A JavaScript `\w` character (ASCII letters, digits, underscore).
fn js_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `^word\b` on already-lowercased text.
fn starts_with_word(lower: &str, word: &str) -> bool {
    lower
        .strip_prefix(word)
        .is_some_and(|rest| !rest.chars().next().is_some_and(js_word))
}

/// `\bsee\s+(report|gist)\b` on already-lowercased text.
fn contains_see_pointer(lower: &str) -> bool {
    lower.match_indices("see").any(|(i, _)| {
        if lower[..i].chars().next_back().is_some_and(js_word) {
            return false;
        }
        let rest = &lower[i + 3..];
        let after_ws = rest.trim_start();
        if after_ws.len() == rest.len() {
            return false; // `\s+` needs at least one whitespace char
        }
        ["report", "gist"].iter().any(|w| starts_with_word(after_ws, w))
    })
}

/// Truncate `s` to at most `max` chars at a word boundary, ending in `…` when
/// anything was cut. A single word longer than `max` is cut mid-word.
pub fn clip_words(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    // Leave room for the ellipsis.
    let budget: String = s.chars().take(max - 1).collect();
    let next_is_break = s.chars().nth(max - 1).is_some_and(char::is_whitespace);
    let head = if next_is_break {
        budget.trim_end()
    } else {
        match budget.rfind(char::is_whitespace) {
            Some(i) if !budget[..i].trim().is_empty() => budget[..i].trim_end(),
            _ => budget.trim_end(),
        }
    };
    let head = head.trim_end_matches([',', ';', ':', '—', '-', ' ']);
    format!("{head}…")
}

/// The finding cell of tonight's ledger row in the report — the row the model
/// is asked to propose at Step 19 — when that cell satisfies the contract.
///
/// A ledger row is a `|`-delimited line with at least ten cells; it may be
/// wrapped in backticks or quoted as a blockquote, which is how reports
/// usually present it. Only a row whose date cell equals `night_date` counts:
/// a report quotes earlier nights' rows (patch context, ledger excerpts), and
/// taking one of those would write a previous night's result under tonight's
/// date.
fn report_ledger_row_finding(report: &str, night_date: &str) -> Option<String> {
    for line in report.lines() {
        let t = line
            .trim()
            .trim_start_matches(['>', ' '])
            .trim_matches('`')
            .trim();
        if !t.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = t.split('|').map(str::trim).collect();
        if cells.len() < 12 || cells[1] != night_date {
            continue;
        }
        let finding = finalize(cells[3]);
        if ledger_cell_ok(&finding) {
            return Some(finding);
        }
    }
    None
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

    /// The night date the sanitiser tests run under.
    const NIGHT: &str = "2026-09-07";

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
        let finding = sanitise_finding(report, Verdict::Accept, NIGHT);
        assert_eq!(
            finding,
            "Given a cold cache, the second request should be faster than the first."
        );
    }

    /// 2026-09-07: the report's own Step-19 row wins over the hypothesis.
    #[test]
    fn sanitise_prefers_the_reports_own_ledger_row_cell() {
        let report = "\
> Given the `sovereign-mesh-bridge` entrypoint pipes cargo through `tail`, when cargo aborts, then the harness still records PASSED.

### Step 19 — Ledger row (appended in annexe clone)

```
| 2026-09-07 | sovereign-mesh | sovereign-mesh-bridge PASS is pipe-masked (cargo dep err, exit=0): FALLBACK rule | NONE | NONE | yes | ACCEPT | docs-only marker | BLOCKED | |
```
VERDICT: ACCEPT
";
        assert_eq!(
            sanitise_finding(report, Verdict::Accept, NIGHT),
            "sovereign-mesh-bridge PASS is pipe-masked (cargo dep err, exit=0): FALLBACK rule"
        );
        // The full variant still carries the whole hypothesis for memory/PR bodies.
        assert!(sanitise_finding_full(report, Verdict::Accept).starts_with("Given the"));
    }

    /// A Step-19 cell that itself leaks the hypothesis, points elsewhere or
    /// overruns the cell is ignored, and the older heuristics apply.
    #[test]
    fn sanitise_ignores_a_ledger_row_cell_that_breaks_the_contract() {
        let leak = "| 2026-09-07 | x | Given the annexe clone lacks the siblings, when… | NONE | NONE | yes | ACCEPT |  | abc |  |\n**Finding:** siblings absent on the annexe\n";
        assert_eq!(
            sanitise_finding(leak, Verdict::Accept, NIGHT),
            "siblings absent on the annexe"
        );
        let pointer = "| 2026-09-07 | x | INCONCLUSIVE — see report | NONE | NONE | yes | INCONCLUSIVE |  | abc |  |\n";
        assert_eq!(
            sanitise_finding(pointer, Verdict::Inconclusive, NIGHT),
            "INCONCLUSIVE — see report"
        );
        let long = format!(
            "| 2026-09-07 | x | {} | NONE | NONE | yes | ACCEPT |  | abc |  |\n",
            "y ".repeat(60)
        );
        assert_eq!(
            sanitise_finding(&long, Verdict::Inconclusive, NIGHT),
            "INCONCLUSIVE — see report"
        );
    }

    /// A contract-satisfying `Finding:` line beats the hypothesis for the cell.
    #[test]
    fn sanitise_prefers_a_self_contained_finding_line_over_the_hypothesis() {
        let report = "Given a cold cache, the second request should be faster than the first.\n**Finding:** warm cache halves p50 latency (412ms → 198ms)\n";
        assert_eq!(
            sanitise_finding(report, Verdict::Accept, NIGHT),
            "warm cache halves p50 latency (412ms → 198ms)"
        );
    }

    #[test]
    fn sanitise_strips_blockquote_from_given() {
        let report = "> Given the flag is off, no requests should be made.";
        let finding = sanitise_finding(report, Verdict::Reject, NIGHT);
        assert_eq!(
            finding,
            "Given the flag is off, no requests should be made."
        );
    }

    #[test]
    fn sanitise_uses_main_lesson() {
        let report = "# Report\nno hypothesis line\n- **Main lesson:** cache warming pays off\n";
        let finding = sanitise_finding(report, Verdict::Accept, NIGHT);
        assert_eq!(finding, "cache warming pays off");
    }

    #[test]
    fn sanitise_uses_finding_line() {
        let report = "# Report\n**Finding:** the retry loop never terminates\n";
        let finding = sanitise_finding(report, Verdict::Reject, NIGHT);
        assert_eq!(finding, "the retry loop never terminates");
    }

    #[test]
    fn sanitise_inconclusive_fallback() {
        let report = "# Report\n## Details\n";
        let finding = sanitise_finding(report, Verdict::Inconclusive, NIGHT);
        assert_eq!(finding, "INCONCLUSIVE — see report");
    }

    #[test]
    fn sanitise_first_non_heading_line() {
        let report = "# Heading\n\nThe system behaved as expected under load.\n";
        let finding = sanitise_finding(report, Verdict::Accept, NIGHT);
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
            sanitise_finding(&report, Verdict::Accept, NIGHT),
            hypothesis.chars().take(80).collect::<String>()
        );
        // Full variant is still bounded.
        let runaway = format!("Given {}\nVERDICT: ACCEPT\n", "x ".repeat(2000));
        assert!(sanitise_finding_full(&runaway, Verdict::Accept).chars().count() <= 1000);
    }

    #[test]
    fn sanitise_is_table_safe_and_truncated() {
        let long = "Given ".to_string() + &"x ".repeat(100) + "| pipe | here";
        let finding = sanitise_finding(&long, Verdict::Accept, NIGHT);
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
        let finding = sanitise_finding(report, Verdict::Inconclusive, NIGHT);
        assert!(finding.starts_with("Given the"), "got: {finding}");
    }
    #[test]
    fn strict_accepts_a_single_clean_declaration() {
        assert_eq!(parse_verdict_strict("blah\nVERDICT: ACCEPT\n").unwrap(), Verdict::Accept);
        assert_eq!(parse_verdict_strict("VERDICT: REJECT.").unwrap(), Verdict::Reject);
        assert_eq!(
            parse_verdict_strict("> **VERDICT:** BLOCKED-ENV").unwrap(),
            Verdict::BlockedEnv
        );
        assert_eq!(parse_verdict_strict("VERDICT: `HANDOFF`").unwrap(), Verdict::Handoff);
    }

    #[test]
    fn strict_refuses_a_report_with_no_declaration() {
        // The lenient parser happily mines this for a keyword; the strict one
        // must refuse, because acceptance may not rest on prose archaeology.
        let report = "We think this should ACCEPT given the numbers.";
        assert_eq!(parse_verdict(report), Verdict::Accept);
        assert_eq!(parse_verdict_strict(report), Err(VerdictParseError::Missing));
    }

    #[test]
    fn strict_refuses_trailing_prose_on_the_verdict_line() {
        let e = parse_verdict_strict("VERDICT: ACCEPT because the benchmark improved");
        assert!(matches!(e, Err(VerdictParseError::Noisy(_))), "got {e:?}");
    }

    #[test]
    fn strict_refuses_conflicting_declarations() {
        let report = "VERDICT: ACCEPT\n...\nVERDICT: REJECT\n";
        // The lenient parser resolves this by "last one wins".
        assert_eq!(parse_verdict(report), Verdict::Reject);
        match parse_verdict_strict(report) {
            Err(VerdictParseError::Ambiguous(names)) => {
                assert_eq!(names, vec!["ACCEPT".to_string(), "REJECT".to_string()])
            }
            other => panic!("expected ambiguity, got {other:?}"),
        }
    }

    #[test]
    fn strict_accepts_repeated_agreeing_declarations() {
        assert_eq!(
            parse_verdict_strict("VERDICT: REJECT\nsummary\nVERDICT: REJECT\n").unwrap(),
            Verdict::Reject
        );
    }

    #[test]
    fn strict_refuses_unknown_and_lowercase_tokens() {
        assert_eq!(
            parse_verdict_strict("VERDICT: MAYBE"),
            Err(VerdictParseError::Unknown("MAYBE".into()))
        );
        assert!(matches!(
            parse_verdict_strict("VERDICT: accept"),
            Err(VerdictParseError::Noisy(_))
        ));
        assert!(matches!(
            parse_verdict_strict("VERDICT:"),
            Err(VerdictParseError::Noisy(_))
        ));
    }

    #[test]
    fn handoff_is_a_non_significant_operational_verdict() {
        assert_eq!(Verdict::Handoff.as_str(), "HANDOFF");
        assert!(!Verdict::Handoff.is_significant());
        assert!(!Verdict::BlockedEnv.is_significant());
    }

    #[test]
    fn from_label_round_trips_every_verdict() {
        for v in [
            Verdict::Accept,
            Verdict::Reject,
            Verdict::Inconclusive,
            Verdict::BlockedEnv,
            Verdict::Handoff,
        ] {
            assert_eq!(from_label(v.as_str()), v);
        }
        assert_eq!(from_label("nonsense"), Verdict::Inconclusive);
        assert_eq!(from_label(" accept "), Verdict::Accept);
    }

    /// 2026-10-06 (dream-machine f56ede7, factrail 9669e7b): the night's own
    /// proposed row was wrapped in backticks, so it was skipped and a row
    /// quoted from an EARLIER night (patch context) supplied tonight's finding.
    #[test]
    fn sanitise_takes_tonights_backticked_row_not_an_earlier_nights_quoted_row() {
        let report = "\
```diff
@@ -12,3 +12,4 @@
 | 2026-10-05 | evaluator | candidatesPerGeneration capped at 4 on the annexe | NONE | NONE | yes | REJECT |  | 0123456789ab |  |
```

Proposed ledger row:

`| 2026-10-06 | evaluator | darwin smoke run passes with 8 candidates per generation | NONE | pending | yes | ACCEPT |  | abcdef012345 |  |`

VERDICT: ACCEPT
";
        assert_eq!(
            sanitise_finding(report, Verdict::Accept, "2026-10-06"),
            "darwin smoke run passes with 8 candidates per generation"
        );
    }

    /// A report that quotes only earlier nights' rows has no row for tonight:
    /// the older heuristics apply instead of a previous night's result.
    #[test]
    fn sanitise_ignores_rows_dated_for_another_night() {
        let report = "\
 | 2026-10-05 | evaluator | candidatesPerGeneration capped at 4 on the annexe | NONE | NONE | yes | REJECT |  | 0123456789ab |  |
**Finding:** tonight's evaluator run timed out after 600s
";
        assert_eq!(
            sanitise_finding(report, Verdict::Inconclusive, "2026-10-06"),
            "tonight's evaluator run timed out after 600s"
        );
    }

    /// The finding rules mirror `rowContract.ts`, including its word
    /// boundaries and its UTF-16 length.
    #[test]
    fn finding_violations_mirror_the_typescript_contract() {
        assert!(finding_violations("row-contract validator added; prior rows show format drift").is_empty());
        assert_eq!(finding_violations(""), vec!["finding-empty"]);
        assert_eq!(finding_violations("   "), vec!["finding-empty"]);
        assert_eq!(finding_violations(&"x".repeat(81)), vec!["finding-too-long"]);
        assert!(finding_violations(&"x".repeat(80)).is_empty());
        assert_eq!(finding_violations("INCONCLUSIVE — see report"), vec!["finding-pointer"]);
        assert_eq!(finding_violations("details: See   Gist."), vec!["finding-pointer"]);
        assert_eq!(finding_violations("see the annexe log"), vec!["finding-pointer"]);
        assert_eq!(finding_violations("Gist published"), vec!["finding-pointer"]);
        assert_eq!(
            finding_violations("Given the Darwin evaluator at commit `7c30573a`"),
            vec!["finding-hypothesis-leak"]
        );
        // Word boundaries: none of these is a pointer or a hypothesis.
        assert!(finding_violations("givens are cached per run").is_empty());
        assert!(finding_violations("seed corpus grows by 12 rows").is_empty());
        assert!(finding_violations("gisting step dropped").is_empty());
        assert!(finding_violations("foresee reporting gap closed").is_empty());
        assert!(finding_violations("see-through cache keys removed").contains(&"finding-pointer"));
        // JS String.length counts UTF-16 code units: 41 emoji are 82 units.
        assert_eq!(finding_violations(&"😀".repeat(41)), vec!["finding-too-long"]);
        assert!(finding_violations(&"€".repeat(80)).is_empty());
    }

    #[test]
    fn clip_words_cuts_on_a_word_boundary_with_an_ellipsis() {
        assert_eq!(clip_words("short enough", 60), "short enough");
        let long = "darwin evaluator caps candidatesPerGeneration at four and times out";
        let clipped = clip_words(long, 40);
        assert!(clipped.chars().count() <= 40, "{clipped}");
        assert_eq!(clipped, "darwin evaluator caps…");
        assert_eq!(clip_words(&"x".repeat(10), 5), "xxxx…");
        assert_eq!(clip_words("alpha beta gamma", 11), "alpha beta…");
    }
}
