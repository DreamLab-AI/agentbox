//! Append-only markdown-table ledger.
//!
//! Each night's outcome is recorded as one row in a 12-column markdown table.
//! The table is human-readable in a repo and machine-appendable: [`append_row`]
//! bootstraps the header the first time and thereafter appends exactly one line,
//! escaping every cell so a stray `|` or newline can never break the table.
//!
//! The last two columns — `Reviewer` and `Review-minutes` — are the human side
//! of the night (PRD-augmentation-conditions FR6.6). Ten of the twelve columns
//! measure what the AGENT did; these two measure the person who reviewed the PR
//! it opened, which is what makes the longitudinal augmentation conditions (C4
//! deepening learning, C6 job purpose) readable from the ledger at all.
//!
//! They are populated from the PR merge event — `merged_by`, and
//! `merged_at − pr_opened_at` in whole minutes — and left EMPTY whenever the PR
//! is unmerged or the event is unavailable. An empty cell reads back as `null`
//! in the cockpit parser (`management-api/lib/dream-ledger.js`); a fabricated
//! `0` would read as "reviewed instantly", so absence is written as absence.
//!
//! Ledgers written before this change are ten columns wide and stay valid: the
//! parser's compatibility floor is the legacy width, and the two new columns
//! are appended, never inserted.

use chrono::DateTime;
use std::path::Path;
use thiserror::Error;

/// Errors produced while writing to the ledger.
#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("ledger io: {0}")]
    Io(#[from] std::io::Error),
}

/// The twelve column headers, in order.
const COLUMNS: [&str; 12] = [
    "Date",
    "Deep",
    "Finding",
    "Issue",
    "PR",
    "Evaluated?",
    "Verdict",
    "Effect",
    "Witness",
    "Prior-night fates",
    "Reviewer",
    "Review-minutes",
];

/// One ledger row. Fields map one-to-one onto [`COLUMNS`].
#[derive(Debug, Clone)]
pub struct LedgerRow {
    /// YYYY-MM-DD.
    pub date: String,
    pub deep: String,
    pub finding: String,
    /// `"#6"`, `"NONE"`, or `"LOCAL"`.
    pub issue: String,
    pub pr: String,
    /// `"yes"`, `"no"`, or `"blocked"`.
    pub evaluated: String,
    /// `"ACCEPT"`, `"REJECT"`, `"INCONCLUSIVE"`, `"BLOCKED-ENV"` or `"HANDOFF"`.
    /// Only the first three affect the dry streak; the last two are operational
    /// state (a broken harness, an unusable evaluator) rather than evidence.
    pub verdict: String,
    pub effect: String,
    /// The short (12-char) witness.
    pub witness: String,
    pub prior_fates: String,
    /// Who merged this night's PR — a GitHub login or a `did:nostr`. EMPTY when
    /// the PR is unmerged or the merge event was unavailable (FR6.6).
    pub reviewer: String,
    /// `merged_at − pr_opened_at` in whole minutes, as a decimal string. EMPTY
    /// when either timestamp is unavailable — never `0`.
    pub review_minutes: String,
}

impl LedgerRow {
    /// A row with the human columns empty: the shape every night starts in,
    /// since a PR opened tonight has not been reviewed yet.
    ///
    /// Callers that later learn the merge event fill [`LedgerRow::reviewer`] and
    /// [`LedgerRow::review_minutes`] with [`review_from_merge`].
    #[allow(clippy::too_many_arguments)] // one parameter per ledger column
    pub fn unreviewed(
        date: String,
        deep: String,
        finding: String,
        issue: String,
        pr: String,
        evaluated: String,
        verdict: String,
        effect: String,
        witness: String,
        prior_fates: String,
    ) -> Self {
        Self {
            date,
            deep,
            finding,
            issue,
            pr,
            evaluated,
            verdict,
            effect,
            witness,
            prior_fates,
            reviewer: String::new(),
            review_minutes: String::new(),
        }
    }
}

/// Derive the two human columns from a PR merge event.
///
/// `merged_by` is written verbatim (a login or a `did:nostr`). The duration is
/// whole minutes between the two RFC-3339 timestamps, and is EMPTY whenever it
/// cannot be computed honestly: a missing timestamp, an unparseable one, or a
/// merge recorded before the PR opened (clock skew, or a back-dated import).
/// Rounding is to the nearest minute, so a two-minute review is `2`, not `1`.
pub fn review_from_merge(
    merged_by: Option<&str>,
    pr_opened_at: Option<&str>,
    merged_at: Option<&str>,
) -> (String, String) {
    let reviewer = merged_by.unwrap_or("").trim().to_string();

    let parse = |s: Option<&str>| DateTime::parse_from_rfc3339(s?.trim()).ok();
    let minutes = match (parse(pr_opened_at), parse(merged_at)) {
        (Some(opened), Some(merged)) if merged >= opened => {
            let seconds = (merged - opened).num_seconds();
            // Nearest whole minute, computed in integers so no float rounding
            // can turn a 90-second review into "1".
            (((seconds * 10) / 60 + 5) / 10).to_string()
        }
        _ => String::new(),
    };
    (reviewer, minutes)
}

