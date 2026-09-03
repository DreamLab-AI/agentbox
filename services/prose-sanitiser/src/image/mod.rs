//! Detect and strip C2PA / AI-related metadata from PNG, JPEG and WebP.

pub mod harness;
pub mod jpeg;
pub mod markers;
pub mod png;
pub mod tools;
pub mod webp;

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::common::proc::{run_capture, Rlimits};
use crate::common::{classify_finding_confidence, safe_arg, safe_write_bytes, which};

pub use jpeg::JPEG_SOI;
pub use png::PNG_SIG;
pub use webp::{WEBP_RIFF, WEBP_SIG};

/// The image inspect result.
#[derive(Debug, Clone)]
pub struct ImageInspectReport {
    pub path: String,
    /// png | jpeg | webp | unknown
    pub format: String,
    pub has_c2pa: bool,
    pub has_ai_metadata: bool,
    pub findings: Vec<String>,
    pub tools: Value,
    pub synthid: Option<Value>,
    pub notes: Vec<String>,
}

impl ImageInspectReport {
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
            "synthid": self.synthid.clone().unwrap_or(Value::Null),
            "notes": self.notes,
        })
    }
}

/// Sniff the raster format from the leading bytes.
pub fn detect_format(data: &[u8]) -> &'static str {
    if data.starts_with(PNG_SIG) {
        return "png";
    }
    if data.starts_with(JPEG_SOI) {
        return "jpeg";
    }
    if data.len() >= 12 && &data[..4] == WEBP_RIFF && &data[8..12] == WEBP_SIG {
        return "webp";
    }
    "unknown"
}

/// Inspect the bytes only, with no external tools — the pure-parser core.
pub fn inspect_bytes(data: &[u8]) -> (String, bool, bool, Vec<String>) {
    let format = detect_format(data);
    let (has_c2pa, has_ai, findings) = match format {
        "png" => png::inspect_png(data),
        "jpeg" => jpeg::inspect_jpeg(data),
        "webp" => webp::inspect_webp(data),
        _ => (
            false,
            false,
            vec!["unsupported format (PNG/JPEG/WebP)".to_string()],
        ),
    };
    (format.to_string(), has_c2pa, has_ai, findings)
}

/// Full inspection: parsers, then the optional external tools and scorer.
pub fn inspect_image(
    path: &Path,
    synthid_dir: Option<&str>,
) -> std::io::Result<ImageInspectReport> {
    let data = std::fs::read(path)?;
    let (format, mut has_c2pa, has_ai, mut findings) = inspect_bytes(&data);

    let mut notes = Vec::new();
    if format == "unknown" {
        notes.push("format not fully inspected; only PNG/JPEG are supported".to_string());
    }

    let tools = tools::run_optional_tools(path);
    // Elevate flags from tools.
    if tools
        .get("c2patool")
        .and_then(|entry| entry.get("has_manifest"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        has_c2pa = true;
        findings.push("c2patool reports a C2PA-related manifest".to_string());
    }

    Ok(ImageInspectReport {
        path: path.display().to_string(),
        format,
        has_c2pa,
        has_ai_metadata: has_ai,
        findings,
        tools,
        synthid: harness::run_synthid_score(path, synthid_dir),
        notes,
    })
}

/// Which pixel-domain remover to run after metadata cleaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelRemover {
    CtrlRegen,
    Diffusion,
}

impl PixelRemover {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "ctrlregen" => Some(Self::CtrlRegen),
            "diffusion" => Some(Self::Diffusion),
            _ => None,
        }
    }

    fn engine_name(self) -> &'static str {
        match self {
            Self::CtrlRegen => "CtrlRegen",
            Self::Diffusion => "DiffusionPurification",
        }
    }
}

/// Everything the clean step needs, so the CLI can pass its flags straight in.
#[derive(Debug, Clone)]
pub struct CleanImageOptions {
    pub strip_all_metadata: bool,
    pub synthid_dir: Option<String>,
    pub remove_pixel: Option<PixelRemover>,
    pub ctrlregen: harness::CtrlRegenOptions,
    pub markdiffusion: harness::MarkDiffusionOptions,
}

impl Default for CleanImageOptions {
    fn default() -> Self {
        Self {
            strip_all_metadata: true,
            synthid_dir: None,
            remove_pixel: None,
            ctrlregen: harness::CtrlRegenOptions::default(),
            markdiffusion: harness::MarkDiffusionOptions::default(),
        }
    }
}

