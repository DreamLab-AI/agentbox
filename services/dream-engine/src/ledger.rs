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

/// The first night date the row contract applies to. Rows dated earlier are
/// grandfathered, as in dream-machine's `rowContract.test.ts`.
pub const CONTRACT_ENFORCE_FROM: &str = "2026-09-06";

/// Every verdict token a ledger row may carry: the three night outcomes and
/// the three non-night tokens of `rowContract.ts` (`OPERATOR` is written by
/// hand, never by the engine).
pub const LEDGER_VERDICTS: [&str; 6] = [
    "ACCEPT",
    "REJECT",
    "INCONCLUSIVE",
    "BLOCKED-ENV",
    "HANDOFF",
    "OPERATOR",
];

/// `^#\d+:(MERGED|CLOSED|OPEN|STALE)$`.
fn fate_token(token: &str) -> bool {
    let Some((num, fate)) = token.strip_prefix('#').and_then(|t| t.split_once(':')) else {
        return false;
    };
    !num.is_empty()
        && num.bytes().all(|b| b.is_ascii_digit())
        && matches!(fate, "MERGED" | "CLOSED" | "OPEN" | "STALE")
}

/// `YYYY-MM-DD` by shape (the contract's `^\d{4}-\d{2}-\d{2}$`).
fn iso_date(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

/// The row-contract rules `row` breaks, named as dream-machine's
/// `packages/ledger/src/rowContract.ts` names them.
///
/// The finding rules come from [`crate::verdict::finding_violations`] (the
/// engine's single finding validator); this adds the row-level rules: verdict
/// vocabulary, ACCEPT rows tracking a PR and carrying a witness, and the
/// prior-night fates grammar. A row with no ISO date, or dated before
/// [`CONTRACT_ENFORCE_FROM`], is not checked, exactly as in the TS contract.
/// Cells are read as written, after the same trim the TS parser applies.
pub fn row_violations(row: &LedgerRow) -> Vec<&'static str> {
    let date = row.date.trim();
    if !iso_date(date) || date < CONTRACT_ENFORCE_FROM {
        return Vec::new();
    }
    let mut out = crate::verdict::finding_violations(&row.finding);
    let verdict = row.verdict.trim();
    if !LEDGER_VERDICTS.contains(&verdict) {
        out.push("verdict-vocab");
    }
    let pr = row.pr.trim();
    if verdict == "ACCEPT" && (pr == "NONE" || pr.is_empty()) {
        out.push("accept-without-pr");
    }
    if verdict == "ACCEPT" && row.witness.trim().is_empty() {
        out.push("accept-without-witness");
    }
    let fates = row.prior_fates.trim();
    if !fates.is_empty() && !fates.split_whitespace().all(fate_token) {
        out.push("fates-grammar");
    }
    out
}

