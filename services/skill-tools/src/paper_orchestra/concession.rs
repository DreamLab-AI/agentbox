//! Devil's Advocate concession guard (derived from `concession_guard.py`).
//!
//! A simulated adversarial reviewer tends to cave as soon as the author pushes
//! back. This module checks the reviewer's concession log against two hard
//! rules so the language model cannot quietly relax them:
//!
//! 1. A concession needs a rebuttal score of at least 4 (otherwise it is
//!    *caving* and is rejected).
//! 2. No consecutive concessions: a valid concession in round *n* rejects any
//!    concession in round *n + 1*.
//!
//! A critical finding that is neither resolved nor validly conceded *blocks*
//! acceptance of the refinement iteration.

use serde::Serialize;
use serde_json::Value;

use super::json_util::truthy;

/// Minimum rebuttal score that justifies a concession.
pub const CONCESSION_MIN_REBUTTAL: f64 = 4.0;

/// A valid concession.
#[derive(Debug, Serialize, PartialEq)]
pub struct ValidConcession {
    /// Round number.
    pub round: Value,
    /// Finding id.
    pub id: String,
    /// Finding severity.
    pub severity: String,
}

/// A protocol violation.
#[derive(Debug, Serialize, PartialEq)]
pub struct Violation {
    /// Round number.
    pub round: Value,
    /// Finding id.
    pub id: String,
    /// `caving` or `consecutive_concession`.
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Explanation.
    pub detail: String,
}

/// A critical finding still standing.
#[derive(Debug, Serialize, PartialEq)]
pub struct StandingCritical {
    /// Round number.
    pub round: Value,
    /// Finding id.
    pub id: String,
    /// The attack text.
    pub attack: String,
}

/// The guard's verdict.
#[derive(Debug, Serialize)]
pub struct GuardReport {
    /// Rounds analysed.
    pub rounds_analyzed: usize,
    /// Concessions that satisfied both rules.
    pub valid_concessions: Vec<ValidConcession>,
    /// Rejected concessions.
    pub violations: Vec<Violation>,
    /// Critical findings still standing.
    pub standing_criticals: Vec<StandingCritical>,
    /// True when a critical is standing.
    pub block_accept: bool,
    /// `REVERT`, `DA_RESTATE` or `PROCEED`.
    pub recommended_action: &'static str,
}

impl GuardReport {
    /// Process exit code: 1 block, 2 violations only, 0 clear.
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        if self.block_accept {
            1
        } else if self.violations.is_empty() {
            0
        } else {
            2
        }
    }
}

const VALID_SEVERITY: [&str; 3] = ["critical", "major", "minor"];

/// Validates the log shape (non-empty `rounds`, known severities, scores in
/// 1–5) and returns the rounds.
///
/// # Errors
///
/// A message describing the first schema problem.
pub fn validate_log(log: &Value) -> Result<&Vec<Value>, String> {
    let rounds = match log.get("rounds").and_then(Value::as_array) {
        Some(r) if !r.is_empty() => r,
        _ => return Err("log['rounds'] must be a non-empty list".into()),
    };
    for r in rounds {
        if !r.is_object() {
            return Err("every round must be an object".into());
        }
        let findings = match r.get("findings") {
            None => continue,
            Some(Value::Array(a)) => a,
            Some(_) => return Err("round 'findings' must be a list".into()),
        };
        for f in findings {
            let id = f.get("id").and_then(Value::as_str).unwrap_or("?");
            let sev = f.get("severity").and_then(Value::as_str).unwrap_or("minor");
            if !VALID_SEVERITY.contains(&sev) {
                return Err(format!(
                    "finding {id} has invalid severity '{sev}' (expected one of {VALID_SEVERITY:?})"
                ));
            }
            match f.get("rebuttal_score") {
                None | Some(Value::Null) => {}
                Some(Value::Number(n)) => {
                    let s = n.as_f64().unwrap_or(f64::NAN);
                    if !(1.0..=5.0).contains(&s) {
                        return Err(format!("finding {id} rebuttal_score={n} out of range 1-5"));
                    }
                }
                Some(other) => {
                    return Err(format!(
                        "finding {id} rebuttal_score={other} is not a number"
                    ))
                }
            }
        }
    }
    Ok(rounds)
}

