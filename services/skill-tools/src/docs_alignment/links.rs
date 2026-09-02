//! Port of `validate_links.py`'s `LinkValidator`: markdown link extraction,
//! internal/anchor/code link resolution, and orphan-document detection.
//!
//! The external-URL HEAD-check path (`--check-external`) lives in
//! [`crate::docs_alignment::links_external`] since it needs an async HTTP
//! client; this module does everything else synchronously, exposing
//! [`LinkValidator::links_mut`] so the binary can run the external check as a
//! second pass before calling [`LinkValidator::finalize`].

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use regex::Regex;
use walkdir::WalkDir;

use super::cli::path_contains_any;
use super::models::{LinkInfo, ValidationReport};

/// File extensions considered documentation (`validate_links.py::DOC_EXTENSIONS`).
const DOC_EXTENSIONS: &[&str] = &[".md", ".markdown", ".mdx", ".rst", ".txt"];

/// File extensions considered code, for forward-link classification
/// (`validate_links.py::CODE_EXTENSIONS`).
const CODE_EXTENSIONS: &[&str] = &[".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java"];

/// Extra ignore substrings on top of the shared [`super::cli::DEFAULT_IGNORES`]
/// — `validate_links.py::should_ignore`'s `default_ignores` list is exactly
/// the shared list, so no extras are needed here; kept as a hook for parity
/// with the other two scanners' narrower lists.
const EXTRA_IGNORES: &[&str] = &[];

/// Lexically normalize a path (resolve `.`/`..` components without touching
/// the filesystem) — mirrors the *normalization* half of Python's
/// `Path.resolve()` closely enough for link targets that may not exist yet.
fn lexical_normalize(path: &Path) -> PathBuf {
    let mut stack: Vec<std::path::Component> = Vec::new();
    for comp in path.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => match stack.last() {
                Some(std::path::Component::Normal(_)) => {
                    stack.pop();
                }
                _ => stack.push(comp),
            },
            other => stack.push(other),
        }
    }
    let mut result = PathBuf::new();
    for comp in stack {
        result.push(comp.as_os_str());
    }
    result
}

pub struct LinkValidator {
    root: PathBuf,
    docs_dir: String,
    check_external: bool,
    ignore_patterns: Vec<String>,

    doc_files: Vec<PathBuf>,
    links: Vec<LinkInfo>,
    file_anchors: HashMap<PathBuf, HashSet<String>>,
    inbound_links: HashMap<PathBuf, HashSet<PathBuf>>,

    md_link_re: Regex,
    md_ref_link_re: Regex,
    md_ref_def_re: Regex,
    html_link_re: Regex,
    anchor_re: Regex,
    fmt_re: Regex,
    ws_re: Regex,
    nonalnum_re: Regex,
    multihyphen_re: Regex,
}

impl LinkValidator {
    pub fn new(
        root: &Path,
        docs_dir: &str,
        check_external: bool,
        ignore_patterns: Vec<String>,
    ) -> Self {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        Self {
            root,
            docs_dir: docs_dir.to_string(),
            check_external,
            ignore_patterns,
            doc_files: Vec::new(),
            links: Vec::new(),
            file_anchors: HashMap::new(),
            inbound_links: HashMap::new(),
            md_link_re: Regex::new(r"\[([^\]]*)\]\(([^)]+)\)").unwrap(),
            md_ref_link_re: Regex::new(r"\[([^\]]*)\]\[([^\]]*)\]").unwrap(),
            md_ref_def_re: Regex::new(r"(?m)^\[([^\]]+)\]:\s*(.+)$").unwrap(),
            html_link_re: Regex::new(r#"<a\s+[^>]*href=["']([^"']+)["'][^>]*>"#).unwrap(),
            anchor_re: Regex::new(r"(?m)^#+\s+(.+)$").unwrap(),
            fmt_re: Regex::new(r"\*\*|__|\*|_|`").unwrap(),
            ws_re: Regex::new(r"\s+").unwrap(),
            nonalnum_re: Regex::new(r"[^a-z0-9-]").unwrap(),
            multihyphen_re: Regex::new(r"-+").unwrap(),
        }
    }

    pub fn check_external(&self) -> bool {
        self.check_external
    }

    /// Mutable access to the collected links, for the async external-URL
    /// check pass to update in place.
    pub fn links_mut(&mut self) -> &mut Vec<LinkInfo> {
        &mut self.links
    }

    fn should_ignore(&self, path: &Path) -> bool {
        let patterns: Vec<&str> = self.ignore_patterns.iter().map(String::as_str).collect();
        if path_contains_any(path, &patterns) {
            return true;
        }
        path_contains_any(path, super::cli::DEFAULT_IGNORES)
            || path_contains_any(path, EXTRA_IGNORES)
    }

    fn discover_files(&mut self) {
        for entry in WalkDir::new(&self.root).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !entry.file_type().is_file() || self.should_ignore(path) {
                continue;
            }
            let ext = path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default();
            if DOC_EXTENSIONS.contains(&ext.as_str()) {
                self.doc_files.push(path.to_path_buf());
            }
        }
    }

