use regex::Regex;
use std::sync::LazyLock;

use crate::types::{ContentDetection, ContentType};

static TIMESTAMP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
        \d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}   # ISO-8601
        | \w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}      # syslog
        | \d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2}       # CLF
        | \[\d+\.\d+\]                                # kernel dmesg
        ",
    )
    .expect("timestamp regex is valid")
});

static LOG_LEVEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|TRACE|NOTICE|CRITICAL)\b")
        .expect("log level regex is valid")
});

static CODE_PATTERN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
        ^\s*(fn|def|class|struct|enum|impl|pub|private|protected|function|const|let|var|import|from|use|module|package)\s
        | [{}();]\s*$
        | ^\s*//|^\s*/\*|^\s*\#\[|^\s*\#!
        | ->\s*\w+
        | =>\s*\{
        ",
    )
    .expect("code pattern regex is valid")
});

/// Detect the content type of the given input string.
pub fn detect(input: &str) -> (ContentType, f64) {
    if input.is_empty() {
        return (ContentType::Unknown, 0.0);
    }

    // Check for binary content (high ratio of non-printable chars).
    let non_printable = input
        .bytes()
        .take(1024)
        .filter(|b| *b < 0x20 && *b != b'\n' && *b != b'\r' && *b != b'\t')
        .count();
    let sample_len = input.len().min(1024);
    if sample_len > 0 && non_printable as f64 / sample_len as f64 > 0.1 {
        return (ContentType::Binary, 0.95);
    }

    let trimmed = input.trim();

    // JSON array detection.
    if trimmed.starts_with('[') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if val.is_array() {
                return (ContentType::JsonArray, 0.98);
            }
        }
        // Might be a partial/large array — check first element.
        if let Some(bracket_end) = find_first_json_element_end(trimmed) {
            let candidate = &trimmed[1..bracket_end];
            if serde_json::from_str::<serde_json::Value>(candidate.trim()).is_ok() {
                return (ContentType::JsonArray, 0.85);
            }
        }
    }

    // Unified diff detection.
    if trimmed.starts_with("diff --git ")
        || trimmed.starts_with("--- ")
        || trimmed.starts_with("Index: ")
    {
        let diff_markers = trimmed
            .lines()
            .take(20)
            .filter(|l| {
                l.starts_with("+++")
                    || l.starts_with("---")
                    || l.starts_with("@@")
                    || l.starts_with("diff --git")
            })
            .count();
        if diff_markers >= 2 {
            return (ContentType::UnifiedDiff, 0.95);
        }
        if diff_markers == 1 {
            return (ContentType::UnifiedDiff, 0.70);
        }
    }

    // Log output detection: sample lines for timestamps and log levels.
    let lines: Vec<&str> = trimmed.lines().take(50).collect();
    if lines.len() >= 3 {
        let timestamp_hits = lines
            .iter()
            .filter(|l| TIMESTAMP_RE.is_match(l))
            .count();
        let level_hits = lines
            .iter()
            .filter(|l| LOG_LEVEL_RE.is_match(l))
            .count();
        let ratio = (timestamp_hits + level_hits) as f64 / (lines.len() as f64 * 2.0);
        if ratio > 0.3 {
            let confidence = (0.5 + ratio * 0.5).min(0.98);
            return (ContentType::LogOutput, confidence);
        }
    }

    // Code detection.
    if lines.len() >= 2 {
        let code_hits = lines
            .iter()
            .filter(|l| CODE_PATTERN_RE.is_match(l))
            .count();
        let ratio = code_hits as f64 / lines.len() as f64;
        if ratio > 0.2 {
            let confidence = (0.4 + ratio * 0.6).min(0.95);
            return (ContentType::Code, confidence);
        }
    }

    // Default to prose if it looks like natural language.
    let avg_line_len = if lines.is_empty() {
        0.0
    } else {
        lines.iter().map(|l| l.len()).sum::<usize>() as f64 / lines.len() as f64
    };
    if avg_line_len > 40.0 && lines.len() >= 2 {
        return (ContentType::Prose, 0.50);
    }

    (ContentType::Unknown, 0.0)
}

/// Convert detection result to the N-API output struct.
pub fn to_detection(content_type: ContentType, confidence: f64) -> ContentDetection {
    ContentDetection {
        content_type: content_type.as_str().to_string(),
        confidence,
    }
}

/// Find the end index of the first JSON element inside a '[' delimited array.
/// Returns the index of the comma or closing bracket after the first element.
fn find_first_json_element_end(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes[0] != b'[' {
        return None;
    }
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    let mut started = false;

    for (i, &b) in bytes.iter().enumerate().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        if b == b'\\' && in_string {
            escaped = true;
            continue;
        }
        if b == b'"' {
            in_string = !in_string;
            if !started {
                started = true;
            }
            continue;
        }
        if in_string {
            continue;
        }
        match b {
            b'{' | b'[' => {
                depth += 1;
                started = true;
            }
            b'}' | b']' => {
                if depth == 0 {
                    if started {
                        return Some(i);
                    }
                    return None;
                }
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            b',' if depth == 0 && started => return Some(i),
            b if !b.is_ascii_whitespace() => {
                started = true;
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_json_array() {
        let input = r#"[{"a": 1}, {"a": 2}]"#;
        let (ct, conf) = detect(input);
        assert_eq!(ct, ContentType::JsonArray);
        assert!(conf > 0.9);
    }

    #[test]
    fn detects_diff() {
        let input = "diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1,3 +1,3 @@\n-old\n+new\n ctx\n";
        let (ct, conf) = detect(input);
        assert_eq!(ct, ContentType::UnifiedDiff);
        assert!(conf > 0.9);
    }

    #[test]
    fn detects_log() {
        let input = "2024-01-15T10:30:00Z INFO Starting service\n2024-01-15T10:30:01Z DEBUG Loaded config\n2024-01-15T10:30:02Z WARN Slow query\n";
        let (ct, conf) = detect(input);
        assert_eq!(ct, ContentType::LogOutput);
        assert!(conf > 0.5);
    }

    #[test]
    fn detects_code() {
        let input = "fn main() {\n    let x = 42;\n    println!(\"{}\", x);\n}\n";
        let (ct, conf) = detect(input);
        assert_eq!(ct, ContentType::Code);
        assert!(conf > 0.4);
    }
}
