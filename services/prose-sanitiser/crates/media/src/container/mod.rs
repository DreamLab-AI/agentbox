//! Inspect/clean AI provenance metadata in non-raster containers.
//!
//! Formats: SVG, PDF, DOCX, ODT, HTML, Markdown frontmatter.
//!
//! Everything runs in-process: `lopdf` owns the PDF object graph, `zip` plus
//! `quick-xml` own the OOXML and ODF packages. Nothing shells out.

pub mod html;
pub mod markdown;
pub mod ooxml;
pub mod patterns;
pub mod pdf;
pub mod svg;

use std::path::Path;

use serde_json::{json, Map, Value};

use crate::image::tools::run_optional_tools;
use crate::io::safe_write_bytes;
use prose_sanitiser_core::classify_finding_confidence;
use prose_sanitiser_core::surrogate;
use prose_sanitiser_unicode::{clean_text, CleanOptions};

/// The container inspect result.
#[derive(Debug, Clone)]
pub struct ContainerInspectReport {
    pub path: String,
    pub format: String,
    pub has_c2pa: bool,
    pub has_ai_metadata: bool,
    pub findings: Vec<String>,
    pub tools: Value,
    pub details: Value,
    pub notes: Vec<String>,
}

impl ContainerInspectReport {
    pub fn to_json(&self) -> Value {
        json!({
            "path": self.path,
            "format": self.format,
            "has_c2pa": self.has_c2pa,
            "has_ai_metadata": self.has_ai_metadata,
            "findings": self.findings,
            "findings_confidence": self.findings.iter()
                .map(|finding| classify_finding_confidence(finding))
                .collect::<Vec<_>>(),
            "tools": self.tools,
            "details": self.details,
            "notes": self.notes,
        })
    }
}

/// Classify a container by extension first, then by its bytes.
pub fn detect_container_format(path: &Path, data: Option<&[u8]>) -> String {
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let by_extension = match extension.as_str() {
        "svg" => Some("svg"),
        "pdf" => Some("pdf"),
        "docx" => Some("docx"),
        "odt" => Some("odt"),
        "html" | "htm" => Some("html"),
        "md" | "markdown" | "mdx" => Some("markdown"),
        _ => None,
    };
    if let Some(format) = by_extension {
        return format.to_string();
    }

    if let Some(data) = data {
        if data.starts_with(b"%PDF") {
            return "pdf".to_string();
        }
        let head = &data[..data.len().min(100)];
        let trimmed: &[u8] = {
            let start = head
                .iter()
                .position(|byte| !byte.is_ascii_whitespace())
                .unwrap_or(head.len());
            &head[start..]
        };
        let first_500 = &data[..data.len().min(500)].to_ascii_lowercase();
        if trimmed.starts_with(b"<") && first_500.windows(3).any(|window| window == b"svg") {
            return "svg".to_string();
        }
        if data.starts_with(b"PK") {
            if let Ok(names) = ooxml::zip_namelist(data) {
                if names.iter().any(|name| name == "word/document.xml") {
                    return "docx".to_string();
                }
                if names.iter().any(|name| name == "content.xml")
                    && names.iter().any(|name| name == "meta.xml")
                {
                    return "odt".to_string();
                }
            }
        }
    }
    "unknown".to_string()
}

