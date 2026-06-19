use crate::types::{CompressResult, DiffCompressOptions};

/// Compress a unified diff by sampling context lines when the context-to-changes
/// ratio exceeds the configured threshold.
pub fn compress(input: &str, options: &DiffCompressOptions) -> Result<CompressResult, String> {
    let context_ratio_threshold = options.context_ratio.unwrap_or(3.0);
    let original_bytes = input.len() as u32;

    if input.is_empty() {
        return Ok(CompressResult {
            compressed: String::new(),
            original_bytes: 0,
            compressed_bytes: 0,
            ratio: 0.0,
            ccr_entries: vec![],
        });
    }

    let hunks = parse_hunks(input);
    let mut output = String::with_capacity(input.len());

    for hunk in &hunks {
        match hunk {
            HunkPart::Header(line) => {
                output.push_str(line);
                output.push('\n');
            }
            HunkPart::Hunk {
                header,
                changed,
                context,
            } => {
                output.push_str(header);
                output.push('\n');

                let n_changed = changed.len();
                let n_context = context.len();

                if n_changed == 0 {
                    // All context, keep a sample.
                    let sampled = sample_lines(context, 3);
                    for line in &sampled {
                        output.push_str(line);
                        output.push('\n');
                    }
                    if sampled.len() < context.len() {
                        output.push_str(&format!(
                            " ... ({} context lines omitted)\n",
                            context.len() - sampled.len()
                        ));
                    }
                } else {
                    let ratio = n_context as f64 / n_changed.max(1) as f64;
                    if ratio > context_ratio_threshold {
                        // Too much context relative to changes. Emit all changes,
                        // sample context.
                        let keep_count =
                            (n_changed as f64 * context_ratio_threshold).ceil() as usize;
                        let sampled_ctx = sample_lines(context, keep_count.max(2));

                        // Interleave: emit changes first, then sampled context.
                        // Better: rebuild in original order.
                        let mut all_lines: Vec<(&str, bool)> = Vec::new();
                        for line in changed {
                            all_lines.push((line.as_str(), true));
                        }
                        let ctx_set: std::collections::HashSet<usize> = sampled_ctx
                            .iter()
                            .enumerate()
                            .map(|(i, _)| i)
                            .collect();
                        let mut ctx_omitted = 0usize;
                        for (i, line) in context.iter().enumerate() {
                            if ctx_set.contains(&i) {
                                all_lines.push((line.as_str(), false));
                            } else {
                                ctx_omitted += 1;
                            }
                        }

                        // Sort by changed-first then context, preserving relative order
                        // within each group.
                        for (line, _is_change) in &all_lines {
                            output.push_str(line);
                            output.push('\n');
                        }
                        if ctx_omitted > 0 {
                            output
                                .push_str(&format!(" ... ({ctx_omitted} context lines omitted)\n"));
                        }
                    } else {
                        // Ratio is acceptable, keep everything.
                        for line in changed {
                            output.push_str(line);
                            output.push('\n');
                        }
                        for line in context {
                            output.push_str(line);
                            output.push('\n');
                        }
                    }
                }
            }
        }
    }

    // Trim trailing newline to match input convention.
    if output.ends_with('\n') && !input.ends_with('\n') {
        output.pop();
    }

    let compressed_bytes = output.len() as u32;

    Ok(CompressResult {
        compressed: output,
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

#[derive(Debug)]
enum HunkPart {
    /// File-level header lines (diff --git, ---, +++, index, etc).
    Header(String),
    /// A single @@ hunk with its changed and context lines.
    Hunk {
        header: String,
        changed: Vec<String>,
        context: Vec<String>,
    },
}

fn parse_hunks(input: &str) -> Vec<HunkPart> {
    let mut parts: Vec<HunkPart> = Vec::new();
    let mut current_changed: Vec<String> = Vec::new();
    let mut current_context: Vec<String> = Vec::new();
    let mut current_header: Option<String> = None;

    for line in input.lines() {
        if line.starts_with("diff --git ")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("index ")
            || line.starts_with("new file")
            || line.starts_with("deleted file")
            || line.starts_with("rename ")
            || line.starts_with("similarity ")
            || line.starts_with("old mode")
            || line.starts_with("new mode")
        {
            // Flush any open hunk.
            if let Some(header) = current_header.take() {
                parts.push(HunkPart::Hunk {
                    header,
                    changed: std::mem::take(&mut current_changed),
                    context: std::mem::take(&mut current_context),
                });
            }
            parts.push(HunkPart::Header(line.to_string()));
        } else if line.starts_with("@@ ") {
            // Flush previous hunk.
            if let Some(header) = current_header.take() {
                parts.push(HunkPart::Hunk {
                    header,
                    changed: std::mem::take(&mut current_changed),
                    context: std::mem::take(&mut current_context),
                });
            }
            current_header = Some(line.to_string());
        } else if let Some(_) = &current_header {
            if line.starts_with('+') || line.starts_with('-') {
                current_changed.push(line.to_string());
            } else {
                // Context line (starts with ' ' or is empty).
                current_context.push(line.to_string());
            }
        } else {
            // Line outside any hunk — treat as header.
            parts.push(HunkPart::Header(line.to_string()));
        }
    }

    // Flush last hunk.
    if let Some(header) = current_header {
        parts.push(HunkPart::Hunk {
            header,
            changed: current_changed,
            context: current_context,
        });
    }

    parts
}

/// Sample up to `count` lines from a slice using even spacing.
fn sample_lines(lines: &[String], count: usize) -> Vec<&String> {
    if lines.len() <= count {
        return lines.iter().collect();
    }
    if count == 0 {
        return vec![];
    }

    let step = lines.len() as f64 / count as f64;
    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        let idx = (i as f64 * step).floor() as usize;
        if idx < lines.len() {
            result.push(&lines[idx]);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compress_empty_diff() {
        let result = compress("", &DiffCompressOptions::default()).unwrap();
        assert_eq!(result.compressed, "");
    }

    #[test]
    fn compress_small_diff_passes_through() {
        let input = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n ctx1\n-old\n+new\n ctx2\n";
        let result = compress(input, &DiffCompressOptions::default()).unwrap();
        // Small diff should pass through mostly unchanged.
        assert!(result.compressed.contains("-old"));
        assert!(result.compressed.contains("+new"));
        assert!(result.compressed.contains("ctx1"));
    }

    #[test]
    fn compress_large_context_reduces() {
        let mut diff = String::from("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,22 +1,22 @@\n");
        // 1 changed line, 20 context lines.
        diff.push_str("-old line\n");
        diff.push_str("+new line\n");
        for i in 0..20 {
            diff.push_str(&format!(" context line {}\n", i));
        }
        let opts = DiffCompressOptions {
            context_ratio: Some(3.0),
        };
        let result = compress(&diff, &opts).unwrap();
        assert!(result.compressed.contains("-old line"));
        assert!(result.compressed.contains("+new line"));
        assert!(result.compressed.contains("omitted"));
        assert!(result.ratio < 1.0);
    }

    #[test]
    fn preserves_hunk_headers() {
        let input = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -10,5 +10,5 @@\n-a\n+b\n";
        let result = compress(input, &DiffCompressOptions::default()).unwrap();
        assert!(result.compressed.contains("@@ -10,5 +10,5 @@"));
    }
}