/// Strip metadata from `path` into `dest`, optionally running a pixel remover.
pub fn clean_image(path: &Path, dest: &Path, options: &CleanImageOptions) -> Result<Value, String> {
    let synthid_before = harness::run_synthid_score(path, options.synthid_dir.as_deref());
    let data = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let format = detect_format(&data);
    let (cleaned, mut actions) = match format {
        "png" => png::strip_png(&data, options.strip_all_metadata)?,
        "jpeg" => jpeg::strip_jpeg(&data, options.strip_all_metadata)?,
        "webp" => webp::strip_webp(&data, options.strip_all_metadata)?,
        other => return Err(format!("unsupported format: {other}")),
    };

    safe_write_bytes(dest, &cleaned)
        .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;

    // Optional exiftool pass for residual tags.
    if options.strip_all_metadata {
        if let Some(exiftool) = which("exiftool") {
            let args = vec![
                "-all=".to_string(),
                "-overwrite_original".to_string(),
                safe_arg(&dest.display().to_string()),
            ];
            match run_capture(
                &exiftool,
                &args,
                Rlimits::default_child(),
                std::time::Duration::from_secs(60),
                None,
            ) {
                Ok(_) => actions.push("exiftool -all= pass".to_string()),
                Err(error) => actions.push(format!("exiftool failed: {error}")),
            }
        }
    }

    let mut pixel_removal: Option<Value> = None;
    if let Some(remover) = options.remove_pixel {
        let result = match remover {
            PixelRemover::CtrlRegen => harness::run_ctrlregen_clean(dest, dest, &options.ctrlregen),
            PixelRemover::Diffusion => {
                harness::run_markdiffusion_purify(dest, dest, &options.markdiffusion)
            }
        };
        let available = result
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if available {
            let strength = match remover {
                PixelRemover::CtrlRegen => options.ctrlregen.strength,
                PixelRemover::Diffusion => options.markdiffusion.strength,
            };
            actions.push(match remover {
                PixelRemover::CtrlRegen => {
                    format!("CtrlRegen pixel removal (strength {strength})")
                }
                PixelRemover::Diffusion => {
                    format!("DiffusionPurification pixel removal (strength {strength})")
                }
            });
        } else {
            let error = result
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string();
            actions.push(format!(
                "{} pixel removal skipped: {error}",
                match remover {
                    PixelRemover::CtrlRegen => "CtrlRegen",
                    PixelRemover::Diffusion => "DiffusionPurification",
                }
            ));
        }
        pixel_removal = Some(result);
    }

    let after = inspect_image(dest, options.synthid_dir.as_deref())
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
    result.insert(
        "synthid_before".into(),
        synthid_before.unwrap_or(Value::Null),
    );
    result.insert("synthid_after".into(), after.synthid.unwrap_or(Value::Null));
    result.insert("pixel_removal".into(), pixel_removal.unwrap_or(Value::Null));
    Ok(Value::Object(result))
}

/// Where the Python looked for its sibling harness scripts.
pub fn scripts_dir() -> PathBuf {
    harness::scripts_dir()
}

/// The engine label used in the CLI's human output.
pub fn engine_label(remover: PixelRemover) -> &'static str {
    remover.engine_name()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_three_supported_formats() {
        assert_eq!(detect_format(PNG_SIG), "png");
        assert_eq!(detect_format(b"\xff\xd8\xff\xe0"), "jpeg");
        let mut webp = WEBP_RIFF.to_vec();
        webp.extend_from_slice(&[0u8; 4]);
        webp.extend_from_slice(WEBP_SIG);
        assert_eq!(detect_format(&webp), "webp");
        assert_eq!(detect_format(b"GIF89a"), "unknown");
        assert_eq!(detect_format(b""), "unknown");
    }

    #[test]
    fn pixel_remover_parses_only_the_two_backends() {
        assert_eq!(
            PixelRemover::parse("ctrlregen"),
            Some(PixelRemover::CtrlRegen)
        );
        assert_eq!(
            PixelRemover::parse("diffusion"),
            Some(PixelRemover::Diffusion)
        );
        assert_eq!(PixelRemover::parse("magic"), None);
    }

    #[test]
    fn unknown_formats_report_the_unsupported_finding() {
        let (format, c2pa, ai, findings) = inspect_bytes(b"GIF89a...");
        assert_eq!(format, "unknown");
        assert!(!c2pa && !ai);
        assert_eq!(
            findings,
            vec!["unsupported format (PNG/JPEG/WebP)".to_string()]
        );
    }
}
