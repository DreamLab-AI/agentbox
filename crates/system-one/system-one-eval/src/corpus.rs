//! The labelled case set and the candidate map it is scored against.
//!
//! Two separate things are loaded here and they must not be confused. The
//! *cases* are labels — a prompt and the skill that should handle it. The
//! *candidates* are the text a backend actually scores: every baked skill's
//! frontmatter `description`, assembled exactly as `skill-route.cjs` assembles
//! it. If the rig built that map any other way it would be measuring a request
//! the router never sends.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// One labelled routing case.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Case {
    /// A user turn, as a user would type it.
    pub prompt: String,
    /// The skill that should be chosen, or the literal `none`.
    pub expected_skill: String,
    /// Why that label and not the nearest wrong one.
    #[serde(default)]
    pub rationale: String,
    /// `none` | `near-neighbour` | `boundary` | `single`.
    #[serde(default)]
    pub class: String,
    /// Where the prompt came from.
    #[serde(default)]
    pub provenance: String,
    /// Explicit late-discriminator flag, when the corpus carries one.
    ///
    /// The corpus at `tests/system-one/routing-cases.json` does not, so the rig
    /// derives the subgroup instead — see [`Case::late_discriminator`].
    #[serde(default)]
    pub late_discriminator: Option<bool>,
}

impl Case {
    /// Whether this case's discriminative information sits late in the rubric.
    ///
    /// Honours an explicit corpus flag when there is one. Otherwise it is
    /// derived from the text under test: a case is late-discriminative when
    /// the boundary clause of its expected skill's description ("NOT for…",
    /// "rather than…", "unless…") begins beyond `option_budget` tokens — that
    /// is, beyond the point at which laya's unconditional 48-token option
    /// truncation would have thrown it away. That subgroup is the one that
    /// separates deliberate compression from naive truncation, so it is
    /// reported on its own.
    pub fn late_discriminator(
        &self,
        candidates: &IndexMap<String, String>,
        option_budget: usize,
    ) -> bool {
        if let Some(flag) = self.late_discriminator {
            return flag;
        }
        candidates
            .get(&self.expected_skill)
            .and_then(|rubric| system_one_facade::compress::boundary_offset(rubric))
            .is_some_and(|offset| offset > option_budget)
    }
}

/// The corpus file as it is on disk.
#[derive(Debug, Clone, Deserialize)]
pub struct Corpus {
    /// What the corpus is for.
    #[serde(default, rename = "_role")]
    pub role: String,
    /// The labelled cases.
    pub cases: Vec<Case>,
}

impl Corpus {
    /// Read and validate a corpus file.
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(path)
            .map_err(|e| format!("cannot read case set {}: {e}", path.display()))?;
        let corpus: Corpus = serde_json::from_str(&text)
            .map_err(|e| format!("{} is not a case set: {e}", path.display()))?;
        if corpus.cases.is_empty() {
            return Err(format!("{} contains no cases", path.display()));
        }
        Ok(corpus)
    }

    /// Cases whose label is not in the candidate map, which cannot be scored.
    ///
    /// Reported rather than silently dropped: a label that no longer names a
    /// live skill is a corpus bug, and hiding it would quietly inflate the
    /// accuracy of every run after a skill is renamed.
    pub fn unscorable(&self, candidates: &IndexMap<String, String>) -> Vec<String> {
        let mut missing: BTreeMap<String, usize> = BTreeMap::new();
        for case in &self.cases {
            if case.expected_skill != "none" && !candidates.contains_key(&case.expected_skill) {
                *missing.entry(case.expected_skill.clone()).or_insert(0) += 1;
            }
        }
        missing
            .into_iter()
            .map(|(name, count)| format!("{name} ({count} cases)"))
            .collect()
    }
}

/// Statuses that are never routable at runtime (mirrors `skill-route.cjs`).
const EXCLUDED_STATUS: [&str; 4] = ["deprecated", "superseded", "not-installed", "router-only"];

/// Read the frontmatter `description`: folded block, quoted or bare scalar.
///
/// The three shapes are the three `skill-route.cjs` accepts, in its order.
fn description(md: &str) -> Option<String> {
    let mut lines = md.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(rest) = line.strip_prefix("description:") else {
            continue;
        };
        let rest = rest.trim();
        if rest == ">-" || rest == ">" || rest == "|" {
            let mut folded: Vec<String> = Vec::new();
            for next in lines.by_ref() {
                if !next.starts_with(' ') && !next.starts_with('\t') {
                    break;
                }
                let trimmed = next.trim();
                if !trimmed.is_empty() {
                    folded.push(trimmed.to_string());
                }
            }
            return if folded.is_empty() {
                None
            } else {
                Some(folded.join(" "))
            };
        }
        if rest.len() >= 2 && rest.starts_with('"') && rest.ends_with('"') {
            return Some(rest[1..rest.len() - 1].to_string());
        }
        if !rest.is_empty() {
            return Some(rest.to_string());
        }
    }
    None
}