    fn slugify_heading(&self, heading: &str) -> String {
        let slug = self.fmt_re.replace_all(heading, "").to_lowercase();
        let slug = self.ws_re.replace_all(&slug, "-");
        let slug = self.nonalnum_re.replace_all(&slug, "");
        let slug = self.multihyphen_re.replace_all(&slug, "-");
        slug.trim_matches('-').to_string()
    }

    fn extract_anchors(&self, content: &str) -> HashSet<String> {
        let mut anchors = HashSet::new();
        for caps in self.anchor_re.captures_iter(content) {
            let heading = caps[1].trim();
            let anchor = self.slugify_heading(heading);
            if !anchor.is_empty() {
                anchors.insert(anchor);
            }
        }
        anchors
    }

    fn classify_link(&self, target: &str) -> &'static str {
        if target.starts_with('#') {
            return "anchor";
        }
        if target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("mailto:")
            || target.starts_with("ftp://")
        {
            return "external";
        }
        // Minimal urlparse(...).path equivalent: strip fragment then query.
        let no_frag = target.split('#').next().unwrap_or(target);
        let path_part = no_frag.split('?').next().unwrap_or(no_frag);
        if CODE_EXTENSIONS.iter().any(|ext| path_part.ends_with(ext)) {
            return "code";
        }
        "internal"
    }

    fn extract_links(&self, file_path: &Path, content: &str) -> Vec<LinkInfo> {
        let mut links = Vec::new();
        let rel_source = file_path
            .strip_prefix(&self.root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        let mut ref_defs: HashMap<String, String> = HashMap::new();
        for caps in self.md_ref_def_re.captures_iter(content) {
            ref_defs.insert(caps[1].to_lowercase(), caps[2].trim().to_string());
        }

        for (idx, line) in content.split('\n').enumerate() {
            let line_num = idx + 1;

            for caps in self.md_link_re.captures_iter(line) {
                let text = caps[1].to_string();
                let target = caps[2].to_string();
                let link_type = self.classify_link(&target).to_string();
                links.push(LinkInfo {
                    source_file: rel_source.clone(),
                    line_number: line_num,
                    link_text: text,
                    link_target: target,
                    link_type,
                    is_valid: true,
                    error_message: None,
                });
            }

            for caps in self.md_ref_link_re.captures_iter(line) {
                let text = caps[1].to_string();
                let ref_name = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let ref_key = if ref_name.is_empty() {
                    text.clone()
                } else {
                    ref_name.to_string()
                }
                .to_lowercase();
                if let Some(target) = ref_defs.get(&ref_key) {
                    let link_type = self.classify_link(target).to_string();
                    links.push(LinkInfo {
                        source_file: rel_source.clone(),
                        line_number: line_num,
                        link_text: text,
                        link_target: target.clone(),
                        link_type,
                        is_valid: true,
                        error_message: None,
                    });
                }
            }

            for caps in self.html_link_re.captures_iter(line) {
                let target = caps[1].to_string();
                let link_type = self.classify_link(&target).to_string();
                links.push(LinkInfo {
                    source_file: rel_source.clone(),
                    line_number: line_num,
                    link_text: "<html link>".to_string(),
                    link_target: target,
                    link_type,
                    is_valid: true,
                    error_message: None,
                });
            }
        }

        links
    }

    fn resolve_link(&self, source: &Path, target: &str) -> (Option<PathBuf>, Option<String>) {
        let (path_part, anchor) = match target.find('#') {
            Some(idx) => (&target[..idx], Some(target[idx + 1..].to_string())),
            None => (target, None),
        };

        if path_part.is_empty() {
            return (Some(source.to_path_buf()), anchor);
        }

        let decoded = urlencoding::decode(path_part)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| path_part.to_string());

        let source_dir = source.parent().unwrap_or_else(|| Path::new(""));
        let target_path = lexical_normalize(&source_dir.join(&decoded));

        if target_path.strip_prefix(&self.root).is_err() {
            return (None, anchor);
        }

        (Some(target_path), anchor)
    }

    /// Validate a non-external link in place (anchor / internal / code) —
    /// external links are left untouched (default `is_valid = true`) for the
    /// async pass to handle.
    fn validate_local(&mut self, mut link: LinkInfo, source_path: &Path) -> LinkInfo {
        if link.link_type == "external" {
            return link;
        }

        if link.link_type == "anchor" {
            let anchor = link.link_target.trim_start_matches('#').to_string();
            if let Some(anchors) = self.file_anchors.get(source_path) {
                if !anchors.contains(&anchor) {
                    link.is_valid = false;
                    link.error_message = Some(format!("Anchor '{anchor}' not found in file"));
                }
            }
            return link;
        }

        // Internal or code link.
        let (resolved_path, anchor) = self.resolve_link(source_path, &link.link_target);
        let resolved_path = match resolved_path {
            None => {
                link.is_valid = false;
                link.error_message = Some("Path resolves outside project".to_string());
                return link;
            }
            Some(p) => p,
        };

        if !resolved_path.exists() {
            link.is_valid = false;
            link.error_message = Some("File not found".to_string());
            return link;
        }

        self.inbound_links
            .entry(resolved_path.clone())
            .or_default()
            .insert(source_path.to_path_buf());

        if let Some(anchor) = anchor {
            if let Some(anchors) = self.file_anchors.get(&resolved_path) {
                if !anchors.contains(&anchor) {
                    link.is_valid = false;
                    link.error_message =
                        Some(format!("Anchor '{anchor}' not found in target file"));
                }
            }
        }

        link
    }

    fn find_orphan_docs(&self) -> Vec<String> {
        let mut orphans = Vec::new();
        for doc_file in &self.doc_files {
            let name_lower = doc_file
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if matches!(name_lower.as_str(), "readme.md" | "index.md" | "toc.md") {
                continue;
            }
            let has_inbound = self
                .inbound_links
                .get(doc_file)
                .is_some_and(|s| !s.is_empty());
            if !has_inbound {
                if let Ok(rel) = doc_file.strip_prefix(&self.root) {
                    orphans.push(rel.to_string_lossy().to_string());
                }
            }
        }
        orphans.sort();
        orphans
    }

    /// Run discovery, anchor extraction, and validation of every
    /// non-external link. Call [`Self::links_mut`] afterwards (optionally)
    /// to run the external-URL check, then [`Self::finalize`].
    pub fn validate_local_pass(&mut self) {
        let _ = &self.docs_dir; // docs_dir mirrors Python's constructor arg; root is walked directly.
        println!("Discovering files...");
        self.discover_files();
        println!("Found {} documentation files", self.doc_files.len());

        println!("Extracting anchors...");
        let doc_files = self.doc_files.clone();
        for doc_file in &doc_files {
            match std::fs::read_to_string(doc_file) {
                Ok(content) => {
                    let anchors = self.extract_anchors(&content);
                    self.file_anchors.insert(doc_file.clone(), anchors);
                }
                Err(e) => println!("Warning: Could not read {}: {e}", doc_file.display()),
            }
        }

        println!("Validating links...");
        for doc_file in &doc_files {
            match std::fs::read_to_string(doc_file) {
                Ok(content) => {
                    let file_links = self.extract_links(doc_file, &content);
                    for link in file_links {
                        let validated = self.validate_local(link, doc_file);
                        self.links.push(validated);
                    }
                }
                Err(e) => println!("Warning: Could not process {}: {e}", doc_file.display()),
            }
        }
    }

    pub fn finalize(&self) -> ValidationReport {
        let broken_links: Vec<LinkInfo> =
            self.links.iter().filter(|l| !l.is_valid).cloned().collect();
        let valid_count = self.links.iter().filter(|l| l.is_valid).count();
        let orphan_docs = self.find_orphan_docs();

        let mut forward_links: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut backward_links: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for link in &self.links {
            if !link.is_valid {
                continue;
            }
            if link.link_type == "code" {
                forward_links
                    .entry(link.source_file.clone())
                    .or_default()
                    .push(link.link_target.clone());
            } else if link.link_type == "internal" {
                backward_links
                    .entry(link.source_file.clone())
                    .or_default()
                    .push(link.link_target.clone());
            }
        }

        let anchor_errors: Vec<LinkInfo> = self
            .links
            .iter()
            .filter(|l| {
                !l.is_valid
                    && l.error_message
                        .as_deref()
                        .is_some_and(|m| m.contains("Anchor"))
            })
            .cloned()
            .collect();

        ValidationReport {
            total_files: self.doc_files.len(),
            total_links: self.links.len(),
            valid_links: valid_count,
            broken_links,
            orphan_docs,
            forward_links,
            backward_links,
            anchor_errors,
        }
    }
}

#[cfg(test)]
#[path = "links_tests.rs"]
mod tests;
