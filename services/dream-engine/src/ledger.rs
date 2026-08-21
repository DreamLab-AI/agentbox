//! Append-only markdown-table ledger.
//!
//! Each night's outcome is recorded as one row in a 10-column markdown table.
//! The table is human-readable in a repo and machine-appendable: [`append_row`]
//! bootstraps the header the first time and thereafter appends exactly one line,
//! escaping every cell so a stray `|` or newline can never break the table.

use std::path::Path;
use thiserror::Error;

/// Errors produced while writing to the ledger.
#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("ledger io: {0}")]
    Io(#[from] std::io::Error),
}

/// The ten column headers, in order.
const COLUMNS: [&str; 10] = [
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
    /// `"ACCEPT"`, `"REJECT"`, `"INCONCLUSIVE"`, or `"BLOCKED-ENV"`.
    pub verdict: String,
    pub effect: String,
    /// The short (12-char) witness.
    pub witness: String,
    pub prior_fates: String,
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
    ];
    let escaped: Vec<String> = cells.iter().map(|c| escape_cell(c)).collect();
    format!("| {} |", escaped.join(" | "))
}

/// The header line, e.g. `| Date | Deep | ... |`.
fn header_line() -> String {
    format!("| {} |", COLUMNS.join(" | "))
}

/// The divider line, e.g. `| --- | --- | ... |` (ten columns).
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
        assert_eq!(lines[0].matches('|').count(), 11); // 10 columns -> 11 bars
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
        // Exactly the two outer bars plus nine inner separators = 11 bars,
        // because the literal pipe was escaped (backslash-pipe is not counted
        // as an unescaped separator below).
        let unescaped_bars = count_unescaped_bars(last);
        assert_eq!(unescaped_bars, 11);
        assert!(!last.contains('\n'));
    }

    #[test]
    fn round_trip_parses_into_ten_cells() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("LEDGER.md");
        let row = sample_row();
        append_row(&path, &row).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let last = content.lines().last().unwrap();
        let cells = parse_row(last);
        assert_eq!(cells.len(), 10);
        assert_eq!(cells[0], "2026-08-15");
        assert_eq!(cells[6], "ACCEPT");
        assert_eq!(cells[8], "8522806be1fd");
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
