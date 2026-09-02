//! Aggregate AI-provenance audit over the URLs listed in a sitemap.
//!
//! Downloads each URL, classifies it by content type/suffix/magic, and runs the
//! same deterministic text/image/container inspections as the local audit. The
//! optional external tools are not invoked for remote URLs; download the assets
//! and run the directory audit locally for those.

pub mod net;

use std::io::Read;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use net::{join_url, url_origin, validated_target, UrlOrigin};

pub const DEFAULT_MAX_BYTES: usize = 4 << 20;
pub const DEFAULT_TIMEOUT: u64 = 15;
pub const DEFAULT_MAX_PAGES: usize = 200;
pub const MAX_SITEMAP_DECOMPRESSED_BYTES: usize = 64 << 20;
pub const MAX_REDIRECTS: usize = 5;
pub const USER_AGENT: &str = "remove-ai-marks-audit/1.0";

/// Extensions used when staging a downloaded asset for the local pipeline.
fn extension_for_kind(kind: &str) -> &'static str {
    match kind {
        "png" => ".png",
        "jpeg" => ".jpg",
        "svg" => ".svg",
        "pdf" => ".pdf",
        "docx" => ".docx",
        "odt" => ".odt",
        "html" => ".html",
        "markdown" => ".md",
        "text" => ".txt",
        _ => ".bin",
    }
}

/// A resolver that only ever returns the addresses validated for this request.
///
/// ureq asks the resolver for the URL's authority; answering with the pinned
/// list means the socket cannot be redirected to a different address by a DNS
/// answer that changes between the check and the connect, while Host and TLS
/// SNI still come from the URL.
struct PinnedResolver {
    addresses: Vec<SocketAddr>,
}

impl ureq::Resolver for PinnedResolver {
    fn resolve(&self, _netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        Ok(self.addresses.clone())
    }
}

/// Classify a downloaded URL from headers, then suffix, then magic bytes.
pub fn guess_kind(url: &str, data: &[u8], content_type: Option<&str>) -> String {
    let content_type = content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let by_type = match content_type.as_str() {
        value if value.contains("html") => Some("html"),
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpeg"),
        value if value.contains("svg") => Some("svg"),
        "application/pdf" => Some("pdf"),
        value if value.contains("wordprocessingml") => Some("docx"),
        value if value.contains("opendocument.text") => Some("odt"),
        value if value.contains("markdown") => Some("markdown"),
        "text/plain" => Some("text"),
        _ => None,
    };
    if let Some(kind) = by_type {
        return kind.to_string();
    }

    let path = net::parse_url(url)
        .map(|parsed| parsed.path.to_lowercase())
        .unwrap_or_default();
    for (extension, kind) in [
        (".png", "png"),
        (".jpg", "jpeg"),
        (".jpeg", "jpeg"),
        (".svg", "svg"),
        (".pdf", "pdf"),
        (".docx", "docx"),
        (".odt", "odt"),
        (".html", "html"),
        (".htm", "html"),
        (".md", "markdown"),
        (".markdown", "markdown"),
        (".txt", "text"),
    ] {
        if path.ends_with(extension) {
            return kind.to_string();
        }
    }

    if data.starts_with(b"\x89PNG") {
        return "png".to_string();
    }
    if data.starts_with(b"\xff\xd8") {
        return "jpeg".to_string();
    }
    if data.starts_with(b"%PDF") {
        return "pdf".to_string();
    }
    let head = &data[..data.len().min(100)];
    let trimmed_start = head
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(head.len());
    let trimmed = &head[trimmed_start..];
    let first_500 = data[..data.len().min(500)].to_ascii_lowercase();
    if trimmed.starts_with(b"<") && first_500.windows(3).any(|window| window == b"svg") {
        return "svg".to_string();
    }
    let first_2000 = data[..data.len().min(2000)].to_ascii_lowercase();
    if first_2000.windows(5).any(|window| window == b"<html") || trimmed.starts_with(b"<") {
        return "html".to_string();
    }
    "text".to_string()
}

