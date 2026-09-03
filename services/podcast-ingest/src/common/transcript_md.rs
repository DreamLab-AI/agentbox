//! Episode transcript markdown assembly — shared by `ingest::download`
//! (`download_episode`) and `bulk::download` (`download_single`), which were
//! byte-identical in this section of the Python originals.

use super::ingest_status::INGEST_STATUS_DOWNLOADED_LINE;
use percent_encoding::percent_decode_str;
use regex::Regex;
use std::sync::OnceLock;

fn re_links() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"https?://[^\s<>"']+"#).unwrap())
}

fn re_redirect_q() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"q=(https?[^&]+)").unwrap())
}

/// Python:
/// ```python
/// formatted_date = (f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
///                   if len(upload_date) == 8 else upload_date)
/// ```
pub fn format_upload_date(upload_date: &str) -> String {
    if upload_date.chars().count() == 8 {
        let chars: Vec<char> = upload_date.chars().collect();
        let y: String = chars[0..4].iter().collect();
        let m: String = chars[4..6].iter().collect();
        let d: String = chars[6..8].iter().collect();
        format!("{y}-{m}-{d}")
    } else {
        upload_date.to_string()
    }
}

/// Python: `re.findall(r'https?://[^\s<>"\']+', description)`.
pub fn extract_links(description: &str) -> Vec<String> {
    re_links()
        .find_iter(description)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Python:
/// ```python
/// if 'redirect' in link and 'q=' in link:
///     match = re.search(r'q=(https?[^&]+)', link)
///     if match:
///         link = unquote(match.group(1))
/// ```
pub fn resolve_redirect_link(link: &str) -> String {
    if link.contains("redirect") && link.contains("q=") {
        if let Some(caps) = re_redirect_q().captures(link) {
            let raw = &caps[1];
            return percent_decode_str(raw).decode_utf8_lossy().to_string();
        }
    }
    link.to_string()
}

/// Word-wrap `transcript_text` into ~500-word paragraphs, exactly matching
/// the Python loop:
/// ```python
/// words = transcript_text.split()
/// para = []
/// for i, w in enumerate(words):
///     para.append(w)
///     if (i + 1) % 500 == 0:
///         md += ' '.join(para) + '\n\n'
///         para = []
/// if para:
///     md += ' '.join(para) + '\n'
/// ```
fn paragraphed_transcript(transcript_text: &str) -> String {
    let words: Vec<&str> = transcript_text.split_whitespace().collect();
    let mut out = String::new();
    let mut para: Vec<&str> = Vec::new();
    for (i, w) in words.iter().enumerate() {
        para.push(w);
        if (i + 1) % 500 == 0 {
            out.push_str(&para.join(" "));
            out.push_str("\n\n");
            para.clear();
        }
    }
    if !para.is_empty() {
        out.push_str(&para.join(" "));
        out.push('\n');
    }
    out
}

/// Assemble the full episode markdown document, matching `download_episode`
/// / `download_single` byte-for-byte (given identical inputs).
#[allow(clippy::too_many_arguments)]
pub fn build_episode_markdown(
    vid_id: &str,
    title: &str,
    formatted_date: &str,
    duration: &str,
    description: &str,
    transcript_text: &str,
) -> String {
    let mut md = String::new();
    md.push_str(INGEST_STATUS_DOWNLOADED_LINE);
    md.push('\n');
    md.push_str(&format!("# {title}\n\n"));
    md.push_str(&format!("- **Date**: {formatted_date}\n"));
    md.push_str(&format!("- **Duration**: {duration}\n"));
    md.push_str(&format!(
        "- **YouTube**: https://www.youtube.com/watch?v={vid_id}\n\n"
    ));
    md.push_str(&format!("## Show Notes\n\n{description}\n\n## Links\n\n"));

    let links = extract_links(description);
    for link in &links {
        let resolved = resolve_redirect_link(link);
        md.push_str(&format!("- {resolved}\n"));
    }
    if links.is_empty() {
        md.push_str("_No links found in show notes._\n");
    }

    md.push_str("\n## Transcript\n\n");
    if !transcript_text.is_empty() {
        md.push_str(&paragraphed_transcript(transcript_text));
    } else {
        md.push_str("_Transcript not available for this episode._\n");
    }
    md
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_eight_digit_date() {
        assert_eq!(format_upload_date("20260218"), "2026-02-18");
    }

    #[test]
    fn leaves_unknown_date_alone() {
        assert_eq!(format_upload_date("unknown"), "unknown");
    }

    #[test]
    fn resolves_redirect_link_containing_q_param() {
        // Must contain the literal substrings "redirect" AND "q=" — a plain
        // https://www.google.com/url?q=... link does NOT qualify (no
        // "redirect" substring), matching `if 'redirect' in link and 'q=' in link`.
        let link = "https://example.com/redirect?q=https%3A%2F%2Ftarget.example%2Fpath&sa=D";
        assert_eq!(resolve_redirect_link(link), "https://target.example/path");
    }

    #[test]
    fn leaves_plain_google_url_param_link_unchanged() {
        // No literal "redirect" substring, so the resolver must not touch it
        // even though it also has a `q=` param — matches the Python guard.
        let link = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpath&sa=D";
        assert_eq!(resolve_redirect_link(link), link);
    }

    #[test]
    fn leaves_non_redirect_link_alone() {
        let link = "https://example.com/page";
        assert_eq!(resolve_redirect_link(link), link);
    }

    #[test]
    fn paragraphs_at_500_words() {
        let words: Vec<String> = (0..1200).map(|i| i.to_string()).collect();
        let text = words.join(" ");
        let out = paragraphed_transcript(&text);
        // Two full 500-word paragraphs (each terminated by \n\n) plus a 200-word remainder (terminated by \n).
        assert_eq!(out.matches("\n\n").count(), 2);
        assert!(out.ends_with(&format!("{}\n", words[1199])));
    }

    #[test]
    fn no_transcript_placeholder() {
        let md = build_episode_markdown("abc123", "Title", "2026-01-01", "10:00", "desc", "");
        assert!(md.contains("_Transcript not available for this episode._"));
    }

    #[test]
    fn no_links_placeholder() {
        let links = extract_links("no links here");
        assert!(links.is_empty());
        let md = build_episode_markdown(
            "abc123",
            "Title",
            "2026-01-01",
            "10:00",
            "no links here",
            "hello world",
        );
        assert!(md.contains("_No links found in show notes._"));
    }
}
