//! Devil's Advocate concession guard (derived from `concession_guard.py`).
//!
//! A simulated adversarial reviewer tends to cave as soon as the author pushes
//! back. This module checks the reviewer's concession log against two hard
//! rules so the language model cannot quietly relax them:
//!
//! 1. A concession needs a rebuttal score of at least 4 (otherwise it is
//!    *caving* and is rejected).
//! 2. At most one concession in any two consecutive rounds: a valid concession
//!    in round *n* rejects any further concession in round *n* and in round
//!    *n + 1*.
//!
//! The log is validated strictly: every round needs an integer `round`, and
//! every finding needs a `severity` of `critical`, `major` or `minor` (any
//! letter case). A guard that guessed missing values could let a critical
//! finding through, so anything else is an input error.
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

/// The lower-case severity of a finding.
fn severity_of(f: &Value) -> Result<String, String> {
    let id = f.get("id").and_then(Value::as_str).unwrap_or("?");
    match f.get("severity") {
        None | Some(Value::Null) => Err(format!(
            "finding {id} has no `severity` (expected one of {VALID_SEVERITY:?}, any case)"
        )),
        Some(Value::String(s)) if VALID_SEVERITY.contains(&s.trim().to_lowercase().as_str()) => {
            Ok(s.trim().to_lowercase())
        }
        Some(other) => Err(format!(
            "finding {id} has invalid severity {other} (expected one of {VALID_SEVERITY:?}, any case)"
        )),
    }
}

/// Validates the log shape (non-empty `rounds`, integer round numbers, known
/// severities, scores in 1–5) and returns the rounds.
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
        match r.get("round") {
            Some(Value::Number(n)) if n.is_i64() || n.is_u64() => {}
            other => {
                return Err(format!(
                    "every round needs an integer `round`, found {}",
                    other.map_or_else(|| "none".to_string(), ToString::to_string)
                ))
            }
        }
        let findings = match r.get("findings") {
            None => continue,
            Some(Value::Array(a)) => a,
            Some(_) => return Err("round 'findings' must be a list".into()),
        };
        for f in findings {
            let id = f.get("id").and_then(Value::as_str).unwrap_or("?");
            severity_of(f)?;
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

/// Applies the two rules to rounds accepted by [`validate_log`].
#[must_use]
pub fn analyse(rounds: &[Value]) -> GuardReport {
    let mut violations = Vec::new();
    let mut valid = Vec::new();
    let mut standing = Vec::new();
    let mut last_conceded: Option<i64> = None;

    for r in rounds {
        let rnum = r.get("round").cloned().unwrap_or(Value::Null);
        let rint = rnum.as_i64();
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
            let sev = severity_of(f).unwrap_or_default();
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
                    last_conceded.zip(rint).filter(|(l, n)| n.abs_diff(*l) <= 1)
                {
                    let detail = if last == now {
                        format!(
                            "a second concession in round {now}; rejected (max one per two rounds)"
                        )
                    } else {
                        format!(
                            "concession in round {now} immediately follows a concession in round \
                             {last}; rejected (max one per two rounds)"
                        )
                    };
                    violations.push(Violation {
                        round: rnum.clone(),
                        id: id.clone(),
                        kind: "consecutive_concession",
                        detail,
                    });
                } else {
                    concession_valid = true;
                    last_conceded = rint;
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
    fn severity_is_case_insensitive_and_a_critical_still_blocks() {
        let r = run(json!({"rounds":[{"round":1,"findings":[
            {"id":"F1","severity":"CRITICAL","attack":"x"},
            {"id":"F2","severity":"Major"}]}]}));
        assert_eq!((r.exit_code(), r.standing_criticals.len()), (1, 1));
        let r = run(json!({"rounds":[{"round":1,"findings":[
            {"id":"F1","severity":"Critical","rebuttal_score":5,"conceded":true}]}]}));
        assert_eq!(r.valid_concessions[0].severity, "critical");
    }

    #[test]
    fn at_most_one_concession_within_a_round() {
        let r = run(json!({"rounds":[{"round":1,"findings":[
            {"id":"A","severity":"major","rebuttal_score":5,"conceded":true},
            {"id":"B","severity":"major","rebuttal_score":5,"conceded":true}]}]}));
        assert_eq!(r.valid_concessions.len(), 1);
        assert_eq!(r.violations.len(), 1);
        assert_eq!(r.violations[0].id, "B");
        assert!(r.violations[0]
            .detail
            .contains("second concession in round 1"));
        assert_eq!(r.exit_code(), 2);
    }

    #[test]
    fn missing_severity_and_non_integer_rounds_are_input_errors() {
        let ok_f = json!([{"id":"F","severity":"minor"}]);
        for (log, needle) in [
            (
                json!({"rounds":[{"round":1,"findings":[{"id":"F"}]}]}),
                "no `severity`",
            ),
            (
                json!({"rounds":[{"round":1,"findings":[{"id":"F","Severity":"critical"}]}]}),
                "no `severity`",
            ),
            (
                json!({"rounds":[{"round":1,"findings":[{"id":"F","severity":null}]}]}),
                "no `severity`",
            ),
            (
                json!({"rounds":[{"round":1,"findings":[{"id":"F","severity":3}]}]}),
                "invalid severity",
            ),
            (
                json!({"rounds":[{"round":"1","findings":ok_f}]}),
                "integer `round`",
            ),
            (
                json!({"rounds":[{"round":1.5,"findings":[]}]}),
                "integer `round`",
            ),
            (json!({"rounds":[{"findings":[]}]}), "integer `round`"),
        ] {
            let e = validate_log(&log).unwrap_err();
            assert!(e.contains(needle), "{log}: {e}");
        }
    }

    #[test]
    fn schema_errors() {
        assert!(validate_log(&json!({"rounds":[]})).is_err());
        assert!(
            validate_log(&json!({"rounds":[{"round":1,"findings":[{"severity":"fatal"}]}]}))
                .is_err()
        );
        assert!(validate_log(
            &json!({"rounds":[{"round":1,"findings":[{"severity":"minor","rebuttal_score":9}]}]})
        )
        .is_err());
    }
}