/// Escape a cell so it can never break the markdown table: `|` becomes `\|` and
/// any newline (or carriage return) becomes a space.
pub fn escape_cell(s: &str) -> String {
    s.replace('|', "\\|").replace(['\n', '\r'], " ")
}

/// Render one table row (without trailing newline).
fn row_line(row: &LedgerRow) -> String {
    let cells = [
        &row.date,
        &row.deep,
        &row.finding,
        &row.issue,
        &row.pr,
        &row.evaluated,
        &row.verdict,
        &row.effect,
        &row.witness,
        &row.prior_fates,
        &row.reviewer,
        &row.review_minutes,
    ];
    let escaped: Vec<String> = cells.iter().map(|c| escape_cell(c)).collect();
    format!("| {} |", escaped.join(" | "))
}

/// The header line, e.g. `| Date | Deep | ... |`.
fn header_line() -> String {
    format!("| {} |", COLUMNS.join(" | "))
}

/// The divider line, e.g. `| --- | --- | ... |` (twelve columns).
fn divider_line() -> String {
    let dashes: Vec<&str> = COLUMNS.iter().map(|_| "---").collect();
    format!("| {} |", dashes.join(" | "))
}

/// Append a single row to the ledger at `ledger_path`.
///
/// Behaviour:
/// * creates parent directories as needed;
/// * bootstraps the header + divider if the file is missing or empty;
/// * inserts a missing trailing newline before appending, so the new row is
///   never concatenated onto the previous one;
/// * appends exactly one row line.
pub fn append_row(ledger_path: &Path, row: &LedgerRow) -> Result<(), LedgerError> {
    if let Some(parent) = ledger_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let existing = std::fs::read_to_string(ledger_path).unwrap_or_default();

    let mut out = String::new();
    if existing.trim().is_empty() {
        // Bootstrap a fresh table.
        out.push_str(&header_line());
        out.push('\n');
        out.push_str(&divider_line());
        out.push('\n');
    } else {
        out.push_str(&existing);
        if !existing.ends_with('\n') {
            out.push('\n');
        }
    }
    out.push_str(&row_line(row));
    out.push('\n');

    std::fs::write(ledger_path, out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn sample_row() -> LedgerRow {
        LedgerRow {
            date: "2026-08-15".into(),
            deep: "cache".into(),
            finding: "Given a cold cache, the second request is faster".into(),
            issue: "#6".into(),
            pr: "NONE".into(),
            evaluated: "yes".into(),
            verdict: "ACCEPT".into(),
            effect: "merged".into(),
            witness: "8522806be1fd".into(),
            prior_fates: "REJECT, INCONCLUSIVE".into(),
            reviewer: "jjohare".into(),
            review_minutes: "42".into(),
        }
    }

    #[test]
    fn escape_cell_neutralises_pipes_and_newlines() {
        assert_eq!(escape_cell("a|b"), "a\\|b");
        assert_eq!(escape_cell("a\nb"), "a b");
        assert_eq!(escape_cell("a\r\nb"), "a  b");
        assert_eq!(escape_cell("plain"), "plain");
    }

    #[test]
    fn bootstraps_missing_file() {
        let dir = tempdir().unwrap();
        // Nested path exercises parent-dir creation.
        let path = dir.path().join("docs/dream-cycle/LEDGER.md");
        append_row(&path, &sample_row()).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3); // header + divider + one row
        assert_eq!(lines[0], header_line());
        assert_eq!(lines[1], divider_line());
        assert_eq!(lines[0].matches('|').count(), 13); // 12 columns -> 13 bars
        assert!(lines[2].starts_with("| 2026-08-15 |"));
    }

    #[test]
    fn append_adds_exactly_one_line() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("LEDGER.md");
        append_row(&path, &sample_row()).unwrap();
        let before = fs::read_to_string(&path).unwrap().lines().count();

        append_row(&path, &sample_row()).unwrap();
        let after = fs::read_to_string(&path).unwrap().lines().count();

        assert_eq!(after, before + 1);
    }

    #[test]
    fn handles_file_without_trailing_newline() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("LEDGER.md");
        // Pre-existing ledger with NO trailing newline on the last row.
        let seed = format!("{}\n{}\n| old row |", header_line(), divider_line());
        fs::write(&path, &seed).unwrap();

        append_row(&path, &sample_row()).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        // header + divider + old row + new row, cleanly separated.
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[2], "| old row |");
        assert!(lines[3].starts_with("| 2026-08-15 |"));
    }

    #[test]
    fn escaping_keeps_row_parseable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("LEDGER.md");
        let mut row = sample_row();
        row.finding = "a | b\nc".into(); // contains a pipe and a newline
        append_row(&path, &row).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let last = content.lines().last().unwrap();
        // Exactly the two outer bars plus eleven inner separators = 13 bars,
        // because the literal pipe was escaped (backslash-pipe is not counted
        // as an unescaped separator below).
        let unescaped_bars = count_unescaped_bars(last);
        assert_eq!(unescaped_bars, 13);
        assert!(!last.contains('\n'));
    }

    #[test]
    fn round_trip_parses_into_twelve_cells() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("LEDGER.md");
        let row = sample_row();
        append_row(&path, &row).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let last = content.lines().last().unwrap();
        let cells = parse_row(last);
        assert_eq!(cells.len(), 12);
        assert_eq!(cells[0], "2026-08-15");
        assert_eq!(cells[6], "ACCEPT");
        assert_eq!(cells[8], "8522806be1fd");
        assert_eq!(cells[10], "jjohare");
        assert_eq!(cells[11], "42");
    }

    #[test]
    fn unreviewed_leaves_the_human_columns_empty() {
        let row = LedgerRow::unreviewed(
            "2026-09-14".into(),
            "deep".into(),
            "finding".into(),
            "NONE".into(),
            "#7".into(),
            "yes".into(),
            "ACCEPT".into(),
            String::new(),
            "abcd1234abcd".into(),
            String::new(),
        );
        assert_eq!(row.reviewer, "");
        assert_eq!(row.review_minutes, "");
        // Still a well-formed twelve-cell row.
        assert_eq!(parse_row(&row_line(&row)).len(), 12);
    }

    #[test]
    fn review_from_merge_reads_the_merge_event() {
        let (reviewer, minutes) = review_from_merge(
            Some("jjohare"),
            Some("2026-09-14T09:00:00Z"),
            Some("2026-09-14T10:30:00Z"),
        );
        assert_eq!(reviewer, "jjohare");
        assert_eq!(minutes, "90");
    }

    #[test]
    fn review_from_merge_rounds_to_the_nearest_minute() {
        let (_, minutes) = review_from_merge(
            Some("x"),
            Some("2026-09-14T09:00:00Z"),
            Some("2026-09-14T09:00:40Z"),
        );
        assert_eq!(minutes, "1");
        let (_, minutes) = review_from_merge(
            Some("x"),
            Some("2026-09-14T09:00:00Z"),
            Some("2026-09-14T09:00:20Z"),
        );
        assert_eq!(minutes, "0");
    }

    #[test]
    fn review_from_merge_never_fabricates_a_duration() {
        // Unmerged: nothing at all.
        assert_eq!(review_from_merge(None, None, None), (String::new(), String::new()));
        // Known reviewer, unknown timing: the reviewer stands, the duration does not.
        let (reviewer, minutes) = review_from_merge(Some("jjohare"), None, Some("2026-09-14T10:00:00Z"));
        assert_eq!(reviewer, "jjohare");
        assert_eq!(minutes, "");
        // Unparseable timestamp.
        let (_, minutes) = review_from_merge(Some("x"), Some("nonsense"), Some("2026-09-14T10:00:00Z"));
        assert_eq!(minutes, "");
        // A merge before its PR opened is refused, never negated.
        let (_, minutes) = review_from_merge(
            Some("x"),
            Some("2026-09-14T10:00:00Z"),
            Some("2026-09-14T09:00:00Z"),
        );
        assert_eq!(minutes, "");
    }

    /// Count `|` characters that are not escaped as `\|`.
    fn count_unescaped_bars(line: &str) -> usize {
        let chars: Vec<char> = line.chars().collect();
        let mut count = 0;
        for (i, &c) in chars.iter().enumerate() {
            if c == '|' && !(i > 0 && chars[i - 1] == '\\') {
                count += 1;
            }
        }
        count
    }

    /// Split a rendered row into its cell values (trimmed), on unescaped bars.
    fn parse_row(line: &str) -> Vec<String> {
        let trimmed = line.trim();
        // Strip the outer `|` ... `|`.
        let inner = trimmed
            .strip_prefix('|')
            .and_then(|s| s.strip_suffix('|'))
            .unwrap_or(trimmed);
        // Split on unescaped bars.
        let mut cells = Vec::new();
        let mut current = String::new();
        let chars: Vec<char> = inner.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1] == '|' {
                current.push('|');
                i += 2;
                continue;
            }
            if chars[i] == '|' {
                cells.push(current.trim().to_string());
                current.clear();
                i += 1;
                continue;
            }
            current.push(chars[i]);
            i += 1;
        }
        cells.push(current.trim().to_string());
        cells
    }
}