/// Parse a (possibly gzip-compressed) sitemap into `(kind, urls)`.
pub fn parse_sitemap(data: &[u8]) -> Result<(String, Vec<String>), String> {
    let body = if data.starts_with(&[0x1F, 0x8B]) {
        let mut decoder = flate2::read::GzDecoder::new(data);
        let mut out = Vec::new();
        // Read one byte past the cap so an over-large payload is detectable.
        decoder
            .take(MAX_SITEMAP_DECOMPRESSED_BYTES as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|error| format!("cannot decompress sitemap: {error}"))?;
        if out.len() > MAX_SITEMAP_DECOMPRESSED_BYTES {
            return Err(format!(
                "sitemap decompressed size exceeds cap ({MAX_SITEMAP_DECOMPRESSED_BYTES} bytes)"
            ));
        }
        out
    } else {
        if data.len() > MAX_SITEMAP_DECOMPRESSED_BYTES {
            return Err(format!(
                "sitemap size exceeds cap ({MAX_SITEMAP_DECOMPRESSED_BYTES} bytes)"
            ));
        }
        data.to_vec()
    };

    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(body.as_slice());
    let config = reader.config_mut();
    config.trim_text(true);
    config.check_end_names = false;

    let mut kind = String::new();
    let mut urls = Vec::new();
    let mut in_loc = false;
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                let name = local_name(element.name().as_ref());
                if kind.is_empty() {
                    kind = name.clone();
                }
                if name == "loc" {
                    in_loc = true;
                }
            }
            Ok(Event::Text(text)) if in_loc => {
                let value = text
                    .unescape()
                    .map_err(|error| format!("malformed sitemap text: {error}"))?;
                let value = value.trim();
                if !value.is_empty() {
                    urls.push(value.to_string());
                }
            }
            Ok(Event::End(element)) => {
                if local_name(element.name().as_ref()) == "loc" {
                    in_loc = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("malformed sitemap XML: {error}")),
            _ => {}
        }
        buffer.clear();
    }
    if kind.is_empty() {
        return Err("sitemap has no root element".to_string());
    }
    Ok((kind, urls))
}

/// Strip any XML namespace prefix from a tag name.
fn local_name(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    match text.rsplit_once(':') {
        Some((_, local)) => local.to_string(),
        None => text.into_owned(),
    }
}

/// Fetch with IP pinning, redirect validation and a byte cap.
pub fn fetch(
    url: &str,
    timeout: u64,
    max_bytes: usize,
    allowed_origin: Option<&UrlOrigin>,
) -> Result<(Vec<u8>, Option<String>), String> {
    let mut current = url.to_string();
    let mut expected: Option<UrlOrigin> = allowed_origin.cloned();

    for hop in 0..=MAX_REDIRECTS {
        let (origin, addresses) = validated_target(&current, expected.as_ref())?;
        if expected.is_none() {
            expected = Some(origin.clone());
        }

        let socket_addresses: Vec<SocketAddr> = addresses
            .iter()
            .map(|address| SocketAddr::new(*address, origin.2))
            .collect();
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(timeout))
            .timeout(Duration::from_secs(timeout))
            .redirects(0)
            .resolver(PinnedResolver {
                addresses: socket_addresses,
            })
            .build();

        let response = match agent.get(&current).set("User-Agent", USER_AGENT).call() {
            Ok(response) => response,
            // ureq surfaces any non-2xx as an error; the redirect statuses are
            // handled below, everything else is a real failure.
            Err(ureq::Error::Status(status, response)) => {
                if !matches!(status, 301 | 302 | 303 | 307 | 308) {
                    return Err(format!("HTTP {status}"));
                }
                response
            }
            Err(error) => return Err(error.to_string()),
        };

        let status = response.status();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            if let Some(location) = response.header("Location") {
                if hop >= MAX_REDIRECTS {
                    return Err(format!("too many redirects (>{MAX_REDIRECTS})"));
                }
                current = join_url(&current, location);
                continue;
            }
        }

        let content_type = response.header("Content-Type").map(str::to_string);
        let mut data = Vec::new();
        let mut reader = response.into_reader().take(max_bytes as u64 + 1);
        reader
            .read_to_end(&mut data)
            .map_err(|error| format!("read failed: {error}"))?;
        if data.len() > max_bytes {
            return Err(format!("exceeds {max_bytes} bytes"));
        }
        return Ok((data, content_type));
    }
    Err(format!("too many redirects (>{MAX_REDIRECTS})"))
}

