use std::collections::HashMap;
use std::fmt::Write as FmtWrite;

use regex::Regex;
use std::sync::LazyLock;

use crate::types::{CompressResult, LogCompressOptions};

static NUMBER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{2,}").expect("number regex"));

static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
        .expect("uuid regex")
});

static HEX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b0x[0-9a-fA-F]+\b").expect("hex regex"));

static IP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b").expect("ip regex"));

static ERROR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(ERROR|FATAL|CRITICAL|EXCEPTION|PANIC|FAIL(ED|URE)?|WARN(ING)?)\b")
        .expect("error regex")
});

static STACK_FRAME_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s+(at |Caused by:|\.\.\.|\d+ more|File |Traceback)")
        .expect("stack frame regex")
});

/// Compress log output by template-mining identical lines, preserving errors
/// and stack traces.
pub fn compress(input: &str, options: &LogCompressOptions) -> Result<CompressResult, String> {
    let preserve_errors = options.preserve_errors.unwrap_or(true);
    let max_templates = options.max_templates.unwrap_or(50) as usize;
    let original_bytes = input.len() as u32;

    let lines: Vec<&str> = input.lines().collect();
    if lines.is_empty() {
        return Ok(CompressResult {
            compressed: String::new(),
            original_bytes,
            compressed_bytes: 0,
            ratio: 0.0,
            ccr_entries: vec![],
        });
    }

    // Phase 1: classify lines.
    let mut classified: Vec<LineClass> = Vec::with_capacity(lines.len());
    let mut in_stack_trace = false;

    for line in &lines {
        if is_error_line(line) {
            classified.push(LineClass::Error);
            in_stack_trace = true;
        } else if in_stack_trace && is_stack_frame(line) {
            classified.push(LineClass::StackTrace);
        } else {
            in_stack_trace = false;
            classified.push(LineClass::Normal);
        }
    }

    // Phase 2: template mining for normal lines.
    let mut template_counts: HashMap<String, TemplateBucket> = HashMap::new();
    let mut output_parts: Vec<OutputPart> = Vec::new();
    let mut pending_normals: Vec<(usize, String)> = Vec::new();

    for (i, (line, class)) in lines.iter().zip(classified.iter()).enumerate() {
        match class {
            LineClass::Error | LineClass::StackTrace if preserve_errors => {
                // Flush pending normals.
                flush_normals(
                    &mut pending_normals,
                    &mut template_counts,
                    &mut output_parts,
                    max_templates,
                );
                output_parts.push(OutputPart::Literal(line.to_string()));
            }
            _ => {
                let template = templatise(line);
                pending_normals.push((i, template));
            }
        }
    }

    // Flush remaining normals.
    flush_normals(
        &mut pending_normals,
        &mut template_counts,
        &mut output_parts,
        max_templates,
    );

    // Phase 3: render output.
    let mut compressed = String::with_capacity(input.len() / 2);
    for part in &output_parts {
        match part {
            OutputPart::Literal(line) => {
                compressed.push_str(line);
                compressed.push('\n');
            }
            OutputPart::TemplateGroup {
                template,
                count,
                example,
            } => {
                if *count == 1 {
                    compressed.push_str(example);
                    compressed.push('\n');
                } else {
                    let _ = writeln!(
                        compressed,
                        "[Template: {}] ({}x)",
                        truncate_template(template, 80),
                        count
                    );
                }
            }
        }
    }

    // Trim trailing newline to match convention.
    if compressed.ends_with('\n') && !input.ends_with('\n') {
        compressed.pop();
    }

    let compressed_bytes = compressed.len() as u32;

    Ok(CompressResult {
        compressed,
        original_bytes,
        compressed_bytes,
        ratio: if original_bytes > 0 {
            compressed_bytes as f64 / original_bytes as f64
        } else {
            1.0
        },
        ccr_entries: vec![],
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LineClass {
    Error,
    StackTrace,
    Normal,
}

enum OutputPart {
    Literal(String),
    TemplateGroup {
        template: String,
        count: usize,
        example: String,
    },
}

#[allow(dead_code)]
struct TemplateBucket {
    count: usize,
    example: String,
}

fn is_error_line(line: &str) -> bool {
    ERROR_RE.is_match(line)
}

fn is_stack_frame(line: &str) -> bool {
    STACK_FRAME_RE.is_match(line)
}

/// Templatise a log line by replacing variable parts with placeholders.
fn templatise(line: &str) -> String {
    let s = UUID_RE.replace_all(line, "<UUID>");
    let s = HEX_RE.replace_all(&s, "<HEX>");
    let s = IP_RE.replace_all(&s, "<IP>");
    let s = NUMBER_RE.replace_all(&s, "<N>");
    s.to_string()
}

fn truncate_template(t: &str, max: usize) -> &str {
    if t.len() <= max {
        t
    } else {
        &t[..max]
    }
}

/// Flush accumulated normal lines into template groups.
fn flush_normals(
    normals: &mut Vec<(usize, String)>,
    template_counts: &mut HashMap<String, TemplateBucket>,
    output: &mut Vec<OutputPart>,
    max_templates: usize,
) {
    if normals.is_empty() {
        return;
    }

    // Count templates in this batch.
    let mut batch_templates: HashMap<String, (usize, String)> = HashMap::new();
    // Keep the insertion order.
    let mut order: Vec<String> = Vec::new();

    for (_idx, template) in normals.iter() {
        let entry = batch_templates
            .entry(template.clone())
            .or_insert_with(|| {
                order.push(template.clone());
                (0, String::new())
            });
        entry.0 += 1;
        if entry.1.is_empty() {
            // Use the original template as the example (it still has placeholders but
            // that is fine for compression output).
            entry.1 = template.clone();
        }

        // Also update global counts.
        let global = template_counts
            .entry(template.clone())
            .or_insert_with(|| TemplateBucket {
                count: 0,
                example: template.clone(),
            });
        global.count += 1;
    }

    // Emit template groups in order, capping at max_templates.
    let mut emitted = 0;
    for tmpl in &order {
        if emitted >= max_templates {
            // Aggregate the rest into a single line.
            let remaining: usize = order[emitted..]
                .iter()
                .filter_map(|t| batch_templates.get(t))
                .map(|(c, _)| c)
                .sum();
            if remaining > 0 {
                output.push(OutputPart::Literal(format!(
                    "[... {} more template groups, {} lines]",
                    order.len() - emitted,
                    remaining
                )));
            }
            break;
        }
        let (count, example) = batch_templates.get(tmpl).unwrap();
        output.push(OutputPart::TemplateGroup {
            template: tmpl.clone(),
            count: *count,
            example: example.clone(),
        });
        emitted += 1;
    }

    normals.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compress_empty() {
        let result = compress("", &LogCompressOptions::default()).unwrap();
        assert_eq!(result.compressed, "");
    }

    #[test]
    fn preserves_error_lines() {
        let input = "INFO Starting\nINFO Loading\nERROR Failed to connect\n  at main.rs:42\nINFO Done\n";
        let opts = LogCompressOptions {
            preserve_errors: Some(true),
            max_templates: Some(50),
        };
        let result = compress(input, &opts).unwrap();
        assert!(result.compressed.contains("ERROR Failed to connect"));
        assert!(result.compressed.contains("at main.rs:42"));
    }

    #[test]
    fn groups_repeated_templates() {
        let mut lines = String::new();
        for i in 100..120 {
            lines.push_str(&format!(
                "INFO Request {} completed in {}ms\n",
                i,
                i * 10
            ));
        }
        let opts = LogCompressOptions {
            preserve_errors: Some(true),
            max_templates: Some(50),
        };
        let result = compress(&lines, &opts).unwrap();
        assert!(
            result.compressed.contains("(20x)"),
            "expected (20x) in compressed output: {}",
            result.compressed
        );
        assert!(result.ratio < 0.5);
    }

    #[test]
    fn templatise_replaces_variables() {
        let line = "Request 12345 from 192.168.1.1 took 0x1F ms, id=550e8400-e29b-41d4-a716-446655440000";
        let t = templatise(line);
        assert!(t.contains("<N>"));
        assert!(t.contains("<IP>"));
        assert!(t.contains("<HEX>"));
        assert!(t.contains("<UUID>"));
    }
}