/// Bring `row` into compliance with the row contract before it is written,
/// returning the rules it broke (empty when it was already compliant).
///
/// A `|` in the finding is dropped first: [`escape_cell`] writes it as `\|`,
/// which the TS parser still splits on, shifting every later column. Then:
///
/// * a failing finding is replaced by `fallback` — a line stating what
///   happened, supplied by the caller — clipped on a word boundary; if that
///   also fails, by a fixed line naming the verdict;
/// * an unknown verdict reads as `INCONCLUSIVE` (never as an acceptance);
/// * an ACCEPT row without a PR records `MISSING`, and without a witness
///   `BLOCKED` (the engine's marker for an unavailable witness);
/// * prior-night fates that are not `#N:FATE` tokens are dropped.
///
/// The engine's own paths never produce the last three (the gate accepts
/// only an applied candidate, which always yields a PR reference and a
/// witness cell); they exist so no row of any shape is written non-compliant.
pub fn enforce_contract(row: &mut LedgerRow, fallback: &str) -> Vec<&'static str> {
    if row.finding.contains('|') {
        row.finding = row
            .finding
            .replace('|', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
    }
    let broken = row_violations(row);
    if broken.is_empty() {
        return broken;
    }
    if !LEDGER_VERDICTS.contains(&row.verdict.trim()) {
        row.verdict = crate::verdict::from_label(&row.verdict)
            .as_str()
            .to_string();
    }
    if !crate::verdict::finding_violations(&row.finding).is_empty() {
        let clean: String = fallback
            .replace('|', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let clipped = crate::verdict::clip_words(&clean, crate::verdict::FINDING_MAX_UTF16);
        row.finding = if crate::verdict::ledger_cell_ok(&clipped) {
            clipped
        } else {
            format!(
                "{} night; finding withheld for breaking the ledger row contract",
                row.verdict.trim()
            )
        };
    }
    if row.verdict.trim() == "ACCEPT" {
        if row.pr.trim().is_empty() || row.pr.trim() == "NONE" {
            row.pr = "MISSING".into();
        }
        if row.witness.trim().is_empty() {
            row.witness = "BLOCKED".into();
        }
    }
    let fates = row.prior_fates.trim();
    if !fates.is_empty() && !fates.split_whitespace().all(fate_token) {
        row.prior_fates = String::new();
    }
    broken
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
/// * repairs the row against the row contract ([`enforce_contract`]) with a
///   warning, so a non-compliant row is never written;
/// * appends exactly one row line.
pub fn append_row(ledger_path: &Path, row: &LedgerRow) -> Result<(), LedgerError> {
    // Backstop: callers repair with a contextual fallback first
    // ([`enforce_contract`]); whatever reaches here is still never written
    // non-compliant, and never fails the night over it.
    let mut row = row.clone();
    let broken = enforce_contract(&mut row, "");
    if !broken.is_empty() {
        tracing::warn!(rules = ?broken, finding = %row.finding, "ledger row broke the row contract; repaired before append");
    }
    let row = &row;
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

/// What happened when the engine tried to commit its own ledger row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "outcome", content = "detail", rename_all = "kebab-case")]
pub enum LedgerCommit {
    /// Committed; carries the short commit id.
    Committed(String),
    /// HEAD is not the default branch (carries HEAD's name): the operator is
    /// working on something, so the row is left for them rather than committed
    /// onto their branch.
    NotDefaultBranch(String),
    /// The ledger file has no uncommitted change.
    NothingToCommit,
    /// git refused; carries its stderr.
    Failed(String),
}

/// Commit the ledger file, and only the ledger file, on the repo's default
/// branch (ADR-2071 Phase 1).
///
/// Before this the row was written to the working tree and left there, so a
/// night that ran was invisible to anyone reading git (27 to 30 September
/// 2026: four VisionFlow rows sat uncommitted and the estate census reported
/// no ledger activity since the 10th). `git commit --only -- <ledger>`
/// commits the file's current content without touching anything else the
/// operator has staged. Local commit only: pushing stays with the operator.
pub fn commit_ledger(repo: &Path, ledger_path: &Path, message: &str) -> LedgerCommit {
    let run = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
    };
    let text = |o: &std::process::Output| String::from_utf8_lossy(&o.stdout).trim().to_string();

    let head = match run(&["symbolic-ref", "--quiet", "--short", "HEAD"]) {
        Ok(o) if o.status.success() => text(&o),
        Ok(_) => return LedgerCommit::NotDefaultBranch("(detached)".into()),
        Err(e) => return LedgerCommit::Failed(e.to_string()),
    };
    let default = run(&[
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/origin/HEAD",
    ])
    .ok()
    .filter(|o| o.status.success())
    .map(|o| text(&o).trim_start_matches("origin/").to_string())
    .unwrap_or_else(|| {
        let has = |b: &str| {
            run(&[
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{b}"),
            ])
            .map(|o| o.status.success())
            .unwrap_or(false)
        };
        if !has("main") && has("master") {
            "master".into()
        } else {
            "main".into()
        }
    });
    if head != default {
        return LedgerCommit::NotDefaultBranch(head);
    }

    let path = ledger_path.to_string_lossy();
    match run(&["status", "--porcelain", "--", &path]) {
        Ok(o) if o.status.success() && text(&o).is_empty() => return LedgerCommit::NothingToCommit,
        Ok(o) if !o.status.success() => {
            return LedgerCommit::Failed(String::from_utf8_lossy(&o.stderr).trim().to_string())
        }
        Err(e) => return LedgerCommit::Failed(e.to_string()),
        _ => {}
    }
    // A freshly bootstrapped ledger is untracked, and `commit --only` refuses a
    // pathspec git does not know; add that one path first.
    let tracked = run(&["ls-files", "--error-unmatch", "--", &path])
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !tracked {
        match run(&["add", "--", &path]) {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                return LedgerCommit::Failed(String::from_utf8_lossy(&o.stderr).trim().to_string())
            }
            Err(e) => return LedgerCommit::Failed(e.to_string()),
        }
    }
    match run(&["commit", "--quiet", "--only", "-m", message, "--", &path]) {
        Ok(o) if o.status.success() => {
            let id = run(&["rev-parse", "--short", "HEAD"])
                .map(|o| text(&o))
                .unwrap_or_default();
            LedgerCommit::Committed(id)
        }
        Ok(o) => LedgerCommit::Failed(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => LedgerCommit::Failed(e.to_string()),
    }
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

    /// The compliant row of dream-machine's `rowContract.test.ts`, widened to
    /// the engine's twelve columns.
    fn compliant_row() -> LedgerRow {
        LedgerRow::unreviewed(
            "2026-09-06".into(),
            "ledger-signals".into(),
            "row-contract validator added; prior rows show format drift".into(),
            "NONE".into(),
            "pending".into(),
            "yes".into(),
            "ACCEPT".into(),
            "guards cross-night memory".into(),
            "0123456789ab".into(),
            String::new(),
        )
    }

    /// One case per rule of `rowContract.test.ts`, same rule names.
    #[test]
    fn row_violations_mirror_the_typescript_contract() {
        assert!(row_violations(&compliant_row()).is_empty());
        let with = |f: &dyn Fn(&mut LedgerRow)| {
            let mut r = compliant_row();
            f(&mut r);
            row_violations(&r)
        };
        assert!(
            with(&|r| r.finding = "INCONCLUSIVE — see report".into()).contains(&"finding-pointer")
        );
        assert!(
            with(&|r| r.finding = "Given the Darwin evaluator at commit `7c30573a`".into())
                .contains(&"finding-hypothesis-leak")
        );
        assert!(with(&|r| r.finding = "x".repeat(81)).contains(&"finding-too-long"));
        assert!(with(&|r| r.finding = String::new()).contains(&"finding-empty"));
        assert!(with(&|r| r.pr = "NONE".into()).contains(&"accept-without-pr"));
        assert!(with(&|r| r.pr = String::new()).contains(&"accept-without-pr"));
        assert!(with(&|r| r.witness = String::new()).contains(&"accept-without-witness"));
        assert!(with(&|r| r.prior_fates = "merged #7 by human".into()).contains(&"fates-grammar"));
        assert!(
            with(&|r| r.prior_fates = "#7:MERGED #8:OPEN #9:STALE #10:CLOSED".into()).is_empty()
        );
        assert!(with(&|r| r.verdict = "MAYBE".into()).contains(&"verdict-vocab"));
        for v in [
            "ACCEPT",
            "REJECT",
            "INCONCLUSIVE",
            "BLOCKED-ENV",
            "HANDOFF",
            "OPERATOR",
        ] {
            assert!(with(&|r| r.verdict = v.into()).is_empty(), "{v}");
        }
        // Only ACCEPT is held to the PR and witness rules.
        assert!(with(&|r| {
            r.verdict = "OPERATOR".into();
            r.pr = "NONE".into();
            r.witness = String::new();
        })
        .is_empty());
        // Rows before the cutoff are grandfathered, as in the TS contract.
        assert!(with(&|r| {
            r.date = "2026-09-01".into();
            r.finding = "INCONCLUSIVE — see report".into();
        })
        .is_empty());
    }

    #[test]
    fn enforce_contract_replaces_a_failing_finding_with_the_fallback() {
        let mut r = compliant_row();
        r.verdict = "REJECT".into();
        r.finding =
            "Given the annexe lacks the siblings, when the build runs, then it fails".into();
        let broken = enforce_contract(&mut r, "ACCEPT vetoed → REJECT: darwin-smoke: exit 1");
        assert_eq!(broken, vec!["finding-hypothesis-leak"]);
        assert_eq!(r.finding, "ACCEPT vetoed → REJECT: darwin-smoke: exit 1");
        assert!(row_violations(&r).is_empty());
    }

    #[test]
    fn enforce_contract_uses_a_last_resort_line_when_the_fallback_also_fails() {
        let mut r = compliant_row();
        r.verdict = "INCONCLUSIVE".into();
        r.finding = "INCONCLUSIVE — see report".into();
        enforce_contract(&mut r, "see report");
        assert!(row_violations(&r).is_empty(), "{}", r.finding);
        assert!(r.finding.starts_with("INCONCLUSIVE"), "{}", r.finding);
        let mut r = compliant_row();
        r.finding = String::new();
        enforce_contract(&mut r, "");
        assert!(row_violations(&r).is_empty(), "{}", r.finding);
    }

    #[test]
    fn enforce_contract_repairs_every_cell_rule() {
        let mut r = compliant_row();
        r.pr = "NONE".into();
        r.witness = String::new();
        r.prior_fates = "merged #7 by human".into();
        let broken = enforce_contract(&mut r, "unused");
        assert_eq!(
            broken,
            vec![
                "accept-without-pr",
                "accept-without-witness",
                "fates-grammar"
            ]
        );
        assert!(row_violations(&r).is_empty());
        assert_eq!(
            r.finding,
            compliant_row().finding,
            "a compliant finding is kept"
        );
        let mut r = compliant_row();
        r.verdict = "MAYBE".into();
        enforce_contract(&mut r, "unused");
        assert_eq!(
            r.verdict, "INCONCLUSIVE",
            "an unknown verdict never reads as acceptance"
        );
        assert!(row_violations(&r).is_empty());
    }

    /// A compliant row is written exactly as given.
    #[test]
    fn enforce_contract_leaves_a_compliant_row_alone() {
        let mut r = compliant_row();
        assert!(enforce_contract(&mut r, "unused").is_empty());
        assert_eq!(row_line(&r), row_line(&compliant_row()));
    }

    /// The backstop: whatever a caller hands `append_row`, the line written
    /// satisfies the contract as the TS parser reads it (raw `|` split).
    #[test]
    fn append_row_never_writes_a_non_compliant_row() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("LEDGER.md");
        let mut r = compliant_row();
        r.date = "2026-10-06".into();
        r.verdict = "REJECT".into();
        r.finding = "VETOED: Given the Darwin evaluator at commit 7c30573a".into();
        append_row(&path, &r).unwrap();
        let mut r = compliant_row();
        r.date = "2026-10-06".into();
        r.finding = "cap | lifted to 8".into();
        append_row(&path, &r).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let rows: Vec<&str> = content.lines().skip(2).collect();
        assert_eq!(rows.len(), 2);
        for line in rows {
            // rowContract.ts parseRow: split on every `|`, trim, cells 1..=10.
            let cells: Vec<&str> = line.trim().split('|').map(str::trim).collect();
            assert_eq!(cells.len(), 14, "{line}");
            let finding = cells[3];
            assert!(crate::verdict::ledger_cell_ok(finding), "{line}");
            assert!(!finding.to_ascii_lowercase().contains("given"), "{line}");
        }
        assert!(content.contains("| cap lifted to 8 |"));
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
        assert_eq!(
            review_from_merge(None, None, None),
            (String::new(), String::new())
        );
        // Known reviewer, unknown timing: the reviewer stands, the duration does not.
        let (reviewer, minutes) =
            review_from_merge(Some("jjohare"), None, Some("2026-09-14T10:00:00Z"));
        assert_eq!(reviewer, "jjohare");
        assert_eq!(minutes, "");
        // Unparseable timestamp.
        let (_, minutes) =
            review_from_merge(Some("x"), Some("nonsense"), Some("2026-09-14T10:00:00Z"));
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

    fn git(dir: &Path, args: &[&str]) -> String {
        let o = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            o.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    fn scratch_repo() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        git(dir.path(), &["init", "-q", "-b", "main"]);
        fs::write(dir.path().join("README.md"), "x\n").unwrap();
        git(dir.path(), &["add", "README.md"]);
        git(dir.path(), &["commit", "-q", "-m", "init"]);
        dir
    }

    #[test]
    fn commit_ledger_commits_only_the_ledger_on_the_default_branch() {
        let dir = scratch_repo();
        let repo = dir.path();
        // Operator work in progress: a staged file that must stay staged.
        fs::write(repo.join("wip.txt"), "wip\n").unwrap();
        git(repo, &["add", "wip.txt"]);
        let ledger = repo.join("docs/dream-cycle/LEDGER.md");
        append_row(&ledger, &sample_row()).unwrap();

        std::env::set_var("GIT_AUTHOR_NAME", "t");
        std::env::set_var("GIT_AUTHOR_EMAIL", "t@t");
        std::env::set_var("GIT_COMMITTER_NAME", "t");
        std::env::set_var("GIT_COMMITTER_EMAIL", "t@t");
        let out = commit_ledger(repo, &ledger, "dream-cycle: ledger row");
        assert!(matches!(out, LedgerCommit::Committed(_)), "{out:?}");
        let files = git(repo, &["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(files, "docs/dream-cycle/LEDGER.md");
        assert_eq!(git(repo, &["diff", "--cached", "--name-only"]), "wip.txt");

        assert_eq!(
            commit_ledger(repo, &ledger, "again"),
            LedgerCommit::NothingToCommit
        );

        // Second night: the ledger is now tracked.
        append_row(&ledger, &sample_row()).unwrap();
        assert!(matches!(
            commit_ledger(repo, &ledger, "night 2"),
            LedgerCommit::Committed(_)
        ));
        assert_eq!(git(repo, &["diff", "--cached", "--name-only"]), "wip.txt");
    }

    #[test]
    fn commit_ledger_leaves_a_feature_branch_alone() {
        let dir = scratch_repo();
        let repo = dir.path();
        git(repo, &["switch", "-q", "-c", "feature/x"]);
        let ledger = repo.join("LEDGER.md");
        append_row(&ledger, &sample_row()).unwrap();
        assert_eq!(
            commit_ledger(repo, &ledger, "m"),
            LedgerCommit::NotDefaultBranch("feature/x".into())
        );
        assert!(!git(repo, &["status", "--porcelain"]).is_empty());
    }
}
