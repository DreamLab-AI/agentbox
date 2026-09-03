//! The packaged self-check: the accessible-SVG contract, the single-file safety
//! rules, and the structural motion contract. A distilled subset of the
//! repository gates, which remain the authority for repository contributions.

pub mod checks;
pub mod html;
pub mod refs;

use std::path::PathBuf;

/// Where the canonical motion controller lives. The binary no longer sits
/// inside the skill, so the template is located by flag, then environment, then
/// the installed and in-repo locations, in that order.
pub fn resolve_motion_template(explicit: Option<&str>) -> PathBuf {
    if let Some(explicit) = explicit {
        return PathBuf::from(explicit);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(skill_dir) = std::env::var("DIAGRAM_DESIGN_SKILL_DIR") {
        if !skill_dir.is_empty() {
            candidates.push(
                PathBuf::from(skill_dir)
                    .join("assets")
                    .join("template-motion.html"),
            );
        }
    }
    candidates.push(PathBuf::from(
        "/opt/agentbox/skills/diagram-design/assets/template-motion.html",
    ));
    candidates.push(PathBuf::from(
        "./skills/diagram-design/assets/template-motion.html",
    ));
    for candidate in &candidates {
        if candidate.is_file() {
            return candidate.clone();
        }
    }
    candidates.pop().expect("the candidate list is never empty")
}
