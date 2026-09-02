//! PDF provenance: best-effort inspection, exiftool-preferred cleaning.

use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use regex::bytes::Regex as ByteRegex;
use serde_json::{json, Value};

use super::patterns::blob_hits;
use crate::common::proc::{run_capture, Rlimits};
use crate::common::{safe_arg, safe_write_bytes, which};
use crate::image::tools::run_optional_tools;

fn xmp_packet_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?is-u)<\?xpacket begin.*?<\?xpacket end[^?]*\?>")
            .expect("static regex compiles")
    })
}

fn stream_re() -> &'static ByteRegex {
    static RE: OnceLock<ByteRegex> = OnceLock::new();
    RE.get_or_init(|| {
        ByteRegex::new(r"(?s-u)stream\r?\n.*?endstream").expect("static regex compiles")
    })
}

/// Return PDF bytes with stream payloads removed, plus the XMP packets.
///
/// Stream payloads are often compressed binary where an AI-marker byte sequence
/// (e.g. "AIGC") can occur by chance. Scanning only dictionaries and XMP
/// packets avoids treating those collisions as metadata findings.
pub fn pdf_structured_blob(data: &[u8]) -> Vec<u8> {
    let no_streams = stream_re().replace_all(data, &b"stream endstream"[..]);
    let packets: Vec<&[u8]> = xmp_packet_re()
        .find_iter(data)
        .map(|found| found.as_bytes())
        .collect();
    let mut out = no_streams.into_owned();
    out.push(b'\n');
    out.extend_from_slice(&packets.join(&b'\n'));
    out
}

/// Inspect a PDF, escalating to c2patool when it is installed.
pub fn inspect_pdf(path: &Path, data: &[u8]) -> (bool, bool, Vec<String>, Value) {
    let (mut has_c2pa, mut has_ai, hits) = blob_hits(&pdf_structured_blob(data));
    let mut findings: Vec<String> = hits
        .into_iter()
        .map(|hit| format!("pdf-structured:{hit}"))
        .collect();

    let packets: Vec<&[u8]> = xmp_packet_re()
        .find_iter(data)
        .map(|found| found.as_bytes())
        .collect();
    if !packets.is_empty() {
        findings.push("XMP packet present".to_string());
        let blob = packets.join(&b'\n');
        has_ai = has_ai
            || ByteRegex::new(r"(?i-u)digitalSourceType|trainedAlgorithmicMedia|SoftwareAgent|c2pa")
                .expect("static regex compiles")
                .is_match(&blob);
    }

    let tools = run_optional_tools(path);
    if tools
        .get("c2patool")
        .and_then(|entry| entry.get("has_manifest"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        has_c2pa = true;
        findings.push("c2patool reports C2PA-related manifest".to_string());
    }

    (
        has_c2pa,
        has_ai || has_c2pa,
        findings,
        json!({"tools": tools}),
    )
}

/// Rebuild a PDF so unreferenced objects are dropped.
///
/// exiftool's PDF edits are incremental, so freed metadata objects survive in
/// the byte stream. qpdf re-serialises from the object graph, which is what
/// actually removes them. No-op (with a warning) when qpdf is absent.
fn pdf_structural_rewrite(dest: &Path, actions: &mut Vec<String>) -> bool {
    let Some(qpdf) = which("qpdf") else {
        actions.push(
            "warning: exiftool PDF edits are incremental — the original metadata bytes remain \
             recoverable; install qpdf for a structural rewrite"
                .to_string(),
        );
        return false;
    };

    let mut temp_name = dest.as_os_str().to_os_string();
    temp_name.push(".qpdf-tmp");
    let temp = std::path::PathBuf::from(temp_name);
    let args = vec![
        "--linearize".to_string(),
        "--".to_string(),
        safe_arg(&dest.display().to_string()),
        safe_arg(&temp.display().to_string()),
    ];
    let result = run_capture(
        &qpdf,
        &args,
        Rlimits::default_child(),
        Duration::from_secs(120),
        None,
    );
    let output = match result {
        Ok(output) => output,
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            actions.push(format!(
                "qpdf rewrite failed: {error}; metadata bytes may remain recoverable"
            ));
            return false;
        }
    };

    // qpdf exit codes: 0 = clean, 3 = succeeded with warnings (output written).
    let code = output.status.code().unwrap_or(-1);
    let wrote_output = std::fs::metadata(&temp)
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false);
    if (code == 0 || code == 3) && wrote_output {
        if std::fs::rename(&temp, dest).is_ok() {
            actions.push(format!("qpdf --linearize structural rewrite (rc={code})"));
            return true;
        }
    }
    let _ = std::fs::remove_file(&temp);
    actions.push(format!(
        "qpdf rewrite skipped (rc={code}); metadata bytes may remain recoverable"
    ));
    false
}

