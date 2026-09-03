//! Direct port of `design_system.py`'s `persist_design_system`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::design_system::DesignSystem;
use super::master_md::format_master_md;
use super::page_override::format_page_override_md;

/// Result of persisting a design system, mirroring the dict `persist_design_system`
/// returns in Python (`status`, `design_system_dir`, `created_files`).
#[derive(Debug, Clone)]
pub struct PersistResult {
    pub status: &'static str,
    pub design_system_dir: PathBuf,
    pub created_files: Vec<PathBuf>,
}

/// `<project_name>.lower().replace(' ', '-')` — Python's exact (non-full) slugify:
/// only lowercasing and space-to-hyphen substitution, nothing else.
pub fn slugify(s: &str) -> String {
    s.to_lowercase().replace(' ', "-")
}

/// `persist_design_system`: write `MASTER.md` (and optionally a page override file)
/// to `design-system/<project-slug>/` under `output_dir` (default: current working
/// directory).
pub fn persist_design_system(
    ds: &DesignSystem,
    page: Option<&str>,
    output_dir: Option<&Path>,
    page_query: Option<&str>,
) -> io::Result<PersistResult> {
    let base_dir = match output_dir {
        Some(dir) => dir.to_path_buf(),
        None => std::env::current_dir()?,
    };

    let project_name = if ds.project_name.is_empty() {
        "default".to_string()
    } else {
        ds.project_name.clone()
    };
    let project_slug = slugify(&project_name);

    let design_system_dir = base_dir.join("design-system").join(&project_slug);
    let pages_dir = design_system_dir.join("pages");

    let mut created_files = Vec::new();

    fs::create_dir_all(&design_system_dir)?;
    fs::create_dir_all(&pages_dir)?;

    let master_file = design_system_dir.join("MASTER.md");
    let master_content = format_master_md(ds);
    fs::write(&master_file, master_content)?;
    created_files.push(master_file);

    if let Some(page) = page {
        let page_file = pages_dir.join(format!("{}.md", slugify(page)));
        let page_content = format_page_override_md(ds, page, page_query);
        fs::write(&page_file, page_content)?;
        created_files.push(page_file);
    }

    Ok(PersistResult {
        status: "success",
        design_system_dir,
        created_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_matches_python_simple_rule() {
        assert_eq!(slugify("My Project"), "my-project");
        assert_eq!(slugify("SaaS Dashboard 2.0"), "saas-dashboard-2.0");
        assert_eq!(slugify("Already-Hyphenated"), "already-hyphenated");
    }

    #[test]
    fn persist_writes_master_and_page_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ds = DesignSystem {
            project_name: "My Project".to_string(),
            ..Default::default()
        };

        let result = persist_design_system(
            &ds,
            Some("Dashboard"),
            Some(dir.path()),
            Some("SaaS dashboard"),
        )
        .expect("persist should succeed");

        assert_eq!(result.status, "success");
        assert_eq!(result.created_files.len(), 2);

        let master_path = dir
            .path()
            .join("design-system")
            .join("my-project")
            .join("MASTER.md");
        let page_path = dir
            .path()
            .join("design-system")
            .join("my-project")
            .join("pages")
            .join("dashboard.md");

        assert!(master_path.exists());
        assert!(page_path.exists());

        let master_content = fs::read_to_string(&master_path).unwrap();
        assert!(master_content.starts_with("# Design System Master File"));

        let page_content = fs::read_to_string(&page_path).unwrap();
        assert!(page_content.starts_with("# Dashboard Page Overrides"));
    }

    #[test]
    fn persist_without_page_only_writes_master() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ds = DesignSystem {
            project_name: "NoPage".to_string(),
            ..Default::default()
        };

        let result = persist_design_system(&ds, None, Some(dir.path()), None)
            .expect("persist should succeed");
        assert_eq!(result.created_files.len(), 1);

        let pages_dir = dir
            .path()
            .join("design-system")
            .join("nopage")
            .join("pages");
        assert!(
            pages_dir.exists(),
            "pages dir is still created even with no page"
        );
        assert_eq!(fs::read_dir(&pages_dir).unwrap().count(), 0);
    }

    #[test]
    fn persist_defaults_project_slug_when_project_name_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ds = DesignSystem::default();

        let result = persist_design_system(&ds, None, Some(dir.path()), None)
            .expect("persist should succeed");
        assert!(result.design_system_dir.ends_with("design-system/default"));
    }
}