/// Applies the two rules to validated rounds.
#[must_use]
pub fn analyse(rounds: &[Value]) -> GuardReport {
    let mut violations = Vec::new();
    let mut valid = Vec::new();
    let mut standing = Vec::new();
    let mut last_conceded: Option<i64> = None;

    for r in rounds {
        let rnum = r.get("round").cloned().unwrap_or(Value::Null);
        let rint = rnum.as_i64();
        let mut conceded_this_round = false;
        let empty = Vec::new();
        let findings = r
            .get("findings")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        for f in findings {
            let id = f
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string();
            let sev = f
                .get("severity")
                .and_then(Value::as_str)
                .unwrap_or("minor")
                .to_string();
            let conceded = f.get("conceded").is_some_and(truthy);
            let resolved = f.get("resolved").is_some_and(truthy);
            let score = f.get("rebuttal_score").and_then(Value::as_f64);

            let mut concession_valid = false;
            if conceded {
                if score.is_none_or(|s| s < CONCESSION_MIN_REBUTTAL) {
                    let shown = f
                        .get("rebuttal_score")
                        .filter(|v| !v.is_null())
                        .map_or_else(|| "None".to_string(), ToString::to_string);
                    violations.push(Violation {
                        round: rnum.clone(),
                        id: id.clone(),
                        kind: "caving",
                        detail: format!(
                            "conceded at rebuttal_score={shown} (< {CONCESSION_MIN_REBUTTAL}); \
                             concession rejected"
                        ),
                    });
                } else if let Some((last, now)) =
                    last_conceded.zip(rint).filter(|(l, n)| *n == l + 1)
                {
                    violations.push(Violation {
                        round: rnum.clone(),
                        id: id.clone(),
                        kind: "consecutive_concession",
                        detail: format!(
                            "concession in round {now} immediately follows a concession in round \
                             {last}; rejected (max one per two rounds)"
                        ),
                    });
                } else {
                    concession_valid = true;
                    conceded_this_round = true;
                    valid.push(ValidConcession {
                        round: rnum.clone(),
                        id: id.clone(),
                        severity: sev.clone(),
                    });
                }
            }
            if sev == "critical" && !resolved && !concession_valid {
                standing.push(StandingCritical {
                    round: rnum.clone(),
                    id,
                    attack: f
                        .get("attack")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                });
            }
        }
        if conceded_this_round {
            last_conceded = rint;
        }
    }

    let block = !standing.is_empty();
    GuardReport {
        rounds_analyzed: rounds.len(),
        valid_concessions: valid,
        recommended_action: if block {
            "REVERT"
        } else if violations.is_empty() {
            "PROCEED"
        } else {
            "DA_RESTATE"
        },
        violations,
        standing_criticals: standing,
        block_accept: block,
    }
}

/// Human-readable summary of a report.
#[must_use]
pub fn summary(report: &GuardReport) -> String {
    let mut s = format!(
        "DA concession guard: {} round(s)  valid_concessions={}  violations={}  standing_criticals={}\n",
        report.rounds_analyzed,
        report.valid_concessions.len(),
        report.violations.len(),
        report.standing_criticals.len()
    );
    let r = |v: &Value| v.to_string();
    for v in &report.violations {
        s.push_str(&format!(
            "  VIOLATION [{}] round {} {}: {}\n",
            v.kind,
            r(&v.round),
            v.id,
            v.detail
        ));
    }
    for c in &report.standing_criticals {
        s.push_str(&format!(
            "  STANDING CRITICAL round {} {}: {}\n",
            r(&c.round),
            c.id,
            c.attack
        ));
    }
    s.push_str(&format!(
        "  → recommended action: {}\n",
        report.recommended_action
    ));
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(log: Value) -> GuardReport {
        analyse(validate_log(&log).unwrap())
    }

    #[test]
    fn clear_when_critical_is_resolved() {
        let r = run(json!({"rounds":[{"round":1,"findings":[
            {"id":"F1","severity":"critical","attack":"x","rebuttal_score":2,"conceded":false,"resolved":true}]}]}));
        assert_eq!((r.exit_code(), r.recommended_action), (0, "PROCEED"));
    }

    #[test]
    fn caving_is_rejected_and_critical_blocks() {
        let r = run(json!({"rounds":[{"round":1,"findings":[
            {"id":"F1","severity":"critical","attack":"causal overclaim","rebuttal_score":3,"conceded":true}]}]}));
        assert_eq!(r.violations[0].kind, "caving");
        assert!(r.violations[0].detail.contains("rebuttal_score=3"));
        assert_eq!((r.exit_code(), r.recommended_action), (1, "REVERT"));
        assert_eq!(r.standing_criticals[0].attack, "causal overclaim");
    }

    #[test]
    fn evidence_backed_concession_clears_a_critical() {
        let r = run(json!({"rounds":[{"round":1,"findings":[
            {"id":"F1","severity":"critical","rebuttal_score":5,"conceded":true}]}]}));
        assert_eq!(r.valid_concessions.len(), 1);
        assert_eq!(r.exit_code(), 0);
    }

    #[test]
    fn consecutive_concessions_are_rejected_but_gap_is_allowed() {
        let f = |round: i64, id: &str| {
            json!({"round":round,"findings":[
            {"id":id,"severity":"major","rebuttal_score":5,"conceded":true}]})
        };
        let r = run(json!({"rounds":[f(1,"A"), f(2,"B"), f(4,"C")]}));
        assert_eq!(
            r.valid_concessions
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            ["A", "C"]
        );
        assert_eq!(r.violations.len(), 1);
        assert_eq!(r.violations[0].kind, "consecutive_concession");
        assert_eq!((r.exit_code(), r.recommended_action), (2, "DA_RESTATE"));
    }

    #[test]
    fn missing_score_counts_as_caving() {
        let r = run(
            json!({"rounds":[{"round":1,"findings":[{"id":"F","severity":"minor","conceded":true}]}]}),
        );
        assert!(r.violations[0].detail.contains("rebuttal_score=None"));
    }

    #[test]
    fn schema_errors() {
        assert!(validate_log(&json!({"rounds":[]})).is_err());
        assert!(validate_log(&json!({"rounds":[{"findings":[{"severity":"fatal"}]}]})).is_err());
        assert!(validate_log(&json!({"rounds":[{"findings":[{"rebuttal_score":9}]}]})).is_err());
    }
}