/// Best-effort PDF clean. Prefers exiftool; falls back to an XMP strip warning.
pub fn clean_pdf(path: &Path, dest: &Path) -> Result<(Vec<String>, Value), String> {
    let mut actions: Vec<String> = Vec::new();
    let data = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }

    if let Some(exiftool) = which("exiftool") {
        safe_write_bytes(dest, &data)
            .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
        let args = vec![
            "-all=".to_string(),
            "-overwrite_original".to_string(),
            safe_arg(&dest.display().to_string()),
        ];
        match run_capture(
            &exiftool,
            &args,
            Rlimits::default_child(),
            Duration::from_secs(60),
            None,
        ) {
            Ok(output) => actions.push(format!(
                "exiftool -all= (rc={})",
                output.status.code().unwrap_or(-1)
            )),
            Err(error) => actions.push(format!("exiftool failed: {error}")),
        }
        // exiftool writes PDFs *incrementally*: it appends an update block that
        // frees the Info object and drops /Info from the trailer, but the
        // original metadata bytes stay in the file verbatim and are trivially
        // recoverable. A structural rewrite is what actually drops them.
        let rewritten = pdf_structural_rewrite(dest, &mut actions);
        if which("c2patool").is_some() {
            actions.push("c2patool available for inspect; strip via exiftool/re-export".to_string());
        }
        return Ok((
            actions,
            json!({"mode": "exiftool", "structural_rewrite": rewritten}),
        ));
    }

    // Degraded: strip obvious XMP packets.
    let count = xmp_packet_re().find_iter(&data).count();
    if count > 0 {
        let stripped = xmp_packet_re().replace_all(&data, &b""[..]).into_owned();
        actions.push(format!(
            "stripped XMP xpacket x{count} (degraded; may leave offsets broken)"
        ));
        safe_write_bytes(dest, &stripped)
            .map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
        actions.push("warning: pure-stdlib PDF strip is best-effort; prefer exiftool".to_string());
        return Ok((actions, json!({"mode": "stdlib-xmp", "degraded": true})));
    }

    safe_write_bytes(dest, &data).map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
    actions.push(
        "no PDF cleaner available (install exiftool for reliable metadata strip); copied as-is"
            .to_string(),
    );
    Ok((actions, json!({"mode": "copy", "degraded": true})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pdf_with(objects: &[u8], stream_payload: &[u8]) -> Vec<u8> {
        let mut out = b"%PDF-1.7\n".to_vec();
        out.extend_from_slice(objects);
        out.extend_from_slice(b"\n4 0 obj\nstream\n");
        out.extend_from_slice(stream_payload);
        out.extend_from_slice(b"\nendstream\nendobj\n%%EOF\n");
        out
    }

    #[test]
    fn stream_payloads_are_excluded_from_the_marker_scan() {
        // "AIGC" occurs only inside compressed stream bytes: a chance collision.
        let pdf = pdf_with(b"1 0 obj<</Title(Hills)>>endobj", b"\x9c\x00AIGC\x01\xff");
        let blob = pdf_structured_blob(&pdf);
        assert!(!blob.windows(4).any(|w| w == b"AIGC"));
        assert!(blob.windows(5).any(|w| w == b"Hills"));
    }

    #[test]
    fn dictionary_markers_are_still_found() {
        let pdf = pdf_with(
            b"1 0 obj<</Producer(Generated by OpenAI)>>endobj",
            b"binary",
        );
        let blob = pdf_structured_blob(&pdf);
        let (_, ai, hits) = blob_hits(&blob);
        assert!(ai);
        assert!(hits.iter().any(|hit| hit == "ai:OpenAI"));
    }

    #[test]
    fn xmp_packets_are_kept_in_the_scanned_blob() {
        let mut pdf = pdf_with(b"1 0 obj<<>>endobj", b"stream-bytes");
        pdf.extend_from_slice(
            b"<?xpacket begin='' id='W5M0'?><x>digitalSourceType</x><?xpacket end='w'?>",
        );
        let blob = pdf_structured_blob(&pdf);
        assert!(blob.windows(17).any(|w| w == b"digitalSourceType"));
    }

    #[test]
    fn inspect_reports_an_xmp_packet_and_sets_the_ai_flag() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.pdf");
        let mut pdf = pdf_with(b"1 0 obj<<>>endobj", b"bytes");
        pdf.extend_from_slice(
            b"<?xpacket begin='' id='W5M0'?><x>trainedAlgorithmicMedia</x><?xpacket end='w'?>",
        );
        std::fs::write(&path, &pdf).unwrap();

        let (_, ai, findings, details) = inspect_pdf(&path, &pdf);
        assert!(ai);
        assert!(findings.contains(&"XMP packet present".to_string()));
        assert!(details["tools"]["exiftool"]["available"].is_boolean());
    }

    #[test]
    fn a_clean_pdf_reports_nothing_structural() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clean.pdf");
        let pdf = pdf_with(b"1 0 obj<</Title(Hills)>>endobj", b"image-bytes");
        std::fs::write(&path, &pdf).unwrap();
        let (c2pa, ai, findings, _) = inspect_pdf(&path, &pdf);
        assert!(!c2pa && !ai, "findings were {findings:?}");
    }

    #[test]
    fn cleaning_always_produces_an_output_file_and_a_mode() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("in.pdf");
        let dest = dir.path().join("out.pdf");
        let pdf = pdf_with(b"1 0 obj<<>>endobj", b"bytes");
        std::fs::write(&source, &pdf).unwrap();

        let (actions, meta) = clean_pdf(&source, &dest).unwrap();
        assert!(dest.is_file());
        assert!(!actions.is_empty());
        // Whichever tools are installed, the mode is always reported.
        assert!(matches!(
            meta["mode"].as_str().unwrap(),
            "exiftool" | "stdlib-xmp" | "copy"
        ));
    }
}