/// Inspect downloaded bytes using the local `scan_file` pipeline.
pub fn inspect_remote(url: &str, data: &[u8], content_type: Option<&str>) -> Value {
    let kind = guess_kind(url, data, content_type);
    let extension = extension_for_kind(&kind);
    let Ok(dir) = tempfile::tempdir() else {
        return serde_json::json!({"path": url, "kind": kind, "error": "cannot create temp dir"});
    };
    let path = dir.path().join(format!("asset{extension}"));
    if let Err(error) = std::fs::write(&path, data) {
        return serde_json::json!({"path": url, "kind": kind, "error": error.to_string()});
    }
    let mut result = super::scan_file(&path, Some(url));
    if let Some(map) = result.as_object_mut() {
        map.insert("kind".into(), serde_json::json!(kind));
    }
    result
}

/// Find a same-site sitemap via the standard paths, then robots.txt.
pub fn discover_sitemap(base_url: &str, timeout: u64) -> Result<Option<String>, String> {
    let origin = url_origin(base_url)?;
    let base = base_url.trim_end_matches('/');

    for candidate in [
        format!("{base}/sitemap.xml"),
        format!("{base}/sitemap_index.xml"),
    ] {
        if let Ok((data, _)) = fetch(&candidate, timeout, DEFAULT_MAX_BYTES, Some(&origin)) {
            if parse_sitemap(&data).is_ok() {
                return Ok(Some(candidate));
            }
        }
    }

    if let Ok((data, _)) = fetch(&format!("{base}/robots.txt"), timeout, 1 << 20, Some(&origin)) {
        let text = String::from_utf8_lossy(&data);
        for line in text.lines() {
            if line.to_lowercase().starts_with("sitemap:") {
                let candidate = line.split_once(':').map(|(_, rest)| rest).unwrap_or("").trim();
                let candidate_origin = url_origin(candidate)?;
                if !net::origin_allowed(&candidate_origin, &origin) {
                    // A robots.txt pointing off-site is a redirect by another
                    // name; refuse it rather than follow it.
                    return Ok(None);
                }
                return Ok(Some(candidate.to_string()));
            }
        }
    }
    Ok(None)
}

/// Collect same-site URLs, following nested sitemap indexes.
pub fn collect_urls(sitemap_url: &str, timeout: u64, max_pages: usize) -> Result<Vec<String>, String> {
    let origin = url_origin(sitemap_url)?;
    let mut urls: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let origin = Arc::new(origin);
    recurse(sitemap_url, 0, timeout, max_pages, &origin, &mut urls, &mut seen)?;
    Ok(urls)
}

fn recurse(
    url: &str,
    depth: usize,
    timeout: u64,
    max_pages: usize,
    origin: &Arc<UrlOrigin>,
    urls: &mut Vec<String>,
    seen: &mut Vec<String>,
) -> Result<(), String> {
    if urls.len() >= max_pages || depth > 3 {
        return Ok(());
    }
    let (data, _) = fetch(url, timeout, DEFAULT_MAX_BYTES, Some(origin))?;
    let (kind, locations) = parse_sitemap(&data)?;

    for location in locations {
        let candidate = url_origin(&location)?;
        if !net::origin_allowed(&candidate, origin) {
            return Err(format!("cross-origin sitemap URL is not allowed: {location}"));
        }
        if seen.contains(&location) {
            continue;
        }
        seen.push(location.clone());
        if kind == "sitemapindex" {
            recurse(&location, depth + 1, timeout, max_pages, origin, urls, seen)?;
        } else {
            urls.push(location);
            if urls.len() >= max_pages {
                break;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