/// Read a bare frontmatter field.
fn field(md: &str, key: &str) -> String {
    md.lines()
        .find_map(|line| line.strip_prefix(&format!("{key}:")))
        .map(|v| v.trim().to_string())
        .unwrap_or_default()
}

/// The candidate map a backend is asked to choose from.
///
/// Mirrors `loadCandidates` in `config/hooks/lib/skill-route.cjs`: every
/// directory with a `SKILL.md` that has a description, minus the statuses a
/// runtime router must never pick, with the gated-off note rendered at the
/// point of use rather than baked into the prose.
pub fn load_candidates(skills_dir: &Path) -> Result<IndexMap<String, String>, String> {
    let mut names: Vec<String> = fs::read_dir(skills_dir)
        .map_err(|e| format!("cannot read skills tree {}: {e}", skills_dir.display()))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();

    let mut out = IndexMap::new();
    for name in names {
        let path = skills_dir.join(&name).join("SKILL.md");
        let Ok(md) = fs::read_to_string(&path) else {
            continue;
        };
        let Some(mut desc) = description(&md) else {
            continue;
        };
        let status = {
            let s = field(&md, "status");
            if s.is_empty() {
                "live".to_string()
            } else {
                s
            }
        };
        if EXCLUDED_STATUS.contains(&status.as_str()) {
            continue;
        }
        if md.lines().any(|l| l.starts_with("deprecated: true")) {
            continue;
        }
        if status == "gated" {
            desc = format!(
                "GATED OFF by default in this environment — do not choose unless its manifest \
                 gate is enabled. {desc}"
            );
        }
        out.insert(name, desc);
    }
    if out.is_empty() {
        return Err(format!(
            "no candidate skills under {}",
            skills_dir.display()
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_all_three_description_shapes() {
        assert_eq!(
            description("description: bare text\n").as_deref(),
            Some("bare text")
        );
        assert_eq!(
            description("description: \"quoted\"\n").as_deref(),
            Some("quoted")
        );
        assert_eq!(
            description("name: x\ndescription: >-\n  first line\n  second line\nstatus: live\n")
                .as_deref(),
            Some("first line second line")
        );
        assert_eq!(description("name: x\n"), None);
    }

    #[test]
    fn late_discriminator_is_derived_from_the_rubric_under_test() {
        let mut candidates = IndexMap::new();
        candidates.insert(
            "late".to_string(),
            "Generates and maintains a whole checked-in diagram corpus for a repository, in \
             Mermaid and D2, with an audit of what has drifted from HEAD, a refresh on request, \
             and a review pass that reconciles every rendered artefact against the sources it \
             was generated from. NOT for a single diagram in a reply."
                .to_string(),
        );
        candidates.insert(
            "early".to_string(),
            "NOT for single diagrams. Maintains a corpus.".to_string(),
        );

        let case = |skill: &str| Case {
            prompt: "p".into(),
            expected_skill: skill.into(),
            rationale: String::new(),
            class: String::new(),
            provenance: String::new(),
            late_discriminator: None,
        };
        assert!(case("late").late_discriminator(&candidates, 44));
        assert!(!case("early").late_discriminator(&candidates, 44));
        assert!(!case("none").late_discriminator(&candidates, 44));

        let explicit = Case {
            late_discriminator: Some(true),
            ..case("early")
        };
        assert!(
            explicit.late_discriminator(&candidates, 44),
            "an explicit flag wins"
        );
    }

    #[test]
    fn unscorable_labels_are_reported_not_hidden() {
        let corpus = Corpus {
            role: String::new(),
            cases: vec![
                Case {
                    prompt: "p".into(),
                    expected_skill: "gone".into(),
                    rationale: String::new(),
                    class: String::new(),
                    provenance: String::new(),
                    late_discriminator: None,
                },
                Case {
                    prompt: "p".into(),
                    expected_skill: "none".into(),
                    rationale: String::new(),
                    class: String::new(),
                    provenance: String::new(),
                    late_discriminator: None,
                },
            ],
        };
        let candidates = IndexMap::new();
        assert_eq!(
            corpus.unscorable(&candidates),
            vec!["gone (1 cases)".to_string()]
        );
    }
}