/// Inspect a container file.
pub fn inspect_container(path: &Path) -> std::io::Result<ContainerInspectReport> {
    let data = std::fs::read(path)?;
    let format = detect_container_format(path, Some(&data));
    let mut tools = Value::Object(Map::new());
    let mut details;
    let (has_c2pa, has_ai, findings);

    match format.as_str() {
        "svg" => {
            let result = svg::inspect_svg(&data);
            (has_c2pa, has_ai, findings, details) = result;
        }
        "pdf" => {
            let result = pdf::inspect_pdf(path, &data);
            (has_c2pa, has_ai, findings, details) = result;
            if let Some(map) = details.as_object_mut() {
                if let Some(extracted) = map.remove("tools") {
                    tools = extracted;
                }
            }
        }
        "docx" => {
            let result = ooxml::inspect_docx(&data);
            (has_c2pa, has_ai, findings, details) = result;
        }
        "odt" => {
            let result = ooxml::inspect_odt(&data);
            (has_c2pa, has_ai, findings, details) = result;
        }
        "html" => {
            let result = html::inspect_html(&data);
            (has_c2pa, has_ai, findings, details) = result;
        }
        "markdown" => {
            let result = markdown::inspect_markdown(&data);
            (has_c2pa, has_ai, findings, details) = result;
        }
        other => {
            has_c2pa = false;
            has_ai = false;
            findings = vec![format!("unsupported container: {other}")];
            details = json!({"unsupported": true});
        }
    }

    let mut notes: Vec<String> = Vec::new();
    if format == "pdf" {
        notes.push(
            "PDF cleaning is a full lopdf object-graph rewrite, so a superseded incremental \
             revision cannot survive; a file lopdf cannot parse falls back to a byte-level XMP \
             strip, which is reported as degraded"
                .to_string(),
        );
    } else if format == "docx" {
        notes.push(
            "DOCX: only metadata/provenance parts are scanned; visible body text is ignored"
                .to_string(),
        );
    }
    if details.get("unsupported").is_some() {
        notes.push(format!("format not fully inspected: {format}"));
    }

    let tools_empty = tools.as_object().map(|map| map.is_empty()).unwrap_or(true);
    if matches!(format.as_str(), "svg" | "pdf" | "docx") && tools_empty {
        tools = run_optional_tools(path);
    }

    Ok(ContainerInspectReport {
        path: path.display().to_string(),
        format,
        has_c2pa,
        has_ai_metadata: has_ai,
        findings,
        tools,
        details,
        notes,
    })
}

/// Clean container metadata; optionally Layer-A scrub text bodies for md/html.
pub fn clean_container(path: &Path, dest: &Path, also_layer_a_text: bool) -> Result<Value, String> {
    let data = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let format = detect_container_format(path, Some(&data));
    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }

    let mut meta = Map::new();
    meta.insert("format".into(), json!(format));
    let actions: Vec<String>;

    match format.as_str() {
        "svg" => {
            let (cleaned, log) = svg::clean_svg(&data);
            actions = log;
            safe_write_bytes(dest, &cleaned)
                .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
        }
        "pdf" => {
            let (log, extra) = pdf::clean_pdf(path, dest)?;
            actions = log;
            if let Some(map) = extra.as_object() {
                for (key, value) in map {
                    meta.insert(key.clone(), value.clone());
                }
            }
        }
        "docx" => {
            let (cleaned, log) = ooxml::clean_docx(&data)?;
            actions = log;
            safe_write_bytes(dest, &cleaned)
                .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
        }
        "odt" => {
            let (cleaned, log) = ooxml::clean_odt(&data)?;
            actions = log;
            safe_write_bytes(dest, &cleaned)
                .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
        }
        "html" | "markdown" => {
            let (cleaned, mut log) = if format == "html" {
                html::clean_html(&data)
            } else {
                markdown::clean_markdown(&data)
            };
            let cleaned = if also_layer_a_text {
                let units = surrogate::decode(&cleaned);
                let (scrubbed, stats) = clean_text(&units, CleanOptions::default());
                if stats.removed_count > 0 || stats.replaced_count > 0 {
                    log.push(format!(
                        "layer A text: removed={} replaced={}",
                        stats.removed_count, stats.replaced_count
                    ));
                    surrogate::encode(&scrubbed)
                } else {
                    cleaned
                }
            } else {
                cleaned
            };
            actions = log;
            safe_write_bytes(dest, &cleaned)
                .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
        }
        other => return Err(format!("unsupported container format: {other}")),
    }

    let after = inspect_container(dest)
        .map_err(|e| format!("cannot re-inspect {}: {e}", dest.display()))?;
    let bytes_out = std::fs::metadata(dest).map(|meta| meta.len()).unwrap_or(0);

    let mut result = Map::new();
    result.insert("input".into(), json!(path.display().to_string()));
    result.insert("output".into(), json!(dest.display().to_string()));
    result.insert("format".into(), json!(format));
    result.insert("actions".into(), json!(actions));
    result.insert("bytes_in".into(), json!(data.len()));
    result.insert("bytes_out".into(), json!(bytes_out));
    result.insert("still_has_c2pa".into(), json!(after.has_c2pa));
    result.insert("still_has_ai_metadata".into(), json!(after.has_ai_metadata));
    result.insert("post_findings".into(), json!(after.findings));
    result.insert("meta".into(), Value::Object(meta));
    Ok(Value::Object(result))
}

#[cfg(test)]
mod tests;
