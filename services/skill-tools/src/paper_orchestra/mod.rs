//! Deterministic helpers for the `paper-orchestra` skill family, ported from
//! the upstream Python scripts (MIT, pinned at commit `6a31913`) into one
//! binary, `paper-orchestra`.
//!
//! The skill is tuned for **arXiv preprints**: there are no conference page
//! limits and no anonymisation, the inputs are `idea.md`, `experimental_log.md`
//! and an optional `figures/` directory, and arXiv defaults are supplied by the
//! skill itself. Every subcommand that takes a paper accepts a single `.tex`
//! file *or* a directory, following `\input{}` and `\include{}` relative to the
//! main file and ignoring comments (see [`tex::Paper`]).
//!
//! | Subcommand | Module | Upstream |
//! |---|---|---|
//! | `init`, `validate-inputs`, `consistency` | [`workspace`] | `init_workspace.py`, `validate_inputs.py` + `check_idea_density.py`, `validate_consistency.py` |
//! | `validate-outline` | [`outline`] | `validate_outline.py` + schema |
//! | `anti-leakage` | [`anti_leakage`] | `anti_leakage_check.py` |
//! | `claim-evidence` | [`claim_evidence`] | `claim_evidence_gate.py` (+ ledger mode, new) |
//! | `orphan-cites`, `citation-coverage` | [`citations`] | `orphan_cite_gate.py`, `citation_coverage.py` |
//! | `verify-refs` | [`verify_refs`] | `levenshtein_match.py` + `check_cutoff.py` |
//! | `reverse-outline` | [`reverse_outline`] | `reverse_outline.py` |
//! | `score-delta`, `decision-band`, `score-trajectory` | [`scoring`] | `score_delta.py`, `decision_band.py`, `score_trajectory.py` |
//! | `concession-guard` | [`concession`] | `concession_guard.py` |
//! | `worklog` | [`worklog`] | `apply_worklog.py` |
//! | `critique-memory` | [`critique_memory`] (+ [`seqmatch`]) | `update_critique_memory.py` |
//! | `arxiv-preflight` | [`preflight`] | none (new) |
//!
//! Shared plumbing: [`tex`] (source loading), [`cite`] (citation keys) and
//! [`json_util`] (ordered JSON output, Python-style truthiness).
//!
//! Exit-code conventions follow upstream per subcommand. Command-line usage
//! errors exit 64 (`EX_USAGE`) in every subcommand, because 2 means a gate
//! result elsewhere (`arxiv-preflight` not ready, `concession-guard` restate,
//! `score-delta` revert). `score-delta`, `score-trajectory`, `concession-guard`
//! and `worklog` exit 3 on an input error: a missing or non-numeric required
//! score, an unknown severity, a non-integer round. They never default a
//! missing value.

#![deny(missing_docs)]

pub mod anti_leakage;
pub mod citations;
pub mod cite;
pub mod claim_evidence;
pub mod concession;
pub mod critique_memory;
pub mod json_util;
pub mod outline;
pub mod preflight;
pub mod reverse_outline;
pub mod scoring;
pub mod seqmatch;
pub mod tex;
pub mod verify_refs;
pub mod worklog;
pub mod workspace;
